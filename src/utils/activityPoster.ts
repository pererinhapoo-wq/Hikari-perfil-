import { UserActivity, AnimeItem } from '../types';
import { INITIAL_ANIMES } from '../data/mockData';

function normalizeString(val: string): string {
  return val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveActivityPoster(
  activity: UserActivity,
  userAnimes?: AnimeItem[]
): string | undefined {
  if (activity.posterUrl && typeof activity.posterUrl === 'string' && activity.posterUrl.trim().length > 0) {
    return activity.posterUrl;
  }

  const catalog: AnimeItem[] = userAnimes && userAnimes.length > 0 ? [...userAnimes, ...INITIAL_ANIMES] : INITIAL_ANIMES;

  if (activity.animeId) {
    const match = catalog.find((a) => a.id === activity.animeId);
    if (match?.posterUrl) return match.posterUrl;
  }

  if (activity.id.startsWith('act_')) {
    const parts = activity.id.split('_');
    if (parts.length >= 3) {
      const candidateId = parts.slice(2).join('_');
      const match = catalog.find((a) => a.id === candidateId || a.id === `anime_${candidateId}`);
      if (match?.posterUrl) return match.posterUrl;
    }
  }

  const combinedText = normalizeString(`${activity.title || ''} ${activity.description || ''} ${activity.animeTitle || ''}`);
  if (!combinedText) return undefined;

  let bestMatch: AnimeItem | null = null;
  let bestMatchLen = 0;

  for (const anime of catalog) {
    const titleNorm = normalizeString(anime.title);
    const romajiNorm = anime.titleRomaji ? normalizeString(anime.titleRomaji) : '';

    if (titleNorm && combinedText.includes(titleNorm) && titleNorm.length > bestMatchLen) {
      bestMatch = anime;
      bestMatchLen = titleNorm.length;
    } else if (romajiNorm && combinedText.includes(romajiNorm) && romajiNorm.length > bestMatchLen) {
      bestMatch = anime;
      bestMatchLen = romajiNorm.length;
    }
  }

  return bestMatch?.posterUrl;
}

export function resolveActivityAnimeTitle(
  activity: UserActivity,
  userAnimes?: AnimeItem[]
): string | undefined {
  if (activity.animeTitle) return activity.animeTitle;

  const catalog: AnimeItem[] = userAnimes && userAnimes.length > 0 ? [...userAnimes, ...INITIAL_ANIMES] : INITIAL_ANIMES;

  if (activity.animeId) {
    const match = catalog.find((a) => a.id === activity.animeId);
    if (match?.title) return match.title;
  }

  const combinedText = normalizeString(`${activity.title || ''} ${activity.description || ''}`);
  for (const anime of catalog) {
    const titleNorm = normalizeString(anime.title);
    if (titleNorm && combinedText.includes(titleNorm)) {
      return anime.title;
    }
  }

  return undefined;
}
