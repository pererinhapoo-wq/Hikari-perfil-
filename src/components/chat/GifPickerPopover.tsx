import React, { useState, useRef } from 'react';
import { X, Check, Upload, FolderPlus, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';

export interface CuratedAnimeGif {
  id: string;
  category: string;
  title: string;
  url: string;
}

// Catálogo curado de GIFs de anime (removido conforme solicitado)
export const CURATED_ANIME_GIFS: CuratedAnimeGif[] = [];

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
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

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

      {/* UPLOAD & GALLERY: Photos and GIFs unified */}
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
    </div>
  );
};
