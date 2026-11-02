import React from 'react';
import { AUTHORIZED_ADMIN_UID } from '../../types';

export interface ElizabethAdminBadgeProps {
  /**
   * UID ou objeto de perfil para conferência de segurança estrita.
   * Somente o UID proprietário ("TLJx2QuEv4QQYoduGqn0LDJxxRW2") tem autorização para exibir o selo.
   */
  profileOrUid: { id?: string; uid?: string } | string | null | undefined;
  size?: 'sm' | 'md';
}

/**
 * Validação de segurança pura baseada no identificador imutável da conta proprietária.
 * Nenhum dado editável pelo usuário (como displayName, bio ou custom roles) pode ativar este selo.
 */
export function isProfileAdmin(
  profileOrUid: { id?: string; uid?: string } | string | null | undefined
): boolean {
  if (!profileOrUid) return false;
  const uid = typeof profileOrUid === 'string' ? profileOrUid : profileOrUid.id || profileOrUid.uid;
  return Boolean(uid && uid.trim() === AUTHORIZED_ADMIN_UID);
}

export const ElizabethAdminBadge: React.FC<ElizabethAdminBadgeProps> = ({
  profileOrUid,
  size = 'md',
}) => {
  // Barreira de segurança: impede renderização para qualquer outro usuário
  if (!isProfileAdmin(profileOrUid)) {
    return null;
  }

  const isSmall = size === 'sm';

  return (
    <span
      className={`group relative inline-flex items-center gap-1.5 select-none rounded-md transition-all duration-200 ${
        isSmall
          ? 'px-2 py-0.5 text-[10px]'
          : 'px-2.5 py-1 text-xs'
      } border border-amber-600/50 bg-gradient-to-r from-[#1E142E] via-[#241738] to-[#1C122C] text-amber-200 font-semibold shadow-sm shadow-purple-950/60 ring-1 ring-amber-500/20 hover:border-amber-500 hover:ring-amber-400/30 hover:shadow-purple-900/40`}
      title="Conta Proprietária e Administradora Oficial do Hikari Perfil (Elizabeth)"
      aria-label="Selo Oficial de Administradora Hikari — Elizabeth"
    >
      {/* Miniatura estilizada da Placa de Madeira da Elizabeth (Gintama) */}
      <span
        aria-hidden="true"
        className="relative inline-flex items-center justify-center flex-shrink-0"
      >
        {/* Retângulo da placa */}
        <span className="block h-3.5 w-4 rounded-[1.5px] border border-amber-500/80 bg-amber-100/90 shadow-2xs">
          {/* Duas linhas simulando a escrita caligráfica da placa */}
          <span className="absolute inset-0 flex flex-col justify-center items-center gap-[1.5px] px-[2px]">
            <span className="h-[1px] w-2.5 bg-neutral-900 rounded-full" />
            <span className="h-[1px] w-2 bg-neutral-800 rounded-full" />
          </span>
        </span>
        {/* Cabo da placa */}
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-[1.5px] bg-amber-700 rounded-b-xs" />
      </span>

      {/* Identificação Oficial Elegante */}
      <span className="font-bold tracking-tight text-amber-200/95 group-hover:text-amber-100 transition-colors">
        Hikari Admin
      </span>

      {/* Detalhe sutil de caligrafia / selo japonês oficial */}
      <span
        aria-hidden="true"
        className="font-black text-[9px] text-purple-400/80 group-hover:text-purple-300 transition-colors ml-0.5 tracking-tighter"
      >
        ✦
      </span>
    </span>
  );
};
