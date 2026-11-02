import type {
  UserProfile,
  AnimeItem,
  AnimeStatus,
  UserActivity,
  HikariComment,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
  FollowUser,
  FollowRequest,
} from '../types';
import type { AnimeStatsSummary } from '../utils/animeStats';
import {
  getAnimesFromIndexedDb,
  getAnimesByCategoryFromIndexedDb,
  saveAnimesToIndexedDb,
  upsertSingleAnimeInIndexedDb,
  removeSingleAnimeFromIndexedDb,
  getActivitiesFromIndexedDb,
  saveActivitiesToIndexedDb,
  getCommentsFromIndexedDb,
  saveCommentsToIndexedDb,
  clearProfileFromIndexedDb,
  saveMetadataToIndexedDb,
  getMetadataFromIndexedDb,
} from './indexedDbStorage';

/**
 * HIKARI PERFIL — CAMADA CENTRAL DE CACHE INTELIGENTE (ETAPA 4)
 *
 * Arquitetura de duas camadas:
 * - L1: Memória síncrona durante a sessão (isolada estritamente por profileId, recurso e categoria).
 * - L2: IndexedDB assíncrono para persistência de dados volumosos sem limite de 5 MiB.
 *
 * Funcionalidades centrais:
 * - TTL configurável por recurso.
 * - Estratégia Stale-While-Revalidate (retorna cache instantâneo e revalida em segundo plano se vencido).
 * - Deduplicação de requisições simultâneas em andamento (in-flight request sharing).
 * - Invalidação seletiva por categoria e recurso (sem expurgar o catálogo inteiro).
 * - Proteção contra race conditions (respostas remotas antigas não sobrescrevem mutações locais recentes).
 * - Isolamento total entre perfis e limpeza completa de dados privados ao encerrar sessão.
 */

export const CACHE_TTLS = {
  PROFILE: 5 * 60_000,          // 5 minutos
  OVERVIEW_STATS: 5 * 60_000,   // 5 minutos
  ANIMES_CATEGORY: 10 * 60_000, // 10 minutos por categoria
  ACTIVITIES: 2 * 60_000,       // 2 minutos
  COMMENTS: 3 * 60_000,         // 3 minutos
  FAVORITES: 5 * 60_000,        // 5 minutos
  RELATIONSHIPS: 5 * 60_000,    // 5 minutos
  PUBLIC_PROFILE: 60_000,       // 1 minuto para perfis visitados
} as const;

export type CacheResourceType =
  | 'profile'
  | 'overview_stats'
  | 'animes_category'
  | 'activities'
  | 'comments'
  | 'favorites'
  | 'relationships';

interface CacheEntry<T> {
  data: T;
  cachedAtMs: number;
  updatedAtMs: number;
}

interface ProfileL1Store {
  profile?: CacheEntry<UserProfile>;
  overviewStats?: CacheEntry<AnimeStatsSummary>;
  animeCategories: Map<string, CacheEntry<AnimeItem[]>>; // Chave: 'all', 'watching', 'completed', etc.
  activities?: CacheEntry<UserActivity[]>;
  comments?: CacheEntry<HikariComment[]>;
  favorites?: CacheEntry<{
    characters: FavoriteCharacter[];
    companies: FavoriteCompany[];
    people: FavoritePerson[];
  }>;
  relationships?: CacheEntry<{
    followers: FollowUser[];
    following: FollowUser[];
    followRequests: FollowRequest[];
  }>;
  lastLocalMutationMs: number;
}

export interface ProfileCacheMetrics {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  remoteFetches: number;
  deduplicatedFetches: number;
  backgroundRevalidations: number;
  selectiveInvalidations: number;
  raceConditionRejections: number;
}

const metrics: ProfileCacheMetrics = {
  l1Hits: 0,
  l1Misses: 0,
  l2Hits: 0,
  remoteFetches: 0,
  deduplicatedFetches: 0,
  backgroundRevalidations: 0,
  selectiveInvalidations: 0,
  raceConditionRejections: 0,
};

