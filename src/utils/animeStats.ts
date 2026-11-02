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
  if (!animes || animes.length === 0) {
    return { ...EMPTY_ANIME_STATS };
  }

  const seenIds = new Set<string>();
  let watchingCount = 0;
  let completedCount = 0;
  let onHoldCount = 0;
  let droppedCount = 0;
  let plannedCount = 0;
  let totalEntries = 0;

  let hasEpisodeData = true;
  let totalEpisodesWatched = 0;

  let ratedCount = 0;
  let ratingSum = 0;

  let hasRewatchData = false;
  let rewatchedSum = 0;

  let canCalculateDaysWatched = true;
  let watchedEntriesCount = 0;
  let watchedMinutesSum = 0;

  for (let i = 0; i < animes.length; i++) {
    const a = animes[i];
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    totalEntries++;

    switch (a.status) {
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

    const hasValidEpData =
      typeof a.currentEpisode === 'number' &&
      Number.isFinite(a.currentEpisode) &&
      typeof a.totalEpisodes === 'number' &&
      Number.isFinite(a.totalEpisodes);

    if (!hasValidEpData) {
      hasEpisodeData = false;
    }

    const baseEps =
      a.status === 'completed'
        ? Math.max(0, a.totalEpisodes || 0)
        : Math.max(0, a.currentEpisode || 0);

    const rewatchEps =
      typeof a.rewatchCount === 'number' &&
      Number.isFinite(a.rewatchCount) &&
      a.rewatchCount > 0
        ? a.rewatchCount * Math.max(0, a.totalEpisodes || 0)
        : 0;

    totalEpisodesWatched += baseEps + rewatchEps;

    if (
      typeof a.rating === 'number' &&
      Number.isFinite(a.rating) &&
      a.rating > 0 &&
      a.rating <= 10
    ) {
      ratedCount++;
      ratingSum += a.rating;
    }

    if (typeof a.rewatchCount === 'number' && Number.isFinite(a.rewatchCount)) {
      hasRewatchData = true;
      rewatchedSum += Math.max(0, a.rewatchCount);
    }

    if (baseEps > 0) {
      watchedEntriesCount++;
      const hasValidDuration =
        typeof a.episodeDurationMinutes === 'number' &&
        Number.isFinite(a.episodeDurationMinutes) &&
        a.episodeDurationMinutes > 0;

      if (!hasValidDuration) {
        canCalculateDaysWatched = false;
      } else {
        watchedMinutesSum += (baseEps + rewatchEps) * a.episodeDurationMinutes!;
      }
    }
  }

  const finalTotalEpisodesWatched = hasEpisodeData ? totalEpisodesWatched : 0;
  const meanScoreFormatted =
    ratedCount > 0 ? (ratingSum / ratedCount).toFixed(2) : '—';

  const daysWatchedFormatted = !canCalculateDaysWatched
    ? null
    : watchedEntriesCount === 0
    ? '0.0'
    : (watchedMinutesSum / 1440).toFixed(1);

  const rewatchedTotal = hasRewatchData ? rewatchedSum : null;

  return {
    watchingCount,
    completedCount,
    onHoldCount,
    droppedCount,
    plannedCount,
    totalEntries,
    hasEpisodeData,
    totalEpisodesWatched: finalTotalEpisodesWatched,
    ratedCount,
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
