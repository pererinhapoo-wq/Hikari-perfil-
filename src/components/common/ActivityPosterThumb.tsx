import React, { useState, useMemo } from 'react';
import { Film, Play, Star, CheckCircle, Bookmark, MessageSquare, RefreshCw, PlusCircle } from 'lucide-react';
import { UserActivity, AnimeItem } from '../../types';
import { resolveActivityAnimeMatch } from '../../utils/activityPoster';

interface ActivityPosterThumbProps {
  activity: UserActivity;
  userAnimes?: AnimeItem[];
  profileId?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const ActivityPosterThumb: React.FC<ActivityPosterThumbProps> = React.memo(({
  activity,
  userAnimes,
  profileId,
  size = 'md',
  className = '',
}) => {
  const { posterUrl, animeTitle: matchedTitle } = useMemo(
    () => resolveActivityAnimeMatch(activity, userAnimes, profileId),
    [activity, userAnimes, profileId]
  );

  const [erroredUrl, setErroredUrl] = useState<string | null>(null);
  const imageError = Boolean(posterUrl && erroredUrl === posterUrl);
  const animeTitle = matchedTitle || activity.title;

  const sizeClasses = size === 'sm'
    ? 'w-10 h-14 min-w-10 min-h-14 rounded-lg'
    : 'w-12 h-16 sm:w-14 sm:h-20 min-w-12 min-h-16 sm:min-w-14 sm:min-h-20 rounded-xl';

  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  const getActivityFallbackIcon = () => {
    switch (activity.type) {
      case 'watched_ep':
        return <Play className={`${iconSize} text-purple-400`} />;
      case 'completed_anime':
        return <CheckCircle className={`${iconSize} text-emerald-400`} />;
      case 'rated':
        return <Star className={`${iconSize} text-amber-400`} />;
      case 'commented':
        return <MessageSquare className={`${iconSize} text-indigo-400`} />;
      case 'added_favorite':
        return <Bookmark className={`${iconSize} text-pink-400`} />;
      case 'status_changed':
        return <RefreshCw className={`${iconSize} text-sky-400`} />;
      case 'added_anime':
        return <PlusCircle className={`${iconSize} text-emerald-400`} />;
      default:
        return <Film className={`${iconSize} text-purple-400`} />;
    }
  };

  // If we have a verified poster and it hasn't errored
  if (posterUrl && !imageError) {
    return (
      <div
        data-testid={`activity-poster-${activity.id}`}
        className={`relative overflow-hidden shrink-0 bg-[#0e0a1b] border border-purple-800/40 shadow-md group/poster transition-all duration-200 hover:border-purple-500/60 ${sizeClasses} ${className}`}
      >
        <img
          src={posterUrl}
          alt={animeTitle}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setErroredUrl(posterUrl)}
          className="h-full w-full object-cover object-center transition-transform duration-300 group-hover/poster:scale-105"
        />
        {/* Subtle bottom vignette to ensure contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>
    );
  }

  // Fallback visual discreto e elegante
  return (
    <div
      data-testid={`activity-poster-fallback-${activity.id}`}
      className={`relative shrink-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#1a1233] to-[#0e091d] border border-purple-800/30 text-purple-300/80 shadow-inner select-none ${sizeClasses} ${className}`}
      title={animeTitle || 'Atividade Hikari'}
      aria-label={animeTitle || 'Atividade'}
    >
      <div className="relative flex items-center justify-center">
        {getActivityFallbackIcon()}
      </div>
      <span className="mt-1 text-[9px] font-mono tracking-wider uppercase text-purple-400/60 font-semibold scale-90">
        Hikari
      </span>
    </div>
  );
});
