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
  AnimeStatus,
  HikariComment,
  UserActivity,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
} from '../../types';
import { FavoritesTab } from './FavoritesTab';
import { useCurrentTime, formatRelativeTime, formatExactDateTime } from '../../utils/relativeTime';
import { computeAnimeStats, type AnimeStatsSummary } from '../../utils/animeStats';

interface OverviewTabProps {
  profile: UserProfile;
  animes: AnimeItem[];
  animeStats?: AnimeStatsSummary;
  canAccessAnimeLists?: boolean;
  favoriteCharacters?: FavoriteCharacter[];
  favoriteCompanies?: FavoriteCompany[];
  favoritePeople?: FavoritePerson[];
  comments: HikariComment[];
  activities: UserActivity[];
  isOwnProfile?: boolean;
  onNavigateTab: (tab: 'overview' | 'animes' | 'comments' | 'about' | 'activity' | 'favorites') => void;
  onSelectAnimeStatus?: (status: AnimeStatus) => void;
  onToggleFavorite?: (id: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  profile,
  animes,
  animeStats,
  canAccessAnimeLists,
  favoriteCharacters = [],
  favoriteCompanies = [],
  favoritePeople = [],
  comments,
  activities,
  isOwnProfile = true,
  onNavigateTab,
  onSelectAnimeStatus,
  onToggleFavorite
}) => {
  const now = useCurrentTime();

  const isListPrivate = profile.privacySettings?.showAnimeList === false;
  const canOpenLists = canAccessAnimeLists ?? (Boolean(isOwnProfile) || !isListPrivate);

  // Deduplicate visible anime entries by ID (empty for visitors when lists are private)
  const uniqueAnimes = canOpenLists
    ? Array.from(new Map(animes.map((a) => [a.id, a])).values())
    : [];

  const watchingAnimes = uniqueAnimes.filter((a) => a.status === 'watching');
  const favorites = uniqueAnimes.filter((a) => a.isFavorite);

  // Aggregated numbers remain visible even when anime lists are private
  const stats = animeStats ?? computeAnimeStats(animes);

  const handleOpenStatusList = (status: AnimeStatus) => {
    if (!canOpenLists) return;
    if (onSelectAnimeStatus) {
      onSelectAnimeStatus(status);
    } else {
      onNavigateTab('animes');
    }
  };

  // Proportional stacked bar segments (SVG viewBox width = 1000)
  const barSegments = stats.totalEntries > 0
    ? [
        { key: 'watching', count: stats.watchingCount, fill: 'fill-emerald-500' },
        { key: 'completed', count: stats.completedCount, fill: 'fill-purple-500' },
        { key: 'on_hold', count: stats.onHoldCount, fill: 'fill-amber-400' },
        { key: 'dropped', count: stats.droppedCount, fill: 'fill-rose-500' },
        { key: 'planned', count: stats.plannedCount, fill: 'fill-indigo-300/60' }
      ]
    : [];

  let cumulativeBarX = 0;
  const renderedSegments = barSegments
    .filter((seg) => seg.count > 0)
    .map((seg) => {
      const width = (seg.count / stats.totalEntries) * 1000;
      const x = cumulativeBarX;
      cumulativeBarX += width;
      return { ...seg, x, width };
    });

  const statusRows: {
    status: Exclude<AnimeStatus, 'all'>;
    label: string;
    count: number;
    dotClass: string;
  }[] = [
    {
      status: 'watching',
      label: 'Assistindo',
      count: stats.watchingCount,
      dotClass: 'bg-emerald-500',
    },
    {
      status: 'completed',
      label: 'Concluídos',
      count: stats.completedCount,
      dotClass: 'bg-purple-500',
    },
    {
      status: 'on_hold',
      label: 'Em espera',
      count: stats.onHoldCount,
      dotClass: 'bg-amber-400',
    },
    {
      status: 'dropped',
      label: 'Abandonados',
      count: stats.droppedCount,
      dotClass: 'bg-rose-500',
    },
    {
      status: 'planned',
      label: 'Planejados',
      count: stats.plannedCount,
      dotClass: 'bg-indigo-300/60',
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: Anime Stats + Favorites + Currently Watching (2 columns) */}
      <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Anime Stats Section — numbers always remain visible; status links respect list privacy */}
          <section
            aria-label="Anime Stats"
            className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-4 sm:p-5 shadow-xl space-y-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-purple-900/30 pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-purple-400" />
                <h2 className="text-sm sm:text-base font-bold text-white">Anime Stats</h2>
              </div>

              {isListPrivate && (
                <div
                  data-testid="anime-stats-privacy-indicator"
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-300/90"
                  title={
                    isOwnProfile
                      ? 'Suas listas estão privadas para visitantes. Você continua podendo abrir todas as suas listas.'
                      : 'As listas de animes deste perfil são privadas.'
                  }
                >
                  <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>{isOwnProfile ? 'Listas privadas para visitantes' : 'Listas privadas'}</span>
                </div>
              )}
            </div>

            {/* Top Summary Bar: Days Watched & Mean Score */}
            <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs sm:text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-purple-300/90">Days Watched:</span>
                {stats.daysWatchedFormatted !== null ? (
                  <span className="font-mono text-base sm:text-lg font-bold text-white tabular-nums">
                    {stats.daysWatchedFormatted}
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
                {stats.ratedCount > 0 ? (
                  <span className="font-mono text-base sm:text-lg font-bold text-amber-300 tabular-nums">
                    {stats.meanScoreFormatted}
                  </span>
                ) : (
                  <span className="text-xs text-purple-400/60">Sem avaliações</span>
                )}
              </div>
            </div>

            {/* Proportional Status Distribution Bar */}
            {stats.totalEntries > 0 ? (
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
              <div className="space-y-1 text-xs">
                {statusRows.map((row) =>
                  canOpenLists ? (
                    <button
                      key={row.status}
                      type="button"
                      data-testid={`anime-stat-${row.status}`}
                      data-status={row.status}
                      onClick={() => handleOpenStatusList(row.status)}
                      className="group flex w-full items-center justify-between rounded-lg px-2 py-1 -mx-2 text-left transition-colors hover:bg-purple-900/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-500/60 cursor-pointer"
                      title={`Abrir lista ${row.label}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${row.dotClass} shrink-0`} />
                        <span className="text-purple-100 font-medium group-hover:text-white group-hover:underline underline-offset-2 transition-colors">
                          {row.label}
                        </span>
                      </span>
                      <span className="font-mono font-semibold text-white tabular-nums group-hover:text-purple-200 transition-colors">
                        {row.count}
                      </span>
                    </button>
                  ) : (
                    <div
                      key={row.status}
                      data-testid={`anime-stat-${row.status}`}
                      data-status={row.status}
                      aria-disabled="true"
                      className="flex items-center justify-between py-1 select-none"
                      title="Esta lista de animes é privada"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${row.dotClass} shrink-0`} />
                        <span className="text-purple-100/85 font-medium">{row.label}</span>
                      </div>
                      <span className="font-mono font-semibold text-white tabular-nums">
                        {row.count}
                      </span>
                    </div>
                  )
                )}
              </div>

              {/* Totals Column */}
              <div className="space-y-2 text-xs border-t sm:border-t-0 sm:border-l border-purple-900/30 pt-3 sm:pt-0 sm:pl-6 flex flex-col justify-center">
                {canOpenLists ? (
                  <button
                    type="button"
                    data-testid="anime-stat-all"
                    data-status="all"
                    onClick={() => handleOpenStatusList('all')}
                    className="group flex w-full items-center justify-between rounded-lg px-2 py-1 -mx-2 text-left transition-colors hover:bg-purple-900/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-500/60 cursor-pointer"
                    title="Abrir todas as entradas da lista"
                  >
                    <span className="text-purple-300/80 font-medium group-hover:text-white group-hover:underline underline-offset-2 transition-colors">
                      Total de entradas
                    </span>
                    <span className="font-mono font-semibold text-white tabular-nums group-hover:text-purple-200 transition-colors">
                      {stats.totalEntries.toLocaleString('pt-BR')}
                    </span>
                  </button>
                ) : (
                  <div
                    data-testid="anime-stat-all"
                    data-status="all"
                    aria-disabled="true"
                    className="flex items-center justify-between py-0.5 select-none"
                  >
                    <span className="text-purple-300/80 font-medium">Total de entradas</span>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {stats.totalEntries.toLocaleString('pt-BR')}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between py-0.5">
                  <span className="text-purple-300/80 font-medium">Reassistidos</span>
                  {stats.rewatchedTotal !== null ? (
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {stats.rewatchedTotal.toLocaleString('pt-BR')}
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
                    {stats.hasEpisodeData ? stats.totalEpisodesWatched.toLocaleString('pt-BR') : '—'}
                  </span>
                </div>
              </div>
            </div>
          </section>

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
              onNavigateToAnimes={() => {
                if (canOpenLists) {
                  handleOpenStatusList('all');
                }
              }}
            />
          )}

          {/* Currently Watching Showcase (strictly hidden for visitors when anime lists are private) */}
          {canOpenLists && watchingAnimes.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-purple-400" />
                  <h3 className="text-sm font-bold text-white">Assistindo Atualmente</h3>
                  <span className="rounded-full bg-purple-950 px-2 py-0.5 text-[10px] font-mono text-purple-300 border border-purple-900/40 tabular-nums">
                    {watchingAnimes.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenStatusList('watching')}
                  className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors cursor-pointer group"
                >
                  <span>Ver todos</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>

              {/* Sliced strictly to 4 items initially */}
              <div className="space-y-2">
                {watchingAnimes.slice(0, 4).map((anime) => {
                  const progressPct = anime.totalEpisodes > 0
                    ? Math.min(100, Math.max(0, Math.round((anime.currentEpisode / anime.totalEpisodes) * 100)))
                    : 0;
                  return (
                    <div
                      key={anime.id}
                      onClick={() => handleOpenStatusList('watching')}
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
                        <svg
                          viewBox="0 0 100 6"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                          className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-purple-950"
                        >
                          {progressPct > 0 && (
                            <rect
                              x={0}
                              y={0}
                              width={progressPct}
                              height={6}
                              rx={3}
                              className="fill-purple-500"
                            />
                          )}
                        </svg>
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
                    onClick={() => handleOpenStatusList('watching')}
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
