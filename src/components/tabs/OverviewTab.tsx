import React from 'react';
import { 
  MessageSquare, 
  ArrowRight, 
  TrendingUp,
  BarChart3,
  Lock
} from 'lucide-react';
import {
  UserProfile,
  AnimeItem,
  HikariComment,
  UserActivity,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
} from '../../types';
import { FavoritesTab } from './FavoritesTab';
import { useCurrentTime, formatRelativeTime, formatExactDateTime } from '../../utils/relativeTime';

interface OverviewTabProps {
  profile: UserProfile;
  animes: AnimeItem[];
  favoriteCharacters?: FavoriteCharacter[];
  favoriteCompanies?: FavoriteCompany[];
  favoritePeople?: FavoritePerson[];
  comments: HikariComment[];
  activities: UserActivity[];
  isOwnProfile?: boolean;
  onNavigateTab: (tab: 'overview' | 'animes' | 'comments' | 'about' | 'activity' | 'favorites') => void;
  onToggleFavorite?: (id: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  profile,
  animes,
  favoriteCharacters = [],
  favoriteCompanies = [],
  favoritePeople = [],
  comments,
  activities,
  isOwnProfile = true,
  onNavigateTab,
  onToggleFavorite
}) => {
  const now = useCurrentTime();

  // Deduplicate anime entries by ID so counts and totals never double-count
  const uniqueAnimes = Array.from(new Map(animes.map(a => [a.id, a])).values());

  const watchingAnimes = uniqueAnimes.filter(a => a.status === 'watching');
  const completedAnimes = uniqueAnimes.filter(a => a.status === 'completed');
  const onHoldAnimes = uniqueAnimes.filter(a => a.status === 'on_hold');
  const droppedAnimes = uniqueAnimes.filter(a => a.status === 'dropped');
  const plannedAnimes = uniqueAnimes.filter(a => a.status === 'planned');
  const favorites = uniqueAnimes.filter(a => a.isFavorite);

  const totalEntries = uniqueAnimes.length;

  // Episodes watched: calculated safely only when episode counters are valid numbers
  const hasEpisodeData = uniqueAnimes.every(
    a =>
      typeof a.currentEpisode === 'number' &&
      Number.isFinite(a.currentEpisode) &&
      typeof a.totalEpisodes === 'number' &&
      Number.isFinite(a.totalEpisodes)
  );

  const totalEpisodesWatched = hasEpisodeData
    ? uniqueAnimes.reduce((acc, a) => {
        const baseEps = a.status === 'completed' ? Math.max(0, a.totalEpisodes) : Math.max(0, a.currentEpisode);
        const rewatchedEps =
          typeof a.rewatchCount === 'number' && Number.isFinite(a.rewatchCount) && a.rewatchCount > 0
            ? a.rewatchCount * Math.max(0, a.totalEpisodes)
            : 0;
        return acc + baseEps + rewatchedEps;
      }, 0)
    : 0;

  // Mean Score: calculated strictly from valid ratings (> 0)
  const ratedAnimes = uniqueAnimes.filter(
    a => typeof a.rating === 'number' && Number.isFinite(a.rating) && a.rating > 0 && a.rating <= 10
  );
  const meanScoreFormatted = ratedAnimes.length > 0
    ? (ratedAnimes.reduce((acc, a) => acc + a.rating, 0) / ratedAnimes.length).toFixed(2)
    : '—';

  // Days Watched: calculated strictly when watched entries include real episodeDurationMinutes
  const watchedEntries = uniqueAnimes.filter(
    a => (a.status === 'completed' ? a.totalEpisodes : a.currentEpisode) > 0
  );
  const canCalculateDaysWatched =
    totalEntries === 0 ||
    watchedEntries.length === 0 ||
    watchedEntries.every(
      a =>
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
          const eps = a.status === 'completed' ? Math.max(0, a.totalEpisodes) : Math.max(0, a.currentEpisode);
          const extraEps =
            typeof a.rewatchCount === 'number' && Number.isFinite(a.rewatchCount) && a.rewatchCount > 0
              ? a.rewatchCount * Math.max(0, a.totalEpisodes)
              : 0;
          return acc + (eps + extraEps) * (a.episodeDurationMinutes || 0);
        }, 0) / 1440
      ).toFixed(1);

  // Rewatched: calculated strictly when rewatchCount metadata exists on entries
  const hasRewatchData =
    totalEntries > 0 &&
    uniqueAnimes.some(a => typeof a.rewatchCount === 'number' && Number.isFinite(a.rewatchCount));
  const rewatchedTotal = hasRewatchData
    ? uniqueAnimes.reduce((acc, a) => acc + Math.max(0, a.rewatchCount || 0), 0)
    : null;

  // Proportional stacked bar segments (SVG viewBox width = 1000)
  const barSegments = totalEntries > 0
    ? [
        { key: 'watching', count: watchingAnimes.length, fill: 'fill-emerald-500' },
        { key: 'completed', count: completedAnimes.length, fill: 'fill-purple-500' },
        { key: 'on_hold', count: onHoldAnimes.length, fill: 'fill-amber-400' },
        { key: 'dropped', count: droppedAnimes.length, fill: 'fill-rose-500' },
        { key: 'planned', count: plannedAnimes.length, fill: 'fill-indigo-300/60' }
      ]
    : [];

  let cumulativeBarX = 0;
  const renderedSegments = barSegments
    .filter(seg => seg.count > 0)
    .map(seg => {
      const width = (seg.count / totalEntries) * 1000;
      const x = cumulativeBarX;
      cumulativeBarX += width;
      return { ...seg, x, width };
    });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: Anime Stats + Favorites + Currently Watching (2 columns) */}
      <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Anime Stats Section (MyAnimeList-inspired, Hikari dark-purple theme) */}
          {!isOwnProfile && profile.privacySettings?.showAnimeList === false ? (
            <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-5 text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-purple-300">
                <Lock className="h-4 w-4 text-purple-400" />
                <span className="text-xs font-semibold text-white">Anime Stats Privado</span>
              </div>
              <p className="text-[11px] text-purple-300/60 max-w-sm mx-auto">
                As estatísticas da lista de animes estão ocultas conforme as preferências de privacidade deste perfil.
              </p>
            </div>
          ) : (
            <section
              aria-label="Anime Stats"
              className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-4 sm:p-5 shadow-xl space-y-4"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-purple-900/30 pb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  <h2 className="text-sm sm:text-base font-bold text-white">Anime Stats</h2>
                </div>
              </div>

              {/* Top Summary Bar: Days Watched & Mean Score */}
              <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs sm:text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-purple-300/90">Days Watched:</span>
                  {daysWatchedFormatted !== null ? (
                    <span className="font-mono text-base sm:text-lg font-bold text-white tabular-nums">
                      {daysWatchedFormatted}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-baseline gap-1.5 text-purple-300/60"
                      title="A duração em minutos por episódio ainda não está disponível nos registros atuais da lista."
                    >
                      <span className="font-mono text-sm font-semibold text-purple-200/80">—</span>
                      <span className="text-[11px] text-purple-400/60">(duração indisponível)</span>
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-purple-300/90">Mean Score:</span>
                  {ratedAnimes.length > 0 ? (
                    <span className="font-mono text-base sm:text-lg font-bold text-amber-300 tabular-nums">
                      {meanScoreFormatted}
                    </span>
                  ) : (
                    <span className="text-xs text-purple-400/60">Sem avaliações</span>
                  )}
                </div>
              </div>

              {/* Proportional Status Distribution Bar */}
              {totalEntries > 0 ? (
                <svg
                  viewBox="0 0 1000 12"
                  preserveAspectRatio="none"
                  className="block h-3 w-full overflow-hidden rounded-full bg-purple-950/80 ring-1 ring-purple-900/40"
                  role="img"
                  aria-label="Distribuição da lista de animes por status"
                >
                  {renderedSegments.map((seg) => (
                    <rect
                      key={seg.key}
                      x={seg.x}
                      y={0}
                      width={seg.width}
                      height={12}
                      className={seg.fill}
                    />
                  ))}
                </svg>
              ) : (
                <div className="h-3 w-full rounded-full bg-purple-950/60 ring-1 ring-purple-900/30" />
              )}

              {/* Two-Column MAL-style Breakdown: Status Counts (Left) & Totals (Right) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 pt-1">
                {/* Status Breakdown */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-purple-100 font-medium">Assistindo</span>
                    </div>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {watchingAnimes.length}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shrink-0" />
                      <span className="text-purple-100 font-medium">Concluídos</span>
                    </div>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {completedAnimes.length}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-purple-100 font-medium">Em espera</span>
                    </div>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {onHoldAnimes.length}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
                      <span className="text-purple-100 font-medium">Abandonados</span>
                    </div>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {droppedAnimes.length}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-300/60 shrink-0" />
                      <span className="text-purple-100 font-medium">Planejados</span>
                    </div>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {plannedAnimes.length}
                    </span>
                  </div>
                </div>

                {/* Totals Column */}
                <div className="space-y-2 text-xs border-t sm:border-t-0 sm:border-l border-purple-900/30 pt-3 sm:pt-0 sm:pl-6 flex flex-col justify-center">
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-purple-300/80 font-medium">Total de entradas</span>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {totalEntries.toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-purple-300/80 font-medium">Reassistidos</span>
                    {rewatchedTotal !== null ? (
                      <span className="font-mono font-semibold text-white tabular-nums">
                        {rewatchedTotal.toLocaleString('pt-BR')}
                      </span>
                    ) : (
                      <span
                        className="text-[11px] text-purple-400/60 font-mono"
                        title="Contagem de reassistidos ainda não registrada nos dados da lista."
                      >
                        Não disponível
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-purple-300/80 font-medium">Episódios assistidos</span>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {hasEpisodeData ? totalEpisodesWatched.toLocaleString('pt-BR') : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

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
              characters={favoriteCharacters}
              companies={favoriteCompanies}
              people={favoritePeople}
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
              {activities.length === 0 ? (
                <p className="text-xs text-purple-300/50 py-3 text-center">
                  Nenhuma atividade recente registrada.
                </p>
              ) : (
                activities.slice(0, 5).map((act) => {
                  const relativeLabel = formatRelativeTime(act.createdAtTimestamp, now, act.timestamp, true);
                  const exactDate = formatExactDateTime(act.createdAtTimestamp);
                  return (
                    <div key={act.id} className="relative flex items-start gap-2.5 text-xs">
                      <div className="h-2 w-2 rounded-full bg-purple-500 shrink-0 mt-1.5 ring-2 ring-purple-900/60" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white leading-snug break-words">
                          <span>{act.title}</span>
                          <span
                            className="text-purple-400/75 font-normal"
                            title={exactDate || undefined}
                          >
                            {' '}— {relativeLabel}
                          </span>
                        </p>
                        {act.description && (
                          <p className="text-[11px] text-purple-300/70 truncate mt-0.5">{act.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
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
                  <span title={formatExactDateTime(comments[0].createdAtTimestamp) || undefined}>
                    {formatRelativeTime(comments[0].createdAtTimestamp, now, comments[0].createdAt, false)}
                  </span>
                </div>
              </div>
            </div>
        )}
      </div>
    </div>
  );
};
