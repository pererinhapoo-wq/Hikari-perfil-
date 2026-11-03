import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, firebaseConfigStatus, auth } from '../lib/firebase';
import type { ImportCheckpoint, ImportProvider } from './importSyncManager';

/**
 * Tipos de erros categorizados e auditáveis para persistência de checkpoints
 */
export type CheckpointStorageErrorType =
  | 'local_quota_exceeded'
  | 'local_storage_unavailable'
  | 'remote_permission_denied'
  | 'remote_unconfigured'
  | 'remote_network_error'
  | 'remote_write_error'
  | 'unauthenticated'
  | 'version_conflict'
  | 'divergence_conflict'
  | 'invalid_checkpoint';

export class CheckpointStorageError extends Error {
  public readonly code: CheckpointStorageErrorType;
  public readonly details?: string;

  constructor(code: CheckpointStorageErrorType, message: string, details?: string) {
    super(message);
    this.name = 'CheckpointStorageError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Interface para adaptadores de armazenamento remoto (Firestore oficial ou mocks em testes)
 */
export interface RemoteCheckpointStore {
  get(profileId: string, provider: ImportProvider, account: string): Promise<ImportCheckpoint | null>;
  set(
    checkpoint: ImportCheckpoint,
    expectedVersion?: number
  ): Promise<{ success: boolean; version: number; error?: CheckpointStorageError }>;
  delete(
    profileId: string,
    provider: ImportProvider,
    account: string
  ): Promise<{ success: boolean; error?: CheckpointStorageError }>;
}

let customRemoteStore: RemoteCheckpointStore | null = null;
let customLocalStorage: Storage | null = null;

export function setRemoteCheckpointStoreForTesting(store: RemoteCheckpointStore | null): void {
  customRemoteStore = store;
}

export function setLocalStorageAdapterForTesting(storage: Storage | null): void {
  customLocalStorage = storage;
}

export function getEffectiveLocalStorage(): Storage | null {
  if (customLocalStorage) return customLocalStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

/**
 * Sanitiza e gera chave local segura e isolada por perfil, provedor e conta.
 */
export function getLocalCheckpointKey(
  profileId: string,
  provider: ImportProvider,
  account: string
): string {
  const cleanProfile = profileId.trim().toLowerCase();
  const cleanAcc = account.trim().toLowerCase();
  return `hikari_import_chk_${cleanProfile}_${provider}_${cleanAcc}`;
}

/**
 * Sanitiza e gera o caminho canônico do documento remoto no Firestore:
 * Caminho: users/{profileId}/import_checkpoints/{provider}_{cleanAccount}
 *
 * Justificativa técnica:
 * - Vinculado ao UID do proprietário sob /users/{profileId}.
 * - Subcoleção dedicada `import_checkpoints` isola metadados operacionais da projeção pública.
 * - Id do documento `${provider}_${cleanAccount}` impede colisões entre MAL e AniList.
 */
export function getRemoteCheckpointDocPath(
  profileId: string,
  provider: ImportProvider,
  account: string
): { collectionPath: string; docId: string; fullPath: string } {
  const cleanProfile = profileId.trim();
  const cleanAcc = account
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  const docId = `${provider}_${cleanAcc}`;
  const collectionPath = `users/${cleanProfile}/import_checkpoints`;
  return {
    collectionPath,
    docId,
    fullPath: `${collectionPath}/${docId}`,
  };
}

/**
 * Sanitiza o checkpoint garantindo estritamente a NÃO inclusão de credenciais,
 * tokens de autenticação ou arrays de animes completos (Requisito 4 e 7).
 */
export function sanitizeCheckpointForStorage(checkpoint: ImportCheckpoint): ImportCheckpoint {
  const sanitized: ImportCheckpoint = {
    version: typeof checkpoint.version === 'number' && checkpoint.version > 0 ? checkpoint.version : 1,
    provider: checkpoint.provider,
    accountIdentifier: checkpoint.accountIdentifier.trim(),
    profileId: checkpoint.profileId.trim(),
    cursor: typeof checkpoint.cursor === 'number' ? checkpoint.cursor : 0,
    page: typeof checkpoint.page === 'number' ? checkpoint.page : 1,
    totalEstimated: typeof checkpoint.totalEstimated === 'number' ? checkpoint.totalEstimated : null,
    recordsReceived: typeof checkpoint.recordsReceived === 'number' ? checkpoint.recordsReceived : 0,
    recordsProcessed: typeof checkpoint.recordsProcessed === 'number' ? checkpoint.recordsProcessed : 0,
    recordsConfirmed:
      typeof checkpoint.recordsConfirmed === 'number'
        ? checkpoint.recordsConfirmed
        : checkpoint.recordsProcessed ?? 0,
    recordsPersisted:
      typeof checkpoint.recordsPersisted === 'number'
        ? checkpoint.recordsPersisted
        : checkpoint.recordsProcessed ?? 0,
    addedCount: typeof checkpoint.addedCount === 'number' ? checkpoint.addedCount : 0,
    updatedCount: typeof checkpoint.updatedCount === 'number' ? checkpoint.updatedCount : 0,
    unchangedCount: typeof checkpoint.unchangedCount === 'number' ? checkpoint.unchangedCount : 0,
    preservedFieldsCount:
      typeof checkpoint.preservedFieldsCount === 'number' ? checkpoint.preservedFieldsCount : 0,
    status: checkpoint.status,
    lastConfirmedCheckpoint:
      typeof checkpoint.lastConfirmedCheckpoint === 'number'
        ? checkpoint.lastConfirmedCheckpoint
        : Date.now(),
    lastConfirmedPoint:
      checkpoint.lastConfirmedPoint ||
      (checkpoint.provider === 'mal' ? `offset_${checkpoint.cursor ?? 0}` : `chunk_${checkpoint.cursor ?? 1}`),
    lastUpdated: checkpoint.lastUpdated || new Date().toISOString(),
    updatedAtMs: typeof checkpoint.updatedAtMs === 'number' ? checkpoint.updatedAtMs : Date.now(),
    errorMessage: checkpoint.errorMessage ?? null,
    lastError: checkpoint.lastError ?? null,
  };

  // Garante que nenhum token ou lista de animes esteja presente
  const rawObj = sanitized as unknown as Record<string, unknown>;
  delete rawObj.idToken;
  delete rawObj.accessToken;
  delete rawObj.refreshToken;
  delete rawObj.token;
  delete rawObj.animes;
  delete rawObj.workingAnimes;
  delete rawObj.mergedAnimes;

  return sanitized;
}

/**
 * Valida a integridade mínima de um checkpoint lido da persistência.
 */
export function validateCheckpointIntegrity(
  raw: unknown,
  expectedProfileId: string,
  expectedProvider: ImportProvider,
  expectedAccount: string
): { valid: boolean; checkpoint: ImportCheckpoint | null; error?: CheckpointStorageError } {
  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      checkpoint: null,
      error: new CheckpointStorageError('invalid_checkpoint', 'Checkpoint corrompido ou formato não reconhecido.'),
    };
  }

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.profileId !== 'string' ||
    candidate.profileId.trim() !== expectedProfileId.trim() ||
    candidate.provider !== expectedProvider ||
    typeof candidate.accountIdentifier !== 'string' ||
    candidate.accountIdentifier.trim().toLowerCase() !== expectedAccount.trim().toLowerCase()
  ) {
    return {
      valid: false,
      checkpoint: null,
      error: new CheckpointStorageError(
        'invalid_checkpoint',
        'Incompatibilidade de perfil, provedor ou identificador de conta no checkpoint.'
      ),
    };
  }

