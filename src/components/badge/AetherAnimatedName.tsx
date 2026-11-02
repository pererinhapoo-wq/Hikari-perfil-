import React from 'react';
import { isAuthorizedOwner } from './HikariEternalBadge';

export interface AetherAnimatedNameProps {
  /** Nome a ser exibido */
  name: string;
  /** Identificador ou objeto de perfil para conferência de segurança estrita */
  profileOrUid?: { id?: string; uid?: string } | string | null;
  /** Classes CSS adicionais */
  className?: string;
  /** Se deve forçar o estilo mesmo sem passar o perfil (apenas se já checado) */
  forceActive?: boolean;
}

/**
 * Componente Tipográfico Exclusivo para o Proprietário "Aether"
 * 
 * - Gradiente em violeta, lavanda e prata acetinada.
 * - Reflexo luminoso percorrido periodicamente pelas letras de forma suave e elegante.
 * - Animação contínua e discreta, sem movimentos bruscos ou distorções.
 * - Intensidade atenuada em dispositivos móveis e estática com "prefers-reduced-motion".
 * - Se o perfil não for a conta autorizada, renderiza tipografia padrão.
 */
export const AetherAnimatedName: React.FC<AetherAnimatedNameProps> = ({
  name,
  profileOrUid,
  className = '',
  forceActive = false,
}) => {
  const isOwner = forceActive || isAuthorizedOwner(profileOrUid);

  if (!isOwner) {
    return <span className={className}>{name}</span>;
  }

  return (
    <span
      className={`relative inline-block font-extrabold tracking-tight ${className}`}
      data-identity="aether-eternal"
    >
      <span className="aether-text-shimmer drop-shadow-[0_2px_12px_rgba(139,92,246,0.35)] select-none">
        {name}
      </span>
    </span>
  );
};
