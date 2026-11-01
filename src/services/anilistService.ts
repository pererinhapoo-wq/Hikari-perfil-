import { AnimeItem } from '../types';

export interface AniListUser {
  id: number;
  name: string;
  avatarUrl: string;
  bannerUrl?: string;
  animeCount?: number;
  episodesWatched?: number;
}

export interface AniListAnimeEntry {
  anilistId: number;
  malId?: number;
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

export interface AniListDiffChange {
  field: string;
  label: string;
  oldVal: string | number;
  newVal: string | number;
}

export interface AniListMatchedItem {
  incoming: AniListAnimeEntry;
  existing: AnimeItem;
  hasChanges: boolean;
  changes: AniListDiffChange[];
}

export interface AniListImportPreview {
  username: string;
  totalIncoming: number;
  newItems: AniListAnimeEntry[];
  matchedItems: AniListMatchedItem[];
  itemsWithUpdates: AniListMatchedItem[];
  itemsIdentical: AniListMatchedItem[];
  unmatchedExistingCount: number;
}

const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';

const USER_QUERY = `
  query ($name: String) {
    User(name: $name) {
      id
      name
      avatar {
        large
        medium
      }
      bannerImage
      statistics {
        anime {
          count
          episodesWatched
        }
      }
    }
  }
`;

const COLLECTION_CHUNK_QUERY = `
  query ($userName: String, $chunk: Int) {
    MediaListCollection(userName: $userName, type: ANIME, chunk: $chunk, perChunk: 500) {
      hasNextChunk
      lists {
        name
        isCustomList
        status
        entries {
          id
          mediaId
          status
          score(format: POINT_10_DECIMAL)
          progress
          repeat
          media {
            id
            idMal
            title {
              userPreferred
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
              medium
            }
            episodes
            duration
            startDate {
              year
            }
            seasonYear
            genres
          }
        }
      }
    }
  }
`;

/**
 * Normaliza um título removendo pontuações, acentos e espaços em branco para busca sem ambiguidade.
 */
export function normalizeTitle(t: string): string {
  if (!t) return '';
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Mapeia o status retornado pelo AniList para o status interno do Hikari.
 */
export function mapAniListStatus(rawStatus: string): AnimeItem['status'] {
  switch (rawStatus) {
    case 'CURRENT':
      return 'watching';
    case 'COMPLETED':
      return 'completed';
    case 'PLANNING':
      return 'planned';
    case 'PAUSED':
      return 'on_hold';
    case 'DROPPED':
      return 'dropped';
    case 'REPEATING':
      return 'watching';
    default:
      return 'watching';
  }
}

export const STATUS_LABELS_PT: Record<AnimeItem['status'], string> = {
  watching: 'Assistindo',
  completed: 'Concluído',
  planned: 'Planejado',
  on_hold: 'Em espera',
  dropped: 'Abandonado',
};

/**
 * Consulta a existência e informações de perfil de um usuário AniList.
 */
export async function fetchAniListUser(username: string): Promise<AniListUser> {
  const cleanUsername = username.trim();
  if (!cleanUsername) {
    throw new Error('Informe o nome de usuário público do AniList.');
  }

  try {
    const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: USER_QUERY,
        variables: { name: cleanUsername },
      }),
    });

    if (res.status === 429) {
      throw new Error(
        'Limite de requisições excedido no AniList. Aguarde alguns instantes e tente novamente.'
      );
    }

    const json = await res.json();

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      const firstError = json.errors[0];
      const status = typeof firstError === 'object' && firstError !== null ? (firstError as { status?: number }).status : undefined;
      const message = typeof firstError === 'object' && firstError !== null ? (firstError as { message?: string }).message : '';

      if (status === 404 || message?.toLowerCase().includes('not found')) {
        throw new Error(
          `O usuário "${cleanUsername}" não foi encontrado no AniList. Verifique a grafia do nome.`
        );
      }
      throw new Error(message || 'Erro ao consultar o perfil no AniList.');
    }

    const userData = json?.data?.User;
    if (!userData || !userData.id) {
      throw new Error(
        `O usuário "${cleanUsername}" não foi encontrado no AniList. Verifique a grafia do nome.`
      );
    }

    return {
      id: userData.id,
      name: userData.name || cleanUsername,
      avatarUrl: userData.avatar?.large || userData.avatar?.medium || '',
      bannerUrl: userData.bannerImage || undefined,
      animeCount: userData.statistics?.anime?.count,
      episodesWatched: userData.statistics?.anime?.episodesWatched,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      // Repassa mensagens já formatadas
      if (err.message.includes('AniList') || err.message.includes('Informe')) {
        throw err;
      }
    }
    throw new Error(
      'Falha na comunicação com os servidores do AniList. Verifique sua conexão com a internet.'
    );
  }
}

