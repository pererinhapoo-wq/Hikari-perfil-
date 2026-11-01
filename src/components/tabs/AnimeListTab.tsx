import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Check,
  Play,
  Clock,
  PauseCircle,
  XCircle,
  Tv,
  ArrowLeft,
  Heart,
  Lock,
  SlidersHorizontal,
} from 'lucide-react';
import { AnimeItem, AnimeStatus } from '../../types';
import { AnimeEditModal } from '../modals/AnimeEditModal';

interface AnimeListTabProps {
  animes: AnimeItem[];
  isOwnProfile: boolean;
  selectedStatusFilter?: AnimeStatus;
  filterSyncKey?: number;
  selectedAnimeId?: string | null;
  onClearSelectedAnime?: () => void;
  isListPrivateForVisitors?: boolean;
  onUpdateEpisode: (animeId: string, delta: number) => void;
  onToggleFavorite: (animeId: string) => void;
  onUpdateStatus?: (animeId: string, newStatus: AnimeItem['status']) => void;
  onSaveAnimeEdit?: (
    animeId: string,
    updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }
  ) => void;
}

const STATUS_LABEL_MAP: Record<AnimeItem['status'], string> = {
  watching: 'Assistindo',
  completed: 'Concluído',
  planned: 'Planejado',
  on_hold: 'Em espera',
  dropped: 'Abandonado',
};

