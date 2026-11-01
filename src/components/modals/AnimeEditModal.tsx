import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Minus, 
  Plus, 
  Check, 
  ChevronDown, 
  Tv, 
  Sparkles
} from 'lucide-react';
import { AnimeItem, AnimeStatus } from '../../types';

interface AnimeEditModalProps {
  anime: AnimeItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }) => void;
}

const STATUS_OPTIONS: { id: AnimeItem['status']; label: string; color: string; dotColor: string }[] = [
  { id: 'watching', label: 'Assistindo', color: 'text-purple-300', dotColor: 'bg-purple-500' },
  { id: 'completed', label: 'Concluído', color: 'text-emerald-300', dotColor: 'bg-emerald-500' },
  { id: 'on_hold', label: 'Em espera', color: 'text-amber-300', dotColor: 'bg-amber-500' },
  { id: 'dropped', label: 'Abandonado', color: 'text-rose-300', dotColor: 'bg-rose-500' },
  { id: 'planned', label: 'Planejado para assistir', color: 'text-sky-300', dotColor: 'bg-sky-500' }
];

export const AnimeEditModal: React.FC<AnimeEditModalProps> = ({
  anime,
  isOpen,
  onClose,
  onSave
}) => {
  if (!isOpen || !anime) return null;

  return <AnimeEditModalContent anime={anime} onClose={onClose} onSave={onSave} />;
};

interface AnimeEditModalContentProps {
  anime: AnimeItem;
  onClose: () => void;
  onSave: (updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }) => void;
}

