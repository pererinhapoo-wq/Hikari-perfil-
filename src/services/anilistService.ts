import { AnimeItem, FavoriteCharacter } from '../types';

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
  isFavorite?: boolean;
}

export interface AniListFavoritesResult {
  animeAnilistIds: number[];
  animeMalIds: number[];
  characters: FavoriteCharacter[];
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
 * Determina se a capa ou imagem é genérica (comprovadamente do domínio images.unsplash.com) ou está ausente/vazia.
 */
export function isGenericOrMissingPoster(posterUrl?: string | null): boolean {
  if (!posterUrl || typeof posterUrl !== 'string' || !posterUrl.trim()) {
    return true;
  }
  const trimmed = posterUrl.trim().toLowerCase();
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === 'images.unsplash.com' || parsed.hostname.endsWith('.unsplash.com');
  } catch {
    return trimmed.includes('images.unsplash.com') || trimmed.includes('unsplash.com');
  }
}

export const isGenericOrMissingImage = isGenericOrMissingPoster;

/**
 * Valida se a capa ou imagem recebida da plataforma externa é uma URL válida (HTTP/HTTPS) e não-vazia.
 */
export function isValidPosterUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isValidImageUrl = isValidPosterUrl;


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
 * Converte e normaliza com precisão notas do AniList para a escala decimal do Hikari (0 a 10, com 1 casa decimal).
 * - Retorna 0 para representar ausência de nota (sem avaliação).
 * - Converte proporcionalmente caso venha na escala de 0 a 100 (ex: 85 -> 8.5).
 * - Preserva até 1 casa decimal exata evitando resíduos de ponto flutuante do IEEE 754.
 */