export const AnimeListTab: React.FC<AnimeListTabProps> = ({
  animes,
  isOwnProfile,
  selectedStatusFilter,
  filterSyncKey,
  selectedAnimeId,
  onClearSelectedAnime,
  isListPrivateForVisitors = false,
  onUpdateEpisode,
  onToggleFavorite,
  onUpdateStatus,
  onSaveAnimeEdit,
}) => {
  const [activeFilter, setActiveFilter] = useState<AnimeStatus>(selectedStatusFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailAnimeId, setDetailAnimeId] = useState<string | null>(selectedAnimeId ?? null);
  const [failedPosterIds, setFailedPosterIds] = useState<Record<string, boolean>>({});

  // Dedicated Anime Edit Modal state
  const [editingAnime, setEditingAnime] = useState<AnimeItem | null>(null);

  // Sync status filter when navigating from clickable Anime Stats rows
  useEffect(() => {
    if (selectedStatusFilter) {
      setActiveFilter(selectedStatusFilter);
      setSearchQuery('');
      setDetailAnimeId(null);
    }
  }, [selectedStatusFilter, filterSyncKey]);

  // Sync direct anime detail selection (e.g. from search)
  useEffect(() => {
    if (selectedAnimeId) {
      setDetailAnimeId(selectedAnimeId);
    }
  }, [selectedAnimeId]);

  const uniqueAnimes = useMemo(
    () => Array.from(new Map(animes.map((a) => [a.id, a])).values()),
    [animes]
  );

  const detailAnime = useMemo(
    () => (detailAnimeId ? uniqueAnimes.find((a) => a.id === detailAnimeId) ?? null : null),
    [detailAnimeId, uniqueAnimes]
  );

  const statusCategories: { id: AnimeStatus; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Todos', icon: null },
    { id: 'watching', label: 'Assistindo', icon: <Play className="h-3 w-3" /> },
    { id: 'completed', label: 'Concluídos', icon: <Check className="h-3 w-3" /> },
    { id: 'planned', label: 'Planejados', icon: <Clock className="h-3 w-3" /> },
    { id: 'on_hold', label: 'Em espera', icon: <PauseCircle className="h-3 w-3" /> },
    { id: 'dropped', label: 'Abandonados', icon: <XCircle className="h-3 w-3" /> },
  ];

  const filteredAnimes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return uniqueAnimes.filter((anime) => {
      const matchesFilter = activeFilter === 'all' || anime.status === activeFilter;
      if (!matchesFilter) return false;
      if (!query) return true;
      return (
        anime.title.toLowerCase().includes(query) ||
        Boolean(anime.titleRomaji && anime.titleRomaji.toLowerCase().includes(query)) ||
        anime.genres.some((g) => g.toLowerCase().includes(query))
      );
    });
  }, [uniqueAnimes, activeFilter, searchQuery]);

  const handleOpenDetail = (animeId: string) => {
    setDetailAnimeId(animeId);
  };

  const handleCloseDetail = () => {
    setDetailAnimeId(null);
    if (onClearSelectedAnime) {
      onClearSelectedAnime();
    }
  };

  const getStatusBadge = (status: AnimeItem['status']) => {
    switch (status) {
      case 'watching':
        return (
          <span className="text-[9px] sm:text-[11px] font-medium text-emerald-400">Assistindo</span>
        );
      case 'completed':
        return (
          <span className="text-[9px] sm:text-[11px] font-medium text-purple-300">Concluído</span>
        );
      case 'planned':
        return (
          <span className="text-[9px] sm:text-[11px] font-medium text-indigo-300">Planejado</span>
        );
      case 'on_hold':
        return (
          <span className="text-[9px] sm:text-[11px] font-medium text-amber-300">Em espera</span>
        );
      case 'dropped':
        return (
          <span className="text-[9px] sm:text-[11px] font-medium text-rose-300">Abandonado</span>
        );
      default:
        return null;
    }
  };

  const getDetailStatusPillClass = (status: AnimeItem['status']) => {
    switch (status) {
      case 'watching':
        return 'border-emerald-500/30 bg-emerald-950/50 text-emerald-300';
      case 'completed':
        return 'border-purple-500/30 bg-purple-950/60 text-purple-200';
      case 'planned':
        return 'border-indigo-500/30 bg-indigo-950/50 text-indigo-200';
      case 'on_hold':
        return 'border-amber-500/30 bg-amber-950/50 text-amber-200';
      case 'dropped':
        return 'border-rose-500/30 bg-rose-950/50 text-rose-200';
    }
  };

  const computeProgressPercent = (anime: AnimeItem): number => {
    if (anime.status === 'completed') return 100;
    if (anime.totalEpisodes <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((anime.currentEpisode / anime.totalEpisodes) * 100)));
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Owner visibility notice when lists are configured as private for visitors */}
      {isOwnProfile && isListPrivateForVisitors && (
        <div
          data-testid="owner-private-list-banner"
          className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-200/90"
        >
          <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            Suas listas de animes estão configuradas como <strong>privadas</strong>. Os números do Anime Stats continuam visíveis, mas apenas você pode abrir e visualizar os animes destas listas.
          </span>
        </div>
      )}

      {/* Dedicated Anime Details View when clicking a cover */}
      {detailAnime ? (
        <div
          data-testid="anime-detail-view"
          className="space-y-4 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              data-testid="anime-detail-back"
              onClick={handleCloseDetail}
              className="inline-flex items-center gap-2 rounded-xl border border-purple-800/40 bg-[#130E24] hover:bg-purple-900/30 hover:border-purple-600/50 px-3.5 py-2 text-xs font-semibold text-purple-200 hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4 text-purple-400" />
              <span>Voltar para a lista</span>
            </button>
          </div>

          <article className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-4 sm:p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-7">
              {/* Proportional 3:4 Cover */}
              <div className="relative w-44 sm:w-52 md:w-60 aspect-[3/4] shrink-0 overflow-hidden rounded-xl border border-purple-800/40 bg-purple-950/50 shadow-lg">
                {detailAnime.posterUrl && !failedPosterIds[detailAnime.id] ? (
                  <img
                    src={detailAnime.posterUrl}
                    alt={detailAnime.title}
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setFailedPosterIds((prev) => ({ ...prev, [detailAnime.id]: true }))
                    }
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-purple-400/50 p-4 text-center">
                    <Tv className="h-10 w-10" />
                    <span className="text-xs font-medium text-purple-300/70 line-clamp-2">
                      {detailAnime.title}
                    </span>
                  </div>
                )}
              </div>

              {/* Anime Real Information & List Status */}
              <div className="flex-1 min-w-0 w-full space-y-4">
                <div className="space-y-1 text-center sm:text-left">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
                    <span
                      className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold ${getDetailStatusPillClass(
                        detailAnime.status
                      )}`}
                    >
                      {STATUS_LABEL_MAP[detailAnime.status]}
                    </span>
                    <span className="rounded-lg border border-purple-900/40 bg-[#0A0713] px-2.5 py-0.5 font-mono text-xs text-purple-300 tabular-nums">
                      {detailAnime.year}
                    </span>
                    {detailAnime.isFavorite && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-950/40 px-2.5 py-0.5 text-xs font-medium text-rose-200">
                        <Heart className="h-3 w-3 fill-rose-400 text-rose-400" />
                        <span>Favorito</span>
                      </span>
                    )}
                  </div>

                  <h2
                    data-testid="anime-detail-title"
                    className="text-lg sm:text-2xl font-bold text-white leading-snug break-words"
                  >
                    {detailAnime.title}
                  </h2>

                  {detailAnime.titleRomaji && (
                    <p className="text-xs sm:text-sm text-purple-300/70 italic">
                      {detailAnime.titleRomaji}
                    </p>
                  )}
                </div>

                {/* Genres */}
                {detailAnime.genres.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
                    {detailAnime.genres.map((genre) => (
                      <span
                        key={genre}
                        className="rounded-lg border border-purple-800/40 bg-[#0A0713] px-2.5 py-1 text-xs font-medium text-purple-200"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )}

                {/* Structured Metrics from Real Item Data */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                  <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-3">
                    <span className="block text-[11px] text-purple-300/60">Progresso</span>
                    <span className="mt-0.5 block font-mono text-sm sm:text-base font-bold text-white tabular-nums">
                      {detailAnime.status === 'completed'
                        ? detailAnime.totalEpisodes
                        : detailAnime.currentEpisode}{' '}
                      / {detailAnime.totalEpisodes} ep
                    </span>
                  </div>

                  <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-3">
                    <span className="block text-[11px] text-purple-300/60">Nota na Lista</span>
                    <span className="mt-0.5 block font-mono text-sm sm:text-base font-bold text-amber-300 tabular-nums">
                      {detailAnime.rating > 0 ? `${detailAnime.rating} / 10` : 'Sem avaliação'}
                    </span>
                  </div>

                  <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-3 col-span-2 sm:col-span-1">
                    <span className="block text-[11px] text-purple-300/60">Conclusão</span>
                    <span className="mt-0.5 block font-mono text-sm sm:text-base font-bold text-purple-200 tabular-nums">
                      {computeProgressPercent(detailAnime)}%
                    </span>
                  </div>

                  {typeof detailAnime.episodeDurationMinutes === 'number' &&
                    detailAnime.episodeDurationMinutes > 0 && (
                      <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-3">
                        <span className="block text-[11px] text-purple-300/60">
                          Duração por episódio
                        </span>
                        <span className="mt-0.5 block font-mono text-sm font-bold text-white tabular-nums">
                          {detailAnime.episodeDurationMinutes} min
                        </span>
                      </div>
                    )}

                  {typeof detailAnime.rewatchCount === 'number' &&
                    detailAnime.rewatchCount > 0 && (
                      <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-3">
                        <span className="block text-[11px] text-purple-300/60">Reassistido</span>
                        <span className="mt-0.5 block font-mono text-sm font-bold text-white tabular-nums">
                          {detailAnime.rewatchCount}x
                        </span>
                      </div>
                    )}
                </div>

                {/* Progress Bar (SVG, zero inline styles) */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs text-purple-300/80">
                    <span>Andamento dos episódios</span>
                    <span className="font-mono font-semibold text-white tabular-nums">
                      {computeProgressPercent(detailAnime)}% concluído
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 100 6"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="block h-2 w-full overflow-hidden rounded-full bg-purple-950"
                  >
                    {computeProgressPercent(detailAnime) > 0 && (
                      <rect
                        x={0}
                        y={0}
                        width={computeProgressPercent(detailAnime)}
                        height={6}
                        rx={3}
                        className="fill-purple-500"
                      />
                    )}
                  </svg>
                </div>

                {/* Owner Actions inside Detail View */}
                {isOwnProfile && (
                  <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-purple-900/30">
                    <button
                      type="button"
                      onClick={() => setEditingAnime(detailAnime)}
                      className="inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Gerenciar progresso</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleFavorite(detailAnime.id)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        detailAnime.isFavorite
                          ? 'border-rose-500/40 bg-rose-950/40 text-rose-200 hover:bg-rose-900/40'
                          : 'border-purple-800/40 bg-[#0A0713] text-purple-200 hover:bg-purple-900/30 hover:text-white'
                      }`}
                    >
                      <Heart
                        className={`h-3.5 w-3.5 ${
                          detailAnime.isFavorite ? 'fill-rose-400 text-rose-400' : 'text-purple-400'
                        }`}
                      />
                      <span>
                        {detailAnime.isFavorite ? 'Remover dos favoritos' : 'Destacar nos favoritos'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </article>
        </div>
      ) : (
        <>
          {/* Controls Bar: Filters & Search */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 rounded-2xl border border-purple-900/30 bg-[#130E24] p-3 sm:p-4">
            {/* Status Filters (Segmented Controls) */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {statusCategories.map((cat) => {
                const count =
                  cat.id === 'all'
                    ? uniqueAnimes.length
                    : uniqueAnimes.filter((a) => a.status === cat.id).length;
                const isActive = activeFilter === cat.id;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-testid={`anime-filter-${cat.id}`}
                    aria-pressed={isActive}
                    onClick={() => setActiveFilter(cat.id)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                    }`}
                  >
                    {cat.icon}
                    <span>{cat.label}</span>
                    <span
                      className={`font-mono tabular-nums text-[10px] rounded px-1 ${
                        isActive ? 'bg-purple-700 text-white' : 'bg-purple-950 text-purple-400'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search input inside anime list */}
            <div className="relative w-full md:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por título ou gênero..."
                className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-1.5 pl-8 pr-3 text-xs text-purple-100 placeholder:text-purple-400/40 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
              />
            </div>
          </div>

          {/* Animes Grid - Strictly 3 columns per row on all screens including mobile, full vertical scroll */}
          {filteredAnimes.length === 0 ? (
            uniqueAnimes.length === 0 && activeFilter === 'all' && !searchQuery.trim() ? (
              <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-12 text-center">
                <Tv className="mx-auto h-10 w-10 text-purple-400/40" />
                <h3 className="mt-3 text-base font-bold text-white">
                  {isOwnProfile ? 'Sua lista de animes está vazia' : 'Nenhum anime na lista'}
                </h3>
                <p className="mt-1 text-xs text-purple-300/60 max-w-sm mx-auto">
                  {isOwnProfile
                    ? 'Você ainda não adicionou nenhum anime à sua lista pessoal.'
                    : 'Este usuário ainda não possui animes registrados na lista.'}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-12 text-center">
                <Tv className="mx-auto h-10 w-10 text-purple-400/40" />
                <h3 className="mt-3 text-base font-bold text-white">Nenhum anime encontrado</h3>
                <p className="mt-1 text-xs text-purple-300/60 max-w-sm mx-auto">
                  Não foram encontrados animes correspondentes ao filtro ou termo de pesquisa selecionado.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('all');
                    setSearchQuery('');
                  }}
                  className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors cursor-pointer"
                >
                  Limpar Filtros
                </button>
              </div>
            )
          ) : (
            <div
              data-testid="anime-list-grid"
              className="grid grid-cols-3 gap-2.5 sm:gap-4 md:gap-5 w-full min-w-0"
            >
              {filteredAnimes.map((anime) => {
                const progress = computeProgressPercent(anime);

                return (
                  <div
                    key={anime.id}
                    data-testid={`anime-card-${anime.id}`}
                    className="group relative flex flex-col justify-between rounded-xl sm:rounded-2xl border border-purple-900/30 bg-[#130E24] p-1.5 sm:p-3 md:p-3.5 shadow-md transition-all hover:border-purple-600/50 hover:bg-[#17102e] w-full min-w-0 overflow-hidden"
                  >
                    {/* Clickable Cover & Title -> Opens Anime Details View */}
                    <button
                      type="button"
                      data-testid={`anime-cover-${anime.id}`}
                      onClick={() => handleOpenDetail(anime.id)}
                      className="group/cover flex flex-col text-left w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-lg cursor-pointer"
                      title={`Abrir detalhes de ${anime.title}`}
                    >
                      {/* Proportional 3:4 Poster & Badges */}
                      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg sm:rounded-xl bg-purple-950/40">
                        {anime.posterUrl && !failedPosterIds[anime.id] ? (
                          <img
                            src={anime.posterUrl}
                            alt={anime.title}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedPosterIds((prev) => ({ ...prev, [anime.id]: true }))
                            }
                            className="h-full w-full object-cover transition-transform duration-300 group-hover/cover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-purple-400/40">
                            <Tv className="h-7 w-7 sm:h-9 sm:w-9" />
                          </div>
                        )}

                        {/* Gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

                        {/* Rating badge (Top-Left) */}
                        {anime.rating > 0 && (
                          <div className="absolute top-1 left-1 sm:top-2 sm:left-2 rounded bg-black/75 px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-xs font-bold text-amber-300 backdrop-blur-md flex items-center border border-amber-500/20 tabular-nums">
                            <span>{anime.rating}</span>
                          </div>
                        )}

                        {/* Status badge & Year in poster footer */}
                        <div className="absolute bottom-1 left-1 right-1 sm:bottom-2 sm:left-2 sm:right-2 flex items-center justify-between gap-1">
                          {getStatusBadge(anime.status)}
                          <span className="font-mono text-purple-200/85 text-[8px] sm:text-[10px] tabular-nums shrink-0">
                            {anime.year}
                          </span>
                        </div>
                      </div>

                      {/* Legible 2-line Title */}
                      <div className="mt-1.5 sm:mt-2.5 min-h-[1.75rem] sm:min-h-[2.5rem] flex items-start w-full">
                        <h4
                          className="font-semibold text-[11px] sm:text-sm md:text-[15px] text-white group-hover/cover:text-purple-300 transition-colors line-clamp-2 leading-tight sm:leading-snug break-words"
                          title={anime.title}
                        >
                          {anime.title}
                        </h4>
                      </div>

                      {/* Genres line */}
                      <div className="mt-0.5 flex items-center w-full text-[9px] sm:text-xs text-purple-400/75 truncate">
                        <span className="truncate" title={anime.genres.join(', ')}>
                          {anime.genres.slice(0, 2).join(' · ') || '—'}
                        </span>
                      </div>
                    </button>

                    {/* Episode Progress & Controls */}
                    <div className="mt-2 sm:mt-3 pt-1.5 sm:pt-2.5 border-t border-purple-900/30">
                      <div className="flex items-center justify-between text-[9px] sm:text-xs mb-1">
                        <span className="text-purple-300/70">Progresso</span>
                        <span className="font-mono font-semibold text-white tabular-nums">
                          {anime.status === 'completed'
                            ? anime.totalEpisodes
                            : anime.currentEpisode}
                          /{anime.totalEpisodes}{' '}
                          <span className="text-[8px] sm:text-[10px] text-purple-300/60">ep</span>
                        </span>
                      </div>

                      {/* Pure SVG Progress Bar (zero inline styles) */}
                      <svg
                        viewBox="0 0 100 6"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                        className="block h-1 sm:h-1.5 w-full overflow-hidden rounded-full bg-purple-950"
                      >
                        {progress > 0 && (
                          <rect
                            x={0}
                            y={0}
                            width={progress}
                            height={6}
                            rx={3}
                            className="fill-purple-500"
                          />
                        )}
                      </svg>

                      <div className="mt-2 pt-1.5 border-t border-purple-900/30">
                        {isOwnProfile ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingAnime(anime);
                            }}
                            className="w-full flex items-center justify-center gap-1 rounded-lg bg-[#16102a] hover:bg-purple-900/50 border border-purple-800/40 hover:border-purple-600/50 py-1 sm:py-1.5 px-1.5 text-[9px] sm:text-xs font-medium text-purple-200 hover:text-white transition-all cursor-pointer"
                            title="Gerenciar progresso, status e nota"
                          >
                            <span className="truncate">Gerenciar progresso</span>
                          </button>
                        ) : (
                          <div className="flex items-center justify-between text-[9px] sm:text-[11px] text-purple-400/70 font-mono py-0.5 tabular-nums">
                            <span>{progress}%</span>
                            {anime.status === 'completed' && (
                              <span className="text-emerald-400 font-medium hidden sm:inline-flex items-center gap-0.5">
                                <Check className="h-3 w-3" /> Concluído
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Dedicated Anime Edit Modal */}
      <AnimeEditModal
        anime={editingAnime}
        isOpen={!!editingAnime}
        onClose={() => setEditingAnime(null)}
        onSave={(updates) => {
          if (onSaveAnimeEdit && editingAnime) {
            onSaveAnimeEdit(editingAnime.id, updates);
          } else if (editingAnime) {
            if (updates.status !== editingAnime.status && onUpdateStatus) {
              onUpdateStatus(editingAnime.id, updates.status);
            }
            if (updates.currentEpisode !== editingAnime.currentEpisode) {
              onUpdateEpisode(
                editingAnime.id,
                updates.currentEpisode - editingAnime.currentEpisode
              );
            }
          }
          setEditingAnime(null);
        }}
      />
    </div>
  );
};

