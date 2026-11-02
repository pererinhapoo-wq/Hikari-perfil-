/**
 * Controle de cooldown persistente e bloqueio de concorrência para sincronizações externas
 * (MyAnimeList e AniList), isolado estritamente por conta de usuário Hikari, provedor e conta externa.
 */

export type ExternalSyncProvider = 'mal' | 'anilist';
export type ExternalSyncMode = 'auto' | 'manual';

export interface ExternalSyncScope {
  /** UID autenticado ou identificador do perfil local */
  profileId: string;
  /** Provedor externo ('mal' | 'anilist') */
  provider: ExternalSyncProvider;
  /** Nome de usuário ou identificador da conta conectada no provedor */
  accountIdentifier: string;
  /** Janela de cooldown personalizada para sincronização automática (padrão: 30 min) */
  cooldownMs?: number;
}

export const DEFAULT_AUTO_SYNC_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos
export const SYNC_COOLDOWN_STORAGE_KEY = 'hikari_external_sync_cooldown_v1';

interface CooldownRecordMap {
  [scopedKey: string]: number;
}

// Cache write-through em memória para evitar JSON.parse repetido a cada verificação
let memoryCooldownMap: CooldownRecordMap | null = null;
let lastRawCooldownSnapshot: string | null = null;
let storageListenerAttached = false;

// Bloqueio em memória contra sincronizações simultâneas da mesma conta/provedor
const inFlightSyncKeys = new Set<string>();

function ensureStorageListener(): void {
  if (storageListenerAttached || typeof window === 'undefined') return;
  storageListenerAttached = true;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === SYNC_COOLDOWN_STORAGE_KEY) {
      memoryCooldownMap = null;
      lastRawCooldownSnapshot = null;
    }
  });
}

export function buildExternalSyncKey(scope: ExternalSyncScope): string {
  const uid = (scope.profileId || '__anonymous__').trim();
  const provider = scope.provider;
  const account = (scope.accountIdentifier || '__default__').trim().toLowerCase();
  return `${uid}::${provider}::${account}`;
}

function readCooldownMap(): CooldownRecordMap {
  ensureStorageListener();
  if (typeof window === 'undefined' || !window.localStorage) {
    if (!memoryCooldownMap) {
      memoryCooldownMap = {};
    }
    return memoryCooldownMap;
  }

  try {
    const raw = window.localStorage.getItem(SYNC_COOLDOWN_STORAGE_KEY);
    if (memoryCooldownMap !== null && raw === lastRawCooldownSnapshot) {
      return memoryCooldownMap;
    }
    lastRawCooldownSnapshot = raw;
    if (!raw) {
      memoryCooldownMap = {};
      return memoryCooldownMap;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const sanitized: CooldownRecordMap = {};
      for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
          sanitized[key] = val;
        }
      }
      memoryCooldownMap = sanitized;
      return memoryCooldownMap;
    }
  } catch {
    // Fallback seguro em memória se localStorage estiver indisponível
  }

  memoryCooldownMap = memoryCooldownMap ?? {};
  return memoryCooldownMap;
}

function writeCooldownMap(nextMap: CooldownRecordMap): void {
  memoryCooldownMap = nextMap;
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const serialized = JSON.stringify(nextMap);
    lastRawCooldownSnapshot = serialized;
    window.localStorage.setItem(SYNC_COOLDOWN_STORAGE_KEY, serialized);
  } catch {
    // Ignora erro de quota mantendo o estado em memória
  }
}

export function isExternalSyncInFlight(scope: ExternalSyncScope): boolean {
  return inFlightSyncKeys.has(buildExternalSyncKey(scope));
}

export function getLastExternalSyncTimestamp(scope: ExternalSyncScope): number | null {
  const key = buildExternalSyncKey(scope);
  const map = readCooldownMap();
  const ts = map[key];
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
}

