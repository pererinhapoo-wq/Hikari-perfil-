import React, { useState, useRef } from 'react';
import { Search, Sparkles, X, Check, Upload, FolderPlus, AlertCircle, Loader2 } from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState<'catalog' | 'upload'>('catalog');
  const [search, setSearch] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  /**
   * Processa o arquivo selecionado da galeria do celular ou do computador,
   * validando o cabeçalho binário real (magic bytes) para garantir que é um GIF autêntico.
   */
  const handleGifFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setIsProcessingFile(true);

    try {
      // 1. Validação de tamanho (máximo de 8MB)
      if (file.size > 8 * 1024 * 1024) {
        throw new Error('O arquivo excede o limite máximo permitido de 8MB para GIFs animados.');
      }

      // 2. Validação do conteúdo binário real do arquivo (Magic bytes)
      // Um arquivo GIF válido sempre inicia com "GIF87a" ou "GIF89a"
      const slice = file.slice(0, 6);
      const buffer = await slice.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const header = String.fromCharCode(...bytes);

      if (header !== 'GIF87a' && header !== 'GIF89a') {
        throw new Error('Arquivo inválido: o conteúdo real não corresponde à assinatura binária de um GIF (esperado GIF87a ou GIF89a).');
      }

      // 3. Conversão para Data URL com MIME image/gif
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const cleanName = file.name.replace(/\.gif$/i, '') || 'GIF da Galeria';
          onSelectGif(reader.result, cleanName);
          setIsProcessingFile(false);
          onClose();
        }
      };
      reader.onerror = () => {
        setFileError('Erro ao ler arquivo da galeria.');
        setIsProcessingFile(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Falha ao processar o GIF.');
      setIsProcessingFile(false);
    } finally {
      // Reseta o input para permitir selecionar o mesmo arquivo novamente
      e.target.value = '';
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Selecionar GIF animado"
      className="absolute bottom-full right-0 mb-3 z-50 w-80 sm:w-96 rounded-2xl border border-purple-800/40 bg-[#120B24] p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Hidden file input for mobile gallery or computer files */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/gif"
        className="hidden"
        onChange={handleGifFileSelected}
      />

      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-purple-900/30">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            GIFs Animados
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

      {/* Tab Switcher: Reações / Galeria & Arquivos */}
      <div className="flex items-center gap-1 bg-[#0A0713] p-1 rounded-xl border border-purple-900/40 mt-2">
        <button
          type="button"
          onClick={() => setActiveTab('catalog')}
          className={`flex-1 text-center py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'catalog'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-purple-300/70 hover:text-white hover:bg-purple-950/40'
          }`}
        >
          Reações de Anime
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex-1 text-center py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'upload'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-purple-300/70 hover:text-white hover:bg-purple-950/40'
          }`}
        >
          Galeria / Arquivo
        </button>
      </div>

      {activeTab === 'catalog' ? (
        <>
          {/* Search Input */}
          <div className="relative mt-2.5">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-purple-400/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar reações (ex: Anya, Frieren, Hype)..."
              className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Grid of Curated GIFs */}
          <div className="mt-2.5 max-h-52 overflow-y-auto pr-1 grid grid-cols-2 gap-2">
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
        </>
      ) : (
        /* UPLOAD TAB: Direct Gallery or Computer Selection */
        <div className="mt-3 space-y-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="group flex flex-col items-center justify-center p-6 border-2 border-dashed border-purple-800/50 hover:border-purple-500 rounded-2xl bg-[#0e081c] hover:bg-[#150d2c] transition-all cursor-pointer text-center space-y-2"
          >
            {isProcessingFile ? (
              <Loader2 className="h-8 w-8 text-purple-400 animate-spin" />
            ) : (
              <div className="h-10 w-10 rounded-xl bg-purple-950/60 border border-purple-700/40 flex items-center justify-center text-purple-300 group-hover:scale-105 transition-transform">
                <FolderPlus className="h-5 w-5" />
              </div>
            )}

            <div>
              <span className="text-xs font-bold text-white block">
                {isProcessingFile ? 'Verificando assinatura binária...' : 'Selecionar GIF do celular ou computador'}
              </span>
              <span className="text-[11px] text-purple-300/60 mt-0.5 block">
                Toque para abrir a galeria ou arquivos (GIF animado até 8MB)
              </span>
            </div>

            <button
              type="button"
              disabled={isProcessingFile}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Navegar nos arquivos</span>
            </button>
          </div>

          <div className="rounded-xl bg-[#0A0713] border border-purple-900/40 p-2.5 text-[11px] text-purple-300/70 leading-relaxed">
            <p>
              🔒 <strong>Validação segura:</strong> O Hikari inspeciona a assinatura binária real do GIF (GIF87a / GIF89a) para proteger a integridade da conversa.
            </p>
          </div>

          {fileError && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{fileError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