export function normalizeAniListScore(score?: number | null): number {
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

const FAVORITES_QUERY = `
  query ($name: String) {
    User(name: $name) {
      id
      favourites {
        anime(page: 1, perPage: 50) {
          nodes {
            id
            idMal
            title {
              userPreferred
              romaji
              english
            }
          }
        }
        characters(page: 1, perPage: 25) {
          nodes {
            id
            name {
              userPreferred
              full
              native
            }
            image {
              large
              medium
            }
            media(type: ANIME, sort: FAVOURITES_DESC, page: 1, perPage: 1) {
              edges {
                characterRole
                node {
                  id
                  title {
                    userPreferred
                    romaji
                    english
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

let lastFetchedAniListCharacters: FavoriteCharacter[] = [];

export function getLastFetchedAniListCharacters(): FavoriteCharacter[] {
  return [...lastFetchedAniListCharacters];
}

export function setLastFetchedAniListCharacters(chars: FavoriteCharacter[]): void {
  lastFetchedAniListCharacters = [...chars];
}

export function mapAniListCharacter(raw: any): FavoriteCharacter {
  const animeEdge = raw.media?.edges?.[0];
  const animeTitle =
    animeEdge?.node?.title?.userPreferred ||
    animeEdge?.node?.title?.romaji ||
    animeEdge?.node?.title?.english ||
    'Anime';

  let roleLabel = 'Protagonista';
  if (animeEdge?.characterRole === 'SUPPORTING' || animeEdge?.characterRole === 'BACKGROUND') {
    roleLabel = 'Personagem Secundário';
  } else if (animeEdge?.characterRole === 'MAIN') {
    roleLabel = 'Protagonista';
  }

  const name =
    raw.name?.userPreferred ||
    raw.name?.full ||
    'Personagem';

  return {
    id: `char_al_${raw.id}`,
    name,
    originalName: raw.name?.native || undefined,
    animeName: animeTitle,
    role: roleLabel,
    imageUrl: raw.image?.large || raw.image?.medium || '',
  };
}

/**
 * Mescla personagens favoritos locais com os favoritos importados do AniList:
 * - Preserva a ordem original dos favoritos manuais e evita duplicatas.
 * - Substitui imagens genéricas do Unsplash ou ausentes por imagem oficial válida recebida.
 * - Preserva imagens oficiais existentes e imagens personalizadas pelo usuário (Data URLs, serviços externos, caminhos locais).
 * - Proteção contra URLs vazias ou inválidas da API (nunca sobrescrevem uma imagem válida).
 * - Mantém rigorosamente intactos todos os demais campos (id, name, originalName, animeName, role).
 */
export function mergeFavoriteCharacters(
  existingCharacters: FavoriteCharacter[],
  incomingCharacters: FavoriteCharacter[]
): FavoriteCharacter[] {
  const result: FavoriteCharacter[] = existingCharacters.map((char) => ({ ...char }));
  const idIndexMap = new Map<string, number>();
  const nameIndexMap = new Map<string, number>();

  result.forEach((char, idx) => {
    if (char.id) idIndexMap.set(char.id, idx);
    const normName = normalizeTitle(char.name);
    if (normName && !nameIndexMap.has(normName)) {
      nameIndexMap.set(normName, idx);
    }
  });

  for (const inc of incomingCharacters) {
    const normName = normalizeTitle(inc.name);
    let matchIdx = -1;

    if (inc.id && idIndexMap.has(inc.id)) {
      matchIdx = idIndexMap.get(inc.id)!;
    } else if (normName && nameIndexMap.has(normName)) {
      matchIdx = nameIndexMap.get(normName)!;
    }

    if (matchIdx >= 0) {
      const existingChar = result[matchIdx];
      // Atualiza apenas se a imagem atual for genérica (Unsplash) ou vazia,
      // e a recebida for uma URL válida oficial
      if (isGenericOrMissingPoster(existingChar.imageUrl) && isValidPosterUrl(inc.imageUrl)) {
        result[matchIdx] = {
          ...existingChar,
          imageUrl: inc.imageUrl,
        };
      }
    } else {
      // Novo personagem: adiciona sem duplicar
      result.push({ ...inc });
      const newIdx = result.length - 1;
      if (inc.id) idIndexMap.set(inc.id, newIdx);
      if (normName && !nameIndexMap.has(normName)) {
        nameIndexMap.set(normName, newIdx);
      }
    }
  }

  return result;
}

/**
 * Consulta os favoritos reais de animes e personagens da conta AniList.
 */
export async function fetchAniListFavorites(username: string): Promise<AniListFavoritesResult> {
  const cleanUsername = username.trim();
  if (!cleanUsername) {
    return { animeAnilistIds: [], animeMalIds: [], characters: [] };
  }

  try {
    const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: FAVORITES_QUERY,
        variables: { name: cleanUsername },
      }),
    });

    if (!res.ok) {
      return { animeAnilistIds: [], animeMalIds: [], characters: [] };
    }

    const json = await res.json();
    const favData = json?.data?.User?.favourites;

    const animeNodes = Array.isArray(favData?.anime?.nodes) ? favData.anime.nodes : [];
    const animeAnilistIds: number[] = [];
    const animeMalIds: number[] = [];

    for (const node of animeNodes) {
      if (typeof node?.id === 'number') {
        animeAnilistIds.push(node.id);
      }
      if (typeof node?.idMal === 'number') {
        animeMalIds.push(node.idMal);
      }
    }

    const charNodes = Array.isArray(favData?.characters?.nodes) ? favData.characters.nodes : [];
    const characters: FavoriteCharacter[] = charNodes.map((raw: any) => mapAniListCharacter(raw));

    lastFetchedAniListCharacters = characters;

    return {
      animeAnilistIds,
      animeMalIds,
      characters,
    };
  } catch {
    return { animeAnilistIds: [], animeMalIds: [], characters: [] };
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

  // Consulta favoritos da conta para atribuir isFavorite e obter personagens favoritos
  const favAnilistIds = new Set<number>();
  const favMalIds = new Set<number>();
  try {
    const favResult = await fetchAniListFavorites(cleanUsername);
    for (const id of favResult.animeAnilistIds) favAnilistIds.add(id);
    for (const id of favResult.animeMalIds) favMalIds.add(id);
  } catch {
    // Falha silenciosa em favoritos não impede carregamento da lista
  }

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

    // Normalização de nota: AniList POINT_10_DECIMAL retorna 0 a 10 (0 = sem nota)
    const rating = normalizeAniListScore(entry.score);

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

    const isFav = favAnilistIds.has(media.id) || (media.idMal ? favMalIds.has(media.idMal) : false);

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
      isFavorite: isFav,
    });
  }

  return result;
}

/**
 * Estrutura de índice em Map para buscas O(1) de animes existentes por identificadores externos e títulos normalizados.
 */
export interface ExistingAnimeIndex {
  byAnilistId: Map<number, AnimeItem>;
  byMalId: Map<number, AnimeItem>;
  byNormalizedTitle: Map<string, { item: AnimeItem; index: number }[]>;
}

/**
 * Constrói índices em Map em O(M) para evitar buscas lineares repetidas O(N x M).
 * Preserva as entradas na ordem da lista original para manter determinismo.
 */
export function createExistingAnimeIndex(list: AnimeItem[]): ExistingAnimeIndex {
  const byAnilistId = new Map<number, AnimeItem>();
  const byMalId = new Map<number, AnimeItem>();
  const byNormalizedTitle = new Map<string, { item: AnimeItem; index: number }[]>();

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.anilistId && !byAnilistId.has(item.anilistId)) {
      byAnilistId.set(item.anilistId, item);
    }
    if (item.malId && !byMalId.has(item.malId)) {
      byMalId.set(item.malId, item);
    }
    const normTitle = normalizeTitle(item.title);
    if (normTitle) {
      const arr = byNormalizedTitle.get(normTitle) || [];
      arr.push({ item, index: i });
      byNormalizedTitle.set(normTitle, arr);
    }
    if (item.titleRomaji) {
      const normRomaji = normalizeTitle(item.titleRomaji);
      if (normRomaji && normRomaji !== normTitle) {
        const arr = byNormalizedTitle.get(normRomaji) || [];
        arr.push({ item, index: i });
        byNormalizedTitle.set(normRomaji, arr);
      }
    }
  }

  return { byAnilistId, byMalId, byNormalizedTitle };
}

/**
 * Localiza no índice em Map a correspondência exata para uma entrada externa em O(1),
 * respeitando a ordem de prioridade definida e evitando associar temporadas/remakes
 * que compartilhem o mesmo título mas possuam IDs externos conflitantes.
 */
export function findMatchingAnimeInIndex(
  incoming: { anilistId?: number; malId?: number; title: string; titleRomaji?: string },
  index: ExistingAnimeIndex,
  priority: 'anilist_first' | 'mal_first' = 'anilist_first'
): AnimeItem | undefined {
  if (priority === 'anilist_first') {
    if (incoming.anilistId) {
      const match = index.byAnilistId.get(incoming.anilistId);
      if (match) return match;
    }
    if (incoming.malId) {
      const match = index.byMalId.get(incoming.malId);
      if (match) return match;
    }
  } else {
    if (incoming.malId) {
      const match = index.byMalId.get(incoming.malId);
      if (match) return match;
    }
    if (incoming.anilistId) {
      const match = index.byAnilistId.get(incoming.anilistId);
      if (match) return match;
    }
  }

  const incTitleNorm = normalizeTitle(incoming.title);
  const incRomajiNorm = incoming.titleRomaji ? normalizeTitle(incoming.titleRomaji) : '';

  if (!incTitleNorm && !incRomajiNorm) return undefined;

  const candidates: { item: AnimeItem; index: number }[] = [];
  if (incTitleNorm && index.byNormalizedTitle.has(incTitleNorm)) {
    candidates.push(...(index.byNormalizedTitle.get(incTitleNorm) || []));
  }
  if (incRomajiNorm && index.byNormalizedTitle.has(incRomajiNorm)) {
    candidates.push(...(index.byNormalizedTitle.get(incRomajiNorm) || []));
  }

  // Ordena por índice de inserção original para manter determinismo
  candidates.sort((a, b) => a.index - b.index);

  for (const { item } of candidates) {
    // Rejeita correspondência por título se ambos tiverem IDs externos conflitantes
    // (ex: temporadas, filmes ou remakes diferentes que compartilham o mesmo título base)
    if (incoming.anilistId && item.anilistId && incoming.anilistId !== item.anilistId) {
      continue;
    }
    if (incoming.malId && item.malId && incoming.malId !== item.malId) {
      continue;
    }
    return item;
  }

  return undefined;
}

/**
 * Localiza no array atual de animes do Hikari a correspondência exata para uma entrada vinda do AniList.
 * 1. Primeiro por identificador anilistId.
 * 2. Segundo por identificador malId (quando disponível).
 * 3. Terceiro por título normalizado, sem associar temporadas ou obras com IDs conflitantes.
 */
export function findMatchingExistingAnime(
  incoming: AniListAnimeEntry,
  existingList: AnimeItem[],
  existingIndex?: ExistingAnimeIndex
): AnimeItem | undefined {
  if (existingIndex) {
    return findMatchingAnimeInIndex(incoming, existingIndex, 'anilist_first');
  }

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
    // Rejeita correspondência se ambos tiverem IDs externos e forem conflitantes
    if (incoming.anilistId && ex.anilistId && incoming.anilistId !== ex.anilistId) {
      return false;
    }
    if (incoming.malId && ex.malId && incoming.malId !== ex.malId) {
      return false;
    }

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
 * Utiliza índice Map em O(N + M) para evitar congelamento da interface em listas extensas.
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
  const existingIndex = createExistingAnimeIndex(currentList);

  for (const incoming of incomingEntries) {
    const matched = findMatchingAnimeInIndex(incoming, existingIndex, 'anilist_first');

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

      const incomingRating = normalizeAniListScore(incoming.rating);
      const existingRating = normalizeAniListScore(matched.rating);

      if (existingRating !== incomingRating) {
        changes.push({
          field: 'rating',
          label: 'Nota',
          oldVal: existingRating > 0 ? `${existingRating}/10` : 'Sem nota',
          newVal: incomingRating > 0 ? `${incomingRating}/10` : 'Sem nota',
        });
      }

      if (!matched.isFavorite && incoming.isFavorite) {
        changes.push({
          field: 'isFavorite',
          label: 'Favorito',
          oldVal: 'Não destacado',
          newVal: 'Destacado no AniList',
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
 * - Preserva campos locais (isFavorite manual mantido, posters personalizados, IDs locais, animes manuais).
 * - Sincroniza animes favoritados na conta AniList sem nunca desmarcar favoritos locais.
 * - Atualiza status e progresso de correspondências apenas se solicitado (updateExistingProgress).
 * - Utiliza índice Map para desempenho O(N + M).
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

  const existingIndex = createExistingAnimeIndex(currentList);
  let nextIndex = currentList.length;

  let addedCount = 0;
  let updatedCount = 0;

  for (const incoming of incomingEntries) {
    const matched = findMatchingAnimeInIndex(incoming, existingIndex, 'anilist_first');

    if (matched) {
      // Anime já existe: vincula o anilistId para rastreamento futuro
      const currentEntry = resultMap.get(matched.id) || matched;

      let changed = false;
      const updatedItem: AnimeItem = {
        ...currentEntry,
        anilistId: incoming.anilistId,
        malId: incoming.malId || currentEntry.malId,
      };

      // Preserva favoritos manuais locais se já marcados no Hikari Perfil OU sincroniza favorito do AniList
      const wasFavorite = Boolean(currentEntry.isFavorite);
      const incomingFavorite = Boolean(incoming.isFavorite);
      if (!wasFavorite && incomingFavorite) {
        updatedItem.isFavorite = true;
        changed = true;
      } else {
        updatedItem.isFavorite = wasFavorite;
      }

      // Substituição de capas genéricas do Unsplash ou ausentes por capa oficial válida recebida
      // Preserva capas oficiais existentes e imagens personalizadas pelo usuário
      if (isGenericOrMissingPoster(currentEntry.posterUrl) && isValidPosterUrl(incoming.posterUrl)) {
        updatedItem.posterUrl = incoming.posterUrl;
        changed = true;
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
        const incomingRating = normalizeAniListScore(incoming.rating);
        const existingRating = normalizeAniListScore(currentEntry.rating);
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
      }

      if (changed) {
        updatedCount++;
      }

      resultMap.set(matched.id, updatedItem);

      // Atualiza o índice para refletir novos identificadores vinculados
      if (incoming.anilistId && !existingIndex.byAnilistId.has(incoming.anilistId)) {
        existingIndex.byAnilistId.set(incoming.anilistId, updatedItem);
      }
      if (updatedItem.malId && !existingIndex.byMalId.has(updatedItem.malId)) {
        existingIndex.byMalId.set(updatedItem.malId, updatedItem);
      }
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
        rating: normalizeAniListScore(incoming.rating),
        isFavorite: Boolean(incoming.isFavorite),
        year: incoming.year,
        genres: incoming.genres,
        episodeDurationMinutes: incoming.episodeDurationMinutes,
        rewatchCount: incoming.rewatchCount,
        anilistId: incoming.anilistId,
        malId: incoming.malId,
      };

      resultMap.set(generatedId, newItem);
      addedCount++;

      // Registra no índice para evitar duplicatas em múltiplos itens recebidos no mesmo lote
      if (newItem.anilistId && !existingIndex.byAnilistId.has(newItem.anilistId)) {
        existingIndex.byAnilistId.set(newItem.anilistId, newItem);
      }
      if (newItem.malId && !existingIndex.byMalId.has(newItem.malId)) {
        existingIndex.byMalId.set(newItem.malId, newItem);
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
  };
}
