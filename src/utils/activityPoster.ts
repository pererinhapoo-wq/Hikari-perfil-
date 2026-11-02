import { UserActivity, AnimeItem } from '../types';
import { INITIAL_ANIMES } from '../data/mockData';

interface IndexedPhraseCandidate {
  anime: AnimeItem;
  phrase: string;
  length: number;
}

interface IndexedCatalogEntry {
  anime: AnimeItem;
  titleNorm: string;
  romajiNorm: string;
  maxLen: number;
}

export interface NormalizedAnimeCatalogIndex {
  byId: Map<string, AnimeItem>;
  byNormalizedTitle: Map<string, AnimeItem>;
  firstWordBuckets: Map<string, IndexedPhraseCandidate[]>;
  entriesByLengthDesc: IndexedCatalogEntry[];
}

const indexByAnimesRef = new WeakMap<readonly AnimeItem[], NormalizedAnimeCatalogIndex>();
const indexByProfileId = new Map<
  string,
  { animesRef: readonly AnimeItem[] | undefined; index: NormalizedAnimeCatalogIndex }
>();
let defaultCatalogIndex: NormalizedAnimeCatalogIndex | null = null;

let indexBuildCount = 0;
let animeNormalizationCount = 0;

export function getActivityPosterMetrics() {
  return {
    indexBuildCount,
    animeNormalizationCount,
  };
}

export function resetActivityPosterMetrics(): void {
  indexBuildCount = 0;
  animeNormalizationCount = 0;
}

export function invalidateProfileAnimeCatalogIndex(profileId?: string): void {
  if (!profileId) {
    indexByProfileId.clear();
    return;
  }
  indexByProfileId.delete(profileId);
}

