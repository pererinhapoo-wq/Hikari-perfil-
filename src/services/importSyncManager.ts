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
import {
  readLocalCheckpointSafe,
  saveLocalCheckpointSafe,
  removeLocalCheckpointSafe,
  reconcileCheckpoints,
  getActiveRemoteCheckpointStore,
  sanitizeCheckpointForStorage,
  getLocalCheckpointKey,
  CheckpointStorageError,
  type CheckpointReconciliationResult,
} from './importCheckpointStorage';

export {
  CheckpointStorageError,
  type CheckpointStorageErrorType,
  setRemoteCheckpointStoreForTesting,
  setLocalStorageAdapterForTesting,
} from './importCheckpointStorage';

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
  recordsConfirmed?: number;
  recordsPersisted?: number;
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
  storageSource?: 'local' | 'remote' | 'reconciled' | 'memory';
  storageError?: string | null;
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

// In-memory memory checkpoints for fast retrieval and headless test consistency
const inMemoryCheckpoints = new Map<string, ImportCheckpoint>();

export function clearInMemoryCheckpointsForTesting(): void {
  inMemoryCheckpoints.clear();
}

function getControllerKey(profileId: string, provider: ImportProvider, account: string): string {
  return `${profileId.trim()}:${provider}:${account.trim().toLowerCase()}`;
}

/**
 * Lê o checkpoint persistente de uma importação de forma síncrona a partir da memória ou localStorage.
 * Mantém 100% de compatibilidade com componentes React e suítes existentes.
 */
export function getImportCheckpoint(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): ImportCheckpoint | null {
  const memKey = getLocalCheckpointKey(profileId, provider, accountIdentifier);
  const mem = inMemoryCheckpoints.get(memKey);
  if (mem) {
    return { ...mem };
  }

  const { checkpoint } = readLocalCheckpointSafe(profileId, provider, accountIdentifier);
  if (checkpoint) {
    inMemoryCheckpoints.set(memKey, checkpoint);
    return { ...checkpoint };
  }

  return null;
}

/**
 * Consulta e reconcilia assincronamente os checkpoints local e remoto entre múltiplos dispositivos.
 */
export async function getOrReconcileImportCheckpoint(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): Promise<CheckpointReconciliationResult> {
  const memKey = getLocalCheckpointKey(profileId, provider, accountIdentifier);

  // 1. Leitura Local (memória ou localStorage)
  let localCheckpoint = inMemoryCheckpoints.get(memKey) || null;
  if (!localCheckpoint) {
    const localRes = readLocalCheckpointSafe(profileId, provider, accountIdentifier);
    localCheckpoint = localRes.checkpoint;
  }

  // 2. Leitura Remota (Firestore / remote store)
  let remoteCheckpoint: ImportCheckpoint | null = null;
  let remoteReadError: CheckpointStorageError | undefined;

  try {
    const remoteStore = getActiveRemoteCheckpointStore();
    remoteCheckpoint = await remoteStore.get(profileId, provider, accountIdentifier);
  } catch (err: unknown) {
    if (err instanceof CheckpointStorageError) {
      remoteReadError = err;
    } else {
      remoteReadError = new CheckpointStorageError('remote_network_error', String(err));
    }
  }

  // 3. Reconciliação segura
  const reconciledResult = reconcileCheckpoints(localCheckpoint, remoteCheckpoint);

  if (reconciledResult.checkpoint) {
    const adopted = { ...reconciledResult.checkpoint };
    inMemoryCheckpoints.set(memKey, adopted);
    saveLocalCheckpointSafe(adopted);
  }

  if (remoteReadError && !reconciledResult.conflict) {
    reconciledResult.diagnostic += ` [Aviso remoto: ${remoteReadError.message}]`;
  }

  return reconciledResult;
}

/**
 * Grava assincronamente o checkpoint em ambas as camadas (local e remota) com auditoria de erros.
 */