  const sanitized = sanitizeCheckpointForStorage(candidate as unknown as ImportCheckpoint);
  return { valid: true, checkpoint: sanitized };
}

/**
 * Implementação padrão do adaptador de persistência remota via Firebase Firestore
 */
export class FirestoreRemoteStore implements RemoteCheckpointStore {
  async get(profileId: string, provider: ImportProvider, account: string): Promise<ImportCheckpoint | null> {
    if (!firebaseConfigStatus.isInitialized || !db) {
      throw new CheckpointStorageError(
        'remote_unconfigured',
        'Firestore não inicializado no ambiente do cliente.'
      );
    }

    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== profileId) {
      throw new CheckpointStorageError(
        'unauthenticated',
        'Sessão do usuário não autenticada para leitura remota de checkpoints.'
      );
    }

    const { collectionPath, docId } = getRemoteCheckpointDocPath(profileId, provider, account);

    try {
      const docRef = doc(db, collectionPath, docId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return null;
      }
      const data = snap.data();
      const validation = validateCheckpointIntegrity(data, profileId, provider, account);
      if (!validation.valid || !validation.checkpoint) {
        throw validation.error || new CheckpointStorageError('invalid_checkpoint', 'Dados remotos inválidos.');
      }
      return validation.checkpoint;
    } catch (err: unknown) {
      if (err instanceof CheckpointStorageError) throw err;
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code === 'permission-denied' || code.includes('permission-denied')) {
        throw new CheckpointStorageError(
          'remote_permission_denied',
          'Permissão negada no Firestore para acessar a subcoleção de checkpoints.',
          code
        );
      }
      if (code === 'unavailable' || code.includes('network') || code.includes('timeout')) {
        throw new CheckpointStorageError(
          'remote_network_error',
          'Falha de rede ao consultar o checkpoint remoto no Firestore.',
          String(err)
        );
      }
      throw new CheckpointStorageError('remote_network_error', 'Falha ao ler checkpoint remoto.', String(err));
    }
  }

  async set(
    checkpoint: ImportCheckpoint,
    expectedVersion?: number
  ): Promise<{ success: boolean; version: number; error?: CheckpointStorageError }> {
    if (!firebaseConfigStatus.isInitialized || !db) {
      return {
        success: false,
        version: checkpoint.version ?? 1,
        error: new CheckpointStorageError('remote_unconfigured', 'Firestore não inicializado.'),
      };
    }

    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== checkpoint.profileId) {
      return {
        success: false,
        version: checkpoint.version ?? 1,
        error: new CheckpointStorageError(
          'unauthenticated',
          'Usuário não autenticado para gravar checkpoint remoto.'
        ),
      };
    }

    const { collectionPath, docId } = getRemoteCheckpointDocPath(
      checkpoint.profileId,
      checkpoint.provider,
      checkpoint.accountIdentifier
    );

    const docRef = doc(db, collectionPath, docId);
    const sanitized = sanitizeCheckpointForStorage(checkpoint);

    try {
      // Verificação de concorrência com optimistic locking
      if (typeof expectedVersion === 'number') {
        const existingSnap = await getDoc(docRef);
        if (existingSnap.exists()) {
          const currentData = existingSnap.data() as { version?: number };
          const currentRemoteVersion = currentData.version ?? 1;
          if (currentRemoteVersion > expectedVersion) {
            return {
              success: false,
              version: currentRemoteVersion,
              error: new CheckpointStorageError(
                'version_conflict',
                `Conflito de concorrência: versão remota (${currentRemoteVersion}) é mais recente que a esperada (${expectedVersion}).`
              ),
            };
          }
        }
      }

      const nextVersion = (sanitized.version ?? 1) + 1;
      const payloadToSave: ImportCheckpoint = {
        ...sanitized,
        version: nextVersion,
        updatedAtMs: Date.now(),
        lastUpdated: new Date().toISOString(),
      };

      await setDoc(docRef, payloadToSave);
      return { success: true, version: nextVersion };
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code === 'permission-denied' || code.includes('permission-denied')) {
        return {
          success: false,
          version: checkpoint.version ?? 1,
          error: new CheckpointStorageError(
            'remote_permission_denied',
            'Permissão negada ao salvar checkpoint remoto no Firestore.',
            code
          ),
        };
      }
      return {
        success: false,
        version: checkpoint.version ?? 1,
        error: new CheckpointStorageError(
          'remote_write_error',
          'Falha na gravação remota do checkpoint.',
          String(err)
        ),
      };
    }
  }

  async delete(
    profileId: string,
    provider: ImportProvider,
    account: string
  ): Promise<{ success: boolean; error?: CheckpointStorageError }> {
    if (!firebaseConfigStatus.isInitialized || !db) {
      return { success: false, error: new CheckpointStorageError('remote_unconfigured', 'Firestore não configurado.') };
    }

    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== profileId) {
      return { success: false, error: new CheckpointStorageError('unauthenticated', 'Não autenticado.') };
    }

    const { collectionPath, docId } = getRemoteCheckpointDocPath(profileId, provider, account);
    try {
      const docRef = doc(db, collectionPath, docId);
      await deleteDoc(docRef);
      return { success: true };
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code === 'permission-denied' || code.includes('permission-denied')) {
        return {
          success: false,
          error: new CheckpointStorageError(
            'remote_permission_denied',
            'Permissão negada ao remover checkpoint remoto.',
            code
          ),
        };
      }
      return {
        success: false,
        error: new CheckpointStorageError('remote_write_error', 'Falha ao remover checkpoint remoto.', String(err)),
      };
    }
  }
}

