import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Check, 
  Play, 
  Clock, 
  PauseCircle, 
  XCircle, 
  Tv, 
  ChevronDown 
} from 'lucide-react';
import { AnimeItem, AnimeStatus } from '../../types';
import { AnimeEditModal } from '../modals/AnimeEditModal';

interface AnimeListTabProps {
  animes: AnimeItem[];
  isOwnProfile: boolean;
  onUpdateEpisode: (animeId: string, delta: number) => void;
  onToggleFavorite: (animeId: string) => void;
  onUpdateStatus?: (animeId: string, newStatus: AnimeItem['status']) => void;
  onSaveAnimeEdit?: (animeId: string, updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }) => void;
}

export const AnimeListTab: React.FC<AnimeListTabProps> = ({
  animes,
  isOwnProfile,
  onUpdateEpisode,
  onToggleFavorite,
  onUpdateStatus,
  onSaveAnimeEdit
}) => {
  const [activeFilter, setActiveFilter] = useState<AnimeStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(12);

  // Dedicated Anime Edit Modal state (Requirement 2 & 3)
  const [editingAnime, setEditingAnime] = useState<AnimeItem | null>(null);

  // Reset pagination to initial 12 when filter or search changes
  useEffect(() => {
    setVisibleCount(12);
  }, [activeFilter, searchQuery]);

  const statusCategories: { id: AnimeStatus; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Todos', icon: null },
    { id: 'watching', label: 'Assistindo', icon: <Play className="h-3 w-3" /> },
    { id: 'completed', label: 'Concluídos', icon: <Check className="h-3 w-3" /> },
    { id: 'planned', label: 'Planejados', icon: <Clock className="h-3 w-3" /> },
    { id: 'on_hold', label: 'Em espera', icon: <PauseCircle className="h-3 w-3" /> },
    { id: 'dropped', label: 'Abandonados', icon: <XCircle className="h-3 w-3" /> }
  ];

  const filteredAnimes = animes.filter((anime) => {
    const matchesFilter = activeFilter === 'all' || anime.status === activeFilter;
    const matchesSearch = 
      anime.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (anime.titleRomaji && anime.titleRomaji.toLowerCase().includes(searchQuery.toLowerCase())) ||
      anime.genres.some(g => g.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  // Items sliced according to pagination limit (12 initially, +12 each load more)
  const displayedAnimes = filteredAnimes.slice(0, visibleCount);
  const hasMore = filteredAnimes.length > visibleCount;

  const getStatusBadge = (status: AnimeItem['status']) => {
    switch (status) {
      case 'watching':
        return <span className="text-[9px] sm:text-[10px] md:text-[11px] font-medium text-emerald-400">Assistindo</span>;
      case 'completed':
        return <span className="text-[9px] sm:text-[10px] md:text-[11px] font-medium text-purple-300">Concluído</span>;
      case 'planned':
        return <span className="text-[9px] sm:text-[10px] md:text-[11px] font-medium text-indigo-300">Planejado</span>;
      case 'on_hold':
        return <span className="text-[9px] sm:text-[10px] md:text-[11px] font-medium text-amber-300">Em espera</span>;
      case 'dropped':
        return <span className="text-[9px] sm:text-[10px] md:text-[11px] font-medium text-rose-300">Abandonado</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Controls Bar: Filters & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 rounded-2xl border border-purple-900/30 bg-[#130E24] p-3 sm:p-4">
        {/* Status Filters (Segmented Controls) */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {statusCategories.map((cat) => {
            const count = cat.id === 'all' 
              ? animes.length 
              : animes.filter(a => a.status === cat.id).length;
            const isActive = activeFilter === cat.id;

            return (
              <button
                key={cat.id}
                onClick={() => setActiveFilter(cat.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                }`}
              >
                {cat.icon}
                <span>{cat.label}</span>
                <span className={`font-mono tabular-nums text-[10px] rounded px-1 ${
                  isActive ? 'bg-purple-700 text-white' : 'bg-purple-950 text-purple-400'
                }`}>
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

      {/* Animes Grid - Always 3 columns on mobile and larger screens */}
      {filteredAnimes.length === 0 ? (
        animes.length === 0 && activeFilter === 'all' && !searchQuery.trim() ? (
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
              onClick={() => {
                setActiveFilter('all');
                setSearchQuery('');
              }}
              className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors"
            >
              Limpar Filtros
            </button>
          </div>
        )
      ) : (
        <>
          <div 
            className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3 md:gap-3.5 w-full"
            style={{ minWidth: 0 }}
          >
            {displayedAnimes.map((anime) => {
              const progress = anime.status === 'completed' 
                ? 100 
                : Math.round((anime.currentEpisode / anime.totalEpisodes) * 100);

              return (
                <div
                  key={anime.id}
                  className="group relative flex flex-col justify-between rounded-xl sm:rounded-2xl border border-purple-900/30 bg-[#130E24] p-1.5 sm:p-2.5 md:p-3 shadow-md transition-all hover:border-purple-600/50 hover:bg-[#17102e] w-full min-w-0 overflow-hidden"
                >
                  {/* Top section: Poster + Title + Romaji + Genres */}
                  <div className="flex flex-col">
                    {/* Poster & Badges */}
                    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg sm:rounded-xl bg-purple-950/40">
                      <img
                        src={anime.posterUrl}
                        alt={anime.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />

                      {/* Gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

                      {/* Rating badge (Top-Left) - clean score without star glyph */}
                      {anime.rating > 0 && (
                        <div className="absolute top-1 left-1 sm:top-1.5 sm:left-1.5 rounded bg-black/75 px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] md:text-xs font-bold text-amber-300 backdrop-blur-md flex items-center border border-amber-500/20">
                          <span>{anime.rating}</span>
                        </div>
                      )}

                      {/* Status badge in poster footer */}
                      <div className="absolute bottom-1 left-1 right-1 sm:bottom-1.5 sm:left-1.5 sm:right-1.5 flex items-center justify-between text-[9px] sm:text-[10px] md:text-xs">
                        {getStatusBadge(anime.status)}
                        <span className="font-mono text-purple-200/80 text-[8px] sm:text-[9px] md:text-[10px] tabular-nums">
                          {anime.year}
                        </span>
                      </div>
                    </div>

                    {/* Title & Metadata with consistent vertical slots */}
                    {/* Fixed 2-line title container so long and short titles take identical height */}
                    <div className="mt-1.5 sm:mt-2 h-7 sm:h-8 flex items-start">
                      <h4 
                        className="font-semibold text-[11px] sm:text-xs md:text-sm text-white group-hover:text-purple-300 transition-colors line-clamp-2 leading-tight" 
                        title={anime.title}
                      >
                        {anime.title}
                      </h4>
                    </div>

                    {/* Fixed 1-line romaji slot */}
                    <div className="h-3.5 sm:h-4 flex items-center mt-0.5">
                      {anime.titleRomaji ? (
                        <p 
                          className="text-[9px] sm:text-[10px] md:text-[11px] text-purple-300/50 truncate italic"
                          title={anime.titleRomaji}
                        >
                          {anime.titleRomaji}
                        </p>
                      ) : (
                        <span className="text-[9px] sm:text-[10px] md:text-[11px] text-purple-400/20 truncate select-none">
                          —
                        </span>
                      )}
                    </div>

                    {/* Fixed 1-line genres slot */}
                    <div className="h-3.5 sm:h-4 flex items-center mt-0.5 text-[9px] sm:text-[10px] md:text-[11px] text-purple-400/70 truncate">
                      <span className="truncate" title={anime.genres.join(', ')}>
                        {anime.genres.slice(0, 2).join(' · ')}
                      </span>
                    </div>
                  </div>

                  {/* Episode Progress & Controls with standardized vertical height */}
                  <div className="mt-2 sm:mt-2.5 pt-1.5 sm:pt-2 border-t border-purple-900/30">
                    {/* Progress text row */}
                    <div className="h-4 flex items-center justify-between text-[9px] sm:text-[10px] md:text-xs mb-1">
                      <span className="text-purple-300/70">Progresso</span>
                      <span className="font-mono font-semibold text-white tabular-nums">
                        {anime.status === 'completed' ? anime.totalEpisodes : anime.currentEpisode}/{anime.totalEpisodes} <span className="text-[8px] sm:text-[10px] text-purple-300/60">ep</span>
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1 sm:h-1.5 w-full overflow-hidden rounded-full bg-purple-950">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {/* Controls row: percentage & "Gerenciar progresso" */}
                    <div className="mt-2 pt-1.5 border-t border-purple-900/30">
                      {isOwnProfile ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-end">
                            <span className="font-mono text-[9px] sm:text-[10px] text-purple-300 tabular-nums">
                              {progress}%
                            </span>
                          </div>

                          {/* Button "Gerenciar progresso" opening the dedicated AnimeEditModal */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingAnime(anime);
                            }}
                            className="w-full flex items-center justify-center gap-1 rounded bg-[#16102a] hover:bg-purple-900/50 border border-purple-800/40 hover:border-purple-600/50 py-1 px-1.5 text-[9px] sm:text-[10px] font-medium text-purple-200 hover:text-white transition-all cursor-pointer"
                            title="Gerenciar progresso, status e nota"
                          >
                            <span className="truncate">Gerenciar progresso</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-[9px] sm:text-[10px] text-purple-400/60 font-mono py-1">
                          <span>{progress}% concluído</span>
                          {anime.status === 'completed' && (
                            <span className="text-emerald-400 font-medium flex items-center gap-0.5">
                              <Check className="h-2.5 w-2.5" /> Concluído
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

          {/* Pagination: Load More Button */}
          {hasMore && (
            <div className="mt-8 flex flex-col items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + 12)}
                className="inline-flex items-center gap-2 rounded-xl border border-purple-600/40 bg-[#17102e] hover:bg-purple-900/60 hover:border-purple-500 px-6 py-2.5 text-xs sm:text-sm font-semibold text-purple-100 shadow-lg shadow-purple-950/40 transition-all active:scale-95 cursor-pointer"
              >
                <span>Carregar mais</span>
                <span className="rounded-full bg-purple-800/70 px-2 py-0.5 text-[10px] text-purple-200 font-mono tabular-nums">
                  +{Math.min(12, filteredAnimes.length - visibleCount)}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-purple-300" />
              </button>
              <p className="text-[11px] text-purple-400/50">
                Exibindo {displayedAnimes.length} de {filteredAnimes.length} animes
              </p>
            </div>
          )}

          {!hasMore && filteredAnimes.length > 12 && (
            <div className="mt-8 text-center text-xs text-purple-400/50">
              Todos os {filteredAnimes.length} animes foram carregados.
            </div>
          )}
        </>
      )}

      {/* Dedicated Modern Anime Edit Modal (Requirement 2 & 3) */}
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
              onUpdateEpisode(editingAnime.id, updates.currentEpisode - editingAnime.currentEpisode);
            }
          }
          setEditingAnime(null);
        }}
      />
    </div>
  );
};
