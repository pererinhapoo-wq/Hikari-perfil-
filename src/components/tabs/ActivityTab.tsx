import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Play, 
  CheckCircle, 
  Star, 
  MessageSquare, 
  Bookmark, 
  RefreshCw, 
  PlusCircle, 
  Calendar,
  ChevronDown,
  Layers
} from 'lucide-react';
import { UserActivity, AnimeItem } from '../../types';
import { useCurrentTime, formatRelativeTime, formatExactDateTime } from '../../utils/relativeTime';
import { ActivityPosterThumb } from '../common/ActivityPosterThumb';

/**
 * Leaf component that subscribes to useCurrentTime() so timer ticks do NOT
 * cause the parent ActivityTab or all rendered activities to re-render.
 */
const ActivityTimeSpan: React.FC<{
  timestamp: number | undefined;
  fallbackText?: string;
}> = ({ timestamp, fallbackText = '' }) => {
  const now = useCurrentTime();
  return <>{formatRelativeTime(timestamp, now, fallbackText, false)}</>;
};

interface ActivityTabProps {
  activities: UserActivity[];
  userAnimes?: AnimeItem[];
  highlightedActivityId?: string;
}

const INITIAL_BATCH_SIZE = 6;
const PROGRESSIVE_BATCH_STEP = 6;