const AnimeEditModalContent: React.FC<AnimeEditModalContentProps> = ({
  anime,
  onClose,
  onSave
}) => {
  // Local form state
  const [currentEpisode, setCurrentEpisode] = useState(anime.currentEpisode);
  const [status, setStatus] = useState<AnimeItem['status']>(anime.status);
  const [rating, setRating] = useState<number>(anime.rating || 0);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Background scroll lock without position:fixed or scrollTo (preserves exact page position)
  useEffect(() => {
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (scrollBarWidth > 0) {
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  // Click outside listener for the compact status dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setIsStatusDropdownOpen(false);
      }
    };
    if (isStatusDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isStatusDropdownOpen]);

  // Stepper handlers
  const handleDecrementEpisode = () => {
    setCurrentEpisode(prev => Math.max(0, prev - 1));
  };

  const handleIncrementEpisode = () => {
    setCurrentEpisode(prev => {
      const next = Math.min(anime.totalEpisodes, prev + 1);
      if (next === anime.totalEpisodes && status !== 'completed') {
        setStatus('completed');
      }
      return next;
    });
  };

  const handleEpisodeInputChange = (val: number) => {
    if (isNaN(val)) return;
    const clamped = Math.min(anime.totalEpisodes, Math.max(0, val));
    setCurrentEpisode(clamped);
    if (clamped === anime.totalEpisodes && status !== 'completed') {
      setStatus('completed');
    }
  };

  // Status selection handler
  const handleSelectStatus = (newStatus: AnimeItem['status']) => {
    setStatus(newStatus);
    if (newStatus === 'completed') {
      setCurrentEpisode(anime.totalEpisodes);
    }
    setIsStatusDropdownOpen(false);
  };

  // Save handler
  const handleSave = () => {
    setIsSaving(true);
    setSaveSuccess(true);
    onSave({
      currentEpisode,
      status,
      rating
    });

    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccess(false);
      onClose();
    }, 500);
  };

  const currentStatusObj = STATUS_OPTIONS.find(s => s.id === status) || STATUS_OPTIONS[0];
  const progressPercent = Math.round((currentEpisode / anime.totalEpisodes) * 100);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      onTouchMove={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div 
        className="relative w-full max-w-md rounded-2xl border border-purple-800/50 bg-[#130E24] shadow-2xl shadow-black/90 p-5 overflow-hidden overscroll-contain animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Title and Close button */}
        <div className="flex items-start justify-between gap-3 border-b border-purple-900/40 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <img 
              src={anime.posterUrl} 
              alt={anime.title} 
              className="h-14 w-10 rounded-lg object-cover border border-purple-800/40 shrink-0" 
            />
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white leading-snug truncate" title={anime.title}>
                {anime.title}
              </h3>
              {anime.titleRomaji && (
                <p className="text-[11px] text-purple-300/60 truncate mt-0.5">
                  {anime.titleRomaji}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2 text-[10px] text-purple-400 font-mono">
                <span>{anime.year}</span>
                <span>•</span>
                <span>{anime.totalEpisodes} episódios</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-purple-400 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer shrink-0"
            title="Cancelar e fechar"
            aria-label="Cancelar e fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <div className="mt-4 space-y-4">
          {/* FIELD 1: Status com Seletor Compacto (Requirement 3) */}
          <div className="space-y-1.5" ref={statusDropdownRef}>
            <label className="text-xs font-semibold text-purple-200">
              Status na lista
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-purple-800/50 bg-[#0d091a] px-3.5 py-2.5 text-xs text-white hover:border-purple-600 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${currentStatusObj.dotColor}`} />
                  <span className="font-medium text-white">{currentStatusObj.label}</span>
                </div>
                <ChevronDown className={`h-4 w-4 text-purple-400 transition-transform duration-200 ${isStatusDropdownOpen ? 'rotate-180 text-purple-200' : ''}`} />
              </button>

              {/* Compact & Elegant Status Selector Popover */}
              {isStatusDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-purple-600/60 bg-[#16102e] p-1.5 shadow-2xl shadow-black/90 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                  <div className="space-y-0.5">
                    {STATUS_OPTIONS.map((opt) => {
                      const isSelected = opt.id === status;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSelectStatus(opt.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer text-left ${
                            isSelected
                              ? 'bg-purple-600/35 text-white font-semibold border border-purple-500/50'
                              : 'text-purple-200/80 hover:bg-purple-900/40 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${opt.dotColor}`} />
                            <span className="truncate">{opt.label}</span>
                          </div>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 text-purple-300 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* FIELD 2: Progresso dos Episódios */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-purple-200">Episódios assistidos</span>
              <span className="font-mono text-purple-300 tabular-nums">
                {currentEpisode} / {anime.totalEpisodes} <span className="text-[10px] text-purple-400">({progressPercent}%)</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDecrementEpisode}
                disabled={currentEpisode <= 0}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-800/60 text-purple-200 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
                title="Diminuir 1 episódio"
                aria-label="Diminuir 1 episódio"
              >
                <Minus className="h-4 w-4" />
              </button>

              <div className="flex-1 relative">
                <input
                  type="number"
                  min={0}
                  max={anime.totalEpisodes}
                  value={currentEpisode}
                  onChange={(e) => handleEpisodeInputChange(parseInt(e.target.value, 10))}
                  className="w-full text-center rounded-xl border border-purple-800/50 bg-[#0d091a] py-2 px-3 text-xs sm:text-sm font-mono font-bold text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleIncrementEpisode}
                disabled={currentEpisode >= anime.totalEpisodes}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm shadow-purple-950/60 cursor-pointer shrink-0"
                title="Avançar 1 episódio"
                aria-label="Avançar 1 episódio"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Visual Progress Bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-purple-950">
              <div 
                className="h-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* FIELD 3: Campo de Nota */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-purple-200">Sua nota</label>
              {rating > 0 ? (
                <span className="font-mono font-bold text-amber-300 text-xs">
                  {rating} / 10
                </span>
              ) : (
                <span className="text-[11px] text-purple-400/60">Sem nota</span>
              )}
            </div>

            <select
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="w-full rounded-xl border border-purple-800/50 bg-[#0d091a] px-3.5 py-2.5 text-xs text-white focus:border-purple-500 focus:outline-none cursor-pointer"
            >
              <option value={0}>Sem nota</option>
              <option value={10}>10 — Obra-prima</option>
              <option value={9}>9 — Excelente</option>
              <option value={8}>8 — Muito bom</option>
              <option value={7}>7 — Bom</option>
              <option value={6}>6 — Razoável</option>
              <option value={5}>5 — Médio</option>
              <option value={4}>4 — Ruim</option>
              <option value={3}>3 — Muito ruim</option>
              <option value={2}>2 — Horrível</option>
              <option value={1}>1 — Desastre</option>
            </select>
          </div>
        </div>

        {/* Footer Actions: Cancelar and Salvar Alterações */}
        <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-purple-900/40 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-semibold text-white transition-all shadow-md shadow-purple-950/60 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {saveSuccess ? (
              <>
                <Check className="h-4 w-4 text-white" />
                <span>Salvo!</span>
              </>
            ) : (
              <span>Salvar alterações</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
