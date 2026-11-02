import type { AnimeItem, UserActivity, HikariComment, FollowUser } from '../types';

/**
 * Camada de armazenamento IndexedDB do Hikari para conjuntos extensos de dados no navegador.
 * Projetada para perfis com milhares de animes, atividades e comentários, operando como cache
 * local assíncrono de alto desempenho que previne o estouro da cota de 5 MiB do localStorage.
 *
 * Princípios de segurança e resiliência:
 * - Não armazena senhas, tokens de autenticação ou credenciais confidenciais.
 * - Isolamento estrito por `profileId`.
 * - Tratamento gracioso de indisponibilidade (navegação anônima restrita, quota excedida, corrupção).
 * - Fallback em memória caso o IndexedDB esteja desativado ou inacessível no ambiente.
 */

const DB_NAME = 'hikari_local_cache_v1';
const DB_VERSION = 1;

export const STORES = {
  ANIMES: 'animes',
  ACTIVITIES: 'activities',
  COMMENTS: 'comments',
  FOLLOWERS: 'followers',
  META: 'metadata',
} as const;

export interface IndexedDbMetrics {
  reads: number;
  writes: number;
  deletes: number;
  fallbackOperations: number;
  errors: number;
}

const metrics: IndexedDbMetrics = {
  reads: 0,
  writes: 0,
  deletes: 0,
  fallbackOperations: 0,
  errors: 0,
};

export function getIndexedDbMetrics(): IndexedDbMetrics {
  return { ...metrics };
}

export function resetIndexedDbMetrics(): void {
  metrics.reads = 0;
  metrics.writes = 0;
  metrics.deletes = 0;
  metrics.fallbackOperations = 0;
  metrics.errors = 0;
}

// In-Memory fallback store for environments without IndexedDB (e.g. Node tests, restricted iframes)
class InMemoryStoreFallback {
  private animes = new Map<string, AnimeItem[]>();
  private activities = new Map<string, UserActivity[]>();
  private comments = new Map<string, HikariComment[]>();
  private followers = new Map<string, FollowUser[]>();
  private metadata = new Map<string, Record<string, unknown>>();

  getAnimes(profileId: string): AnimeItem[] | null {
    const list = this.animes.get(profileId);
    return list ? list.map((a) => ({ ...a })) : null;
  }

  getAnimesByCategory(profileId: string, status: AnimeItem['status']): AnimeItem[] | null {
    const list = this.animes.get(profileId);
    if (!list) return null;
    return list.filter((a) => a.status === status).map((a) => ({ ...a }));
  }

  saveAnimes(profileId: string, animes: AnimeItem[]): void {
    this.animes.set(profileId, animes.map((a) => ({ ...a })));
  }

  upsertAnime(profileId: string, anime: AnimeItem): void {
    const list = this.animes.get(profileId) || [];
    const idx = list.findIndex((a) => a.id === anime.id);
    if (idx >= 0) {
      list[idx] = { ...anime };
    } else {
      list.push({ ...anime });
    }
    this.animes.set(profileId, list);
  }

  removeAnime(profileId: string, animeId: string): void {
    const list = this.animes.get(profileId) || [];
    this.animes.set(profileId, list.filter((a) => a.id !== animeId));
  }

  getActivities(profileId: string): UserActivity[] | null {
    const list = this.activities.get(profileId);
    return list ? list.map((a) => ({ ...a })) : null;
  }

  saveActivities(profileId: string, activities: UserActivity[]): void {
    this.activities.set(profileId, activities.map((a) => ({ ...a })));
  }

  getComments(profileId: string): HikariComment[] | null {
    const list = this.comments.get(profileId);
    return list ? list.map((c) => ({ ...c })) : null;
  }

  saveComments(profileId: string, comments: HikariComment[]): void {
    this.comments.set(profileId, comments.map((c) => ({ ...c })));
  }