/**
 * Consulta a lista completa de animes do usuário no AniList com suporte a paginação por chunks.
 */
export async function fetchAniListAnimeList(username: string): Promise<AniListAnimeEntry[]> {
  const cleanUsername = username.trim();
  if (!cleanUsername) {
    throw new Error('Informe o nome de usuário do AniList.');
  }

  interface RawMediaListEntry {
    id: number;
    mediaId: number;
    status: string;
    score?: number;
    progress?: number;
    repeat?: number;
    media: {
      id: number;
      idMal?: number | null;
      title: {
        userPreferred?: string;
        romaji?: string;
        english?: string;
        native?: string;
      };
      coverImage?: {
        extraLarge?: string;
        large?: string;
        medium?: string;
      };
      episodes?: number | null;
      duration?: number | null;
      startDate?: {
        year?: number | null;
      };
      seasonYear?: number | null;
      genres?: string[];
    };
  }

  interface RawListCollection {
    hasNextChunk: boolean;
    lists?: {
      name: string;
      isCustomList: boolean;
      status?: string;
      entries?: RawMediaListEntry[];
    }[];
  }

  const entriesMap = new Map<number, RawMediaListEntry>();
  let currentChunk = 1;
  let hasMore = true;
  const maxChunks = 10; // Até 5.000 entradas (segurança contra loops)

  while (hasMore && currentChunk <= maxChunks) {
    let res: Response;
    try {
      res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: COLLECTION_CHUNK_QUERY,
          variables: { userName: cleanUsername, chunk: currentChunk },
        }),
      });
    } catch {
      throw new Error(
        'Falha de rede ao consultar a lista de animes no AniList. Verifique sua conexão.'
      );
    }

    if (res.status === 429) {
      throw new Error(
        'Limite de requisições excedido no AniList. Aguarde alguns segundos e tente novamente.'
      );
    }

    const json = await res.json();

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      const msg = json.errors[0]?.message || '';
      if (msg.toLowerCase().includes('private')) {
        throw new Error(
          'A lista de animes deste perfil no AniList está configurada como privada. Acesse sua conta AniList e torne sua lista pública para poder importá-la.'
        );
      }
      if (msg.toLowerCase().includes('not found')) {
        throw new Error(`Usuário "${cleanUsername}" não encontrado no AniList.`);
      }
      throw new Error(`Erro retornado pelo AniList: ${msg}`);
    }

    const collection = json?.data?.MediaListCollection as RawListCollection | undefined;
    if (!collection) {
      break;
    }

    if (Array.isArray(collection.lists)) {
      for (const list of collection.lists) {
        if (Array.isArray(list.entries)) {
          for (const entry of list.entries) {
            if (entry && entry.media && entry.media.id) {
              // Previne duplicatas que existam em listas personalizadas diferentes do mesmo usuário
              if (!entriesMap.has(entry.media.id)) {
                entriesMap.set(entry.media.id, entry);
              }
            }
          }
        }
      }
    }

    hasMore = Boolean(collection.hasNextChunk);
    currentChunk++;
  }

  // Converte as entradas brutas para o modelo padronizado
  const result: AniListAnimeEntry[] = [];

  for (const entry of entriesMap.values()) {
    const media = entry.media;
    const title =
      media.title.userPreferred ||
      media.title.romaji ||
      media.title.english ||
      'Anime sem título';

    const titleRomaji = media.title.romaji || undefined;

    const posterUrl =
      media.coverImage?.large ||
      media.coverImage?.extraLarge ||
      media.coverImage?.medium ||
      '';

    const status = mapAniListStatus(entry.status);

    const currentEpisode = typeof entry.progress === 'number' ? Math.max(0, entry.progress) : 0;
    const totalEpisodes =
      typeof media.episodes === 'number' && media.episodes > 0 ? media.episodes : 0;

    // Normalização de nota: AniList format: POINT_10_DECIMAL retorna 0 a 10. Se for 0 ou null, é sem nota.
    let rating = 0;
    if (typeof entry.score === 'number' && Number.isFinite(entry.score) && entry.score > 0) {
      rating = Math.min(10, Math.max(0, Math.round(entry.score * 10) / 10));
    }

    const year =
      media.startDate?.year ||
      media.seasonYear ||
      new Date().getFullYear();

    const genres = Array.isArray(media.genres) ? media.genres : [];

    const duration =
      typeof media.duration === 'number' && media.duration > 0 ? media.duration : undefined;

    const rewatchCount =
      typeof entry.repeat === 'number' && entry.repeat > 0
        ? entry.repeat
        : entry.status === 'REPEATING'
        ? 1
        : undefined;

    result.push({
      anilistId: media.id,
      malId: media.idMal || undefined,
      title,
      titleRomaji,
      posterUrl,
      status,
      currentEpisode,
      totalEpisodes,
      rating,
      year,
      genres,
      episodeDurationMinutes: duration,
      rewatchCount,
    });
  }

  return result;
}

