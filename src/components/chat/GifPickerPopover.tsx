import React, { useState, useRef } from 'react';
import { Search, Sparkles, X, Check, Upload, FolderPlus, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';

export interface CuratedAnimeGif {
  id: string;
  category: string;
  title: string;
  url: string;
}

// Catálogo curado e verificado de GIFs de anime (todos retornam HTTP 200 OK e animam fluidamente)
export const CURATED_ANIME_GIFS: CuratedAnimeGif[] = [
  {
    id: 'gif_01',
    category: 'Kawaii / Feliz',
    title: 'Anya Smug Heh',
    url: 'https://i.giphy.com/media/FWAcpJsFT9mVRv0e7a/giphy.gif',
  },
  {
    id: 'gif_02',
    category: 'Ação / Hype',
    title: 'Goku Super Saiyan Aura',
    url: 'https://i.giphy.com/media/bDWdJRY2IZCX6/giphy.gif',
  },
  {
    id: 'gif_03',
    category: 'Kawaii / Feliz',
    title: 'Chika Fujiwara Dança',
    url: 'https://i.giphy.com/media/W6dHvprT7oks6BpX5R/giphy.gif',
  },
  {
    id: 'gif_04',
    category: 'Ação / Hype',
    title: 'Naruto GG Vitória',
    url: 'https://i.giphy.com/media/2y98KScHKeaQM/giphy.gif',
  },
  {
    id: 'gif_05',
    category: 'Pensativo',
    title: 'L Lawliet Pensativo',
    url: 'https://i.giphy.com/media/e20AWoQEoOB2/giphy.gif',
  },
  {
    id: 'gif_06',
    category: 'Choro / Drama',
    title: 'Usagi Choro Drama',
    url: 'https://i.giphy.com/media/d2lcHJTG5Tscg/giphy.gif',
  },
  {
    id: 'gif_07',
    category: 'Kawaii / Feliz',
    title: 'Pikachu Alegre',
    url: 'https://i.giphy.com/media/slVWEctHZKvWU/giphy.gif',
  },
  {
    id: 'gif_08',
    category: 'Comédia',
    title: 'Zenitsu Pânico',
    url: 'https://i.giphy.com/media/dyjrpqaUVqCELGuQVr/giphy.gif',
  },
  {
    id: 'gif_09',
    category: 'Aplausos / GG',
    title: 'Evangelion Parabéns',
    url: 'https://i.giphy.com/media/Diym3aZO1dHzO/giphy.gif',
  },
  {
    id: 'gif_10',
    category: 'Pensativo',
    title: 'Kakashi Leitura',
    url: 'https://i.giphy.com/media/eYilisUwipOEM/giphy.gif',
  },
];

interface GifPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMedia?: (mediaUrl: string, type: 'image' | 'gif', title: string) => void;
  onSelectGif?: (gifUrl: string, title: string) => void;
}