  getFollowers(profileId: string): FollowUser[] | null {
    const list = this.followers.get(profileId);
    return list ? list.map((f) => ({ ...f })) : null;
  }

  saveFollowers(profileId: string, followers: FollowUser[]): void {
    this.followers.set(profileId, followers.map((f) => ({ ...f })));
  }

  getMeta(profileId: string): Record<string, unknown> | null {
    const m = this.metadata.get(profileId);
    return m ? { ...m } : null;
  }

  saveMeta(profileId: string, data: Record<string, unknown>): void {
    const existing = this.metadata.get(profileId) || {};
    this.metadata.set(profileId, { ...existing, ...data });
  }

  clearProfile(profileId: string): void {
    this.animes.delete(profileId);
    this.activities.delete(profileId);
    this.comments.delete(profileId);
    this.followers.delete(profileId);
    this.metadata.delete(profileId);
  }

  clearAll(): void {
    this.animes.clear();
    this.activities.clear();
    this.comments.clear();
    this.followers.clear();
    this.metadata.clear();
  }
}

export const inMemoryFallback = new InMemoryStoreFallback();

let dbPromise: Promise<IDBDatabase | null> | null = null;
let isIndexedDbSupportedOverride: boolean | null = null;

export function setIndexedDbSupportedForTesting(supported: boolean | null): void {
  isIndexedDbSupportedOverride = supported;
  dbPromise = null;
}

function isIndexedDbAvailable(): boolean {
  if (isIndexedDbSupportedOverride !== null) {
    return isIndexedDbSupportedOverride;
  }
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) {
    return Promise.resolve(null);
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Tabela de animes isolada por profileId + animeId
        if (!db.objectStoreNames.contains(STORES.ANIMES)) {
          const store = db.createObjectStore(STORES.ANIMES, {
            keyPath: ['profileId', 'id'],
          });
          store.createIndex('byProfile', 'profileId', { unique: false });
          store.createIndex('byProfileAndStatus', ['profileId', 'status'], { unique: false });
        }

        // Tabela de atividades
        if (!db.objectStoreNames.contains(STORES.ACTIVITIES)) {
          const store = db.createObjectStore(STORES.ACTIVITIES, {
            keyPath: ['profileId', 'id'],
          });
          store.createIndex('byProfile', 'profileId', { unique: false });
        }

        // Tabela de comentários
        if (!db.objectStoreNames.contains(STORES.COMMENTS)) {
          const store = db.createObjectStore(STORES.COMMENTS, {
            keyPath: ['profileId', 'id'],
          });
          store.createIndex('byProfile', 'profileId', { unique: false });
        }

        // Tabela de seguidores / seguindo
        if (!db.objectStoreNames.contains(STORES.FOLLOWERS)) {
          const store = db.createObjectStore(STORES.FOLLOWERS, {
            keyPath: ['profileId', 'id'],
          });
          store.createIndex('byProfile', 'profileId', { unique: false });
        }

        // Metadados locais por perfil (ex: timestamps de sync, contadores)
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META, {
            keyPath: ['profileId', 'key'],
          });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        metrics.errors++;
        resolve(null);
      };

      request.onblocked = () => {
        metrics.errors++;
        resolve(null);
      };
    } catch {
      metrics.errors++;
      resolve(null);
    }
  });

  return dbPromise;
}

// ============================================================================
// Funções Públicas de Leitura e Gravação com Fallback Seguro
// ============================================================================

