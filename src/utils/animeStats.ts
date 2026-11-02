import { AnimeItem, AnimeStatus } from '../types';

/**
 * Calcula a contagem de todas as 6 categorias de status em uma única passagem O(N).
 */
export function computeAnimeStatusCounts(
  animes: readonly AnimeItem[]
): Record<AnimeStatus, number> {
  let watching = 0;
  let completed = 0;
  let planned = 0;
  let onHold = 0;
  let dropped = 0;

  for (let i = 0; i < animes.length; i++) {
    switch (animes[i].status) {
      case 'watching':
        watching++;
        break;
      case 'completed':
        completed++;
        break;
      case 'planned':
        planned++;
        break;
      case 'on_hold':
        onHold++;
        break;
      case 'dropped':
        dropped++;
        break;
    }
  }

  return {
    all: animes.length,
    watching,
    completed,
    planned,
    on_hold: onHold,
    dropped,
  };
}

export interface AnimeStatsSummary {
  watchingCount: number;
  completedCount: number;
  onHoldCount: number;
  droppedCount: number;
  plannedCount: number;
  totalEntries: number;
  totalEpisodesWatched: number;
  hasEpisodeData: boolean;
  rewatchedTotal: number | null;
  meanScore: number | null;
  meanScoreFormatted: string | null;
  ratedCount: number;
  daysWatched: number | null;
  daysWatchedFormatted: string | null;
  hasDurationData: boolean;
}

export const EMPTY_ANIME_STATS: AnimeStatsSummary = {
  watchingCount: 0,
  completedCount: 0,
  onHoldCount: 0,
  droppedCount: 0,
  plannedCount: 0,
  totalEntries: 0,
  totalEpisodesWatched: 0,
  hasEpisodeData: false,
  rewatchedTotal: null,
  meanScore: null,
  meanScoreFormatted: null,
  ratedCount: 0,
  daysWatched: null,
  daysWatchedFormatted: null,
  hasDurationData: false,
};

// Cache por referência de lista para evitar recalcular estatísticas repetidamente para os mesmos dados
const animeStatsCache = new WeakMap<readonly AnimeItem[], AnimeStatsSummary>();

let animeStatsComputeExecutions = 0;
let animeStatsCacheHits = 0;

export function getAnimeStatsComputeMetrics() {
  return {
    executions: animeStatsComputeExecutions,
    cacheHits: animeStatsCacheHits,
  };
}

export function resetAnimeStatsComputeMetrics(): void {
  animeStatsComputeExecutions = 0;
  animeStatsCacheHits = 0;
}

/**
 * Atualiza pontualmente um único anime por ID sem mapear/recriar objetos de toda a lista.
 * Usa cópia rasa nativa (slice) substituindo apenas o índice modificado e retorna null se não houver mudança real.
 */
export function updateSingleAnimeById(
  animes: AnimeItem[],
  animeId: string,
  updater: (current: AnimeItem) => AnimeItem | null
): { nextAnimes: AnimeItem[]; previousAnime: AnimeItem; updatedAnime: AnimeItem } | null {
  const index = animes.findIndex((item) => item.id === animeId);
  if (index === -1) return null;

  const previousAnime = animes[index];
  const updatedAnime = updater(previousAnime);
  if (!updatedAnime || updatedAnime === previousAnime) {
    return null;
  }

  const nextAnimes = animes.slice();
  nextAnimes[index] = updatedAnime;
  return { nextAnimes, previousAnime, updatedAnime };
}

/**
 * Computes real, deduplicated anime statistics strictly from the user's anime entries.
 * Never fabricates fallback metrics when fields like duration or rewatch count are absent.
 * Memoized via WeakMap by array reference so identical anime lists compute at most once.
 */