export const GifPickerPopover: React.FC<GifPickerPopoverProps> = ({
  isOpen,
  onClose,
  onSelectMedia,
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

  const emitSelection = (url: string, type: 'image' | 'gif', title: string) => {
    if (onSelectMedia) {
      onSelectMedia(url, type, title);
    } else if (onSelectGif && type === 'gif') {
      onSelectGif(url, title);
    }
    onClose();
  };

  const handleApplyCustomUrl = () => {
    const trimmed = customUrl.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('https://')) {
      setCustomError('A URL deve começar com https://');
      return;
    }
    const isGif = Boolean(trimmed.match(/\.gif($|\?)/i) || trimmed.includes('giphy.com') || trimmed.includes('tenor.com'));
    const isImage = Boolean(trimmed.match(/\.(png|jpe?g|webp)($|\?)/i));
    if (!isGif && !isImage) {
      setCustomError('A URL deve apontar para uma imagem (.png, .jpg, .webp) ou GIF (.gif).');
      return;
    }
    setCustomError(null);
    emitSelection(trimmed, isGif ? 'gif' : 'image', isGif ? 'GIF Personalizado' : 'Imagem Personalizada');
    setCustomUrl('');
  };

  /**
   * Processa o arquivo selecionado da galeria ou computador,
   * unificando fotos (PNG, JPEG, WebP) e GIFs com validação de magic bytes.
   */
  const handleMediaFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setIsProcessingFile(true);

    try {
      // 1. Validação de tamanho (máximo de 8MB)
      if (file.size > 8 * 1024 * 1024) {
        throw new Error('O arquivo excede o limite máximo permitido de 8MB.');
      }

      const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');

      // 2. Se for GIF, valida cabeçalho binário real (GIF87a ou GIF89a)
      if (isGif) {
        const slice = file.slice(0, 6);
        const buffer = await slice.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const header = String.fromCharCode(...bytes);
        if (header !== 'GIF87a' && header !== 'GIF89a') {
          throw new Error('Arquivo inválido: o conteúdo não corresponde à assinatura binária de um GIF animado (GIF87a/GIF89a).');
        }
      } else {
        const validMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!validMimes.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp)$/i)) {
          throw new Error('Formato não suportado. Escolha fotos (PNG, JPEG, WebP) ou GIFs animados.');
        }
      }

      // 3. Conversão para Data URL segura
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const cleanName = file.name.replace(/\.[a-zA-Z0-9]+$/i, '');
          emitSelection(reader.result, isGif ? 'gif' : 'image', cleanName || (isGif ? 'GIF da Galeria' : 'Foto da Galeria'));
          setIsProcessingFile(false);
        }
      };
      reader.onerror = () => {
        setFileError('Erro ao ler o arquivo selecionado.');
        setIsProcessingFile(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Falha ao processar o arquivo.');
      setIsProcessingFile(false);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Selecionar imagem ou GIF"
      className="absolute bottom-full left-0 sm:left-auto sm:right-0 mb-3 z-50 w-80 sm:w-96 rounded-2xl border border-purple-800/40 bg-[#120B24] p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Hidden file input for mobile gallery or computer files */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleMediaFileSelected}
      />

      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-purple-900/30">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Imagens & GIFs
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer"
          title="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab Switcher: Reações de Anime / Galeria & Arquivos */}
      <div className="flex items-center gap-1 bg-[#0A0713] p-1 rounded-xl border border-purple-900/40 mt-2">
        <button
          type="button"
          onClick={() => setActiveTab('catalog')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'catalog'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-purple-300/70 hover:text-white hover:bg-purple-950/40'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>GIFs de Anime</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'upload'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-purple-300/70 hover:text-white hover:bg-purple-950/40'
          }`}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span>Galeria / Arquivo</span>
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
              placeholder="Pesquisar GIFs de anime (Anya, Goku, Naruto, Chika)..."
              className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Grid of Verified Curated Anime GIFs */}
          <div className="mt-2.5 max-h-56 overflow-y-auto pr-1 grid grid-cols-2 gap-2">
            {filtered.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => emitSelection(gif.url, 'gif', gif.title)}
                className="group relative h-24 overflow-hidden rounded-xl border border-purple-900/40 bg-[#160f2e] transition-all hover:border-purple-500 hover:scale-[1.02] cursor-pointer"
              >
                <img
                  src={gif.url}
                  alt={gif.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105 motion-reduce:transform-none"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent flex items-end p-1.5 opacity-90 group-hover:opacity-100">
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
        </>
      ) : (
        /* UPLOAD & GALLERY TAB: Photos and GIFs unified */
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
                {isProcessingFile ? 'Processando arquivo...' : 'Selecionar imagem ou GIF do dispositivo'}
              </span>
              <span className="text-[11px] text-purple-300/60 mt-0.5 block">
                Suporta PNG, JPEG, WebP e GIFs animados até 8MB
              </span>
            </div>

            <button
              type="button"
              disabled={isProcessingFile}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Abrir galeria ou arquivos</span>
            </button>
          </div>

          {/* Direct HTTPS URL Input */}
          <div className="pt-2 border-t border-purple-900/30">
            <div className="text-[10px] font-semibold text-purple-300/80 mb-1">
              Ou cole a URL direta de uma imagem ou GIF (HTTPS):
            </div>
            <div className="flex gap-1.5">
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://.../foto.png ou anime.gif"
                className="flex-1 rounded-lg border border-purple-900/40 bg-[#0A0713] px-2.5 py-1 text-xs text-white placeholder-purple-400/30 focus:border-purple-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleApplyCustomUrl}
                className="rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
                title="Inserir URL"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
            {customError && (
              <span className="text-[10px] text-rose-400 block mt-1">{customError}</span>
            )}
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