export async function saveAnimesToIndexedDb(
  profileId: string,
  animes: AnimeItem[]
): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return;

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    inMemoryFallback.saveAnimes(cleanProfileId, animes);
    return;
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORES.ANIMES], 'readwrite');
      const store = tx.objectStore(STORES.ANIMES);
      const index = store.index('byProfile');
      const range = IDBKeyRange.only(cleanProfileId);

      // Limpa animes antigos deste perfil específico antes de salvar a nova lista integral
      const clearReq = index.openKeyCursor(range);
      clearReq.onsuccess = () => {
        const cursor = clearReq.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          // Grava todos os animes do lote
          for (const item of animes) {
            store.put({
              ...item,
              profileId: cleanProfileId,
            });
          }
        }
      };

      tx.oncomplete = () => {
        metrics.writes += animes.length;
        inMemoryFallback.saveAnimes(cleanProfileId, animes);
        resolve();
      };

      tx.onerror = () => {
        metrics.errors++;
        metrics.fallbackOperations++;
        inMemoryFallback.saveAnimes(cleanProfileId, animes);
        resolve();
      };

      tx.onabort = () => {
        metrics.errors++;
        metrics.fallbackOperations++;
        inMemoryFallback.saveAnimes(cleanProfileId, animes);
        resolve();
      };
    } catch {
      metrics.errors++;
      metrics.fallbackOperations++;
      inMemoryFallback.saveAnimes(cleanProfileId, animes);
      resolve();
    }
  });
}

export async function getAnimesFromIndexedDb(profileId: string): Promise<AnimeItem[] | null> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return null;

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    metrics.reads++;
    return inMemoryFallback.getAnimes(cleanProfileId);
  }

  return new Promise<AnimeItem[] | null>((resolve) => {
    try {
      const tx = db.transaction([STORES.ANIMES], 'readonly');
      const store = tx.objectStore(STORES.ANIMES);
      const index = store.index('byProfile');
      const request = index.getAll(IDBKeyRange.only(cleanProfileId));

      request.onsuccess = () => {
        metrics.reads++;
        const rawList = request.result as Array<AnimeItem & { profileId: string }>;
        if (!rawList || rawList.length === 0) {
          // Fallback se IndexedDB ainda não possui mas fallback em memória possui
          const mem = inMemoryFallback.getAnimes(cleanProfileId);
          resolve(mem);
          return;
        }

        const sanitized: AnimeItem[] = rawList.map((item) => {
          const { profileId: _pid, ...rest } = item;
          return rest;
        });

        // Mantém cache em memória alinhado
        inMemoryFallback.saveAnimes(cleanProfileId, sanitized);
        resolve(sanitized);
      };

      request.onerror = () => {
        metrics.errors++;
        metrics.fallbackOperations++;
        resolve(inMemoryFallback.getAnimes(cleanProfileId));
      };
    } catch {
      metrics.errors++;
      metrics.fallbackOperations++;
      resolve(inMemoryFallback.getAnimes(cleanProfileId));
    }
  });
}

export async function getAnimesByCategoryFromIndexedDb(
  profileId: string,
  status: AnimeItem['status']
): Promise<AnimeItem[] | null> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return null;

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    metrics.reads++;
    return inMemoryFallback.getAnimesByCategory(cleanProfileId, status);
  }

  return new Promise<AnimeItem[] | null>((resolve) => {
    try {
      const tx = db.transaction([STORES.ANIMES], 'readonly');
      const store = tx.objectStore(STORES.ANIMES);
      const index = store.index('byProfileAndStatus');
      const request = index.getAll(IDBKeyRange.only([cleanProfileId, status]));

      request.onsuccess = () => {
        metrics.reads++;
        const rawList = request.result as Array<AnimeItem & { profileId: string }>;
        if (!rawList) {
          resolve(inMemoryFallback.getAnimesByCategory(cleanProfileId, status));
          return;
        }

        const sanitized: AnimeItem[] = rawList.map((item) => {
          const { profileId: _pid, ...rest } = item;
          return rest;
        });

        resolve(sanitized);
      };

      request.onerror = () => {
        metrics.errors++;
        metrics.fallbackOperations++;
        resolve(inMemoryFallback.getAnimesByCategory(cleanProfileId, status));
      };
    } catch {
      metrics.errors++;
      metrics.fallbackOperations++;
      resolve(inMemoryFallback.getAnimesByCategory(cleanProfileId, status));
    }
  });
}