function normalizeString(val: string): string {
  return val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldPreferAnimeRecord(existing: AnimeItem | undefined, candidate: AnimeItem): boolean {
  if (!existing) return true;
  if (!existing.posterUrl && Boolean(candidate.posterUrl)) return true;
  return false;
}

function addPhraseToBucket(
  buckets: Map<string, IndexedPhraseCandidate[]>,
  phrase: string,
  anime: AnimeItem
): void {
  if (!phrase) return;
  const firstSpace = phrase.indexOf(' ');
  const firstWord = firstSpace === -1 ? phrase : phrase.slice(0, firstSpace);
  if (!firstWord) return;

  let list = buckets.get(firstWord);
  if (!list) {
    list = [];
    buckets.set(firstWord, list);
  }
  list.push({
    anime,
    phrase,
    length: phrase.length,
  });
}

function buildNormalizedCatalogIndex(userAnimes?: readonly AnimeItem[]): NormalizedAnimeCatalogIndex {
  indexBuildCount++;

  const byId = new Map<string, AnimeItem>();
  const byNormalizedTitle = new Map<string, AnimeItem>();
  const firstWordBuckets = new Map<string, IndexedPhraseCandidate[]>();
  const entriesByLengthDesc: IndexedCatalogEntry[] = [];

  const registerList = (list: readonly AnimeItem[]) => {
    for (let i = 0; i < list.length; i++) {
      const anime = list[i];
      if (!anime) continue;

      if (anime.id && shouldPreferAnimeRecord(byId.get(anime.id), anime)) {
        byId.set(anime.id, anime);
      }

      animeNormalizationCount++;
      const titleNorm = anime.title ? normalizeString(anime.title) : '';
      const romajiNorm = anime.titleRomaji ? normalizeString(anime.titleRomaji) : '';

      if (titleNorm && shouldPreferAnimeRecord(byNormalizedTitle.get(titleNorm), anime)) {
        byNormalizedTitle.set(titleNorm, anime);
      }
      if (
        romajiNorm &&
        romajiNorm !== titleNorm &&
        shouldPreferAnimeRecord(byNormalizedTitle.get(romajiNorm), anime)
      ) {
        byNormalizedTitle.set(romajiNorm, anime);
      }

      if (titleNorm) {
        addPhraseToBucket(firstWordBuckets, titleNorm, anime);
      }
      if (romajiNorm && romajiNorm !== titleNorm) {
        addPhraseToBucket(firstWordBuckets, romajiNorm, anime);
      }

      const maxLen = Math.max(titleNorm.length, romajiNorm.length);
      if (maxLen > 0) {
        entriesByLengthDesc.push({
          anime,
          titleNorm,
          romajiNorm,
          maxLen,
        });
      }
    }
  };

  if (userAnimes && userAnimes.length > 0) {
    registerList(userAnimes);
  }
  registerList(INITIAL_ANIMES);

  // Ordena candidatos de cada bucket pelo maior comprimento para priorizar títulos mais específicos
  for (const list of firstWordBuckets.values()) {
    if (list.length > 1) {
      list.sort((a, b) => b.length - a.length);
    }
  }
  entriesByLengthDesc.sort((a, b) => b.maxLen - a.maxLen);

  return {
    byId,
    byNormalizedTitle,
    firstWordBuckets,
    entriesByLengthDesc,
  };
}

/**
 * Obtém ou reutiliza o índice normalizado de animes por perfil / referência de lista.
 * Invalida e reconstrói automaticamente quando a referência de `userAnimes` muda.
 */
export function getNormalizedAnimeCatalogIndex(
  userAnimes?: readonly AnimeItem[],
  profileId?: string
): NormalizedAnimeCatalogIndex {
  if (profileId) {
    const profileCached = indexByProfileId.get(profileId);
    if (profileCached && profileCached.animesRef === userAnimes) {
      return profileCached.index;
    }
  }

  if (!userAnimes || userAnimes.length === 0) {
    if (!defaultCatalogIndex) {
      defaultCatalogIndex = buildNormalizedCatalogIndex(undefined);
    }
    if (profileId) {
      indexByProfileId.set(profileId, { animesRef: userAnimes, index: defaultCatalogIndex });
    }
    return defaultCatalogIndex;
  }

  let index = indexByAnimesRef.get(userAnimes);
  if (!index) {
    index = buildNormalizedCatalogIndex(userAnimes);
    indexByAnimesRef.set(userAnimes, index);
  }

  if (profileId) {
    indexByProfileId.set(profileId, { animesRef: userAnimes, index });
  }

  return index;
}

function findBestEmbeddedMatch(
  combinedText: string,
  index: NormalizedAnimeCatalogIndex,
  requirePoster: boolean
): AnimeItem | undefined {
  if (!combinedText) return undefined;

  // 1. Consulta exata O(1) caso o texto inteiro corresponda ao título normalizado
  const exactFull = index.byNormalizedTitle.get(combinedText);
  if (exactFull && (!requirePoster || exactFull.posterUrl)) {
    return exactFull;
  }

  // 2. Consulta O(W) guiada pelas palavras presentes na atividade (evita varrer milhares de animes)
  const words = combinedText.split(' ');
  const checkedFirstWords = new Set<string>();
  let bestMatch: AnimeItem | undefined;
  let bestMatchLen = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word || checkedFirstWords.has(word)) continue;
    checkedFirstWords.add(word);

    const candidates = index.firstWordBuckets.get(word);
    if (!candidates) continue;

    for (let j = 0; j < candidates.length; j++) {
      const candidate = candidates[j];
      if (candidate.length <= bestMatchLen) {
        // Bucket já está ordenado por comprimento decrescente
        break;
      }
      if (requirePoster && !candidate.anime.posterUrl) {
        continue;
      }
      if (combinedText.includes(candidate.phrase)) {
        bestMatch = candidate.anime;
        bestMatchLen = candidate.length;
        break;
      }
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  // 3. Fallback raro para substrings coladas sem separação de palavra, já pré-normalizadas e ordenadas
  for (let i = 0; i < index.entriesByLengthDesc.length; i++) {
    const entry = index.entriesByLengthDesc[i];
    if (entry.maxLen <= bestMatchLen) break;
    if (requirePoster && !entry.anime.posterUrl) continue;

    if (
      entry.titleNorm &&
      entry.titleNorm.length > bestMatchLen &&
      combinedText.includes(entry.titleNorm)
    ) {
      bestMatch = entry.anime;
      bestMatchLen = entry.titleNorm.length;
    } else if (
      entry.romajiNorm &&
      entry.romajiNorm.length > bestMatchLen &&
      combinedText.includes(entry.romajiNorm)
    ) {
      bestMatch = entry.anime;
      bestMatchLen = entry.romajiNorm.length;
    }
  }

  return bestMatch;
}

/**
 * Resolve capa e título do anime em uma única operação O(1) para evitar consultas duplicadas no card.
 */
export function resolveActivityAnimeMatch(
  activity: UserActivity,
  userAnimes?: AnimeItem[],
  profileId?: string
): { posterUrl?: string; animeTitle?: string } {
  const directPoster =
    activity.posterUrl && typeof activity.posterUrl === 'string' && activity.posterUrl.trim().length > 0
      ? activity.posterUrl
      : undefined;
  const directTitle =
    activity.animeTitle && typeof activity.animeTitle === 'string' && activity.animeTitle.trim().length > 0
      ? activity.animeTitle
      : undefined;

  if (directPoster && directTitle) {
    return { posterUrl: directPoster, animeTitle: directTitle };
  }

  const index = getNormalizedAnimeCatalogIndex(userAnimes, profileId);

  // 1. Consulta direta O(1) por animeId
  if (activity.animeId) {
    const byIdMatch = index.byId.get(activity.animeId);
    if (byIdMatch) {
      const resolvedPoster = directPoster || byIdMatch.posterUrl || undefined;
      const resolvedTitle = directTitle || byIdMatch.title || undefined;
      if (resolvedPoster && resolvedTitle) {
        return { posterUrl: resolvedPoster, animeTitle: resolvedTitle };
      }
    }
  }

  // 2. Consulta O(1) pelo sufixo determinístico de IDs de atividade ("act_<ts>_<animeId>")
  if (activity.id && activity.id.startsWith('act_')) {
    const firstSep = activity.id.indexOf('_', 4);
    if (firstSep !== -1 && firstSep + 1 < activity.id.length) {
      const candidateId = activity.id.slice(firstSep + 1);
      const idMatch = index.byId.get(candidateId) || index.byId.get(`anime_${candidateId}`);
      if (idMatch) {
        const resolvedPoster = directPoster || idMatch.posterUrl || undefined;
        const resolvedTitle = directTitle || idMatch.title || undefined;
        if (resolvedPoster) {
          return { posterUrl: resolvedPoster, animeTitle: resolvedTitle };
        }
      }
    }
  }

  // 3. Consulta exata O(1) por animeTitle normalizado quando presente
  if (directTitle) {
    const normAnimeTitle = normalizeString(directTitle);
    const exactByTitle = normAnimeTitle ? index.byNormalizedTitle.get(normAnimeTitle) : undefined;
    if (exactByTitle?.posterUrl) {
      return {
        posterUrl: directPoster || exactByTitle.posterUrl,
        animeTitle: directTitle,
      };
    }
  }

  // 4. Correspondência textual usando o índice normalizado uma única vez por lista
  const combinedText = normalizeString(
    `${activity.title || ''} ${activity.description || ''} ${activity.animeTitle || ''}`
  );
  if (!combinedText) {
    return { posterUrl: directPoster, animeTitle: directTitle };
  }

  const matched = findBestEmbeddedMatch(combinedText, index, !directPoster);
  return {
    posterUrl: directPoster || matched?.posterUrl || undefined,
    animeTitle: directTitle || matched?.title || undefined,
  };
}

export function resolveActivityPoster(
  activity: UserActivity,
  userAnimes?: AnimeItem[],
  profileId?: string
): string | undefined {
  return resolveActivityAnimeMatch(activity, userAnimes, profileId).posterUrl;
}

export function resolveActivityAnimeTitle(
  activity: UserActivity,
  userAnimes?: AnimeItem[],
  profileId?: string
): string | undefined {
  if (activity.animeTitle) return activity.animeTitle;

  const index = getNormalizedAnimeCatalogIndex(userAnimes, profileId);

  if (activity.animeId) {
    const match = index.byId.get(activity.animeId);
    if (match?.title) return match.title;
  }

  const combinedText = normalizeString(`${activity.title || ''} ${activity.description || ''}`);
  if (!combinedText) return undefined;

  const matched = findBestEmbeddedMatch(combinedText, index, false);
  return matched?.title;
}