export function getProfileCacheMetrics(): ProfileCacheMetrics {
  return { ...metrics };
}

export function resetProfileCacheMetrics(): void {
  metrics.l1Hits = 0;
  metrics.l1Misses = 0;
  metrics.l2Hits = 0;
  metrics.remoteFetches = 0;
  metrics.deduplicatedFetches = 0;
  metrics.backgroundRevalidations = 0;
  metrics.selectiveInvalidations = 0;
  metrics.raceConditionRejections = 0;
}

// L1 Store em Memória mapeado estritamente por profileId
const l1ProfilesMap = new Map<string, ProfileL1Store>();

// Mapa de requisições em andamento (Deduplicação de chamadas simultâneas)
const inFlightRequests = new Map<string, Promise<unknown>>();

function getOrCreateProfileL1(profileId: string): ProfileL1Store {
  const cleanId = profileId.trim();
  let store = l1ProfilesMap.get(cleanId);
  if (!store) {
    store = {
      animeCategories: new Map(),
      lastLocalMutationMs: 0,
    };
    l1ProfilesMap.set(cleanId, store);
  }
  return store;
}

// ============================================================================
// Métodos de Consulta com Stale-While-Revalidate e Deduplicação
// ============================================================================

/**
 * Consulta genérica com suporte a L1 (memória), L2 (IndexedDB), Stale-While-Revalidate
 * e proteção contra respostas obsoletas da rede.
 */