export async function saveMetadataToIndexedDb(
  profileId: string,
  key: string,
  value: unknown
): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId || !key) return;
  inMemoryFallback.saveMeta(cleanProfileId, { [key]: value });

  const db = await openDatabase();
  if (!db) return;

  try {
    const tx = db.transaction([STORES.META], 'readwrite');
    const store = tx.objectStore(STORES.META);
    store.put({
      profileId: cleanProfileId,
      key,
      value,
      updatedAtMs: Date.now(),
    });
  } catch {
    // fallback
  }
}

export async function getMetadataFromIndexedDb<T = unknown>(
  profileId: string,
  key: string
): Promise<T | null> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId || !key) return null;

  const mem = inMemoryFallback.getMeta(cleanProfileId);
  if (mem && key in mem) return mem[key] as T;

  const db = await openDatabase();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction([STORES.META], 'readonly');
      const store = tx.objectStore(STORES.META);
      const req = store.get([cleanProfileId, key]);
      req.onsuccess = () => {
        if (req.result && req.result.value !== undefined) {
          resolve(req.result.value as T);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function upsertSingleAnimeInIndexedDb(
  profileId: string,
  anime: AnimeItem
): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId || !anime.id) return;

  inMemoryFallback.upsertAnime(cleanProfileId, anime);

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return;
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORES.ANIMES], 'readwrite');
      const store = tx.objectStore(STORES.ANIMES);
      store.put({
        ...anime,
        profileId: cleanProfileId,
      });

      tx.oncomplete = () => {
        metrics.writes++;
        resolve();
      };

      tx.onerror = () => {
        metrics.errors++;
        resolve();
      };
    } catch {
      metrics.errors++;
      resolve();
    }
  });
}

export async function removeSingleAnimeFromIndexedDb(
  profileId: string,
  animeId: string
): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId || !animeId) return;

  inMemoryFallback.removeAnime(cleanProfileId, animeId);

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return;
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORES.ANIMES], 'readwrite');
      const store = tx.objectStore(STORES.ANIMES);
      store.delete([cleanProfileId, animeId]);

      tx.oncomplete = () => {
        metrics.deletes++;
        resolve();
      };

      tx.onerror = () => {
        metrics.errors++;
        resolve();
      };
    } catch {
      metrics.errors++;
      resolve();
    }
  });
}

export async function saveActivitiesToIndexedDb(
  profileId: string,
  activities: UserActivity[]
): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return;

  inMemoryFallback.saveActivities(cleanProfileId, activities);

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return;
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORES.ACTIVITIES], 'readwrite');
      const store = tx.objectStore(STORES.ACTIVITIES);
      const index = store.index('byProfile');
      const clearReq = index.openKeyCursor(IDBKeyRange.only(cleanProfileId));

      clearReq.onsuccess = () => {
        const cursor = clearReq.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          for (const item of activities) {
            store.put({
              ...item,
              profileId: cleanProfileId,
            });
          }
        }
      };

      tx.oncomplete = () => {
        metrics.writes += activities.length;
        resolve();
      };

      tx.onerror = () => {
        metrics.errors++;
        resolve();
      };
    } catch {
      metrics.errors++;
      resolve();
    }
  });
}

export async function getActivitiesFromIndexedDb(
  profileId: string
): Promise<UserActivity[] | null> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return null;

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return inMemoryFallback.getActivities(cleanProfileId);
  }

  return new Promise<UserActivity[] | null>((resolve) => {
    try {
      const tx = db.transaction([STORES.ACTIVITIES], 'readonly');
      const store = tx.objectStore(STORES.ACTIVITIES);
      const index = store.index('byProfile');
      const request = index.getAll(IDBKeyRange.only(cleanProfileId));

      request.onsuccess = () => {
        metrics.reads++;
        const rawList = request.result as Array<UserActivity & { profileId: string }>;
        if (!rawList || rawList.length === 0) {
          resolve(inMemoryFallback.getActivities(cleanProfileId));
          return;
        }

        const sanitized = rawList.map((item) => {
          const { profileId: _pid, ...rest } = item;
          return rest;
        });

        inMemoryFallback.saveActivities(cleanProfileId, sanitized);
        resolve(sanitized);
      };

      request.onerror = () => {
        metrics.errors++;
        resolve(inMemoryFallback.getActivities(cleanProfileId));
      };
    } catch {
      metrics.errors++;
      resolve(inMemoryFallback.getActivities(cleanProfileId));
    }
  });
}

