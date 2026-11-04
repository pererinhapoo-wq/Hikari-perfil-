import React, { Suspense, lazy, useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { ModalLoadingFallback } from '../common/LazyFallbacks';

const LazyAnimeEditModal = lazy(() =>
  import('../modals/AnimeEditModal').then((m) => ({ default: m.AnimeEditModal }))
);

interface AnimeListTabProps {
  profileId?: string;
  animes: AnimeItem[];
  isOwnProfile: boolean;
  selectedStatusFilter?: AnimeStatus;
  statusCounts?: Record<AnimeStatus, number>;
  onSelectCategory?: (category: AnimeStatus) => void;
  isLoadingCategory?: boolean;
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

const COLUMNS = 3;
const OVERSCAN_ROWS = 1; // Mantém apenas uma linha extra acima/abaixo para reduzir imagens fora da tela
const DEFAULT_ROW_HEIGHT = 380;

const STATUS_CATEGORIES: { id: AnimeStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'Todos', icon: null },
  { id: 'watching', label: 'Assistindo', icon: <Play className="h-3 w-3" /> },
  { id: 'completed', label: 'Concluídos', icon: <Check className="h-3 w-3" /> },
  { id: 'planned', label: 'Planejados', icon: <Clock className="h-3 w-3" /> },
  { id: 'on_hold', label: 'Em espera', icon: <PauseCircle className="h-3 w-3" /> },
  { id: 'dropped', label: 'Abandonados', icon: <XCircle className="h-3 w-3" /> },
];

const animeSearchTextCache = new WeakMap<AnimeItem, string>();

/**
 * Pré-indexa o texto pesquisável de cada AnimeItem em minúsculas uma única vez por referência.
 */
export function getNormalizedAnimeSearchText(anime: AnimeItem): string {
  const cached = animeSearchTextCache.get(anime);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = `${anime.title || ''}\u0000${anime.titleRomaji || ''}\u0000${
    Array.isArray(anime.genres) ? anime.genres.join('\u0000') : ''
  }`.toLowerCase();
  animeSearchTextCache.set(anime, normalized);
  return normalized;
}

import { computeAnimeStatusCounts } from '../../utils/animeStats';
import { computeVirtualGridWindow } from '../../utils/listVirtualizer';
export { computeAnimeStatusCounts, computeVirtualGridWindow };

export type AnimeSortOption = 'recent' | 'rating_desc' | 'rating_asc' | 'title_asc' | 'progress_desc';

// Persistent cache across tab switches isolated per profileId
export interface PersistentAnimeTabState {
  activeFilter: AnimeStatus;
  searchQuery: string;
  sortBy: AnimeSortOption;
  selectedGenre: string;
  scrollYByFilter: Record<AnimeStatus, number>;
  scrollY: number;
}

const persistentAnimeTabStateByProfile = new Map<string, PersistentAnimeTabState>();

export function getPersistentAnimeTabState(profileKey: string): PersistentAnimeTabState {
  let state = persistentAnimeTabStateByProfile.get(profileKey);
  if (!state) {
    state = {
      activeFilter: 'all',
      searchQuery: '',
      sortBy: 'recent',
      selectedGenre: 'all',
      scrollYByFilter: {
        all: 0,
        watching: 0,
        completed: 0,
        planned: 0,
        on_hold: 0,
        dropped: 0,
      },
      scrollY: 0,
    };
    persistentAnimeTabStateByProfile.set(profileKey, state);
  }
  return state;
}

function getStatusBadge(status: AnimeItem['status']) {
  switch (status) {
    case 'watching':
      return (
        <span className="inline-flex items-center gap-1 text-[9px] sm:text-[11px] font-medium text-emerald-400">
          <span className="relative flex h-1.5 w-1.5 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span>Assistindo</span>
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-[9px] sm:text-[11px] font-medium text-purple-300">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
          <span>Concluído</span>
        </span>
      );
    case 'planned':
      return (
        <span className="inline-flex items-center gap-1 text-[9px] sm:text-[11px] font-medium text-indigo-300">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
          <span>Planejado</span>
        </span>
      );
    case 'on_hold':
      return (
        <span className="inline-flex items-center gap-1 text-[9px] sm:text-[11px] font-medium text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
          <span>Em espera</span>
        </span>
      );
    case 'dropped':
      return (
        <span className="inline-flex items-center gap-1 text-[9px] sm:text-[11px] font-medium text-rose-300">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
          <span>Abandonado</span>
        </span>
      );
    default:
      return null;
  }
}

interface AnimeCardProps {
  anime: AnimeItem;
  isOwnProfile: boolean;
  failedPoster: boolean;
  onOpenDetail: (id: string) => void;
  onOpenEdit: (anime: AnimeItem) => void;
  onPosterError: (id: string) => void;
}

const AnimeCard = React.memo<AnimeCardProps>(({
  anime,
  isOwnProfile,
  failedPoster,
  onOpenDetail,
  onOpenEdit,
  onPosterError,
}) => {
  const progress = anime.status === 'completed'
    ? 100
    : anime.totalEpisodes <= 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((anime.currentEpisode / anime.totalEpisodes) * 100)));

  return (
    <div
      data-testid={`anime-card-${anime.id}`}
      className="group relative flex flex-col justify-between rounded-xl sm:rounded-2xl border border-purple-900/30 bg-[#130E24] p-1.5 sm:p-3 md:p-3.5 shadow-md transition-all hover:border-purple-600/50 hover:bg-[#17102e] w-full min-w-0 overflow-hidden"
    >
      {/* Clickable Cover & Title -> Opens Anime Details View */}
      <button
        type="button"
        data-testid={`anime-cover-${anime.id}`}
        onClick={() => onOpenDetail(anime.id)}
        className="group/cover flex flex-col text-left w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-lg cursor-pointer"
        title={`Abrir detalhes de ${anime.title}`}
      >
        {/* Proportional 3:4 Poster & Badges */}
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg sm:rounded-xl bg-purple-950/40">
          {anime.posterUrl && !failedPoster ? (
            <img
              src={anime.posterUrl}
              alt={anime.title}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              referrerPolicy="no-referrer"
              onError={() => onPosterError(anime.id)}
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

        {/* Pure SVG Progress Bar */}
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
                onOpenEdit(anime);
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
}, (prev, next) => {
  return (
    prev.anime === next.anime &&
    prev.isOwnProfile === next.isOwnProfile &&
    prev.failedPoster === next.failedPoster
  );
});

export const AnimeListTab: React.FC<AnimeListTabProps> = React.memo(({
  profileId,
  animes,
  isOwnProfile,
  selectedStatusFilter,
  statusCounts: statusCountsProp,
  onSelectCategory,
  isLoadingCategory = false,
  filterSyncKey,
  selectedAnimeId,
  onClearSelectedAnime,
  isListPrivateForVisitors = false,
  onUpdateEpisode,
  onToggleFavorite,
  onUpdateStatus,
  onSaveAnimeEdit,
}) => {
  const profileKey = profileId || '__default__';
  const persistentTabState = getPersistentAnimeTabState(profileKey);

  const [prevProfileKey, setPrevProfileKey] = useState(profileKey);
  const [activeFilter, setActiveFilter] = useState<AnimeStatus>(() => {
    return selectedStatusFilter ?? persistentTabState.activeFilter;
  });
  const [searchQuery, setSearchQuery] = useState(() => persistentTabState.searchQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(() => persistentTabState.searchQuery);
  const [sortBy, setSortBy] = useState<AnimeSortOption>(() => persistentTabState.sortBy);
  const [selectedGenre, setSelectedGenre] = useState<string>(() => persistentTabState.selectedGenre);
  const [detailAnimeId, setDetailAnimeId] = useState<string | null>(selectedAnimeId ?? null);
  const [failedPosterIds, setFailedPosterIds] = useState<Record<string, boolean>>({});

  // Dedicated Anime Edit Modal state
  const [editingAnime, setEditingAnime] = useState<AnimeItem | null>(null);

  // Debounce search query changes to prevent heavy re-filtering of 10,000+ items on every keystroke
  useEffect(() => {
    if (!searchQuery.trim()) {
      setDebouncedQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  if (prevProfileKey !== profileKey) {
    const nextState = getPersistentAnimeTabState(profileKey);
    setPrevProfileKey(profileKey);
    setActiveFilter(selectedStatusFilter ?? nextState.activeFilter);
    setSearchQuery(nextState.searchQuery);
    setDebouncedQuery(nextState.searchQuery);
    setSortBy(nextState.sortBy);
    setSelectedGenre(nextState.selectedGenre);
    setDetailAnimeId(selectedAnimeId ?? null);
    setEditingAnime(null);
  }

  // Virtualization state & refs
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridOffsetTopRef = useRef<number>(0);
  const lastStartRowRef = useRef<number>(-1);
  const lastEndRowRef = useRef<number>(-1);
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number>(DEFAULT_ROW_HEIGHT);
  const [scrollY, setScrollY] = useState<number>(() => {
    return typeof window !== 'undefined' ? window.scrollY || window.pageYOffset || 0 : 0;
  });

  // Safely measure gridOffsetTop on mount, resize and filter change (never on every scroll pixel)
  const updateGridOffsetTop = useCallback(() => {
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      const currentScrollY = window.scrollY || window.pageYOffset || 0;
      gridOffsetTopRef.current = Math.max(0, rect.top + currentScrollY);
    }
  }, []);

  // Sync status filter when navigating from clickable Anime Stats rows
  useEffect(() => {
    if (selectedStatusFilter) {
      setActiveFilter(selectedStatusFilter);
      setSearchQuery('');
      setDebouncedQuery('');
      setDetailAnimeId(null);
      persistentTabState.scrollY = 0;
    }
  }, [selectedStatusFilter, filterSyncKey, persistentTabState]);

  // Sync direct anime detail selection (e.g. from search)
  useEffect(() => {
    if (selectedAnimeId) {
      setDetailAnimeId(selectedAnimeId);
    }
  }, [selectedAnimeId]);

  // Keep persistent state synchronized
  useEffect(() => {
    persistentTabState.activeFilter = activeFilter;
    persistentTabState.searchQuery = searchQuery;
    persistentTabState.sortBy = sortBy;
    persistentTabState.selectedGenre = selectedGenre;
  }, [activeFilter, searchQuery, sortBy, selectedGenre, persistentTabState]);

  // Restore scroll position when returning to this tab or when filter changes
  useEffect(() => {
    if (persistentTabState.scrollY > 0 && !selectedStatusFilter) {
      const targetY = persistentTabState.scrollY;
      const timer = window.setTimeout(() => {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
      }, 15);
      return () => window.clearTimeout(timer);
    }
  }, [selectedStatusFilter, profileKey, persistentTabState]);

  const uniqueAnimes = useMemo(() => {
    const seen = new Set<string>();
    const result: AnimeItem[] = [];
    for (let i = 0; i < animes.length; i++) {
      if (!seen.has(animes[i].id)) {
        seen.add(animes[i].id);
        result.push(animes[i]);
      }
    }
    return result;
  }, [animes]);

  // Extrai lista única de gêneros disponíveis
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < uniqueAnimes.length; i++) {
      const gList = uniqueAnimes[i].genres;
      if (Array.isArray(gList)) {
        for (let j = 0; j < gList.length; j++) {
          if (gList[j]) set.add(gList[j]);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [uniqueAnimes]);

  const detailAnime = useMemo(
    () => (detailAnimeId ? uniqueAnimes.find((a) => a.id === detailAnimeId) ?? null : null),
    [detailAnimeId, uniqueAnimes]
  );

  const statusCounts = useMemo(
    () => statusCountsProp ?? computeAnimeStatusCounts(uniqueAnimes),
    [statusCountsProp, uniqueAnimes]
  );

  // Manipulador de troca de categoria com preservação individual de scroll
  const handleSelectCategory = useCallback(
    (newCategory: AnimeStatus) => {
      // 1. Salva o scroll atual da categoria ativa
      const currentY = window.scrollY || window.pageYOffset || 0;
      persistentTabState.scrollYByFilter[activeFilter] = currentY;

      // 2. Altera a categoria
      setActiveFilter(newCategory);
      if (onSelectCategory) {
        onSelectCategory(newCategory);
      }

      // 3. Restaura a rolagem memorizada da nova categoria selecionada
      const savedY = persistentTabState.scrollYByFilter[newCategory] || 0;
      persistentTabState.scrollY = savedY;
      window.setTimeout(() => {
        window.scrollTo({ top: savedY, behavior: 'instant' as ScrollBehavior });
      }, 15);
    },
    [activeFilter, onSelectCategory, persistentTabState]
  );

  const filteredAnimes = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    const isAllFilter = activeFilter === 'all';
    const isAllGenre = selectedGenre === 'all';

    let result: AnimeItem[] = [];

    for (let i = 0; i < uniqueAnimes.length; i++) {
      const anime = uniqueAnimes[i];
      if (!isAllFilter && anime.status !== activeFilter) {
        continue;
      }
      if (!isAllGenre && (!Array.isArray(anime.genres) || !anime.genres.includes(selectedGenre))) {
        continue;
      }
      if (query && !getNormalizedAnimeSearchText(anime).includes(query)) {
        continue;
      }
      result.push(anime);
    }

    // Ordenação sob demanda sem mutação
    if (sortBy !== 'recent') {
      result = result.slice().sort((a, b) => {
        switch (sortBy) {
          case 'rating_desc':
            return (b.rating || 0) - (a.rating || 0);
          case 'rating_asc':
            return (a.rating || 0) - (b.rating || 0);
          case 'title_asc':
            return (a.title || '').localeCompare(b.title || '');
          case 'progress_desc': {
            const progressA = a.totalEpisodes > 0 ? a.currentEpisode / a.totalEpisodes : 0;
            const progressB = b.totalEpisodes > 0 ? b.currentEpisode / b.totalEpisodes : 0;
            return progressB - progressA;
          }
          default:
            return 0;
        }
      });
    }

    return result;
  }, [uniqueAnimes, activeFilter, selectedGenre, debouncedQuery, sortBy]);

  // Virtual window total metrics
  const totalItems = filteredAnimes.length;
  const totalRows = Math.ceil(totalItems / COLUMNS);

  // Window scroll & resize listener with row-change banding to eliminate redundant renders
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY || window.pageYOffset || 0;
          persistentTabState.scrollY = currentY;
          persistentTabState.scrollYByFilter[activeFilter] = currentY;

          const rowHeight = measuredRowHeight > 0 ? measuredRowHeight : DEFAULT_ROW_HEIGHT;
          const viewportHeight = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
          const relativeScroll = Math.max(0, currentY - gridOffsetTopRef.current);
          const startRow = Math.max(0, Math.floor(relativeScroll / rowHeight) - OVERSCAN_ROWS);
          const endRow = Math.min(totalRows, Math.ceil((relativeScroll + viewportHeight) / rowHeight) + OVERSCAN_ROWS);

          if (startRow !== lastStartRowRef.current || endRow !== lastEndRowRef.current) {
            lastStartRowRef.current = startRow;
            lastEndRowRef.current = endRow;
            setScrollY(currentY);
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    const handleResize = () => {
      updateGridOffsetTop();
      handleScroll();
    };

    updateGridOffsetTop();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [totalRows, measuredRowHeight, updateGridOffsetTop, activeFilter, persistentTabState]);

  // Post-commit measurement of gridOffsetTop and actual rendered card height (never inside render/useMemo)
  useEffect(() => {
    const measure = () => {
      if (!gridRef.current) return;
      updateGridOffsetTop();
      const firstCard = gridRef.current.querySelector<HTMLElement>('[data-testid^="anime-card-"]');
      if (firstCard) {
        const height = firstCard.offsetHeight || firstCard.getBoundingClientRect().height;
        if (height > 100) {
          const gap = window.innerWidth >= 768 ? 20 : window.innerWidth >= 640 ? 16 : 10;
          const nextRowHeight = Math.round(height + gap);
          setMeasuredRowHeight((prev) => (Math.abs(prev - nextRowHeight) >= 2 ? nextRowHeight : prev));
        }
      }
    };

    measure();
  }, [filteredAnimes.length, updateGridOffsetTop]);

  const { visibleAnimes, topPadding, bottomPadding, domReductionPercent } = useMemo(() => {
    // If list is small (<= 24 items), render completely without windowing
    if (totalItems <= 24) {
      return {
        visibleAnimes: filteredAnimes,
        topPadding: 0,
        bottomPadding: 0,
        domReductionPercent: 0,
      };
    }

    const rowHeight = measuredRowHeight > 0 ? measuredRowHeight : DEFAULT_ROW_HEIGHT;
    const viewportHeight = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
    const relativeScroll = Math.max(0, scrollY - gridOffsetTopRef.current);

    const win = computeVirtualGridWindow({
      totalItems,
      columns: COLUMNS,
      rowHeight,
      viewportHeight,
      scrollTop: relativeScroll,
      overscanRows: OVERSCAN_ROWS,
    });

    return {
      visibleAnimes: filteredAnimes.slice(win.startIndex, win.endIndex),
      topPadding: win.topPadding,
      bottomPadding: win.bottomPadding,
      domReductionPercent: win.domReductionPercent,
    };
  }, [filteredAnimes, totalItems, measuredRowHeight, scrollY]);

  const handleOpenDetail = useCallback((animeId: string) => {
    setDetailAnimeId(animeId);
  }, []);

  const handleCloseDetail = () => {
    setDetailAnimeId(null);
    if (onClearSelectedAnime) {
      onClearSelectedAnime();
    }
  };

  const handlePosterError = useCallback((id: string) => {
    setFailedPosterIds((prev) => ({ ...prev, [id]: true }));
  }, []);

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
              <span>Voltar para Lista de Animes</span>
            </button>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${getDetailStatusPillClass(detailAnime.status)}`}>
                {STATUS_LABEL_MAP[detailAnime.status]}
              </span>
              {detailAnime.isFavorite && (
                <span className="flex items-center gap-1 rounded-full border border-pink-500/30 bg-pink-950/40 px-2.5 py-0.5 text-xs font-medium text-pink-300">
                  <Heart className="h-3.5 w-3.5 fill-pink-500 text-pink-500" />
                  Favorito
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 rounded-2xl border border-purple-900/40 bg-[#130E24] p-4 sm:p-6 shadow-xl">
            {/* Left: Poster and Quick Controls */}
            <div className="flex flex-col items-center md:items-start space-y-4">
              <div className="relative aspect-[3/4] w-48 sm:w-56 overflow-hidden rounded-xl border border-purple-900/40 bg-purple-950/40 shadow-lg">
                {detailAnime.posterUrl && !failedPosterIds[detailAnime.id] ? (
                  <img
                    src={detailAnime.posterUrl}
                    alt={detailAnime.title}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => handlePosterError(detailAnime.id)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-purple-400/40">
                    <Tv className="h-12 w-12" />
                  </div>
                )}
                {detailAnime.rating > 0 && (
                  <div className="absolute top-2 left-2 rounded-lg bg-black/80 px-2 py-1 text-xs font-bold text-amber-300 backdrop-blur-md flex items-center border border-amber-500/20 tabular-nums">
                    <span>{detailAnime.rating}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="w-full max-w-[14rem] space-y-2">
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={() => setEditingAnime(detailAnime)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 py-2 px-3 text-xs font-semibold text-white transition-colors cursor-pointer shadow-md shadow-purple-900/40"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>Gerenciar Anime</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onToggleFavorite(detailAnime.id)}
                  className={`w-full flex items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    detailAnime.isFavorite
                      ? 'border-pink-500/40 bg-pink-950/30 text-pink-300 hover:bg-pink-900/40'
                      : 'border-purple-800/40 bg-purple-950/30 text-purple-200 hover:bg-purple-900/30'
                  }`}
                >
                  <Heart className={`h-3.5 w-3.5 ${detailAnime.isFavorite ? 'fill-pink-500 text-pink-500' : ''}`} />
                  <span>{detailAnime.isFavorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}</span>
                </button>
              </div>
            </div>

            {/* Right: Detailed Metadata & Synopsis */}
            <div className="md:col-span-2 space-y-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight">
                  {detailAnime.title}
                </h2>
                {detailAnime.titleRomaji && detailAnime.titleRomaji !== detailAnime.title && (
                  <p className="text-xs text-purple-400/80 font-medium mt-0.5">
                    {detailAnime.titleRomaji}
                  </p>
                )}
              </div>

              {/* Progress Bar & Counter */}
              <div className="rounded-xl border border-purple-900/30 bg-[#16102a] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-purple-300 font-medium">Progresso de Episódios</span>
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {detailAnime.status === 'completed' ? detailAnime.totalEpisodes : detailAnime.currentEpisode} / {detailAnime.totalEpisodes} ep
                  </span>
                </div>
                <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-purple-950">
                  {computeProgressPercent(detailAnime) > 0 && (
                    <rect x={0} y={0} width={computeProgressPercent(detailAnime)} height={6} rx={3} className="fill-purple-500" />
                  )}
                </svg>
                <div className="flex items-center justify-between text-[11px] text-purple-400/70 font-mono">
                  <span>{computeProgressPercent(detailAnime)}% concluído</span>
                  {detailAnime.status === 'completed' && <span className="text-emerald-400 font-medium">Finalizado</span>}
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border border-purple-900/30 bg-[#16102a]/60 p-2.5">
                  <span className="text-[10px] text-purple-400/70 block uppercase font-mono">Ano de Lançamento</span>
                  <span className="text-white font-semibold font-mono">{detailAnime.year}</span>
                </div>
                <div className="rounded-lg border border-purple-900/30 bg-[#16102a]/60 p-2.5">
                  <span className="text-[10px] text-purple-400/70 block uppercase font-mono">Total de Episódios</span>
                  <span className="text-white font-semibold font-mono">{detailAnime.totalEpisodes}</span>
                </div>
                <div className="rounded-lg border border-purple-900/30 bg-[#16102a]/60 p-2.5">
                  <span className="text-[10px] text-purple-400/70 block uppercase font-mono">Nota Pessoal</span>
                  <span className="text-amber-300 font-bold font-mono">
                    {detailAnime.rating > 0 ? `${detailAnime.rating} / 10` : 'Sem nota'}
                  </span>
                </div>
              </div>

              {/* Genres */}
              <div>
                <span className="text-[11px] font-semibold text-purple-300/80 uppercase block mb-1.5">Gêneros</span>
                <div className="flex flex-wrap gap-1.5">
                  {detailAnime.genres.map((genre) => (
                    <span
                      key={genre}
                      className="rounded-md border border-purple-800/40 bg-purple-950/40 px-2 py-0.5 text-xs text-purple-200"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Controls: Horizontal Status Filters, Search Box, Genre & Sort Dropdowns */}
          <div className="space-y-3 border-b border-purple-900/30 pb-3">
            {/* Status Categories */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {STATUS_CATEGORIES.map((cat) => {
                const isActive = activeFilter === cat.id;
                const count = statusCounts[cat.id];

                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-testid={`anime-category-tab-${cat.id}`}
                    onClick={() => handleSelectCategory(cat.id)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/50 border border-purple-400/30'
                        : 'border border-purple-900/30 bg-[#130E24] text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                    }`}
                  >
                    {cat.icon}
                    <span>{cat.label}</span>
                    <span
                      className={`font-mono text-[10px] tabular-nums rounded px-1.5 py-0.2 ${
                        isActive
                          ? 'bg-purple-800 text-purple-100'
                          : 'bg-purple-950 text-purple-400 border border-purple-900/40'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filter toolbar: Search, Genre, Sort & Counter */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                {/* Search input inside anime list */}
                <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/60" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filtrar por título..."
                    className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-1.5 pl-8 pr-3 text-xs text-purple-100 placeholder:text-purple-400/40 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                  />
                </div>

                {/* Genre Selector */}
                {availableGenres.length > 0 && (
                  <select
                    data-testid="anime-genre-select"
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value)}
                    className="rounded-xl border border-purple-900/40 bg-[#0A0713] px-2.5 py-1.5 text-xs text-purple-200 focus:border-purple-500 focus:outline-none cursor-pointer"
                  >
                    <option value="all">Todos os Gêneros</option>
                    {availableGenres.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                )}

                {/* Sort Selector */}
                <select
                  data-testid="anime-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as AnimeSortOption)}
                  className="rounded-xl border border-purple-900/40 bg-[#0A0713] px-2.5 py-1.5 text-xs text-purple-200 focus:border-purple-500 focus:outline-none cursor-pointer"
                >
                  <option value="recent">Ordem Padrão</option>
                  <option value="rating_desc">Maior Nota</option>
                  <option value="rating_asc">Menor Nota</option>
                  <option value="title_asc">Título (A-Z)</option>
                  <option value="progress_desc">Maior Progresso</option>
                </select>
              </div>

              {/* Counts indicator with DOM reduction note for audit */}
              <div className="text-[11px] font-mono text-purple-400/70 shrink-0">
                <span>
                  {filteredAnimes.length} de {statusCounts[activeFilter]} animes
                </span>
                {domReductionPercent > 0 && (
                  <span className="hidden sm:inline-block ml-1.5 text-[10px] text-emerald-400/80 font-normal">
                    (DOM otimizado: {visibleAnimes.length} nós ativos)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Animes Grid - Strictly 3 columns per row on all screens including mobile, full vertical scroll */}
          {isLoadingCategory && filteredAnimes.length === 0 ? (
            <div data-testid="category-loading-indicator" className="flex flex-col items-center justify-center py-16 space-y-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
              <span className="text-xs text-purple-300/70">Carregando animes desta categoria...</span>
            </div>
          ) : filteredAnimes.length === 0 ? (
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
                    persistentTabState.scrollY = 0;
                  }}
                  className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors cursor-pointer"
                >
                  Limpar Filtros
                </button>
              </div>
            )
          ) : (
            <div
              ref={gridRef}
              data-testid="anime-list-grid"
              className="grid grid-cols-3 gap-2.5 sm:gap-4 md:gap-5 w-full min-w-0"
              style={{
                paddingTop: topPadding > 0 ? `${topPadding}px` : undefined,
                paddingBottom: bottomPadding > 0 ? `${bottomPadding}px` : undefined,
              }}
            >
              {visibleAnimes.map((anime) => (
                <AnimeCard
                  key={anime.id}
                  anime={anime}
                  isOwnProfile={isOwnProfile}
                  failedPoster={Boolean(failedPosterIds[anime.id])}
                  onOpenDetail={handleOpenDetail}
                  onOpenEdit={setEditingAnime}
                  onPosterError={handlePosterError}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Dedicated Anime Edit Modal — downloaded & mounted strictly when editingAnime !== null */}
      {editingAnime !== null && (
        <Suspense fallback={<ModalLoadingFallback label="Carregando editor de anime..." />}>
          <LazyAnimeEditModal
            anime={editingAnime}
            isOpen={true}
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
        </Suspense>
      )}
    </div>
  );
});

