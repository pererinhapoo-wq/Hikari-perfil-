import React from 'react';
import { ExternalLink, Star, Film, Sparkles } from 'lucide-react';
import type { HikariLinkPreview } from '../../types';

interface HikariCardPreviewProps {
  preview: HikariLinkPreview;
  onSelectAnime?: (animeTitle: string) => void;
}

export const HikariCardPreview: React.FC<HikariCardPreviewProps> = ({
  preview,
  onSelectAnime,
}) => {
  const isHikariAnime = preview.type === 'anime';

  return (
    <div
      className="mt-2 w-full max-w-sm overflow-hidden rounded-xl border border-purple-800/40 bg-[#0e0a1e]/90 shadow-lg shadow-black/40 transition-all hover:border-purple-600/60 group"
    >
      <div className="flex items-start gap-3 p-3">
        {/* Poster / Thumbnail */}
        {preview.imageUrl ? (
          <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg border border-purple-900/50 bg-[#160f2e]">
            <img
              src={preview.imageUrl}
              alt={preview.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
            />
            {preview.extraInfo?.rating && (
              <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/80 px-1 py-0.5 text-[9px] font-bold text-amber-300 backdrop-blur-xs">
                <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                <span>{preview.extraInfo.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg border border-purple-900/50 bg-purple-950/40 text-purple-400">
            <Film className="h-6 w-6" />
          </div>
        )}

        {/* Content & Metadata */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded bg-purple-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300 border border-purple-700/40">
              <Sparkles className="h-2.5 w-2.5 text-purple-400" />
              {isHikariAnime ? 'Anime Hikari' : 'Hikari Link'}
            </span>
            {preview.badge && (
              <span className="text-[10px] text-purple-300/80 font-medium truncate">
                {preview.badge}
              </span>
            )}
          </div>

          <h4 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate group-hover:text-purple-200 transition-colors">
            {preview.title}
          </h4>

          {preview.description && (
            <p className="text-[11px] text-purple-300/70 line-clamp-2 leading-tight">
              {preview.description}
            </p>
          )}

          {preview.extraInfo?.genres && preview.extraInfo.genres.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {preview.extraInfo.genres.slice(0, 2).map((g) => (
                <span
                  key={g}
                  className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-[#1a1236] text-purple-300/90 border border-purple-900/30"
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action footer */}
      <div className="flex items-center justify-between border-t border-purple-900/30 bg-[#080511]/80 px-3 py-1.5 text-[11px] text-purple-300">
        <span className="truncate text-purple-400 font-mono text-[10px]">
          {preview.url.replace(/^https?:\/\//i, '').slice(0, 32)}
        </span>

        {isHikariAnime && onSelectAnime ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectAnime(preview.title);
            }}
            className="inline-flex items-center gap-1 font-semibold text-purple-300 hover:text-white transition-colors cursor-pointer"
          >
            <span>Ver no perfil</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-semibold text-purple-300 hover:text-white transition-colors cursor-pointer"
          >
            <span>Acessar</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
};