export async function saveImportCheckpointAsync(
  checkpoint: ImportCheckpoint,
  expectedRemoteVersion?: number
): Promise<{
  localSuccess: boolean;
  remoteSuccess: boolean;
  checkpoint: ImportCheckpoint;
  localError?: CheckpointStorageError;
  remoteError?: CheckpointStorageError;
}> {
  const sanitized = sanitizeCheckpointForStorage(checkpoint);
  const memKey = getLocalCheckpointKey(
    sanitized.profileId,
    sanitized.provider,
    sanitized.accountIdentifier
  );

  inMemoryCheckpoints.set(memKey, { ...sanitized });

  // 1. Gravação local segura
  const localRes = saveLocalCheckpointSafe(sanitized);

  // 2. Gravação remota segura
  let remoteSuccess = false;
  let remoteError: CheckpointStorageError | undefined;
  let updatedRemoteVersion = sanitized.version ?? 1;

  try {
    const remoteStore = getActiveRemoteCheckpointStore();
    const remRes = await remoteStore.set(sanitized, expectedRemoteVersion);
    remoteSuccess = remRes.success;
    remoteError = remRes.error;
    if (remRes.success) {
      updatedRemoteVersion = remRes.version;
    }
  } catch (err: unknown) {
    remoteSuccess = false;
    remoteError =
      err instanceof CheckpointStorageError
        ? err
        : new CheckpointStorageError('remote_write_error', String(err));
  }

  const finalCheckpoint: ImportCheckpoint = {
    ...sanitized,
    version: remoteSuccess ? updatedRemoteVersion : sanitized.version,
    storageSource: remoteSuccess ? (localRes.success ? 'reconciled' : 'remote') : 'local',
    storageError: remoteError?.message || localRes.error?.message || null,
  };

  inMemoryCheckpoints.set(memKey, finalCheckpoint);

  const eventType: ImportEvent['type'] =
    finalCheckpoint.status === 'completed'
      ? 'completed'
      : finalCheckpoint.status === 'paused'
      ? 'paused'
      : finalCheckpoint.status === 'error'
      ? 'error'
      : 'progress';

  emitImportEvent({ type: eventType, checkpoint: { ...finalCheckpoint } });

  return {
    localSuccess: localRes.success,
    remoteSuccess,
    checkpoint: finalCheckpoint,
    localError: localRes.error,
    remoteError,
  };
}

/**
 * Persiste o checkpoint de importação imediatamente no armazenamento local e em memória,
 * disparando a gravação remota em segundo plano para compatibilidade com chamadas síncronas existentes.
 */
export function saveImportCheckpoint(checkpoint: ImportCheckpoint): void {
  const sanitized = sanitizeCheckpointForStorage(checkpoint);
  const memKey = getLocalCheckpointKey(
    sanitized.profileId,
    sanitized.provider,
    sanitized.accountIdentifier
  );

  inMemoryCheckpoints.set(memKey, { ...sanitized });
  saveLocalCheckpointSafe(sanitized);

  const eventType: ImportEvent['type'] =
    sanitized.status === 'completed'
      ? 'completed'
      : sanitized.status === 'paused'
      ? 'paused'
      : sanitized.status === 'error'
      ? 'error'
      : 'progress';

  emitImportEvent({ type: eventType, checkpoint: { ...sanitized } });

  // Sincronização remota assíncrona em segundo plano sem quebrar a assinatura síncrona
  void (async () => {
    try {
      const remoteStore = getActiveRemoteCheckpointStore();
      await remoteStore.set(sanitized);
    } catch {
      // Ignora falhas não fatais em chamadas fire-and-forget
    }
  })();
}

/**
 * Remove o checkpoint persistente local e remotamente (conclusão ou cancelamento).
 */
export async function clearImportCheckpointAsync(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): Promise<{ localSuccess: boolean; remoteSuccess: boolean }> {
  const memKey = getLocalCheckpointKey(profileId, provider, accountIdentifier);
  inMemoryCheckpoints.delete(memKey);

  const localRes = removeLocalCheckpointSafe(profileId, provider, accountIdentifier);

  let remoteSuccess = false;
  try {
    const remoteStore = getActiveRemoteCheckpointStore();
    const remRes = await remoteStore.delete(profileId, provider, accountIdentifier);
    remoteSuccess = remRes.success;
  } catch {
    remoteSuccess = false;
  }

  return { localSuccess: localRes.success, remoteSuccess };
}

/**
 * Versão síncrona de limpeza de checkpoint (compatibilidade retroativa).
 */
