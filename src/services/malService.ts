import { AnimeItem } from '../types';
import {
  normalizeTitle,
  ExistingAnimeIndex,
  createExistingAnimeIndex,
  findMatchingAnimeInIndex,
  isValidYear,
  isGenericOrMissingPoster,
  isValidPosterUrl,
  isGenericOrMissingImage,
  isValidImageUrl,
} from './anilistService';

export {
  isValidYear,
  isGenericOrMissingPoster,
  isValidPosterUrl,
  isGenericOrMissingImage,
  isValidImageUrl,
};

export interface MALAnimeEntry {
  malId: number;
  anilistId?: number;
  title: string;
  titleRomaji?: string;
  posterUrl: string;
  status: AnimeItem['status'];
  currentEpisode: number;
  totalEpisodes: number;
  rating: number; // 0 to 10
  year: number;
  genres: string[];
  episodeDurationMinutes?: number;
  rewatchCount?: number;
}

export interface MALDiffChange {
  field: string;
  label: string;
  oldVal: string | number;
  newVal: string | number;
}

export interface MALMatchedItem {
  incoming: MALAnimeEntry;
  existing: AnimeItem;
  hasChanges: boolean;
  changes: MALDiffChange[];
}

export interface MALImportPreview {
  username: string;
  totalIncoming: number;
  newItems: MALAnimeEntry[];
  matchedItems: MALMatchedItem[];
  itemsWithUpdates: MALMatchedItem[];
  itemsIdentical: MALMatchedItem[];
  unmatchedExistingCount: number;
}

export const MAL_STATUS_LABELS_PT: Record<AnimeItem['status'], string> = {
  watching: 'Assistindo',
  completed: 'Concluído',
  planned: 'Planejado',
  on_hold: 'Em espera',
  dropped: 'Abandonado',
};

/**
 * Converte e normaliza com precisão notas do MyAnimeList para a escala decimal do Hikari (0 a 10, com 1 casa decimal).
 * - Retorna 0 para representar ausência de nota (sem avaliação).
 * - Converte proporcionalmente caso venha na escala de 0 a 100.
 * - Preserva valores inteiros (1 a 10) do MAL oficial e decimais caso fornecidos, evitando dízimas do IEEE 754.
 */
export function normalizeMALScore(score?: number | null): number {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) {
    return 0;
  }
  let val = score;
  if (val > 10 && val <= 100) {
    val = val / 10;
  }
  const normalized = Math.round((val + Number.EPSILON) * 100) / 100;
  return Math.min(10, Math.max(0, normalized));
}

/**
 * Mapeia os status oficiais da API v2 do MyAnimeList para os status internos do Hikari.
 */
export function mapMALStatus(rawStatus?: string): AnimeItem['status'] {
  switch (rawStatus) {
    case 'watching':
      return 'watching';
    case 'completed':
      return 'completed';
    case 'plan_to_watch':
      return 'planned';
    case 'on_hold':
      return 'on_hold';
    case 'dropped':
      return 'dropped';
    default:
      return 'watching';
  }
}

export interface MALServerStatus {
  configured: boolean;
  clientIdConfigured: boolean;
  storageConfigured?: boolean;
  storageError?: string;
  redirectUri: string;
}

let cachedMALServerStatus: MALServerStatus | null = null;
let inFlightMALServerStatus: Promise<MALServerStatus> | null = null;

/**
 * Verifica o status de configuração do MyAnimeList no servidor (com cache em memória por sessão).
 */