export async function getCachedResource<T>(
  profileId: string,
  resource: CacheResourceType,
  subKey: string,
  ttlMs: number,
  fetcher: () => Promise<{ data: T; updatedAtMs?: number }>,
  options?: {
    readFromL2?: (pId: string, k: string) => Promise<T | null>;
    saveToL2?: (pId: string, k: string, data: T) => Promise<void>;
    onBackgroundRevalidated?: (freshData: T) => void;
  }
): Promise<T> {
  const cleanId = profileId.trim();
  if (!cleanId) {
    const res = await fetcher();
    return res.data;
  }

  const now = Date.now();
  const l1 = getOrCreateProfileL1(cleanId);
  const cacheKey = `${cleanId}:${resource}:${subKey}`;

  // 1. Verificação L1 (Memória)
  let l1Entry: CacheEntry<unknown> | undefined;
  if (resource === 'animes_category') {
    l1Entry = l1.animeCategories.get(subKey);
  } else if (resource === 'profile') {
    l1Entry = l1.profile;
  } else if (resource === 'overview_stats') {
    l1Entry = l1.overviewStats;
  } else if (resource === 'activities') {
    l1Entry = l1.activities;
  } else if (resource === 'comments') {
    l1Entry = l1.comments;
  } else if (resource === 'favorites') {
    l1Entry = l1.favorites;
  } else if (resource === 'relationships') {
    l1Entry = l1.relationships;
  }

  if (l1Entry) {
    metrics.l1Hits++;
    const isFresh = now - l1Entry.cachedAtMs < ttlMs;
    if (isFresh) {
      return l1Entry.data as T;
    }

    // Stale: Retorna imediatamente os dados atuais da memória e revalida em segundo plano
    metrics.backgroundRevalidations++;
    void triggerBackgroundRevalidation(cleanId, resource, subKey, fetcher, options);
    return l1Entry.data as T;
  }

  metrics.l1Misses++;

  // 2. Verificação L2 (IndexedDB)
  if (options?.readFromL2) {
    try {
      const l2Data = await options.readFromL2(cleanId, subKey);
      if (l2Data !== null) {
        metrics.l2Hits++;
        const l2Entry: CacheEntry<unknown> = {
          data: l2Data,
          cachedAtMs: now,
          updatedAtMs: now,
        };

        // Popula L1
        setL1Resource(cleanId, resource, subKey, l2Entry);

        // Se L2 estiver disponível, verifica se precisa revalidar em segundo plano
        void triggerBackgroundRevalidation(cleanId, resource, subKey, fetcher, options);
        return l2Data;
      }
    } catch {
      // Ignora falhas de L2 e avança para a busca remota
    }
  }

  // 3. Busca remota com deduplicação de requisições simultâneas em andamento
  const existingInFlight = inFlightRequests.get(cacheKey) as Promise<T> | undefined;
  if (existingInFlight) {
    metrics.deduplicatedFetches++;
    return existingInFlight;
  }

  const inFlightPromise = (async (): Promise<T> => {
    try {
      metrics.remoteFetches++;
      const result = await fetcher();
      const resolvedUpdatedAt = result.updatedAtMs || Date.now();

      // Proteção contra race conditions: Se uma mutação local ocorreu depois desta resposta remota, rejeita o retorno obsoleto
      if (l1.lastLocalMutationMs > resolvedUpdatedAt) {
        metrics.raceConditionRejections++;
        const currentL1 = getL1Resource<T>(cleanId, resource, subKey);
        if (currentL1) return currentL1.data;
      }

      const entry: CacheEntry<T> = {
        data: result.data,
        cachedAtMs: Date.now(),
        updatedAtMs: resolvedUpdatedAt,
      };

      setL1Resource(cleanId, resource, subKey, entry);

      if (options?.saveToL2) {
        void options.saveToL2(cleanId, subKey, result.data).catch(() => {});
      }

      return result.data;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, inFlightPromise);
  return inFlightPromise;
}

async function triggerBackgroundRevalidation<T>(
  cleanId: string,
  resource: CacheResourceType,
  subKey: string,
  fetcher: () => Promise<{ data: T; updatedAtMs?: number }>,
  options?: {
    saveToL2?: (pId: string, k: string, data: T) => Promise<void>;
    onBackgroundRevalidated?: (freshData: T) => void;
  }
): Promise<void> {
  const cacheKey = `${cleanId}:${resource}:${subKey}`;
  if (inFlightRequests.has(cacheKey)) return;

  const revalPromise = (async () => {
    try {
      metrics.remoteFetches++;
      const result = await fetcher();
      const l1 = getOrCreateProfileL1(cleanId);
      const resolvedUpdatedAt = result.updatedAtMs || Date.now();

      if (l1.lastLocalMutationMs > resolvedUpdatedAt) {
        metrics.raceConditionRejections++;
        return;
      }

      const entry: CacheEntry<T> = {
        data: result.data,
        cachedAtMs: Date.now(),
        updatedAtMs: resolvedUpdatedAt,
      };

      setL1Resource(cleanId, resource, subKey, entry);

      if (options?.saveToL2) {
        void options.saveToL2(cleanId, subKey, result.data).catch(() => {});
      }

      if (options?.onBackgroundRevalidated) {
        options.onBackgroundRevalidated(result.data);
      }
    } catch {
      // Falhas em background não apagam nem corrompem dados válidos existentes no cache
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, revalPromise);
}

function getL1Resource<T>(
  profileId: string,
  resource: CacheResourceType,
  subKey: string
): CacheEntry<T> | undefined {
  const l1 = l1ProfilesMap.get(profileId);
  if (!l1) return undefined;

  if (resource === 'animes_category') {
    return l1.animeCategories.get(subKey) as CacheEntry<T> | undefined;
  }
  if (resource === 'profile') return l1.profile as CacheEntry<T> | undefined;
  if (resource === 'overview_stats') return l1.overviewStats as CacheEntry<T> | undefined;
  if (resource === 'activities') return l1.activities as CacheEntry<T> | undefined;
  if (resource === 'comments') return l1.comments as CacheEntry<T> | undefined;
  if (resource === 'favorites') return l1.favorites as CacheEntry<T> | undefined;
  if (resource === 'relationships') return l1.relationships as CacheEntry<T> | undefined;
  return undefined;
}

function setL1Resource(
  profileId: string,
  resource: CacheResourceType,
  subKey: string,
  entry: CacheEntry<unknown>
): void {
  const l1 = getOrCreateProfileL1(profileId);
  if (resource === 'animes_category') {
    l1.animeCategories.set(subKey, entry as CacheEntry<AnimeItem[]>);
  } else if (resource === 'profile') {
    l1.profile = entry as CacheEntry<UserProfile>;
  } else if (resource === 'overview_stats') {
    l1.overviewStats = entry as CacheEntry<AnimeStatsSummary>;
  } else if (resource === 'activities') {
    l1.activities = entry as CacheEntry<UserActivity[]>;
  } else if (resource === 'comments') {
    l1.comments = entry as CacheEntry<HikariComment[]>;
  } else if (resource === 'favorites') {
    l1.favorites = entry as CacheEntry<{
      characters: FavoriteCharacter[];
      companies: FavoriteCompany[];
      people: FavoritePerson[];
    }>;
  } else if (resource === 'relationships') {
    l1.relationships = entry as CacheEntry<{
      followers: FollowUser[];
      following: FollowUser[];
      followRequests: FollowRequest[];
    }>;
  }
}

// ============================================================================
// Métodos Especializados por Recurso (Visão Geral, Categorias, Abas)
// ============================================================================

/**
 * Consulta de perfil para Visão Geral com L1 e L2.
 */
export async function getCachedProfile(
  profileId: string,
  fetcher: () => Promise<{ profile: UserProfile; updatedAtMs?: number }>,
  options?: { isVisitor?: boolean; onRevalidated?: (p: UserProfile) => void }
): Promise<UserProfile> {
  const ttl = options?.isVisitor ? CACHE_TTLS.PUBLIC_PROFILE : CACHE_TTLS.PROFILE;
  return getCachedResource<UserProfile>(
    profileId,
    'profile',
    'info',
    ttl,
    async () => {
      const res = await fetcher();
      return { data: res.profile, updatedAtMs: res.updatedAtMs };
    },
    {
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Consulta sob demanda por categoria individual de animes (Assistindo, Concluídos, etc.).
 * Não carrega o catálogo inteiro antecipadamente; lê L1 -> L2 -> fetcher da categoria.
 */
export async function getCachedAnimeCategory(
  profileId: string,
  category: AnimeStatus,
  fetcher: () => Promise<{ animes: AnimeItem[]; updatedAtMs?: number }>,
  options?: { onRevalidated?: (list: AnimeItem[]) => void }
): Promise<AnimeItem[]> {
  const statusKey = category || 'all';

  return getCachedResource<AnimeItem[]>(
    profileId,
    'animes_category',
    statusKey,
    CACHE_TTLS.ANIMES_CATEGORY,
    async () => {
      const res = await fetcher();
      return { data: res.animes, updatedAtMs: res.updatedAtMs };
    },
    {
      readFromL2: async (pId) => {
        if (category === 'all') {
          return getAnimesFromIndexedDb(pId);
        }
        return getAnimesByCategoryFromIndexedDb(pId, category as AnimeItem['status']);
      },
      saveToL2: async (pId, _key, data) => {
        if (category === 'all') {
          await saveAnimesToIndexedDb(pId, data);
        } else {
          // Atualiza registros individuais no IndexedDB
          for (const item of data) {
            await upsertSingleAnimeInIndexedDb(pId, item);
          }
        }
      },
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Consulta sob demanda da aba Atividades.
 */
export async function getCachedActivities(
  profileId: string,
  fetcher: () => Promise<{ activities: UserActivity[]; updatedAtMs?: number }>,
  options?: { onRevalidated?: (acts: UserActivity[]) => void }
): Promise<UserActivity[]> {
  return getCachedResource<UserActivity[]>(
    profileId,
    'activities',
    'list',
    CACHE_TTLS.ACTIVITIES,
    async () => {
      const res = await fetcher();
      return { data: res.activities, updatedAtMs: res.updatedAtMs };
    },
    {
      readFromL2: async (pId) => getActivitiesFromIndexedDb(pId),
      saveToL2: async (pId, _k, data) => saveActivitiesToIndexedDb(pId, data),
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Consulta sob demanda da aba Comentários.
 */
export async function getCachedComments(
  profileId: string,
  fetcher: () => Promise<{ comments: HikariComment[]; updatedAtMs?: number }>,
  options?: { onRevalidated?: (comms: HikariComment[]) => void }
): Promise<HikariComment[]> {
  return getCachedResource<HikariComment[]>(
    profileId,
    'comments',
    'list',
    CACHE_TTLS.COMMENTS,
    async () => {
      const res = await fetcher();
      return { data: res.comments, updatedAtMs: res.updatedAtMs };
    },
    {
      readFromL2: async (pId) => getCommentsFromIndexedDb(pId),
      saveToL2: async (pId, _k, data) => saveCommentsToIndexedDb(pId, data),
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Consulta sob demanda das estatísticas resumidas da Visão Geral (sem carregar o catálogo completo).
 */
export async function getCachedOverviewStats(
  profileId: string,
  fetcher: () => Promise<{ stats: AnimeStatsSummary; updatedAtMs?: number }>,
  options?: { onRevalidated?: (stats: AnimeStatsSummary) => void }
): Promise<AnimeStatsSummary> {
  return getCachedResource<AnimeStatsSummary>(
    profileId,
    'overview_stats',
    'summary',
    CACHE_TTLS.OVERVIEW_STATS,
    async () => {
      const res = await fetcher();
      return { data: res.stats, updatedAtMs: res.updatedAtMs };
    },
    {
      readFromL2: async (pId) => {
        return getMetadataFromIndexedDb<AnimeStatsSummary>(pId, 'stats');
      },
      saveToL2: async (pId, _k, data) => {
        await saveMetadataToIndexedDb(pId, 'stats', data);
      },
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Consulta sob demanda da aba Favoritos.
 */
export async function getCachedFavorites(
  profileId: string,
  fetcher: () => Promise<{
    characters: FavoriteCharacter[];
    companies: FavoriteCompany[];
    people: FavoritePerson[];
    updatedAtMs?: number;
  }>,
  options?: {
    onRevalidated?: (favs: {
      characters: FavoriteCharacter[];
      companies: FavoriteCompany[];
      people: FavoritePerson[];
    }) => void;
  }
): Promise<{
  characters: FavoriteCharacter[];
  companies: FavoriteCompany[];
  people: FavoritePerson[];
}> {
  return getCachedResource<{
    characters: FavoriteCharacter[];
    companies: FavoriteCompany[];
    people: FavoritePerson[];
  }>(
    profileId,
    'favorites',
    'bundle',
    CACHE_TTLS.FAVORITES,
    async () => {
      const res = await fetcher();
      return {
        data: {
          characters: res.characters,
          companies: res.companies,
          people: res.people,
        },
        updatedAtMs: res.updatedAtMs,
      };
    },
    {
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Consulta sob demanda de Seguidores e Seguindo.
 */
export async function getCachedRelationships(
  profileId: string,
  fetcher: () => Promise<{
    followers: FollowUser[];
    following: FollowUser[];
    followRequests: FollowRequest[];
    updatedAtMs?: number;
  }>,
  options?: {
    onRevalidated?: (rel: {
      followers: FollowUser[];
      following: FollowUser[];
      followRequests: FollowRequest[];
    }) => void;
  }
): Promise<{
  followers: FollowUser[];
  following: FollowUser[];
  followRequests: FollowRequest[];
}> {
  return getCachedResource<{
    followers: FollowUser[];
    following: FollowUser[];
    followRequests: FollowRequest[];
  }>(
    profileId,
    'relationships',
    'bundle',
    CACHE_TTLS.RELATIONSHIPS,
    async () => {
      const res = await fetcher();
      return {
        data: {
          followers: res.followers,
          following: res.following,
          followRequests: res.followRequests,
        },
        updatedAtMs: res.updatedAtMs,
      };
    },
    {
      onBackgroundRevalidated: options?.onRevalidated,
    }
  );
}

/**
 * Verifica se uma categoria específica de animes está em cache L1 válido.
 */
export function isCategoryCached(profileId: string, category: string): boolean {
  const cleanId = profileId.trim();
  const l1 = l1ProfilesMap.get(cleanId);
  if (!l1) return false;
  const entry = l1.animeCategories.get(category);
  if (!entry) return false;
  return Date.now() - entry.cachedAtMs < CACHE_TTLS.ANIMES_CATEGORY;
}

/**
 * Verifica se um recurso genérico está em cache L1 válido.
 */
export function isResourceCached(
  profileId: string,
  resource: CacheResourceType,
  subKey = 'list'
): boolean {
  const cleanId = profileId.trim();
  const l1 = l1ProfilesMap.get(cleanId);
  if (!l1) return false;
  const entry = getL1Resource(cleanId, resource, subKey);
  if (!entry) return false;
  const ttl =
    resource === 'profile'
      ? CACHE_TTLS.PROFILE
      : resource === 'overview_stats'
      ? CACHE_TTLS.OVERVIEW_STATS
      : resource === 'activities'
      ? CACHE_TTLS.ACTIVITIES
      : resource === 'comments'
      ? CACHE_TTLS.COMMENTS
      : resource === 'favorites'
      ? CACHE_TTLS.FAVORITES
      : resource === 'relationships'
      ? CACHE_TTLS.RELATIONSHIPS
      : CACHE_TTLS.ANIMES_CATEGORY;
  return Date.now() - entry.cachedAtMs < ttl;
}

// ============================================================================
// Invalidação Seletiva e Mutações Locais Atômicas
// ============================================================================

/**
 * Registra timestamp de mutação local para proteger contra race conditions.
 */
export function recordLocalMutationTimestamp(profileId: string): number {
  const cleanId = profileId.trim();
  const now = Date.now();
  const l1 = getOrCreateProfileL1(cleanId);
  l1.lastLocalMutationMs = now;
  return now;
}

/**
 * Invalidação Seletiva ao alterar o status de um anime.
 * Invalida APENAS a categoria de origem e a categoria de destino, além da estatística resumida da Visão Geral.
 * As demais categorias (ex: Concluídos, Desistidos) e abas (Comentários, Atividades antigas) permanecem intactas no cache!
 */
export function invalidateAnimeStatusChange(
  profileId: string,
  fromStatus: AnimeStatus,
  toStatus: AnimeStatus
): void {
  const cleanId = profileId.trim();
  metrics.selectiveInvalidations++;
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (!l1) return;

  // Invalida somente as categorias afetadas
  l1.animeCategories.delete(fromStatus);
  l1.animeCategories.delete(toStatus);
  l1.animeCategories.delete('all');

  // Invalida resumo de estatísticas da Visão Geral
  delete l1.overviewStats;
}

/**
 * Invalidação Seletiva ao editar campos de um anime (episódios, notas, capa).
 */
export function invalidateAnimeCategory(profileId: string, category: AnimeStatus): void {
  const cleanId = profileId.trim();
  metrics.selectiveInvalidations++;
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (!l1) return;

  l1.animeCategories.delete(category);
  l1.animeCategories.delete('all');
  delete l1.overviewStats;
}

/**
 * Invalidação em massa de todas as categorias de animes (utilizada em sincronização externa de catálogo completo).
 * Preserva as outras abas (Comentários, etc.).
 */
export function invalidateAllAnimeCategories(profileId: string): void {
  const cleanId = profileId.trim();
  metrics.selectiveInvalidations++;
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (!l1) return;

  l1.animeCategories.clear();
  delete l1.overviewStats;
}

/**
 * Invalidação ao receber nova atividade no feed.
 */
export function invalidateActivitiesCache(profileId: string): void {
  const cleanId = profileId.trim();
  metrics.selectiveInvalidations++;
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (l1) {
    delete l1.activities;
  }
}

/**
 * Invalidação ao criar ou excluir comentário.
 */
export function invalidateCommentsCache(profileId: string): void {
  const cleanId = profileId.trim();
  metrics.selectiveInvalidations++;
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (l1) {
    delete l1.comments;
  }
}

/**
 * Invalidação ao alternar relações de seguidores.
 */
export function invalidateRelationshipsCache(profileId: string): void {
  const cleanId = profileId.trim();
  metrics.selectiveInvalidations++;
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (l1) {
    delete l1.relationships;
    if (l1.profile) {
      delete l1.profile; // Recalcula contagens de seguidores do perfil
    }
  }
}

/**
 * Atualização síncrona imediata de um anime no cache L1 e L2 sem refetch completo.
 */
export function updateCachedAnimeLocally(
  profileId: string,
  updatedAnime: AnimeItem,
  category: AnimeStatus
): void {
  const cleanId = profileId.trim();
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (l1) {
    const catEntry = l1.animeCategories.get(category);
    if (catEntry && Array.isArray(catEntry.data)) {
      const idx = catEntry.data.findIndex((a) => a.id === updatedAnime.id);
      if (idx >= 0) {
        const nextList = [...catEntry.data];
        nextList[idx] = updatedAnime;
        catEntry.data = nextList;
        catEntry.cachedAtMs = Date.now();
      }
    }
  }

  // Persiste pontualmente no IndexedDB
  void upsertSingleAnimeInIndexedDb(cleanId, updatedAnime);
}

/**
 * Remove um anime de uma categoria específica no cache L1 e L2.
 */
export function removeCachedAnimeLocally(
  profileId: string,
  animeId: string,
  category: AnimeStatus
): void {
  const cleanId = profileId.trim();
  recordLocalMutationTimestamp(cleanId);

  const l1 = l1ProfilesMap.get(cleanId);
  if (l1) {
    const catEntry = l1.animeCategories.get(category);
    if (catEntry && Array.isArray(catEntry.data)) {
      catEntry.data = catEntry.data.filter((a) => a.id !== animeId);
      catEntry.cachedAtMs = Date.now();
    }
    const allEntry = l1.animeCategories.get('all');
    if (allEntry && Array.isArray(allEntry.data)) {
      allEntry.data = allEntry.data.filter((a) => a.id !== animeId);
      allEntry.cachedAtMs = Date.now();
    }
    delete l1.overviewStats;
  }

  void removeSingleAnimeFromIndexedDb(cleanId, animeId);
}

// ============================================================================
// Isolamento por Usuário e Limpeza Segura (Logout / Troca de Perfil)
// ============================================================================

/**
 * Limpa todos os dados em memória L1 de um perfil específico.
 */
export function clearProfileMemoryCache(profileId: string): void {
  const cleanId = profileId.trim();
  l1ProfilesMap.delete(cleanId);

  // Cancela deduplicação em andamento deste perfil
  for (const [key] of inFlightRequests.entries()) {
    if (key.startsWith(`${cleanId}:`)) {
      inFlightRequests.delete(key);
    }
  }
}

/**
 * Limpa integralmente todo o cache L1 da memória ao deslogar.
 * Garante que dados de uma conta nunca vazem para outro usuário na mesma máquina.
 */
export function clearAllMemoryCache(): void {
  l1ProfilesMap.clear();
  inFlightRequests.clear();
  resetProfileCacheMetrics();
}