export function computeAnimeStats(animes: AnimeItem[]): AnimeStatsSummary {
  if (!Array.isArray(animes) || animes.length === 0) {
    return EMPTY_ANIME_STATS;
  }

  const cached = animeStatsCache.get(animes);
  if (cached) {
    animeStatsCacheHits++;
    return cached;
  }

  animeStatsComputeExecutions++;

  // Deduplicate by anime ID in a single pass without intermediate array allocations
  const seenIds = new Set<string>();

  let watchingCount = 0;
  let completedCount = 0;
  let onHoldCount = 0;
  let droppedCount = 0;
  let plannedCount = 0;
  let totalEntries = 0;

  let totalEpisodesWatched = 0;
  let hasEpisodeData = false;

  let rewatchedSum = 0;
  let hasRewatchField = false;

  let scoreSum = 0;
  let ratedCount = 0;

  let totalWatchedMinutes = 0;
  let hasDurationData = false;

  for (let i = 0; i < animes.length; i++) {
    const anime = animes[i];
    if (!anime || typeof anime.id !== 'string' || seenIds.has(anime.id)) {
      continue;
    }
    seenIds.add(anime.id);
    totalEntries++;

    // 1. Status distribution counts
    switch (anime.status) {
      case 'watching':
        watchingCount++;
        break;
      case 'completed':
        completedCount++;
        break;
      case 'on_hold':
        onHoldCount++;
        break;
      case 'dropped':
        droppedCount++;
        break;
      case 'planned':
        plannedCount++;
        break;
    }

    // 2. Episodes watched
    const rawCurrent = Number.isFinite(anime.currentEpisode)
      ? Math.max(0, Math.floor(anime.currentEpisode))
      : 0;
    const rawTotal = Number.isFinite(anime.totalEpisodes)
      ? Math.max(0, Math.floor(anime.totalEpisodes))
      : 0;

    if (typeof anime.currentEpisode === 'number' && Number.isFinite(anime.currentEpisode)) {
      hasEpisodeData = true;
    }

    const effectiveEpisodes =
      anime.status === 'completed' && rawTotal > 0
        ? Math.max(rawCurrent, rawTotal)
        : rawTotal > 0
          ? Math.min(rawCurrent, rawTotal)
          : rawCurrent;

    // 3. Rewatched count (only aggregated if explicitly recorded on entries)
    let entryRewatches = 0;
    if (typeof anime.rewatchCount === 'number' && Number.isFinite(anime.rewatchCount)) {
      hasRewatchField = true;
      entryRewatches = Math.max(0, Math.floor(anime.rewatchCount));
      rewatchedSum += entryRewatches;
    }

    const totalEntryEpisodesWatched =
      effectiveEpisodes + (entryRewatches > 0 && rawTotal > 0 ? entryRewatches * rawTotal : 0);

    totalEpisodesWatched += totalEntryEpisodesWatched;

    // 4. Mean Score: average only positively rated entries (> 0), ignoring unrated (0 / null / undefined)
    if (typeof anime.rating === 'number' && Number.isFinite(anime.rating) && anime.rating > 0) {
      scoreSum += anime.rating;
      ratedCount++;
    }

    // 5. Days Watched: calculated strictly when real episode duration in minutes exists
    if (
      typeof anime.episodeDurationMinutes === 'number' &&
      Number.isFinite(anime.episodeDurationMinutes) &&
      anime.episodeDurationMinutes > 0
    ) {
      hasDurationData = true;
      totalWatchedMinutes += totalEntryEpisodesWatched * anime.episodeDurationMinutes;
    }
  }

  if (totalEntries === 0) {
    animeStatsCache.set(animes, EMPTY_ANIME_STATS);
    return EMPTY_ANIME_STATS;
  }

  const meanScore = ratedCount > 0 ? scoreSum / ratedCount : null;
  const meanScoreFormatted = meanScore !== null ? meanScore.toFixed(2) : null;

  const daysWatched = hasDurationData ? totalWatchedMinutes / 1440 : null;
  const daysWatchedFormatted = daysWatched !== null ? daysWatched.toFixed(1) : null;

  const summary: AnimeStatsSummary = {
    watchingCount,
    completedCount,
    onHoldCount,
    droppedCount,
    plannedCount,
    totalEntries,
    totalEpisodesWatched,
    hasEpisodeData,
    rewatchedTotal: hasRewatchField ? rewatchedSum : null,
    meanScore,
    meanScoreFormatted,
    ratedCount,
    daysWatched,
    daysWatchedFormatted,
    hasDurationData,
  };

  animeStatsCache.set(animes, summary);
  return summary;
}

/**
 * Validates and sanitizes an unknown persisted AnimeStatsSummary object.
 * Returns null if the object is malformed so callers can recompute or fallback safely.
 */
export function sanitizeAnimeStatsSummary(raw: unknown): AnimeStatsSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;

  if (
    typeof s.watchingCount !== 'number' ||
    !Number.isFinite(s.watchingCount) ||
    typeof s.completedCount !== 'number' ||
    !Number.isFinite(s.completedCount) ||
    typeof s.onHoldCount !== 'number' ||
    !Number.isFinite(s.onHoldCount) ||
    typeof s.droppedCount !== 'number' ||
    !Number.isFinite(s.droppedCount) ||
    typeof s.plannedCount !== 'number' ||
    !Number.isFinite(s.plannedCount) ||
    typeof s.totalEntries !== 'number' ||
    !Number.isFinite(s.totalEntries) ||
    typeof s.totalEpisodesWatched !== 'number' ||
    !Number.isFinite(s.totalEpisodesWatched) ||
    typeof s.ratedCount !== 'number' ||
    !Number.isFinite(s.ratedCount)
  ) {
    return null;
  }

  const meanScore =
    typeof s.meanScore === 'number' && Number.isFinite(s.meanScore) ? s.meanScore : null;
  const daysWatched =
    typeof s.daysWatched === 'number' && Number.isFinite(s.daysWatched) ? s.daysWatched : null;
  const rewatchedTotal =
    typeof s.rewatchedTotal === 'number' && Number.isFinite(s.rewatchedTotal)
      ? Math.max(0, Math.floor(s.rewatchedTotal))
      : null;

  return {
    watchingCount: Math.max(0, Math.floor(s.watchingCount)),
    completedCount: Math.max(0, Math.floor(s.completedCount)),
    onHoldCount: Math.max(0, Math.floor(s.onHoldCount)),
    droppedCount: Math.max(0, Math.floor(s.droppedCount)),
    plannedCount: Math.max(0, Math.floor(s.plannedCount)),
    totalEntries: Math.max(0, Math.floor(s.totalEntries)),
    totalEpisodesWatched: Math.max(0, Math.floor(s.totalEpisodesWatched)),
    hasEpisodeData: Boolean(s.hasEpisodeData),
    rewatchedTotal,
    meanScore,
    meanScoreFormatted:
      typeof s.meanScoreFormatted === 'string'
        ? s.meanScoreFormatted
        : meanScore !== null
          ? meanScore.toFixed(2)
          : null,
    ratedCount: Math.max(0, Math.floor(s.ratedCount)),
    daysWatched,
    daysWatchedFormatted:
      typeof s.daysWatchedFormatted === 'string'
        ? s.daysWatchedFormatted
        : daysWatched !== null
          ? daysWatched.toFixed(1)
          : null,
    hasDurationData: Boolean(s.hasDurationData),
  };
}