export async function fetchMALServerStatus(forceRefresh = false): Promise<MALServerStatus> {
  if (!forceRefresh && cachedMALServerStatus) {
    return cachedMALServerStatus;
  }
  if (!forceRefresh && inFlightMALServerStatus) {
    return inFlightMALServerStatus;
  }

  const request = (async (): Promise<MALServerStatus> => {
    try {
      const res = await fetch('/api/mal/config');
      if (!res.ok) {
        return {
          configured: false,
          clientIdConfigured: false,
          storageConfigured: false,
          storageError: `Erro ao consultar status do servidor (HTTP ${res.status})`,
          redirectUri: `${window.location.origin}/api/mal/callback`,
        };
      }
      const data = await res.json();
      const resolved: MALServerStatus = {
        configured: Boolean(data.configured),
        clientIdConfigured: Boolean(data.clientIdConfigured),
        storageConfigured: typeof data.storageConfigured === 'boolean' ? data.storageConfigured : Boolean(data.configured),
        storageError: typeof data.storageError === 'string' ? data.storageError : undefined,
        redirectUri: data.redirectUri || `${window.location.origin}/api/mal/callback`,
      };
      cachedMALServerStatus = resolved;
      return resolved;
    } catch (err) {
      return {
        configured: false,
        clientIdConfigured: false,
        storageConfigured: false,
        storageError: err instanceof Error ? err.message : 'Falha na comunicação de rede com o servidor.',
        redirectUri: typeof window !== 'undefined' ? `${window.location.origin}/api/mal/callback` : '',
      };
    } finally {
      inFlightMALServerStatus = null;
    }
  })();

  inFlightMALServerStatus = request;
  return request;
}

/**
 * Solicita ao servidor a geração da URL de autorização OAuth 2.0 PKCE do MyAnimeList.
 * Exige Firebase ID Token no cabeçalho Authorization para vincular com segurança a sessão.
 */
export async function fetchMALAuthUrl(
  idToken: string,
  redirectUri?: string
): Promise<{ url: string; state: string }> {
  const effectiveRedirectUri =
    redirectUri ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/api/mal/callback`
      : '/api/mal/callback');

  const params = new URLSearchParams({
    redirect_uri: effectiveRedirectUri,
  });

  const res = await fetch(`/api/mal/auth-url?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || data.error || 'Erro ao gerar URL de autorização do MyAnimeList.');
  }

  return {
    url: data.url,
    state: data.state,
  };
}