/**
 * Localiza no array atual de animes do Hikari a correspondência exata para uma entrada vinda do AniList.
 * 1. Primeiro por identificador anilistId.
 * 2. Segundo por identificador malId (quando disponível).
 * 3. Terceiro por título normalizado sem ambiguidades.
 */
export function findMatchingExistingAnime(
  incoming: AniListAnimeEntry,
  existingList: AnimeItem[]
): AnimeItem | undefined {
  // 1. Coincidência direta por anilistId
  if (incoming.anilistId) {
    const byAniId = existingList.find((e) => e.anilistId === incoming.anilistId);
    if (byAniId) return byAniId;
  }

  // 2. Coincidência por malId (se ambos tiverem)
  if (incoming.malId) {
    const byMalId = existingList.find((e) => e.malId && e.malId === incoming.malId);
    if (byMalId) return byMalId;
  }

  // 3. Coincidência por título normalizado
  const incTitleNorm = normalizeTitle(incoming.title);
  const incRomajiNorm = incoming.titleRomaji ? normalizeTitle(incoming.titleRomaji) : '';

  if (!incTitleNorm && !incRomajiNorm) return undefined;

  return existingList.find((ex) => {
    const exTitleNorm = normalizeTitle(ex.title);
    const exRomajiNorm = ex.titleRomaji ? normalizeTitle(ex.titleRomaji) : '';

    if (incTitleNorm && exTitleNorm && incTitleNorm === exTitleNorm) return true;
    if (incTitleNorm && exRomajiNorm && incTitleNorm === exRomajiNorm) return true;
    if (incRomajiNorm && exTitleNorm && incRomajiNorm === exTitleNorm) return true;
    if (incRomajiNorm && exRomajiNorm && incRomajiNorm === exRomajiNorm) return true;

    return false;
  });
}

/**
 * Calcula a prévia detalhada comparativa antes de efetuar qualquer gravação no perfil.
 */
