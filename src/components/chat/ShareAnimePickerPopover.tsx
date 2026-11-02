import React, { useState } from 'react';
import { Search, Film, Star, X, Sparkles } from 'lucide-react';
import type { AnimeItem, HikariLinkPreview } from '../../types';
import { INITIAL_ANIMES } from '../../data/mockData';

interface ShareAnimePickerPopoverProps {
  isOpen: boolean;
  userAnimes?: AnimeItem[];
  onClose: () => void;
  onSelectAnime: (preview: HikariLinkPreview) => void;
}

export const ShareAnimePickerPopover: React.FC<ShareAnimePickerPopoverProps> = ({
  isOpen,
  userAnimes = [],
  onClose,
  onSelectAnime,
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  // Combina animes do usuário com catálogo geral sem duplicatas
  const allMap = new Map<string, AnimeItem>();
  for (const a of userAnimes) allMap.set(a.id, a);
  for (const a of INITIAL_ANIMES) {
    if (!allMap.has(a.id)) allMap.set(a.id, a);
  }
  const combinedList = Array.from(allMap.values());

  const filtered = combinedList.filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    (a.titleRomaji && a.titleRomaji.toLowerCase().includes(search.toLowerCase())) ||
    a.genres.some((g) => g.toLowerCase().includes(search.toLowerCase()))
  );

  const handlePick = (anime: AnimeItem) => {
    const preview: HikariLinkPreview = {
      url: `https://hikari.tv/anime/${anime.id}`,
      type: 'anime',
      title: anime.title,
      description: anime.titleRomaji ? `${anime.titleRomaji} (${anime.year})` : `Ano ${anime.year}`,
      imageUrl: anime.posterUrl,
      badge: `★ ${anime.rating.toFixed(1)} • ${anime.currentEpisode}/${anime.totalEpisodes} eps`,
      extraInfo: {
        rating: anime.rating,
        status: anime.status,
        episodes: `${anime.totalEpisodes} episódios`,
        year: anime.year,
        genres: anime.genres,
      },
    };
    onSelectAnime(preview);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Compartilhar Card de Anime Hikari"
      className="absolute bottom-full left-0 mb-3 z-50 w-80 sm:w-96 rounded-2xl border border-purple-800/40 bg-[#120B24] p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between pb-2 border-b border-purple-900/30">
        <div className="flex items-center gap-1.5">
          <Film className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Compartilhar Anime Hikari
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-2.5">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-purple-400/60" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar anime por título ou gênero..."
          className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors"
        />
      </div>

      <div className="mt-2.5 max-h-56 overflow-y-auto pr-1 space-y-1.5">
        {filtered.slice(0, 40).map((anime) => (
          <button
            key={anime.id}
            type="button"
            onClick={() => handlePick(anime)}
            className="w-full text-left flex items-center gap-2.5 p-2 rounded-xl border border-purple-900/30 bg-[#160f2e]/60 hover:bg-purple-950/80 hover:border-purple-600/50 transition-colors cursor-pointer group"
          >
            <img
              src={anime.posterUrl}
              alt={anime.title}
              className="h-12 w-9 rounded-md object-cover border border-purple-900/40 shrink-0"
              loading="lazy"
            />
            <div className="flex-1 min-w-0">
              <h5 className="text-xs font-bold text-white truncate group-hover:text-purple-200">
                {anime.title}
              </h5>
              <p className="text-[10px] text-purple-300/60 truncate">
                {anime.titleRomaji || anime.genres.join(', ')}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-300">
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  {anime.rating.toFixed(1)}
                </span>
                <span className="text-[10px] text-purple-400/70">
                  {anime.totalEpisodes} episódios
                </span>
              </div>
            </div>
          </button>
        ))}

        {filtered.length > 40 && (
          <div className="py-2 text-center text-[10px] text-purple-400/70 border-t border-purple-900/30">
            Mostrando 40 de {filtered.length} animes correspondentes. Refine a pesquisa para filtrar mais.
          </div>
        )}

        {filtered.length === 0 && (
          <div className="py-6 text-center text-xs text-purple-400/60">
            Nenhum anime encontrado para &quot;{search}&quot;.
          </div>
        )}
      </div>
    </div>
  );
};