export async function saveCommentsToIndexedDb(
  profileId: string,
  comments: HikariComment[]
): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return;

  inMemoryFallback.saveComments(cleanProfileId, comments);

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return;
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORES.COMMENTS], 'readwrite');
      const store = tx.objectStore(STORES.COMMENTS);
      const index = store.index('byProfile');
      const clearReq = index.openKeyCursor(IDBKeyRange.only(cleanProfileId));

      clearReq.onsuccess = () => {
        const cursor = clearReq.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          for (const item of comments) {
            store.put({
              ...item,
              profileId: cleanProfileId,
            });
          }
        }
      };

      tx.oncomplete = () => {
        metrics.writes += comments.length;
        resolve();
      };

      tx.onerror = () => {
        metrics.errors++;
        resolve();
      };
    } catch {
      metrics.errors++;
      resolve();
    }
  });
}

export async function getCommentsFromIndexedDb(
  profileId: string
): Promise<HikariComment[] | null> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return null;

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return inMemoryFallback.getComments(cleanProfileId);
  }

  return new Promise<HikariComment[] | null>((resolve) => {
    try {
      const tx = db.transaction([STORES.COMMENTS], 'readonly');
      const store = tx.objectStore(STORES.COMMENTS);
      const index = store.index('byProfile');
      const request = index.getAll(IDBKeyRange.only(cleanProfileId));

      request.onsuccess = () => {
        metrics.reads++;
        const rawList = request.result as Array<HikariComment & { profileId: string }>;
        if (!rawList || rawList.length === 0) {
          resolve(inMemoryFallback.getComments(cleanProfileId));
          return;
        }

        const sanitized = rawList.map((item) => {
          const { profileId: _pid, ...rest } = item;
          return rest;
        });

        inMemoryFallback.saveComments(cleanProfileId, sanitized);
        resolve(sanitized);
      };

      request.onerror = () => {
        metrics.errors++;
        resolve(inMemoryFallback.getComments(cleanProfileId));
      };
    } catch {
      metrics.errors++;
      resolve(inMemoryFallback.getComments(cleanProfileId));
    }
  });
}

export async function clearProfileFromIndexedDb(profileId: string): Promise<void> {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return;

  inMemoryFallback.clearProfile(cleanProfileId);

  const db = await openDatabase();
  if (!db) {
    metrics.fallbackOperations++;
    return;
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(
        [STORES.ANIMES, STORES.ACTIVITIES, STORES.COMMENTS, STORES.FOLLOWERS, STORES.META],
        'readwrite'
      );

      const clearStoreByIndex = (storeName: string) => {
        const store = tx.objectStore(storeName);
        if (store.indexNames.contains('byProfile')) {
          const index = store.index('byProfile');
          const req = index.openKeyCursor(IDBKeyRange.only(cleanProfileId));
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              store.delete(cursor.primaryKey);
              cursor.continue();
            }
          };
        }
      };

      clearStoreByIndex(STORES.ANIMES);
      clearStoreByIndex(STORES.ACTIVITIES);
      clearStoreByIndex(STORES.COMMENTS);
      clearStoreByIndex(STORES.FOLLOWERS);

      tx.oncomplete = () => {
        metrics.deletes++;
        resolve();
      };

      tx.onerror = () => {
        metrics.errors++;
        resolve();
      };
    } catch {
      metrics.errors++;
      resolve();
    }
  });
}

