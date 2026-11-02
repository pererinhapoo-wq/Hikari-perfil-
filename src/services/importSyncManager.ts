import { AnimeItem, UserProfile } from '../types';
import {
  fetchAniListAnimeChunk,
  mergeAniListImport,
  fetchAniListFavorites,
  type AniListAnimeEntry,
  type AniListChunkResult,
} from './anilistService';
import {
  fetchMALAnimeListBatch,
  mergeMALImport,
  type MALAnimeEntry,
  type MALBatchResult,
} from './malService';
import {
  clearExternalSyncCooldown,
  recordExternalSyncSuccess,
} from '../utils/syncCooldown';

export type ImportProvider = 'mal' | 'anilist';

export type ImportSyncStatus =
  | 'idle'
  | 'in_progress'
  | 'paused'
  | 'error'
  | 'completed';

export interface ImportCheckpoint {
  version?: number;
  provider: ImportProvider;
  accountIdentifier: string;
  profileId: string;
  cursor?: number; // offset para MAL (ex: 0, 1000, 2000), chunk para AniList (ex: 1, 2, 3)
  page?: number;
  totalEstimated?: number | null;
  recordsReceived: number;
  recordsProcessed: number;
  addedCount?: number;
  updatedCount?: number;
  unchangedCount?: number;
  preservedFieldsCount?: number;
  status: ImportSyncStatus;
  lastConfirmedCheckpoint?: number;
  lastConfirmedPoint?: string;
  lastUpdated?: string;
  updatedAtMs?: number;
  errorMessage?: string | null;
  lastError?: string | null;
}

export interface ImportProgressUpdate {
  checkpoint: ImportCheckpoint;
  currentBatchEntries: number;
  percentage: number | null;
  message: string;
}

export type ImportEvent = {
  type: 'progress' | 'batch_committed' | 'completed' | 'paused' | 'error' | 'cancelled';
  checkpoint: ImportCheckpoint;
};

export type ImportEventListener = (event: ImportEvent) => void;
const eventListeners = new Set<ImportEventListener>();

export function subscribeImportEvents(listener: ImportEventListener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

export function emitImportEvent(event: ImportEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('Erro no listener de importação:', err);
    }
  }
}

export interface StartImportOptions {
  profileId: string;
  provider: ImportProvider;
  accountIdentifier: string;
  idToken?: string; // Obrigatório para MAL
  currentAnimes?: AnimeItem[];
  existingAnimes?: AnimeItem[];
  totalEstimated?: number | null;
  updateExistingProgress?: boolean;
  onProgress?: (update: ImportProgressUpdate) => void;
  onBatchCommitted?: (batchResult: {
    checkpoint: ImportCheckpoint;
    mergedAnimes: AnimeItem[];
  } | AnimeItem[]) => Promise<void> | void;
  onCompleted?: (result: {
    checkpoint: ImportCheckpoint;
    mergedAnimes: AnimeItem[];
  }) => Promise<void> | void;
  onError?: (err: Error, checkpoint: ImportCheckpoint) => void;
}

// In-Memory active controllers for cancellation and pause triggers
interface ActiveImportController {
  isPaused: boolean;
  isCancelled: boolean;
  abortController: AbortController;
}

const activeControllers = new Map<string, ActiveImportController>();

// In-memory memory checkpoints for headless tests or fast retrieval
const inMemoryCheckpoints = new Map<string, ImportCheckpoint>();

function getCheckpointStorageKey(profileId: string, provider: ImportProvider, account: string): string {
  const cleanProfile = profileId.trim().toLowerCase();
  const cleanAcc = account.trim().toLowerCase();
  return `hikari_import_chk_${cleanProfile}_${provider}_${cleanAcc}`;
}

function getControllerKey(profileId: string, provider: ImportProvider, account: string): string {
  return `${profileId.trim()}:${provider}:${account.trim().toLowerCase()}`;
}

/**
 * Lê o checkpoint persistente de uma importação a partir do localStorage ou memória.
 */
export function getImportCheckpoint(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): ImportCheckpoint | null {
  const key = getCheckpointStorageKey(profileId, provider, accountIdentifier);
  const mem = inMemoryCheckpoints.get(key);
  if (mem) {
    return { ...mem };
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImportCheckpoint;
    if (
      parsed &&
      parsed.provider === provider &&
      parsed.profileId === profileId
    ) {
      inMemoryCheckpoints.set(key, parsed);
      return parsed;
    }
  } catch {
    // Falha silenciosa de leitura de localStorage
  }
  return null;
}

