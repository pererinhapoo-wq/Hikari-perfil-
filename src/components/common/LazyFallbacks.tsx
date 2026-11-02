import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

/**
 * Discreet inline fallback rendered strictly inside the active tab container
 * so Header, ProfileHeader, and TabsNavigation remain interactive while a secondary tab chunk loads.
 */
export const TabSectionFallback: React.FC<{ label?: string }> = ({
  label = 'Carregando seção...',
}) => (
  <div
    role="status"
    aria-live="polite"
    className="rounded-2xl border border-purple-900/30 bg-[#130E24]/70 px-6 py-12 flex flex-col items-center justify-center gap-3 text-purple-200/80"
  >
    <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
    <span className="text-xs font-medium tracking-wide">{label}</span>
  </div>
);

/**
 * Lightweight, non-blocking floating pill shown briefly on first download of a lazy modal chunk.
 * Does not lock document scroll or block the entire screen.
 */
export const ModalLoadingFallback: React.FC<{ label?: string }> = ({
  label = 'Carregando...',
}) => {
  const pill = (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-20 z-50 flex justify-center pointer-events-none px-4"
    >
      <div className="inline-flex items-center gap-2.5 rounded-xl border border-purple-500/30 bg-[#130E24]/95 px-4 py-2.5 text-xs font-semibold text-purple-100 shadow-xl shadow-purple-950/70 backdrop-blur-md">
        <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
        <span>{label}</span>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(pill, document.body);
  }
  return pill;
};

/**
 * Clean full-page route fallback used only when a standalone route (/admin or AuthScreen) loads its chunk.
 */
export const FullPageRouteFallback: React.FC<{ label?: string }> = ({
  label = 'Carregando...',
}) => (
  <div
    role="status"
    aria-live="polite"
    className="min-h-screen bg-[#0A0713] text-[#EDE8F5] flex flex-col items-center justify-center gap-3 px-4"
  >
    <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
    <span className="text-xs sm:text-sm font-medium text-purple-200">{label}</span>
  </div>
);
