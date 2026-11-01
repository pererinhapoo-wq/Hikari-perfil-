import React from 'react';
import { 
  Tv, 
  CheckCircle2, 
  Clock, 
  Star, 
  MessageSquare, 
  ArrowRight, 
  TrendingUp,
  Sparkles,
  Lock
} from 'lucide-react';
import { UserProfile, AnimeItem, HikariComment, UserActivity } from '../../types';
import { FavoritesTab } from './FavoritesTab';

interface OverviewTabProps {
  profile: UserProfile;
  animes: AnimeItem[];
  comments: HikariComment[];
  activities: UserActivity[];
  isOwnProfile?: boolean;
  onNavigateTab: (tab: 'overview' | 'animes' | 'comments' | 'about' | 'activity' | 'favorites') => void;
  onToggleFavorite?: (id: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  profile,
  animes,
  comments,
  activities,
  isOwnProfile = true,
  onNavigateTab,
  onToggleFavorite
}) => {
  const completedAnimes = animes.filter(a => a.status === 'completed');
  const watchingAnimes = animes.filter(a => a.status === 'watching');
  const favorites = animes.filter(a => a.isFavorite);

  const totalEpisodesWatched = animes.reduce((acc, a) => {
    if (a.status === 'completed') return acc + a.totalEpisodes;
    return acc + a.currentEpisode;
  }, 0);

  const ratedAnimes = animes.filter(a => a.rating > 0);
  const averageScore = ratedAnimes.length > 0 
    ? (ratedAnimes.reduce((acc, a) => acc + a.rating, 0) / ratedAnimes.length).toFixed(1)
    : '—';

  return (
    <div className="space-y-6">
      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/80 p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-purple-400">
            <Tv className="h-4 w-4" />
            <span>Total na Lista</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {animes.length}
          </div>
          <div className="mt-1 text-[11px] text-purple-300/60">
            {watchingAnimes.length} em exibição
          </div>
        </div>

        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/80 p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Concluídos</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {completedAnimes.length}
          </div>
          <div className="mt-1 text-[11px] text-purple-300/60">
            Obras finalizadas
          </div>
        </div>

        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/80 p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-400">
            <Clock className="h-4 w-4" />
            <span>Episódios Vistos</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {totalEpisodesWatched}
          </div>
          <div className="mt-1 text-[11px] text-purple-300/60">
            ~{((totalEpisodesWatched * 24) / 60).toFixed(0)} horas assistidas
          </div>
        </div>

        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/80 p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
            <Star className="h-4 w-4" />
            <span>Média de Notas</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {averageScore} <span className="text-xs text-amber-300/80">★</span>
          </div>
          <div className="mt-1 text-[11px] text-purple-300/60">
            {ratedAnimes.length} obras avaliadas
          </div>
        </div>
      </div>

      {/* Grid: 4 Favorites Sections & Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Favorites + Currently Watching (2 columns) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* The 4 Favorites Sections directly in Overview (Visão geral) */}
          {!isOwnProfile && profile.privacySettings?.showFavorites === false ? (
            <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-6 text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-purple-300">
                <Lock className="h-4 w-4 text-purple-400" />
                <span className="text-xs font-semibold text-white">Seções de Favoritos Privadas</span>
              </div>
              <p className="text-[11px] text-purple-300/60 max-w-sm mx-auto">
                O usuário configurou seus favoritos (animes, personagens, empresas e criadores) como privados em seu perfil.
              </p>
            </div>
          ) : (
            <FavoritesTab
              favorites={favorites}
              isOwnProfile={!!isOwnProfile}
              onToggleFavorite={onToggleFavorite || (() => {})}
              onNavigateToAnimes={() => onNavigateTab('animes')}
            />
          )}

          {/* Currently Watching Showcase */}
          {watchingAnimes.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-purple-400" />
                  <h3 className="text-sm font-bold text-white">Assistindo Atualmente</h3>
                  <span className="rounded-full bg-purple-950 px-2 py-0.5 text-[10px] font-mono text-purple-300 border border-purple-900/40">
                    {watchingAnimes.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('animes')}
                  className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors cursor-pointer group"
                >
                  <span>Ver todos</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>

              {/* Sliced strictly to 4 items initially */}
              <div className="space-y-2">
                {watchingAnimes.slice(0, 4).map((anime) => {
                  const progressPct = Math.round((anime.currentEpisode / anime.totalEpisodes) * 100);
                  return (
                    <div
                      key={anime.id}
                      onClick={() => onNavigateTab('animes')}
                      className="group flex items-center gap-3 rounded-xl border border-purple-900/30 bg-[#130E24] p-3 shadow-md hover:border-purple-600/40 hover:bg-[#17102e] transition-all cursor-pointer"
                      title={`Ver ${anime.title} na lista de animes`}
                    >
                      <img
                        src={anime.posterUrl}
                        alt={anime.title}
                        referrerPolicy="no-referrer"
                        className="h-14 w-11 rounded-lg object-cover shrink-0 border border-purple-900/40 group-hover:scale-105 transition-transform"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="truncate text-xs font-semibold text-white group-hover:text-purple-300 transition-colors">{anime.title}</h4>
                          <span className="font-mono text-xs font-medium text-purple-300 tabular-nums shrink-0">
                            Ep {anime.currentEpisode} / {anime.totalEpisodes}
                          </span>
                        </div>
                        {/* Progress Bar */}
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-purple-950">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-500 transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] text-purple-300/60">
                          <span>{anime.genres.join(' · ')}</span>
                          <span>{progressPct}% concluído</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {watchingAnimes.length > 4 && (
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('animes')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-purple-800/40 bg-purple-950/40 hover:bg-purple-900/50 px-3.5 py-1.5 text-xs text-purple-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <span>Ver mais {watchingAnimes.length - 4} animes em andamento na lista</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Recent Activities and Comments Preview */}
        <div className="space-y-6">
          {/* Recent Activity List */}
          <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-purple-900/30 pb-3">
              <h3 className="text-sm font-bold text-white">Atividades Recentes</h3>
              <button
                onClick={() => onNavigateTab('activity')}
                className="text-xs text-purple-400 hover:text-purple-300 font-medium"
              >
                Ver todas
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {activities.slice(0, 4).map((act) => (
                <div key={act.id} className="relative flex items-start gap-2.5 text-xs">
                  <div className="h-2 w-2 rounded-full bg-purple-500 shrink-0 mt-1.5 ring-2 ring-purple-900/60" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{act.title}</p>
                    <p className="text-[11px] text-purple-300/70 truncate">{act.description}</p>
                    <span className="text-[10px] text-purple-400/50 mt-0.5 block">{act.timestamp}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comments Preview */}
          {profile.showCommentsOnProfile && comments.length > 0 && (
            <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-purple-900/30 pb-3">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-purple-400" />
                  <h3 className="text-sm font-bold text-white">Comentários no Hikari</h3>
                </div>
                <button
                  onClick={() => onNavigateTab('comments')}
                  className="text-xs text-purple-400 hover:text-purple-300 font-medium"
                >
                  Histórico
                </button>
              </div>

              <div className="mt-3">
                <p className="text-xs text-purple-200 line-clamp-3 italic">
                  "{comments[0].content}"
                </p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-purple-300/60">
                  <span className="truncate max-w-[150px] text-purple-400 font-medium">{comments[0].animeTitle}</span>
                  <span>{comments[0].createdAt}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