export function calculateAniListImportPreview(
  incomingEntries: AniListAnimeEntry[],
  currentList: AnimeItem[],
  username: string
): AniListImportPreview {
  const newItems: AniListAnimeEntry[] = [];
  const matchedItems: AniListMatchedItem[] = [];
  const itemsWithUpdates: AniListMatchedItem[] = [];
  const itemsIdentical: AniListMatchedItem[] = [];

  const matchedExistingIds = new Set<string>();

  for (const incoming of incomingEntries) {
    const matched = findMatchingExistingAnime(incoming, currentList);

    if (!matched) {
      newItems.push(incoming);
    } else {
      matchedExistingIds.add(matched.id);
      const changes: AniListDiffChange[] = [];

      if (matched.status !== incoming.status) {
        changes.push({
          field: 'status',
          label: 'Status',
          oldVal: STATUS_LABELS_PT[matched.status] || matched.status,
          newVal: STATUS_LABELS_PT[incoming.status] || incoming.status,
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

      if (incoming.rating > 0 && matched.rating !== incoming.rating) {
        changes.push({
          field: 'rating',
          label: 'Nota',
          oldVal: matched.rating > 0 ? `${matched.rating}/10` : 'Sem nota',
          newVal: `${incoming.rating}/10`,
        });
      }

      const matchRecord: AniListMatchedItem = {
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
 * Mescla as entradas do AniList com a lista existente de forma segura:
 * - Não cria duplicatas.
 * - Preserva campos locais (isFavorite, posters personalizados existentes, IDs locais, animes manuais).
 * - Atualiza status e progresso de correspondências apenas se solicitado (updateExistingProgress).
 */
export function mergeAniListImport(
  incomingEntries: AniListAnimeEntry[],
  currentList: AnimeItem[],
  updateExistingProgress: boolean = true
): {
  mergedList: AnimeItem[];
  addedCount: number;
  updatedCount: number;
} {
  // Mapa de trabalho iniciando com os animes já existentes para preservar a ordem e dados manuais
  const resultMap = new Map<string, AnimeItem>();
  for (const item of currentList) {
    resultMap.set(item.id, { ...item });
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const incoming of incomingEntries) {
    const existing = findMatchingExistingAnime(incoming, Array.from(resultMap.values()));

    if (existing) {
      // Anime já existe: vincula o anilistId para rastreamento futuro
      const currentEntry = resultMap.get(existing.id) || existing;

      let changed = false;
      const updatedItem: AnimeItem = {
        ...currentEntry,
        anilistId: incoming.anilistId,
        malId: incoming.malId || currentEntry.malId,
      };

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
        if (incoming.rating > 0 && currentEntry.rating !== incoming.rating) {
          updatedItem.rating = incoming.rating;
          changed = true;
        }
        if (incoming.rewatchCount && currentEntry.rewatchCount !== incoming.rewatchCount) {
          updatedItem.rewatchCount = incoming.rewatchCount;
          changed = true;
        }
        if (incoming.episodeDurationMinutes && !currentEntry.episodeDurationMinutes) {
          updatedItem.episodeDurationMinutes = incoming.episodeDurationMinutes;
        }
      }

      if (changed) {
        updatedCount++;
      }

      resultMap.set(existing.id, updatedItem);
    } else {
      // Novo anime a ser adicionado
      const generatedId = `ani_al_${incoming.anilistId}_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 6)}`;

      const newItem: AnimeItem = {
        id: generatedId,
        title: incoming.title,
        titleRomaji: incoming.titleRomaji,
        posterUrl: incoming.posterUrl,
        status: incoming.status,
        currentEpisode: incoming.currentEpisode,
        totalEpisodes: incoming.totalEpisodes,
        rating: incoming.rating,
        isFavorite: false, // Preserva favoritos manuais; novos iniciam false
        year: incoming.year,
        genres: incoming.genres,
        episodeDurationMinutes: incoming.episodeDurationMinutes,
        rewatchCount: incoming.rewatchCount,
        anilistId: incoming.anilistId,
        malId: incoming.malId,
      };

      resultMap.set(generatedId, newItem);
      addedCount++;
    }
  }

  return {
    mergedList: Array.from(resultMap.values()),
    addedCount,
    updatedCount,
  };
}