const defaultFirestoreStore = new FirestoreRemoteStore();

export function getActiveRemoteCheckpointStore(): RemoteCheckpointStore {
  return customRemoteStore || defaultFirestoreStore;
}

/**
 * Grava checkpoint local com tratamento explícito de quota excedida e falhas.
 */
export function saveLocalCheckpointSafe(
  checkpoint: ImportCheckpoint
): { success: boolean; error?: CheckpointStorageError } {
  const storage = getEffectiveLocalStorage();
  if (!storage) {
    return {
      success: false,
      error: new CheckpointStorageError(
        'local_storage_unavailable',
        'Armazenamento local (localStorage) não disponível no ambiente atual.'
      ),
    };
  }

  const key = getLocalCheckpointKey(
    checkpoint.profileId,
    checkpoint.provider,
    checkpoint.accountIdentifier
  );
  const sanitized = sanitizeCheckpointForStorage(checkpoint);

  try {
    storage.setItem(key, JSON.stringify(sanitized));
    return { success: true };
  } catch (err) {
    const isQuota =
      err instanceof Error &&
      (err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.message.toLowerCase().includes('quota'));
    const code: CheckpointStorageErrorType = isQuota
      ? 'local_quota_exceeded'
      : 'local_storage_unavailable';
    return {
      success: false,
      error: new CheckpointStorageError(
        code,
        isQuota
          ? 'Cota de armazenamento local excedida ao tentar salvar checkpoint.'
          : 'Falha de gravação no armazenamento local.',
        String(err)
      ),
    };
  }
}