export interface MALBatchResult {
  entries: MALAnimeEntry[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Consulta um lote específico da lista de animes do usuário conectado no MyAnimeList com suporte a paginação incremental por offset/limit.
 */
export async function fetchMALAnimeListBatch(
  idToken: string,
  options?: { offset?: number; limit?: number; signal?: AbortSignal }
): Promise<MALBatchResult> {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 1000;
  const res = await fetch(`/api/mal/animelist?offset=${offset}&limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    signal: options?.signal,
  });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        data.message || 'Sessão de autenticação expirada ou inválida. Faça login novamente.'
      );
    }
    if (res.status === 403) {
      throw new Error(
        data.message || 'Nenhuma conta MyAnimeList vinculada à sua sessão. Conecte sua conta primeiro.'
      );
    }
    if (res.status === 429) {
      throw new Error(
        'Limite de requisições atingido no MyAnimeList. Aguarde alguns instantes e tente novamente.'
      );
    }
    throw new Error(data.message || data.error || 'Erro ao consultar a lista de animes no MyAnimeList.');
  }

  const entries = Array.isArray(data.entries) ? (data.entries as MALAnimeEntry[]) : [];
  return {
    entries,
    totalCount: typeof data.totalCount === 'number' ? data.totalCount : entries.length,
    hasMore: Boolean(data.hasMore),
    nextOffset: typeof data.nextOffset === 'number' ? data.nextOffset : null,
  };
}

/**
 * Consulta a lista de animes do usuário conectado no MyAnimeList através da rota de backend protegida.
 * Exige Firebase ID Token e obtém animes vinculados estritamente à identidade do usuário autenticado.
 */
export async function fetchMALAnimeList(
  idToken: string
): Promise<MALAnimeEntry[]> {
  const res = await fetch('/api/mal/animelist', {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        data.message || 'Sessão de autenticação expirada ou inválida. Faça login novamente.'
      );
    }
    if (res.status === 403) {
      throw new Error(
        data.message || 'Nenhuma conta MyAnimeList vinculada à sua sessão. Conecte sua conta primeiro.'
      );
    }
    if (res.status === 429) {
      throw new Error(
        'Limite de requisições atingido no MyAnimeList. Aguarde alguns instantes e tente novamente.'
      );
    }
    throw new Error(data.message || data.error || 'Erro ao consultar a lista de animes no MyAnimeList.');
  }

  if (!Array.isArray(data.entries)) {
    return [];
  }

  return data.entries as MALAnimeEntry[];
}

/**
 * Desconecta a conta MyAnimeList no servidor de forma autenticada para o UID do usuário.
 */
export async function disconnectMALServer(idToken: string): Promise<void> {
  try {
    await fetch('/api/mal/disconnect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Falha silenciosa no servidor; desconexão no cliente deve prosseguir
  }
}

/**
 * Localiza no array atual de animes do Hikari a correspondência exata para uma entrada vinda do MyAnimeList.
 * 1. Primeiro por identificador malId.
 * 2. Segundo por anilistId (caso o item existente tenha vindo do AniList com idMal preenchido).
 * 3. Terceiro por título normalizado e ano combinado sem ambiguidades nem colisões entre obras distintas.
 */
export function findMatchingExistingAnimeForMAL(
  incoming:
    | MALAnimeEntry
    | { malId?: number; anilistId?: number; title: string; titleRomaji?: string; year?: number },
  existingList: AnimeItem[],
  existingIndex?: ExistingAnimeIndex
): AnimeItem | undefined {
  if (existingIndex) {
    return findMatchingAnimeInIndex(incoming, existingIndex, 'mal_first');
  }

  // 1. Coincidência direta por malId
  if (incoming.malId) {
    const byMalId = existingList.find((e) => e.malId === incoming.malId);
    if (byMalId) return byMalId;
  }

  // 2. Coincidência por anilistId (se ambos tiverem)
  if (incoming.anilistId) {
    const byAniId = existingList.find((e) => e.anilistId && e.anilistId === incoming.anilistId);
    if (byAniId) return byAniId;
  }

  // 3. Fallback unificado utilizando createExistingAnimeIndex + findMatchingAnimeInIndex
  const tempIndex = createExistingAnimeIndex(existingList);
  return findMatchingAnimeInIndex(incoming, tempIndex, 'mal_first');
}

/**
 * Calcula a prévia detalhada comparativa antes de efetuar qualquer gravação no perfil.
 * Utiliza índice Map em O(N + M) para evitar congelamento da interface em listas extensas.
 */
export function calculateMALImportPreview(
  incomingEntries: MALAnimeEntry[],
  currentList: AnimeItem[],
  username: string
): MALImportPreview {
  const newItems: MALAnimeEntry[] = [];
  const matchedItems: MALMatchedItem[] = [];
  const itemsWithUpdates: MALMatchedItem[] = [];
  const itemsIdentical: MALMatchedItem[] = [];

  const matchedExistingIds = new Set<string>();
  const existingIndex = createExistingAnimeIndex(currentList);

  for (const incoming of incomingEntries) {
    const matched = findMatchingAnimeInIndex(incoming, existingIndex, 'mal_first');

    if (!matched) {
      newItems.push(incoming);
    } else {
      matchedExistingIds.add(matched.id);
      const changes: MALDiffChange[] = [];

      if (matched.status !== incoming.status) {
        changes.push({
          field: 'status',
          label: 'Status',
          oldVal: MAL_STATUS_LABELS_PT[matched.status] || matched.status,
          newVal: MAL_STATUS_LABELS_PT[incoming.status] || incoming.status,
        });
      }

      if (matched.currentEpisode !== incoming.currentEpisode) {
        changes.push({
          field: 'currentEpisode',
          label: 'Episódios',
          oldVal: `${matched.currentEpisode}/${matched.totalEpisodes || '?'}`,
          newVal: `${incoming.currentEpisode}/${incoming.totalEpisodes || '?'}`,
        });
      }

      const incomingRating = normalizeMALScore(incoming.rating);
      const existingRating = normalizeMALScore(matched.rating);

      if (existingRating !== incomingRating) {
        changes.push({
          field: 'rating',
          label: 'Nota',
          oldVal: existingRating > 0 ? `${existingRating}/10` : 'Sem nota',
          newVal: incomingRating > 0 ? `${incomingRating}/10` : 'Sem nota',
        });
      }

      if (isGenericOrMissingPoster(matched.posterUrl) && isValidPosterUrl(incoming.posterUrl)) {
        changes.push({
          field: 'posterUrl',
          label: 'Capa',
          oldVal: 'Capa genérica',
          newVal: 'Capa oficial sincronizada',
        });
      }

      const matchRecord: MALMatchedItem = {
        incoming,
        existing: matched,
        hasChanges: changes.length > 0,
        changes,
      };

      matchedItems.push(matchRecord);
      if (changes.length > 0) {
        itemsWithUpdates.push(matchRecord);
      } else {
        itemsIdentical.push(matchRecord);
      }
    }
  }

  const unmatchedExistingCount = currentList.filter(
    (item) => !matchedExistingIds.has(item.id)
  ).length;

  return {
    username,
    totalIncoming: incomingEntries.length,
    newItems,
    matchedItems,
    itemsWithUpdates,
    itemsIdentical,
    unmatchedExistingCount,
  };
}

/**
 * Mescla as entradas do MyAnimeList com a lista existente de forma segura:
 * - Não cria duplicatas.
 * - Preserva campos locais (isFavorite, posters personalizados existentes, IDs locais, animes manuais, anilistId).
 * - Atualiza status e progresso de correspondências apenas se solicitado (updateExistingProgress).
 * - Utiliza índice Map para desempenho O(N + M).
 */
export interface MALMergeReport {
  mergedList: AnimeItem[];
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  preservedFieldsCount: number;
}

/**
 * Mescla as entradas do MyAnimeList com a lista existente de forma segura:
 * - Não cria duplicatas.
 * - Preserva campos locais (isFavorite, posters personalizados existentes, IDs locais, animes manuais, anilistId).
 * - Atualiza status e progresso de correspondências apenas se solicitado (updateExistingProgress).
 * - Utiliza índice Map para desempenho O(N + M).
 */
export function mergeMALImport(
  incomingEntries: MALAnimeEntry[],
  currentList: AnimeItem[],
  updateExistingProgress: boolean = true
): MALMergeReport {
  const resultMap = new Map<string, AnimeItem>();
  for (const item of currentList) {
    resultMap.set(item.id, { ...item });
  }

  const existingIndex = createExistingAnimeIndex(currentList);
  let nextIndex = currentList.length;

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let preservedFieldsCount = 0;

  for (const incoming of incomingEntries) {
    const matched = findMatchingAnimeInIndex(incoming, existingIndex, 'mal_first');

    if (matched) {
      const currentEntry = resultMap.get(matched.id) || matched;

      let changed = false;
      const updatedItem: AnimeItem = {
        ...currentEntry,
        malId: incoming.malId,
        anilistId: currentEntry.anilistId || incoming.anilistId,
        // Limitação técnica da API v2 oficial do MyAnimeList:
        // A API REST v2 do MAL (/v2/users/@me/animelist) não disponibiliza favoritos do usuário (animes ou personagens).
        // Preserva estritamente os favoritos manuais já marcados no Hikari Perfil sem alteração ou remoção.
        isFavorite: currentEntry.isFavorite,
      };

      if (currentEntry.isFavorite) {
        preservedFieldsCount++;
      }

      // Substituição de capas genéricas do Unsplash ou ausentes por capa oficial válida recebida
      // Preserva capas oficiais existentes e imagens personalizadas pelo usuário
      if (isGenericOrMissingPoster(currentEntry.posterUrl) && isValidPosterUrl(incoming.posterUrl)) {
        updatedItem.posterUrl = incoming.posterUrl;
        changed = true;
      } else if (!isGenericOrMissingPoster(currentEntry.posterUrl)) {
        preservedFieldsCount++;
      }

      if (updateExistingProgress) {
        if (currentEntry.status !== incoming.status) {
          updatedItem.status = incoming.status;
          changed = true;
        }
        if (currentEntry.currentEpisode !== incoming.currentEpisode) {
          updatedItem.currentEpisode = incoming.currentEpisode;
          changed = true;
        }
        if (incoming.totalEpisodes > 0 && currentEntry.totalEpisodes !== incoming.totalEpisodes) {
          updatedItem.totalEpisodes = incoming.totalEpisodes;
          changed = true;
        }
        const incomingRating = normalizeMALScore(incoming.rating);
        const existingRating = normalizeMALScore(currentEntry.rating);
        if (existingRating !== incomingRating) {
          updatedItem.rating = incomingRating;
          changed = true;
        }
        if (incoming.rewatchCount && currentEntry.rewatchCount !== incoming.rewatchCount) {
          updatedItem.rewatchCount = incoming.rewatchCount;
          changed = true;
        }
        if (incoming.episodeDurationMinutes && !currentEntry.episodeDurationMinutes) {
          updatedItem.episodeDurationMinutes = incoming.episodeDurationMinutes;
        }
      } else {
        // Se updateExistingProgress for false, todos os dados locais são estritamente preservados
        preservedFieldsCount += 3;
      }

      if (changed) {
        updatedCount++;
      } else {
        unchangedCount++;
      }

      resultMap.set(matched.id, updatedItem);

      // Atualiza o índice para refletir novos identificadores vinculados
      if (incoming.malId && !existingIndex.byMalId.has(incoming.malId)) {
        existingIndex.byMalId.set(incoming.malId, updatedItem);
      }
      if (updatedItem.anilistId && !existingIndex.byAnilistId.has(updatedItem.anilistId)) {
        existingIndex.byAnilistId.set(updatedItem.anilistId, updatedItem);
      }
      const normTitle = normalizeTitle(updatedItem.title);
      if (normTitle) {
        const titleEntries = existingIndex.byNormalizedTitle.get(normTitle);
        if (titleEntries) {
          const entry = titleEntries.find((c) => c.item.id === matched.id);
          if (entry) entry.item = updatedItem;
        }
      }
    } else {
      const generatedId = `ani_mal_${incoming.malId}_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 6)}`;

      // Importante: Nunca considerar nota 10 como favorito. A API oficial do MAL não
      // expõe favoritos do usuário; portanto novos animes importados sempre iniciam
      // com isFavorite = false, aguardando destaque manual no Hikari.
      const newItem: AnimeItem = {
        id: generatedId,
        title: incoming.title,
        titleRomaji: incoming.titleRomaji,
        posterUrl: incoming.posterUrl,
        status: incoming.status,
        currentEpisode: incoming.currentEpisode,
        totalEpisodes: incoming.totalEpisodes,
        rating: normalizeMALScore(incoming.rating),
        isFavorite: false,
        year: incoming.year,
        genres: incoming.genres,
        episodeDurationMinutes: incoming.episodeDurationMinutes,
        rewatchCount: incoming.rewatchCount,
        malId: incoming.malId,
        anilistId: incoming.anilistId,
      };

      resultMap.set(generatedId, newItem);
      addedCount++;

      // Registra no índice para evitar duplicatas no mesmo lote
      if (newItem.malId && !existingIndex.byMalId.has(newItem.malId)) {
        existingIndex.byMalId.set(newItem.malId, newItem);
      }
      if (newItem.anilistId && !existingIndex.byAnilistId.has(newItem.anilistId)) {
        existingIndex.byAnilistId.set(newItem.anilistId, newItem);
      }
      const normTitle = normalizeTitle(newItem.title);
      if (normTitle) {
        const arr = existingIndex.byNormalizedTitle.get(normTitle) || [];
        arr.push({ item: newItem, index: nextIndex++ });
        existingIndex.byNormalizedTitle.set(normTitle, arr);
      }
      if (newItem.titleRomaji) {
        const normRomaji = normalizeTitle(newItem.titleRomaji);
        if (normRomaji && normRomaji !== normTitle) {
          const arr = existingIndex.byNormalizedTitle.get(normRomaji) || [];
          arr.push({ item: newItem, index: nextIndex++ });
          existingIndex.byNormalizedTitle.set(normRomaji, arr);
        }
      }
    }
  }

  return {
    mergedList: Array.from(resultMap.values()),
    addedCount,
    updatedCount,
    unchangedCount,
    preservedFieldsCount,
  };
}