/**
 * Persiste o checkpoint de importação imediatamente no localStorage e em memória, e notifica ouvintes.
 */
export function saveImportCheckpoint(checkpoint: ImportCheckpoint): void {
  const key = getCheckpointStorageKey(checkpoint.profileId, checkpoint.provider, checkpoint.accountIdentifier);
  inMemoryCheckpoints.set(key, { ...checkpoint });

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, JSON.stringify(checkpoint));
    } catch {
      // Ignora erro de cota
    }
  }

  const eventType: ImportEvent['type'] =
    checkpoint.status === 'completed'
      ? 'completed'
      : checkpoint.status === 'paused'
      ? 'paused'
      : checkpoint.status === 'error'
      ? 'error'
      : 'progress';

  emitImportEvent({ type: eventType, checkpoint: { ...checkpoint } });
}

/**
 * Remove o checkpoint persistente (usado após conclusão com sucesso ou cancelamento explícito pelo usuário).
 */
export function clearImportCheckpoint(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): void {
  const key = getCheckpointStorageKey(profileId, provider, accountIdentifier);
  inMemoryCheckpoints.delete(key);

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/**
 * Verifica se uma importação desta conta e provedor já está em andamento (trava de concorrência).
 */
export function isImportInProgress(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): boolean {
  const ctrlKey = getControllerKey(profileId, provider, accountIdentifier);
  const ctrl = activeControllers.get(ctrlKey);
  return Boolean(ctrl && !ctrl.isPaused && !ctrl.isCancelled);
}

/**
 * Pausa uma importação ativa de forma segura, permitindo retomar de onde parou.
 */
export function pauseImport(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): boolean {
  const ctrlKey = getControllerKey(profileId, provider, accountIdentifier);
  const ctrl = activeControllers.get(ctrlKey);
  if (ctrl) {
    ctrl.isPaused = true;
    ctrl.abortController.abort();
    activeControllers.delete(ctrlKey);

    const chk = getImportCheckpoint(profileId, provider, accountIdentifier);
    if (chk) {
      chk.status = 'paused';
      chk.updatedAtMs = Date.now();
      saveImportCheckpoint(chk);
    }
    return true;
  }
  return false;
}

/**
 * Cancela com segurança uma importação ativa ou pausada, limpando o checkpoint sem corromper animes já importados.
 */
export function cancelImport(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): void {
  const ctrlKey = getControllerKey(profileId, provider, accountIdentifier);
  const ctrl = activeControllers.get(ctrlKey);
  if (ctrl) {
    ctrl.isCancelled = true;
    ctrl.abortController.abort();
    activeControllers.delete(ctrlKey);
  }

  clearImportCheckpoint(profileId, provider, accountIdentifier);
  emitImportEvent({
    type: 'cancelled',
    checkpoint: {
      profileId,
      provider,
      accountIdentifier,
      status: 'idle',
      recordsReceived: 0,
      recordsProcessed: 0,
      updatedAtMs: Date.now(),
    },
  });
}

/**
 * Inicia ou retoma uma importação paginada incremental e resiliente para AniList ou MyAnimeList.
 */
export async function startOrResumeImport(
  options: StartImportOptions
): Promise<{
  success: boolean;
  status: ImportSyncStatus;
  mergedAnimes: AnimeItem[];
  checkpoint: ImportCheckpoint;
}> {
  const {
    profileId,
    provider,
    accountIdentifier,
    idToken,
    currentAnimes,
    existingAnimes,
    totalEstimated = null,
    updateExistingProgress = true,
    onProgress,
    onBatchCommitted,
    onCompleted,
    onError,
  } = options;

  const ctrlKey = getControllerKey(profileId, provider, accountIdentifier);

  // 1. Trava contra execuções concorrentes simultâneas da mesma conta e provedor
  if (isImportInProgress(profileId, provider, accountIdentifier)) {
    throw new Error(
      `Já existe uma importação em andamento para a conta ${accountIdentifier} (${provider.toUpperCase()}).`
    );
  }

  const abortController = new AbortController();
  const activeCtrl: ActiveImportController = {
    isPaused: false,
    isCancelled: false,
    abortController,
  };
  activeControllers.set(ctrlKey, activeCtrl);

  // 2. Recuperação de Checkpoint existente ou inicialização de novo checkpoint
  const existingCheckpoint = getImportCheckpoint(profileId, provider, accountIdentifier);
  const isNewCheckpoint = !existingCheckpoint || existingCheckpoint.status === 'completed';

  const checkpoint: ImportCheckpoint = isNewCheckpoint
    ? {
        version: 1,
        provider,
        accountIdentifier,
        profileId,
        cursor: provider === 'mal' ? 0 : 1, // MAL usa offset (0, 1000..), AniList usa chunk (1, 2..)
        page: provider === 'mal' ? 0 : 1,
        totalEstimated,
        recordsReceived: 0,
        recordsProcessed: 0,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        preservedFieldsCount: 0,
        status: 'in_progress',
        lastConfirmedCheckpoint: Date.now(),
        lastConfirmedPoint: provider === 'mal' ? 'offset_0' : 'chunk_1',
        updatedAtMs: Date.now(),
        lastUpdated: new Date().toISOString(),
        errorMessage: null,
        lastError: null,
      }
    : {
        ...existingCheckpoint,
        status: 'in_progress',
        errorMessage: null,
        lastError: null,
        updatedAtMs: Date.now(),
        lastUpdated: new Date().toISOString(),
        addedCount: existingCheckpoint.addedCount ?? 0,
        updatedCount: existingCheckpoint.updatedCount ?? 0,
        unchangedCount: existingCheckpoint.unchangedCount ?? 0,
        preservedFieldsCount: existingCheckpoint.preservedFieldsCount ?? 0,
      };

  saveImportCheckpoint(checkpoint);

  const initialList = currentAnimes ?? existingAnimes ?? [];
  let workingAnimes = [...initialList];
  let hasMore = true;

  // Pré-busca de favoritos para AniList se for novo ou não buscado ainda
  const favAnilistIds = new Set<number>();
  const favMalIds = new Set<number>();
  if (provider === 'anilist') {
    try {
      const favResult = await fetchAniListFavorites(accountIdentifier, {
        signal: abortController.signal,
      });
      for (const id of favResult.animeAnilistIds) favAnilistIds.add(id);
      for (const id of favResult.animeMalIds) favMalIds.add(id);
    } catch {
      // Ignora erro em favoritos para não bloquear lista
    }
  }

  try {
    while (hasMore) {
      if (activeCtrl.isCancelled) {
        checkpoint.status = 'idle';
        clearImportCheckpoint(profileId, provider, accountIdentifier);
        activeControllers.delete(ctrlKey);
        return { success: false, status: 'idle', mergedAnimes: workingAnimes, checkpoint };
      }

      if (activeCtrl.isPaused) {
        checkpoint.status = 'paused';
        saveImportCheckpoint(checkpoint);
        activeControllers.delete(ctrlKey);
        return { success: false, status: 'paused', mergedAnimes: workingAnimes, checkpoint };
      }

      let incomingBatch: (AnimeItem | AniListAnimeEntry | MALAnimeEntry)[] = [];
      let batchHasMore = false;

      // 3. Consulta do lote respeitando paginação real de cada plataforma
      if (provider === 'anilist') {
        const chunkIndex = checkpoint.cursor ?? 1;
        const chunkRes: AniListChunkResult = await fetchAniListAnimeChunk(
          accountIdentifier,
          chunkIndex,
          {
            signal: abortController.signal,
            favAnilistIds,
            favMalIds,
          }
        );
        incomingBatch = chunkRes.entries;
        batchHasMore = chunkRes.hasNextChunk;
        checkpoint.cursor = chunkIndex + 1;
        checkpoint.page = chunkIndex + 1;
        checkpoint.lastConfirmedPoint = `chunk_${chunkIndex}`;
      } else {
        // MyAnimeList
        if (!idToken) {
          throw new Error('Token de autenticação do Firebase ausente para consulta segura do MyAnimeList.');
        }
        const offset = checkpoint.cursor ?? 0;
        const batchRes: MALBatchResult = await fetchMALAnimeListBatch(idToken, {
          offset,
          limit: 1000,
          signal: abortController.signal,
        });
        incomingBatch = batchRes.entries;
        batchHasMore = batchRes.hasMore;
        if (batchRes.nextOffset !== null) {
          checkpoint.cursor = batchRes.nextOffset;
        } else {
          checkpoint.cursor = offset + incomingBatch.length;
        }
        checkpoint.page = Math.floor((checkpoint.cursor || 0) / 1000) + 1;
        checkpoint.lastConfirmedPoint = `offset_${offset}`;
      }

      checkpoint.recordsReceived += incomingBatch.length;

      // 4. Mesclagem segura e idempotente com preservação estrita de dados locais
      let mergeResult: {
        mergedList: AnimeItem[];
        addedCount: number;
        updatedCount: number;
        unchangedCount: number;
        preservedFieldsCount: number;
      };

      if (provider === 'anilist') {
        mergeResult = mergeAniListImport(
          incomingBatch as AniListAnimeEntry[],
          workingAnimes,
          updateExistingProgress
        );
      } else {
        mergeResult = mergeMALImport(
          incomingBatch as MALAnimeEntry[],
          workingAnimes,
          updateExistingProgress
        );
      }

      workingAnimes = mergeResult.mergedList;
      checkpoint.recordsProcessed = workingAnimes.length;
      checkpoint.addedCount = (checkpoint.addedCount ?? 0) + mergeResult.addedCount;
      checkpoint.updatedCount = (checkpoint.updatedCount ?? 0) + mergeResult.updatedCount;
      checkpoint.unchangedCount = (checkpoint.unchangedCount ?? 0) + mergeResult.unchangedCount;
      checkpoint.preservedFieldsCount = (checkpoint.preservedFieldsCount ?? 0) + mergeResult.preservedFieldsCount;
      checkpoint.lastConfirmedCheckpoint = Date.now();
      checkpoint.updatedAtMs = Date.now();
      checkpoint.lastUpdated = new Date().toISOString();

      // Salva o progresso logo após a confirmação do lote
      saveImportCheckpoint(checkpoint);

      // 5. Notificação de progresso da interface
      const percentage =
        checkpoint.totalEstimated && checkpoint.totalEstimated > 0
          ? Math.min(99, Math.round((checkpoint.recordsReceived / checkpoint.totalEstimated) * 100))
          : null;

      const progressUpdate: ImportProgressUpdate = {
        checkpoint: { ...checkpoint },
        currentBatchEntries: incomingBatch.length,
        percentage,
        message: `${checkpoint.recordsReceived} animes recebidos (${mergeResult.addedCount} novos, ${mergeResult.updatedCount} atualizados)`,
      };

      if (onProgress) {
        onProgress(progressUpdate);
      }

      // 6. Callback de persistência incremental em bloco (Firestore particionado + IndexedDB)
      if (onBatchCommitted) {
        await onBatchCommitted({
          checkpoint: { ...checkpoint },
          mergedAnimes: workingAnimes,
        });
      }

      // Verificação de parada: API indicou fim definitivo da paginação
      if (!batchHasMore || incomingBatch.length === 0) {
        hasMore = false;
        break;
      }

      // Pequena pausa assíncrona entre lotes para manter a interface do usuário responsiva
      await new Promise((r) => setTimeout(r, 60));
    }

    // 7. Conclusão oficial e confirmada de toda a lista
    checkpoint.status = 'completed';
    checkpoint.updatedAtMs = Date.now();
    checkpoint.lastUpdated = new Date().toISOString();
    saveImportCheckpoint(checkpoint);

    // Registra sucesso e atualiza cooldown da Etapa 2
    recordExternalSyncSuccess({
      profileId,
      provider,
      accountIdentifier,
    });

    if (onCompleted) {
      await onCompleted({
        checkpoint: { ...checkpoint },
        mergedAnimes: workingAnimes,
      });
    }

    activeControllers.delete(ctrlKey);
    return {
      success: true,
      status: 'completed',
      mergedAnimes: workingAnimes,
      checkpoint,
    };
  } catch (err: unknown) {
    activeControllers.delete(ctrlKey);

    if (activeCtrl.isCancelled) {
      checkpoint.status = 'idle';
      clearImportCheckpoint(profileId, provider, accountIdentifier);
      return { success: false, status: 'idle', mergedAnimes: workingAnimes, checkpoint };
    }

    if (activeCtrl.isPaused) {
      checkpoint.status = 'paused';
      saveImportCheckpoint(checkpoint);
      return { success: false, status: 'paused', mergedAnimes: workingAnimes, checkpoint };
    }

    const errorMsg = err instanceof Error ? err.message : 'Falha na comunicação com a API externa.';
    checkpoint.status = 'error';
    checkpoint.errorMessage = errorMsg;
    checkpoint.lastError = errorMsg;
    checkpoint.updatedAtMs = Date.now();
    checkpoint.lastUpdated = new Date().toISOString();
    saveImportCheckpoint(checkpoint);

    if (onError) {
      onError(err instanceof Error ? err : new Error(errorMsg), checkpoint);
    }

    return {
      success: false,
      status: 'error',
      mergedAnimes: workingAnimes,
      checkpoint,
    };
  }
}
