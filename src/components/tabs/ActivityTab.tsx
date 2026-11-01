import React from 'react';
import { 
  Activity, 
  Play, 
  CheckCircle, 
  Star, 
  MessageSquare, 
  Bookmark,
  Calendar
} from 'lucide-react';
import { UserActivity } from '../../types';

interface ActivityTabProps {
  activities: UserActivity[];
}

export const ActivityTab: React.FC<ActivityTabProps> = ({ activities }) => {
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
            {activities.map((activity) => (
              <div key={activity.id} className="relative group">
                {/* Node icon */}
                <div className="absolute -left-6 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#130E24] border-2 border-purple-600/70 shadow-md">
                  {getActivityIcon(activity.type)}
                </div>

                {/* Content */}
                <div className="rounded-xl border border-purple-900/20 bg-[#17112c]/60 p-3.5 transition-colors group-hover:border-purple-600/40 group-hover:bg-[#1a1333]">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-white">
                      {activity.title}
                    </span>
                    <div className="flex items-center gap-1 text-[11px] text-purple-400/60 font-mono">
                      <Calendar className="h-3 w-3" />
                      <span>{activity.timestamp}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-purple-200/80">
                    {activity.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
