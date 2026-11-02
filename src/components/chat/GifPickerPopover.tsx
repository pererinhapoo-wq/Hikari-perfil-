import React, { useState } from 'react';
import { Search, Sparkles, X, Check } from 'lucide-react';

interface GifPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGif: (gifUrl: string, title: string) => void;
}

// Curated safe animated anime GIFs with diverse reactions
const CURATED_ANIME_GIFS = [
  {
    id: 'gif_01',
    category: 'Feliz / Kawaii',
    title: 'Anya Heh Smug',
    url: 'https://media.tenor.com/7i2r0v_zGqEAAAAM/anya-spy-x-family.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_02',
    category: 'Hype / Ação',
    title: 'Solo Leveling Arise Aura',
    url: 'https://media.tenor.com/mU_v-E6Y7V8AAAAM/solo-leveling-jin-woo.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_03',
    category: 'Frieren / Chá',
    title: 'Frieren Relaxing Magic',
    url: 'https://media.tenor.com/0FwTz_w6s8oAAAAM/frieren-sousou-no-frieren.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_04',
    category: 'Pensativo',
    title: 'L Lawliet Thinking',
    url: 'https://media.tenor.com/8-yqWz4eE7QAAAAM/l-death-note.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_05',
    category: 'Choro / Drama',
    title: 'Aqua Crying KonoSuba',
    url: 'https://media.tenor.com/yFzNqVb9G08AAAAM/aqua-konosuba.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_06',
    category: 'Cyberpunk',
    title: 'Edgerunners David Neon',
    url: 'https://media.tenor.com/h5T2Q4l9Qp8AAAAM/cyberpunk-edgerunners.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_07',
    category: 'Bocchi Panic',
    title: 'Bocchi the Rock Glitch',
    url: 'https://media.tenor.com/7t-JmQ9zT6AAAAAM/bocchi-the-rock.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
  },
  {
    id: 'gif_08',
    category: 'Aplausos / GG',
    title: 'Anime Cheers Applause',
    url: 'https://media.tenor.com/2YfS0Z6w5_QAAAAM/anime-clap.gif',
    fallbackUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
  },
];

export const GifPickerPopover: React.FC<GifPickerPopoverProps> = ({
  isOpen,
  onClose,
  onSelectGif,
}) => {
  const [search, setSearch] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  if (!isOpen) return null;

  const filtered = CURATED_ANIME_GIFS.filter(
    (g) =>
      g.title.toLowerCase().includes(search.toLowerCase()) ||
      g.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleApplyCustomUrl = () => {
    const trimmed = customUrl.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('https://')) {
      setCustomError('A URL do GIF deve começar com https://');
      return;
    }
    if (!trimmed.match(/\.(gif|webp)($|\?)/i) && !trimmed.includes('tenor.com') && !trimmed.includes('giphy.com')) {
      setCustomError('A URL deve apontar para um arquivo .gif ou provedor de gifs.');
      return;
    }
    setCustomError(null);
    onSelectGif(trimmed, 'GIF Personalizado');
    setCustomUrl('');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Selecionar GIF animado"
      className="absolute bottom-full right-0 mb-3 z-50 w-80 sm:w-96 rounded-2xl border border-purple-800/40 bg-[#120B24] p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-purple-900/30">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Reações em GIF Hikari
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

      {/* Search Input */}
      <div className="relative mt-2.5">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-purple-400/60" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar GIF de anime (ex: Anya, Frieren, Hype)..."
          className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors"
        />
      </div>

      {/* Grid of GIFs */}
      <div className="mt-2.5 max-h-56 overflow-y-auto pr-1 grid grid-cols-2 gap-2">
        {filtered.map((gif) => (
          <button
            key={gif.id}
            type="button"
            onClick={() => {
              onSelectGif(gif.url, gif.title);
              onClose();
            }}
            className="group relative h-24 overflow-hidden rounded-xl border border-purple-900/40 bg-[#160f2e] transition-all hover:border-purple-500 hover:scale-[1.02] cursor-pointer"
          >
            <img
              src={gif.url}
              alt={gif.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition-transform group-hover:scale-105 motion-reduce:transform-none"
              onError={(e) => {
                // Fallback gracioso
                (e.currentTarget as HTMLImageElement).src = gif.fallbackUrl;
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-1.5 opacity-90 group-hover:opacity-100">
              <span className="text-[10px] font-bold text-white truncate drop-shadow-md">
                {gif.title}
              </span>
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-2 py-6 text-center text-xs text-purple-400/60">
            Nenhum GIF encontrado para &quot;{search}&quot;.
          </div>
        )}
      </div>

      {/* Custom URL Input Accordion */}
      <div className="mt-2.5 pt-2 border-t border-purple-900/30">
        <div className="text-[10px] font-semibold text-purple-300/80 mb-1">
          Ou cole a URL direta de um GIF (HTTPS):
        </div>
        <div className="flex gap-1.5">
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://.../anime.gif"
            className="flex-1 rounded-lg border border-purple-900/40 bg-[#0A0713] px-2.5 py-1 text-xs text-white placeholder-purple-400/30 focus:border-purple-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleApplyCustomUrl}
            className="rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
        {customError && (
          <span className="text-[10px] text-rose-400 block mt-1">{customError}</span>
        )}
      </div>
    </div>
  );
};