export function clearImportCheckpoint(
  profileId: string,
  provider: ImportProvider,
  accountIdentifier: string
): void {
  const memKey = getLocalCheckpointKey(profileId, provider, accountIdentifier);
  inMemoryCheckpoints.delete(memKey);
  removeLocalCheckpointSafe(profileId, provider, accountIdentifier);

  // Limpeza remota disparada em segundo plano
  void (async () => {
    try {
      const remoteStore = getActiveRemoteCheckpointStore();
      await remoteStore.delete(profileId, provider, accountIdentifier);
    } catch {
      // ignore
    }
  })();
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
      recordsConfirmed: 0,
      recordsPersisted: 0,
      updatedAtMs: Date.now(),
    },
  });
}

/**
 * Inicia ou retoma uma importação paginada incremental e resiliente para AniList ou MyAnimeList.
 * Garante que o cursor do checkpoint só avance definitivamente após confirmação de persistência (onBatchCommitted).
 * Reconcilia checkpoints remotos entre dispositivos antes de iniciar ou retomar (Etapa 4).
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

  // 1. Trava contra execuções concorrentes simultâneas da mesma conta e provedor no mesmo cliente
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

  // 2. Reconciliação entre Dispositivos (Etapa 4): consulta local e remoto
  const reconciliation = await getOrReconcileImportCheckpoint(
    profileId,
    provider,
    accountIdentifier
  );

  // Se houve conflito não resolvido entre versões de dispositivos diferentes, interrompe sem avançar
  if (reconciliation.diverged && reconciliation.conflict) {
    activeControllers.delete(ctrlKey);
    const conflictCheckpoint: ImportCheckpoint = {
      profileId,
      provider,
      accountIdentifier,
      status: 'error',
      recordsReceived: reconciliation.localCheckpoint?.recordsReceived ?? 0,
      recordsProcessed: reconciliation.localCheckpoint?.recordsProcessed ?? 0,
      recordsConfirmed: reconciliation.localCheckpoint?.recordsConfirmed ?? 0,
      recordsPersisted: reconciliation.localCheckpoint?.recordsPersisted ?? 0,
      errorMessage: reconciliation.conflict.message,
      lastError: reconciliation.conflict.message,
      updatedAtMs: Date.now(),
      lastUpdated: new Date().toISOString(),
    };
    if (onError) onError(reconciliation.conflict, conflictCheckpoint);
    return {
      success: false,
      status: 'error',
      mergedAnimes: currentAnimes ?? existingAnimes ?? [],
      checkpoint: conflictCheckpoint,
    };
  }

  const existingCheckpoint = reconciliation.checkpoint;
  const isNewCheckpoint = !existingCheckpoint || existingCheckpoint.status === 'completed';

  const initialCursor = provider === 'mal' ? 0 : 1;
  const initialPoint = provider === 'mal' ? 'offset_0' : 'chunk_1';

  const checkpoint: ImportCheckpoint = isNewCheckpoint
    ? {
        version: 1,
        provider,
        accountIdentifier,
        profileId,
        cursor: initialCursor,
        page: initialCursor,
        totalEstimated,
        recordsReceived: 0,
        recordsProcessed: 0,
        recordsConfirmed: 0,
        recordsPersisted: 0,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        preservedFieldsCount: 0,
        status: 'in_progress',
        lastConfirmedCheckpoint: Date.now(),
        lastConfirmedPoint: initialPoint,
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
        recordsReceived: existingCheckpoint.recordsReceived ?? 0,
        recordsProcessed: existingCheckpoint.recordsProcessed ?? 0,
        recordsConfirmed: existingCheckpoint.recordsConfirmed ?? existingCheckpoint.recordsProcessed ?? 0,
        recordsPersisted: existingCheckpoint.recordsPersisted ?? existingCheckpoint.recordsProcessed ?? 0,
        addedCount: existingCheckpoint.addedCount ?? 0,
        updatedCount: existingCheckpoint.updatedCount ?? 0,
        unchangedCount: existingCheckpoint.unchangedCount ?? 0,
        preservedFieldsCount: existingCheckpoint.preservedFieldsCount ?? 0,
      };

  await saveImportCheckpointAsync(checkpoint);

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
        await saveImportCheckpointAsync(checkpoint);
        activeControllers.delete(ctrlKey);
        return { success: false, status: 'paused', mergedAnimes: workingAnimes, checkpoint };
      }

      // PASSO 1: Receber o lote da API externa sem avançar o cursor de checkpoint confirmado
      let incomingBatch: (AnimeItem | AniListAnimeEntry | MALAnimeEntry)[] = [];
      let batchHasMore = false;
      const currentBatchCursor = checkpoint.cursor ?? (provider === 'mal' ? 0 : 1);
      let candidateNextCursor = currentBatchCursor;
      let candidateNextPage = checkpoint.page ?? 1;
      let candidateConfirmedPoint =
        checkpoint.lastConfirmedPoint ||
        (provider === 'mal' ? `offset_${currentBatchCursor}` : `chunk_${currentBatchCursor}`);

      if (provider === 'anilist') {
        const chunkIndex = currentBatchCursor;
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
        candidateNextCursor = chunkIndex + 1;
        candidateNextPage = chunkIndex + 1;
        candidateConfirmedPoint = `chunk_${chunkIndex}`;
      } else {
        // MyAnimeList
        if (!idToken) {
          throw new Error('Token de autenticação do Firebase ausente para consulta segura do MyAnimeList.');
        }
        const offset = currentBatchCursor;
        const batchRes: MALBatchResult = await fetchMALAnimeListBatch(idToken, {
          offset,
          limit: 1000,
          signal: abortController.signal,
        });
        incomingBatch = batchRes.entries;
        batchHasMore = batchRes.hasMore;
        if (batchRes.nextOffset !== null) {
          candidateNextCursor = batchRes.nextOffset;
        } else {
          candidateNextCursor = offset + incomingBatch.length;
        }
        candidateNextPage = Math.floor((candidateNextCursor || 0) / 1000) + 1;
        candidateConfirmedPoint = `offset_${offset}`;
      }

      // Registros recebidos da API (telemetria em memória do lote)
      const batchRecordsReceived = incomingBatch.length;
      const candidateRecordsReceived = (checkpoint.recordsReceived ?? 0) + batchRecordsReceived;

      // PASSO 2: Mesclagem segura e idempotente em memória preservando estritamente campos locais
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
          updateExistingProgress,
          accountIdentifier
        );
      } else {
        mergeResult = mergeMALImport(
          incomingBatch as MALAnimeEntry[],
          workingAnimes,
          updateExistingProgress,
          accountIdentifier
        );
      }

      const nextWorkingAnimes = mergeResult.mergedList;

      // PASSO 3: Preparar o próximo checkpoint como candidato NÃO confirmado
      const candidateCheckpoint: ImportCheckpoint = {
        ...checkpoint,
        version: (checkpoint.version ?? 1) + 1,
        cursor: candidateNextCursor,
        page: candidateNextPage,
        recordsReceived: candidateRecordsReceived,
        recordsProcessed: nextWorkingAnimes.length,
        recordsConfirmed: nextWorkingAnimes.length,
        recordsPersisted: nextWorkingAnimes.length,
        addedCount: (checkpoint.addedCount ?? 0) + mergeResult.addedCount,
        updatedCount: (checkpoint.updatedCount ?? 0) + mergeResult.updatedCount,
        unchangedCount: (checkpoint.unchangedCount ?? 0) + mergeResult.unchangedCount,
        preservedFieldsCount:
          (checkpoint.preservedFieldsCount ?? 0) + mergeResult.preservedFieldsCount,
        lastConfirmedPoint: candidateConfirmedPoint,
        lastConfirmedCheckpoint: Date.now(),
        updatedAtMs: Date.now(),
        lastUpdated: new Date().toISOString(),
      };

      // Checagem de interrupção ou cancelamento antes da persistência
      if (activeCtrl.isCancelled) {
        checkpoint.status = 'idle';
        clearImportCheckpoint(profileId, provider, accountIdentifier);
        activeControllers.delete(ctrlKey);
        return { success: false, status: 'idle', mergedAnimes: workingAnimes, checkpoint };
      }

      if (activeCtrl.isPaused) {
        checkpoint.status = 'paused';
        await saveImportCheckpointAsync(checkpoint);
        activeControllers.delete(ctrlKey);
        return { success: false, status: 'paused', mergedAnimes: workingAnimes, checkpoint };
      }

      // PASSO 4 & 5: Executar persistência incremental e confirmar gravações oficiais
      // Se onBatchCommitted lançar erro, a execução salta para o catch SEM salvar o novo cursor.
      if (onBatchCommitted) {
        await onBatchCommitted({
          checkpoint: { ...candidateCheckpoint },
          mergedAnimes: nextWorkingAnimes,
        });
      }

      // PASSO 6: Somente após a resolução com sucesso de onBatchCommitted o checkpoint avança
      workingAnimes = nextWorkingAnimes;
      checkpoint.version = candidateCheckpoint.version;
      checkpoint.cursor = candidateCheckpoint.cursor;
      checkpoint.page = candidateCheckpoint.page;
      checkpoint.recordsReceived = candidateCheckpoint.recordsReceived;
      checkpoint.recordsProcessed = candidateCheckpoint.recordsProcessed;
      checkpoint.recordsConfirmed = candidateCheckpoint.recordsConfirmed;
      checkpoint.recordsPersisted = candidateCheckpoint.recordsPersisted;
      checkpoint.addedCount = candidateCheckpoint.addedCount;
      checkpoint.updatedCount = candidateCheckpoint.updatedCount;
      checkpoint.unchangedCount = candidateCheckpoint.unchangedCount;
      checkpoint.preservedFieldsCount = candidateCheckpoint.preservedFieldsCount;
      checkpoint.lastConfirmedPoint = candidateCheckpoint.lastConfirmedPoint;
      checkpoint.lastConfirmedCheckpoint = candidateCheckpoint.lastConfirmedCheckpoint;
      checkpoint.updatedAtMs = candidateCheckpoint.updatedAtMs;
      checkpoint.lastUpdated = candidateCheckpoint.lastUpdated;

      await saveImportCheckpointAsync(checkpoint);

      // PASSO 7: Atualizar o estado visual e comunicar o progresso confirmado
      const percentage =
        checkpoint.totalEstimated && checkpoint.totalEstimated > 0
          ? Math.min(
              99,
              Math.round(
                ((checkpoint.recordsConfirmed ?? checkpoint.recordsProcessed) /
                  checkpoint.totalEstimated) *
                  100
              )
            )
          : null;

      const progressUpdate: ImportProgressUpdate = {
        checkpoint: { ...checkpoint },
        currentBatchEntries: batchRecordsReceived,
        percentage,
        message: `${checkpoint.recordsConfirmed ?? checkpoint.recordsProcessed} animes confirmados (${checkpoint.addedCount} novos, ${checkpoint.updatedCount} atualizados)`,
      };

      if (onProgress) {
        onProgress(progressUpdate);
      }

      // Verificação de parada: API indicou fim definitivo da paginação
      if (!batchHasMore || incomingBatch.length === 0) {
        hasMore = false;
        break;
      }

      // Pequena pausa assíncrona entre lotes para manter a interface responsiva
      await new Promise((r) => setTimeout(r, 60));
    }

    // 8. Conclusão oficial e confirmada de toda a lista após todos os lotes persistidos
    checkpoint.status = 'completed';
    checkpoint.recordsConfirmed = workingAnimes.length;
    checkpoint.recordsPersisted = workingAnimes.length;
    checkpoint.recordsProcessed = workingAnimes.length;
    checkpoint.updatedAtMs = Date.now();
    checkpoint.lastUpdated = new Date().toISOString();
    await saveImportCheckpointAsync(checkpoint);

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
      await saveImportCheckpointAsync(checkpoint);
      return { success: false, status: 'paused', mergedAnimes: workingAnimes, checkpoint };
    }

    // Em caso de falha durante a persistência, o checkpoint preserva o último cursor confirmado
    const errorMsg =
      err instanceof Error ? err.message : 'Falha na comunicação ou persistência da importação.';
    checkpoint.status = 'error';
    checkpoint.errorMessage = errorMsg;
    checkpoint.lastError = errorMsg;
    checkpoint.updatedAtMs = Date.now();
    checkpoint.lastUpdated = new Date().toISOString();
    await saveImportCheckpointAsync(checkpoint);

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

export const startImport = startOrResumeImport;