export const ActivityTab: React.FC<ActivityTabProps> = ({
  activities,
  userAnimes,
  highlightedActivityId
}) => {
  // Determine initial batch size, ensuring highlighted activity is included if requested
  const initialBatch = useMemo(() => {
    if (!highlightedActivityId) return INITIAL_BATCH_SIZE;
    const idx = activities.findIndex((a) => a.id === highlightedActivityId);
    return idx >= 0 ? Math.max(INITIAL_BATCH_SIZE, idx + 1) : INITIAL_BATCH_SIZE;
  }, [activities, highlightedActivityId]);

  const [visibleCount, setVisibleCount] = useState<number>(initialBatch);

  // Adjust visible count if highlightedActivityId changes
  useEffect(() => {
    if (highlightedActivityId) {
      const idx = activities.findIndex((a) => a.id === highlightedActivityId);
      if (idx >= 0 && idx >= visibleCount) {
        setVisibleCount(idx + 1);
      }
    }
  }, [highlightedActivityId, activities, visibleCount]);

  const getActivityIcon = (type: UserActivity['type']) => {
    switch (type) {
      case 'watched_ep':
        return <Play className="h-3.5 w-3.5 text-purple-400" />;
      case 'completed_anime':
        return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
      case 'rated':
        return <Star className="h-3.5 w-3.5 text-amber-400" />;
      case 'commented':
        return <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />;
      case 'added_favorite':
        return <Bookmark className="h-3.5 w-3.5 text-pink-400" />;
      case 'status_changed':
        return <RefreshCw className="h-3.5 w-3.5 text-sky-400" />;
      case 'added_anime':
        return <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />;
      default:
        return <Activity className="h-3.5 w-3.5 text-purple-400" />;
    }
  };

  const getActivityTypeBadge = (activity: UserActivity) => {
    switch (activity.type) {
      case 'watched_ep':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-950/80 px-2 py-0.5 text-[10px] font-semibold text-purple-300 border border-purple-800/40">
            Episódio {activity.episode ? `· ${activity.episode}` : ''}
          </span>
        );
      case 'completed_anime':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-950/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-800/40">
            Concluído
          </span>
        );
      case 'rated':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-950/80 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-800/40">
            Nota {activity.score !== undefined ? `★ ${activity.score}` : ''}
          </span>
        );
      case 'commented':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-950/80 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-800/40">
            Comentário
          </span>
        );
      case 'added_favorite':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-pink-950/80 px-2 py-0.5 text-[10px] font-semibold text-pink-300 border border-pink-800/40">
            Favorito
          </span>
        );
      case 'status_changed':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-950/80 px-2 py-0.5 text-[10px] font-semibold text-sky-300 border border-sky-800/40">
            Status
          </span>
        );
      case 'added_anime':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-950/80 px-2 py-0.5 text-[10px] font-semibold text-purple-200 border border-purple-800/40">
            Adicionado
          </span>
        );
      default:
        return null;
    }
  };

  const visibleActivities = activities.slice(0, visibleCount);
  const remainingCount = Math.max(0, activities.length - visibleCount);

  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(activities.length, prev + PROGRESSIVE_BATCH_STEP));
  };

  const handleShowAll = () => {
    setVisibleCount(activities.length);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-4 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            <h3 className="font-bold text-base text-white">Linha do Tempo de Atividades</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-purple-300/80 font-mono tabular-nums">
              Exibindo <span className="font-bold text-white">{visibleActivities.length}</span> de <span className="font-bold text-white">{activities.length}</span> eventos
            </span>
          </div>
        </div>

        {activities.length === 0 ? (
          <div className="py-12 text-center text-xs text-purple-300/50">
            Nenhuma atividade registrada até o momento.
          </div>
        ) : (
          <div className="relative mt-6 pl-4 sm:pl-7 space-y-4 before:absolute before:left-2 before:sm:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-purple-900/40">
            {visibleActivities.map((activity) => {
              const exactDate = formatExactDateTime(activity.createdAtTimestamp);
              const isHighlighted = activity.id === highlightedActivityId;

              return (
                <div
                  key={activity.id}
                  id={`hikari-activity-${activity.id}`}
                  className="relative group"
                >
                  {/* Node icon on timeline rail */}
                  <div className="absolute -left-4 sm:-left-7 top-3 flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-[#130E24] border-2 border-purple-600/70 shadow-md">
                    {getActivityIcon(activity.type)}
                  </div>

                  {/* Main activity card */}
                  <div
                    className={`rounded-xl border p-3.5 sm:p-4 transition-all duration-300 ${
                      isHighlighted
                        ? 'border-purple-500 bg-[#1e153b] ring-2 ring-purple-500/60 shadow-lg shadow-purple-900/40'
                        : 'border-purple-900/25 bg-[#17112c]/65 hover:border-purple-600/45 hover:bg-[#1a1333]'
                    }`}
                  >
                    <div className="flex items-start gap-3 sm:gap-4">
                      {/* Real Anime Poster Thumbnail with Discreet Fallback */}
                      <ActivityPosterThumb
                        activity={activity}
                        userAnimes={userAnimes}
                        size="md"
                      />

                      {/* Details & Metadata */}
                      <div className="flex-1 min-w-0">
                        {/* Header line: Title + Badges + Date */}
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-sm font-semibold text-white leading-snug">
                              {activity.title}
                            </span>
                            {getActivityTypeBadge(activity)}
                            {isHighlighted && (
                              <span className="inline-flex items-center rounded-md bg-purple-900/80 px-2 py-0.5 text-[10px] font-semibold text-purple-200 border border-purple-500/40">
                                Atividade da Notificação
                              </span>
                            )}
                          </div>

                          <div
                            className="flex items-center gap-1 text-[11px] text-purple-400/70 font-mono shrink-0"
                            title={exactDate || undefined}
                          >
                            <Calendar className="h-3 w-3 text-purple-400/60" />
                            <ActivityTimeSpan
                              timestamp={activity.createdAtTimestamp}
                              fallbackText={activity.timestamp}
                            />
                          </div>
                        </div>

                        {/* Description */}
                        {activity.description && (
                          <p className="mt-1 text-xs text-purple-200/85 leading-relaxed break-words">
                            {activity.description}
                          </p>
                        )}

                        {/* Additional info tags if present */}
                        {(activity.score !== undefined || activity.episode !== undefined) && (
                          <div className="mt-2 flex items-center gap-2 text-[11px]">
                            {activity.score !== undefined && (
                              <span className="inline-flex items-center gap-1 text-amber-300 font-semibold font-mono">
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                {activity.score}/10
                              </span>
                            )}
                            {activity.episode !== undefined && (
                              <span className="text-purple-300/70 font-mono">
                                Episódio #{activity.episode}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* "Ver tudo" / Progressive Loading Controls */}
            {remainingCount > 0 ? (
              <div className="pt-4 pb-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  data-testid="activity-load-more-btn"
                  onClick={handleLoadMore}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-purple-700/60 bg-gradient-to-r from-[#1e1338] to-[#16102a] hover:from-purple-900/60 hover:to-purple-800/40 px-5 py-2.5 text-xs font-semibold text-purple-100 hover:text-white transition-all cursor-pointer shadow-md hover:shadow-purple-900/30"
                >
                  <span>Carregar mais atividades ({remainingCount} restantes)</span>
                  <ChevronDown className="h-4 w-4 text-purple-400" />
                </button>

                <button
                  type="button"
                  data-testid="activity-view-all-btn"
                  onClick={handleShowAll}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-purple-800/40 bg-purple-950/40 hover:bg-purple-900/50 px-4 py-2 text-xs font-medium text-purple-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5 text-purple-400" />
                  <span>Ver tudo ({activities.length})</span>
                </button>
              </div>
            ) : activities.length > 0 ? (
              <div
                data-testid="activity-timeline-end-state"
                className="pt-4 pb-2 text-center"
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-purple-900/40 bg-[#120b22]/70 px-4 py-1.5 text-xs text-purple-300/70">
                  <CheckCircle className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                  <span>Você visualizou todas as {activities.length} atividades da linha do tempo</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
