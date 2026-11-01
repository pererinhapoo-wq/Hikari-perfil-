import type { AnimeItem } from '../types';

export interface AnimeStatsSummary {
  watchingCount: number;
  completedCount: number;
  onHoldCount: number;
  droppedCount: number;
  plannedCount: number;
  totalEntries: number;
  hasEpisodeData: boolean;
  totalEpisodesWatched: number;
  ratedCount: number;
  meanScoreFormatted: string;
  daysWatchedFormatted: string | null;
  rewatchedTotal: number | null;
}

export const EMPTY_ANIME_STATS: AnimeStatsSummary = {
  watchingCount: 0,
  completedCount: 0,
  onHoldCount: 0,
  droppedCount: 0,
  plannedCount: 0,
  totalEntries: 0,
  hasEpisodeData: true,
  totalEpisodesWatched: 0,
  ratedCount: 0,
  meanScoreFormatted: '—',
  daysWatchedFormatted: '0.0',
  rewatchedTotal: null,
};

/**
 * Computes aggregated numeric statistics from an anime list without retaining
 * any individual anime titles, covers, or identifiers. Safe to expose when
 * a profile's anime lists are marked private while keeping stats visible.
 */
export function computeAnimeStats(animes: AnimeItem[]): AnimeStatsSummary {
  const uniqueAnimes = Array.from(new Map(animes.map((a) => [a.id, a])).values());

  const watchingCount = uniqueAnimes.filter((a) => a.status === 'watching').length;
  const completedCount = uniqueAnimes.filter((a) => a.status === 'completed').length;
  const onHoldCount = uniqueAnimes.filter((a) => a.status === 'on_hold').length;
  const droppedCount = uniqueAnimes.filter((a) => a.status === 'dropped').length;
  const plannedCount = uniqueAnimes.filter((a) => a.status === 'planned').length;

  const totalEntries = uniqueAnimes.length;

  const hasEpisodeData = uniqueAnimes.every(
    (a) =>
      typeof a.currentEpisode === 'number' &&
      Number.isFinite(a.currentEpisode) &&
      typeof a.totalEpisodes === 'number' &&
      Number.isFinite(a.totalEpisodes)
  );

  const totalEpisodesWatched = hasEpisodeData
    ? uniqueAnimes.reduce((acc, a) => {
        const baseEps =
          a.status === 'completed'
            ? Math.max(0, a.totalEpisodes)
            : Math.max(0, a.currentEpisode);
        const rewatchedEps =
          typeof a.rewatchCount === 'number' &&
          Number.isFinite(a.rewatchCount) &&
          a.rewatchCount > 0
            ? a.rewatchCount * Math.max(0, a.totalEpisodes)
            : 0;
        return acc + baseEps + rewatchedEps;
      }, 0)
    : 0;

  const ratedAnimes = uniqueAnimes.filter(
    (a) =>
      typeof a.rating === 'number' &&
      Number.isFinite(a.rating) &&
      a.rating > 0 &&
      a.rating <= 10
  );

  const meanScoreFormatted =
    ratedAnimes.length > 0
      ? (ratedAnimes.reduce((acc, a) => acc + a.rating, 0) / ratedAnimes.length).toFixed(2)
      : '—';

  const watchedEntries = uniqueAnimes.filter(
    (a) => (a.status === 'completed' ? a.totalEpisodes : a.currentEpisode) > 0
  );

  const canCalculateDaysWatched =
    totalEntries === 0 ||
    watchedEntries.length === 0 ||
    watchedEntries.every(
      (a) =>
        typeof a.episodeDurationMinutes === 'number' &&
        Number.isFinite(a.episodeDurationMinutes) &&
        a.episodeDurationMinutes > 0
    );

  const daysWatchedFormatted = !canCalculateDaysWatched
    ? null
    : watchedEntries.length === 0
    ? '0.0'
    : (
        watchedEntries.reduce((acc, a) => {
          const eps =
            a.status === 'completed'
              ? Math.max(0, a.totalEpisodes)
              : Math.max(0, a.currentEpisode);
          const extraEps =
            typeof a.rewatchCount === 'number' &&
            Number.isFinite(a.rewatchCount) &&
            a.rewatchCount > 0
              ? a.rewatchCount * Math.max(0, a.totalEpisodes)
              : 0;
          return acc + (eps + extraEps) * (a.episodeDurationMinutes || 0);
        }, 0) / 1440
      ).toFixed(1);

  const hasRewatchData =
    totalEntries > 0 &&
    uniqueAnimes.some(
      (a) => typeof a.rewatchCount === 'number' && Number.isFinite(a.rewatchCount)
    );

  const rewatchedTotal = hasRewatchData
    ? uniqueAnimes.reduce((acc, a) => acc + Math.max(0, a.rewatchCount || 0), 0)
    : null;

  return {
    watchingCount,
    completedCount,
    onHoldCount,
    droppedCount,
    plannedCount,
    totalEntries,
    hasEpisodeData,
    totalEpisodesWatched,
    ratedCount: ratedAnimes.length,
    meanScoreFormatted,
    daysWatchedFormatted,
    rewatchedTotal,
  };
}

export function sanitizeAnimeStatsSummary(raw: unknown): AnimeStatsSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  if (
    typeof src.watchingCount !== 'number' ||
    typeof src.completedCount !== 'number' ||
    typeof src.onHoldCount !== 'number' ||
    typeof src.droppedCount !== 'number' ||
    typeof src.plannedCount !== 'number' ||
    typeof src.totalEntries !== 'number'
  ) {
    return null;
  }

  return {
    watchingCount: Math.max(0, Math.floor(src.watchingCount)),
    completedCount: Math.max(0, Math.floor(src.completedCount)),
    onHoldCount: Math.max(0, Math.floor(src.onHoldCount)),
    droppedCount: Math.max(0, Math.floor(src.droppedCount)),
    plannedCount: Math.max(0, Math.floor(src.plannedCount)),
    totalEntries: Math.max(0, Math.floor(src.totalEntries)),
    hasEpisodeData: typeof src.hasEpisodeData === 'boolean' ? src.hasEpisodeData : true,
    totalEpisodesWatched:
      typeof src.totalEpisodesWatched === 'number' && Number.isFinite(src.totalEpisodesWatched)
        ? Math.max(0, Math.floor(src.totalEpisodesWatched))
        : 0,
    ratedCount:
      typeof src.ratedCount === 'number' && Number.isFinite(src.ratedCount)
        ? Math.max(0, Math.floor(src.ratedCount))
        : 0,
    meanScoreFormatted:
      typeof src.meanScoreFormatted === 'string' ? src.meanScoreFormatted : '—',
    daysWatchedFormatted:
      typeof src.daysWatchedFormatted === 'string' ? src.daysWatchedFormatted : null,
    rewatchedTotal:
      typeof src.rewatchedTotal === 'number' && Number.isFinite(src.rewatchedTotal)
        ? Math.max(0, Math.floor(src.rewatchedTotal))
        : null,
  };
}