export function recordExternalSyncSuccess(scope: ExternalSyncScope, timestampMs = Date.now()): void {
  const key = buildExternalSyncKey(scope);
  const current = readCooldownMap();
  const updated: CooldownRecordMap = {
    ...current,
    [key]: timestampMs,
  };
  writeCooldownMap(updated);
}

export function clearExternalSyncCooldown(scope?: ExternalSyncScope): void {
  if (!scope) {
    memoryCooldownMap = {};
    lastRawCooldownSnapshot = null;
    inFlightSyncKeys.clear();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(SYNC_COOLDOWN_STORAGE_KEY);
      } catch {
        // Ignora
      }
    }
    return;
  }

  const key = buildExternalSyncKey(scope);
  const current = readCooldownMap();
  if (key in current) {
    const next = { ...current };
    delete next[key];
    writeCooldownMap(next);
  }
}

export interface SyncEligibilityResult {
  allowed: boolean;
  reason?: 'in_flight' | 'cooldown';
  remainingMs: number;
  lastSyncedAtMs: number | null;
}

/**
 * Avalia se uma sincronização externa pode ser iniciada:
 * - Impede execuções simultâneas duplicadas para a mesma conta/provedor.
 * - Aplica cooldown persistente APENAS para sincronizações automáticas ('auto').
 * - Sincronizações manuais ('manual') solicitadas explicitamente pelo usuário NUNCA são bloqueadas pelo cooldown.
 */
export function checkExternalSyncEligibility(
  scope: ExternalSyncScope,
  mode: ExternalSyncMode,
  nowMs = Date.now()
): SyncEligibilityResult {
  const key = buildExternalSyncKey(scope);
  const lastSyncedAtMs = getLastExternalSyncTimestamp(scope);

  if (inFlightSyncKeys.has(key)) {
    return {
      allowed: false,
      reason: 'in_flight',
      remainingMs: 0,
      lastSyncedAtMs,
    };
  }

  if (mode === 'manual') {
    return {
      allowed: true,
      remainingMs: 0,
      lastSyncedAtMs,
    };
  }

  const cooldownMs = scope.cooldownMs ?? DEFAULT_AUTO_SYNC_COOLDOWN_MS;
  if (lastSyncedAtMs !== null) {
    const elapsed = Math.max(0, nowMs - lastSyncedAtMs);
    if (elapsed < cooldownMs) {
      return {
        allowed: false,
        reason: 'cooldown',
        remainingMs: cooldownMs - elapsed,
        lastSyncedAtMs,
      };
    }
  }

  return {
    allowed: true,
    remainingMs: 0,
    lastSyncedAtMs,
  };
}

export type GuardedSyncOutcome<T> =
  | {
      executed: true;
      data: T;
    }
  | {
      executed: false;
      reason: 'in_flight' | 'cooldown';
      remainingMs: number;
      lastSyncedAtMs: number | null;
    };

/**
 * Executa uma tarefa de sincronização protegida contra chamadas concorrentes e repetição automática.
 * Em caso de falha (ex: erro de rede ou limite 429 da API), libera o lock imediatamente sem gravar
 * falso sucesso de cooldown, permitindo nova tentativa pelo usuário.
 */
export async function runGuardedExternalSync<T>(
  scope: ExternalSyncScope,
  mode: ExternalSyncMode,
  task: () => Promise<T>,
  nowMs = Date.now()
): Promise<GuardedSyncOutcome<T>> {
  const check = checkExternalSyncEligibility(scope, mode, nowMs);
  if (!check.allowed) {
    return {
      executed: false,
      reason: check.reason!,
      remainingMs: check.remainingMs,
      lastSyncedAtMs: check.lastSyncedAtMs,
    };
  }

  const key = buildExternalSyncKey(scope);
  inFlightSyncKeys.add(key);
  try {
    const data = await task();
    recordExternalSyncSuccess(scope, Date.now());
    return {
      executed: true,
      data,
    };
  } finally {
    inFlightSyncKeys.delete(key);
  }
}