/**
 * Lê checkpoint local validando formato e compatibilidade retroativa.
 */
export function readLocalCheckpointSafe(
  profileId: string,
  provider: ImportProvider,
  account: string
): { checkpoint: ImportCheckpoint | null; error?: CheckpointStorageError } {
  const storage = getEffectiveLocalStorage();
  if (!storage) {
    return {
      checkpoint: null,
      error: new CheckpointStorageError('local_storage_unavailable', 'localStorage indisponível.'),
    };
  }

  const key = getLocalCheckpointKey(profileId, provider, account);
  try {
    const raw = storage.getItem(key);
    if (!raw) return { checkpoint: null };
    const parsed: unknown = JSON.parse(raw);
    const validation = validateCheckpointIntegrity(parsed, profileId, provider, account);
    if (!validation.valid || !validation.checkpoint) {
      return { checkpoint: null, error: validation.error };
    }
    return { checkpoint: validation.checkpoint };
  } catch (err) {
    return {
      checkpoint: null,
      error: new CheckpointStorageError(
        'invalid_checkpoint',
        'Falha ao ler ou desserializar checkpoint local.',
        String(err)
      ),
    };
  }
}

/**
 * Remove checkpoint local.
 */
export function removeLocalCheckpointSafe(
  profileId: string,
  provider: ImportProvider,
  account: string
): { success: boolean; error?: CheckpointStorageError } {
  const storage = getEffectiveLocalStorage();
  if (!storage) {
    return { success: false, error: new CheckpointStorageError('local_storage_unavailable', 'localStorage indisponível.') };
  }

  const key = getLocalCheckpointKey(profileId, provider, account);
  try {
    storage.removeItem(key);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: new CheckpointStorageError('local_storage_unavailable', 'Falha ao remover checkpoint local.', String(err)),
    };
  }
}

/**
 * Resultado da reconciliação entre dispositivo local e armazenamento remoto
 */
export interface CheckpointReconciliationResult {
  checkpoint: ImportCheckpoint | null;
  source: 'local' | 'remote' | 'reconciled' | 'none';
  localCheckpoint: ImportCheckpoint | null;
  remoteCheckpoint: ImportCheckpoint | null;
  diverged: boolean;
  conflict?: CheckpointStorageError;
  diagnostic: string;
}

/**
 * Reconcilia de forma estrita e segura os checkpoints local e remoto.
 *
 * Algoritmo de Reconciliação (Requisitos 4, 5 e 6):
 * 1. Se apenas um existir e for comprovadamente válido, adota-o.
 * 2. Se ambos existirem, compara versões e progresso confirmado.
 * 3. Escolhe o último progresso comprovadamente confirmado (recordsConfirmed/recordsPersisted).
 * 4. Não escolhe automaticamente o cursor mais avançado se este não foi confirmado com sucesso.
 * 5. Se houver divergência não resolvida (ramificações conflitantes em dispositivos distintos),
 *    preserva ambos os estados e reporta erro controlado sem avançar cursor.
 */
