import React from 'react';
import { 
  Activity, 
  Play, 
  CheckCircle, 
  Star, 
  MessageSquare, 
  Bookmark,
  RefreshCw,
  PlusCircle,
  Calendar
} from 'lucide-react';
import { UserActivity } from '../../types';
import { useCurrentTime, formatRelativeTime, formatExactDateTime } from '../../utils/relativeTime';

interface ActivityTabProps {
  activities: UserActivity[];
  highlightedActivityId?: string;
}

export const ActivityTab: React.FC<ActivityTabProps> = ({
  activities,
  highlightedActivityId
}) => {
  const now = useCurrentTime();

  const getActivityIcon = (type: UserActivity['type']) => {
    switch (type) {
      case 'watched_ep':
        return <Play className="h-4 w-4 text-purple-400" />;
      case 'completed_anime':
        return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case 'rated':
        return <Star className="h-4 w-4 text-amber-400" />;
      case 'commented':
        return <MessageSquare className="h-4 w-4 text-indigo-400" />;
      case 'added_favorite':
        return <Bookmark className="h-4 w-4 text-pink-400" />;
      case 'status_changed':
        return <RefreshCw className="h-4 w-4 text-sky-400" />;
      case 'added_anime':
        return <PlusCircle className="h-4 w-4 text-emerald-400" />;
      default:
        return <Activity className="h-4 w-4 text-purple-400" />;
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            <h3 className="font-bold text-base text-white">Linha do Tempo de Atividades</h3>
          </div>
          <span className="text-xs text-purple-400/70 font-mono tabular-nums">
            {activities.length} eventos
          </span>
        </div>

        {activities.length === 0 ? (
          <div className="py-12 text-center text-xs text-purple-300/50">
            Nenhuma atividade registrada até o momento.
          </div>
        ) : (
          <div className="relative mt-6 pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-purple-900/40">
            {activities.map((activity) => {
              const relativeLabel = formatRelativeTime(activity.createdAtTimestamp, now, activity.timestamp, false);
              const exactDate = formatExactDateTime(activity.createdAtTimestamp);
              const isHighlighted = activity.id === highlightedActivityId;
              return (
                <div
                  key={activity.id}
                  id={`hikari-activity-${activity.id}`}
                  className="relative group"
                >
                  {/* Node icon */}
                  <div className="absolute -left-6 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#130E24] border-2 border-purple-600/70 shadow-md">
                    {getActivityIcon(activity.type)}
                  </div>

                  {/* Content */}
                  <div
                    className={`rounded-xl border p-3.5 transition-all duration-300 ${
                      isHighlighted
                        ? 'border-purple-500 bg-[#1e153b] ring-2 ring-purple-500/60 shadow-lg shadow-purple-900/40'
                        : 'border-purple-900/20 bg-[#17112c]/60 group-hover:border-purple-600/40 group-hover:bg-[#1a1333]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">
                          {activity.title}
                        </span>
                        {isHighlighted && (
                          <span className="inline-flex items-center rounded-md bg-purple-900/80 px-2 py-0.5 text-[10px] font-semibold text-purple-200 border border-purple-500/40">
                            Atividade da Notificação
                          </span>
                        )}
                      </div>
                      <div
                        className="flex items-center gap-1 text-[11px] text-purple-400/60 font-mono"
                        title={exactDate || undefined}
                      >
                        <Calendar className="h-3 w-3" />
                        <span>{relativeLabel}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-purple-200/80">
                      {activity.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
