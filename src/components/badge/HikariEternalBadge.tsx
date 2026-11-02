import React from 'react';
import { AUTHORIZED_ADMIN_UID } from '../../types';

export interface HikariEternalBadgeProps {
  /**
   * UID ou objeto de perfil para conferência de segurança estrita.
   * Somente o UID proprietário ("TLJx2QuEv4QQYoduGqn0LDJxxRW2") tem autorização para receber o selo.
   */
  profileOrUid: { id?: string; uid?: string } | string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Validação de segurança infalível baseada exclusivamente no identificador imutável da conta proprietária.
 * Nenhuma alteração de nome, perfil, JSON, papel (role) ou payload do cliente pode ativar este selo.
 */
export function isAuthorizedOwner(
  profileOrUid: { id?: string; uid?: string } | string | null | undefined
): boolean {
  if (!profileOrUid) return false;
  const uid = typeof profileOrUid === 'string' ? profileOrUid : profileOrUid.id || profileOrUid.uid;
  return Boolean(uid && uid.trim() === AUTHORIZED_ADMIN_UID);
}

/**
 * Selo Exclusivo Hikari Eternal
 * 
 * - Símbolo abstrato de cristal/energia em puro CSS/SVG (sem personagens, sem imagens externas).
 * - Núcleo luminoso com pulsação suave.
 * - Micropartículas cósmicas e contorno com brilho discreto animado.
 * - Paleta premium: violeta, roxo imperial, prata e lavanda.
 * - Totalmente isento da palavra "Admin".
 */
export const HikariEternalBadge: React.FC<HikariEternalBadgeProps> = ({
  profileOrUid,
  size = 'md',
  className = '',
}) => {
  // Barreira de segurança mandatória: se não for o UID proprietário autorizado, nada é renderizado
  if (!isAuthorizedOwner(profileOrUid)) {
    return null;
  }

  const isSmall = size === 'sm';

  return (
    <span
      className={`group relative inline-flex items-center gap-1.5 select-none rounded-full transition-all duration-300 ${
        isSmall
          ? 'px-2 py-0.5 text-[10.5px]'
          : 'px-2.5 py-1 text-xs'
      } border border-purple-400/40 bg-gradient-to-r from-[#170E2B] via-[#21143D] to-[#160E2A] text-purple-100 font-semibold shadow-sm shadow-purple-950/70 ring-1 ring-purple-400/20 hover:border-purple-300 hover:ring-purple-300/40 hover:shadow-purple-800/40 ${className}`}
      title="Selo Exclusivo Hikari Eternal — Guardião do Ecossistema"
      aria-label="Selo Exclusivo Hikari Eternal"
      style={{
        animation: 'eternalBorderGlow 4s ease-in-out infinite',
      }}
    >
      {/* Símbolo abstrato de Cristal / Energia Cósmica (100% SVG, sem imagens externas) */}
      <span
        aria-hidden="true"
        className={`relative inline-flex items-center justify-center flex-shrink-0 ${
          isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full overflow-visible"
        >
          <defs>
            {/* Gradiente do corpo facetado superior do cristal */}
            <linearGradient id="crystalTopGrad" x1="12" y1="2" x2="12" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="40%" stopColor="#DDD6FE" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>

            {/* Gradiente do corpo facetado inferior do cristal */}
            <linearGradient id="crystalBottomGrad" x1="12" y1="12" x2="12" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="70%" stopColor="#6D28D9" />
              <stop offset="100%" stopColor="#4C1D95" />
            </linearGradient>

            {/* Gradiente da faceta lateral esquerda (reflexo prateado) */}
            <linearGradient id="crystalFacetLeft" x1="4" y1="12" x2="12" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#C4B5FD" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#6D28D9" stopOpacity="0.4" />
            </linearGradient>

            {/* Gradiente da faceta lateral direita (sombra violeta profunda) */}
            <linearGradient id="crystalFacetRight" x1="20" y1="12" x2="12" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E0E7FF" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.5" />
            </linearGradient>

            {/* Brilho radial do núcleo de energia pura */}
            <radialGradient id="crystalCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
              <stop offset="35%" stopColor="#DDD6FE" stopOpacity="0.95" />
              <stop offset="70%" stopColor="#A78BFA" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Facetas do Cristal Abstrato */}
          {/* Pirâmide / Faceta Superior */}
          <polygon
            points="12,2 18,9 12,12 6,9"
            fill="url(#crystalTopGrad)"
          />
          {/* Pirâmide / Faceta Inferior */}
          <polygon
            points="6,9 12,12 18,9 12,22"
            fill="url(#crystalBottomGrad)"
          />
          {/* Faceta de Reflexo Esquerdo */}
          <polygon
            points="12,2 6,9 12,12"
            fill="url(#crystalFacetLeft)"
          />
          {/* Faceta de Reflexo Direito */}
          <polygon
            points="12,2 18,9 12,12"
            fill="url(#crystalFacetRight)"
          />

          {/* Arestas de corte do cristal com brilho em prata */}
          <line x1="12" y1="2" x2="12" y2="22" stroke="#FFFFFF" strokeWidth="0.75" strokeOpacity="0.8" />
          <line x1="6" y1="9" x2="18" y2="9" stroke="#E0E7FF" strokeWidth="0.6" strokeOpacity="0.7" />

          {/* Núcleo luminoso pulsante de energia pura */}
          <circle
            cx="12"
            cy="11"
            r="3.5"
            fill="url(#crystalCoreGlow)"
            style={{
              animation: 'eternalCorePulse 3s ease-in-out infinite',
              transformOrigin: '12px 11px',
            }}
          />

          {/* Micropartícula superior direita */}
          <circle
            cx="21"
            cy="5"
            r="0.85"
            fill="#E0E7FF"
            style={{
              animation: 'particleTwinkle1 2.4s ease-in-out infinite',
            }}
          />

          {/* Micropartícula inferior esquerda */}
          <circle
            cx="3.5"
            cy="16"
            r="0.75"
            fill="#DDD6FE"
            style={{
              animation: 'particleTwinkle2 2.8s ease-in-out infinite',
            }}
          />
        </svg>
      </span>

      {/* Título do Selo: "Hikari Eternal" (sem a palavra Admin) */}
      <span className="font-bold tracking-tight bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 bg-clip-text text-transparent group-hover:from-white group-hover:to-purple-100 transition-colors">
        Hikari Eternal
      </span>

      {/* Símbolo sutil de ressonância */}
      <span
        aria-hidden="true"
        className="font-black text-[9px] text-purple-300/80 group-hover:text-purple-200 transition-colors tracking-tighter"
      >
        ✦
      </span>
    </span>
  );
};