export function reconcileCheckpoints(
  local: ImportCheckpoint | null,
  remote: ImportCheckpoint | null
): CheckpointReconciliationResult {
  if (!local && !remote) {
    return {
      checkpoint: null,
      source: 'none',
      localCheckpoint: null,
      remoteCheckpoint: null,
      diverged: false,
      diagnostic: 'Nenhum checkpoint existente em disco ou na nuvem.',
    };
  }

  if (remote && !local) {
    return {
      checkpoint: { ...remote },
      source: 'remote',
      localCheckpoint: null,
      remoteCheckpoint: { ...remote },
      diverged: false,
      diagnostic: `Retomando em novo dispositivo via checkpoint remoto (@${remote.accountIdentifier}, cursor: ${remote.cursor}, confirmados: ${remote.recordsConfirmed ?? remote.recordsProcessed}).`,
    };
  }

  if (local && !remote) {
    return {
      checkpoint: { ...local },
      source: 'local',
      localCheckpoint: { ...local },
      remoteCheckpoint: null,
      diverged: false,
      diagnostic: `Utilizando checkpoint local (@${local.accountIdentifier}, cursor: ${local.cursor}, confirmados: ${local.recordsConfirmed ?? local.recordsProcessed}).`,
    };
  }

  // Ambos existem: comparação rigorosa
  const loc = local!;
  const rem = remote!;

  const localConfirmed = loc.recordsConfirmed ?? loc.recordsProcessed ?? 0;
  const remoteConfirmed = rem.recordsConfirmed ?? rem.recordsProcessed ?? 0;

  const localVersion = loc.version ?? 1;
  const remoteVersion = rem.version ?? 1;

  // Caso 1: Checkpoints idênticos em versão e progresso confirmado
  if (localVersion === remoteVersion && loc.cursor === rem.cursor && localConfirmed === remoteConfirmed) {
    return {
      checkpoint: { ...rem },
      source: 'reconciled',
      localCheckpoint: loc,
      remoteCheckpoint: rem,
      diverged: false,
      diagnostic: 'Checkpoints local e remoto perfeitamente sincronizados.',
    };
  }

  // Caso 2: Remoto mais avançado comprovadamente confirmado (outro dispositivo continuou a importação)
  if (remoteVersion >= localVersion && remoteConfirmed >= localConfirmed && (rem.cursor ?? 0) >= (loc.cursor ?? 0)) {
    return {
      checkpoint: { ...rem },
      source: 'remote',
      localCheckpoint: loc,
      remoteCheckpoint: rem,
      diverged: false,
      diagnostic: `Progresso remoto mais recente adotado (versão ${remoteVersion} vs ${localVersion}, ${remoteConfirmed} vs ${localConfirmed} animes confirmados).`,
    };
  }

  // Caso 3: Local mais avançado comprovadamente confirmado (este dispositivo avançou lote antes de sincronização remota)
  if (localVersion > remoteVersion && localConfirmed >= remoteConfirmed && (loc.cursor ?? 0) >= (rem.cursor ?? 0)) {
    return {
      checkpoint: { ...loc },
      source: 'local',
      localCheckpoint: loc,
      remoteCheckpoint: rem,
      diverged: false,
      diagnostic: `Progresso local confirmado mais recente adotado (versão ${localVersion} vs ${remoteVersion}, ${localConfirmed} confirmados).`,
    };
  }

  // Caso 4: Divergência conflitante não reconciliável automaticamente
  // Exemplo: Dispositivo A processou chunk X com cursor 1000, Dispositivo B processou chunk Y com cursor 800 e contagens divergentes
  const conflictError = new CheckpointStorageError(
    'divergence_conflict',
    'Conflito de concorrência entre dispositivos: os checkpoints local e remoto divergiram sem resolução segura automática.',
    `Local (v${localVersion}, cursor ${loc.cursor}, confirmados ${localConfirmed}) vs Remoto (v${remoteVersion}, cursor ${rem.cursor}, confirmados ${remoteConfirmed})`
  );

  return {
    checkpoint: null,
    source: 'reconciled',
    localCheckpoint: loc,
    remoteCheckpoint: rem,
    diverged: true,
    conflict: conflictError,
    diagnostic: conflictError.message,
  };
}
