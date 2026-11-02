import React from 'react';
import { ShieldAlert, ArrowLeft, LogIn } from 'lucide-react';

export interface AdminAccessDeniedProps {
  onReturnToApp: () => void;
  onOpenAuth?: () => void;
  isAuthenticated?: boolean;
}

export const AdminAccessDenied: React.FC<AdminAccessDeniedProps> = ({
  onReturnToApp,
  onOpenAuth,
  isAuthenticated = false,
}) => {
  return (
    <div className="min-h-screen bg-[#0A0713] text-[#EDE8F5] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-purple-900/40 bg-[#120B22] p-6 sm:p-8 shadow-2xl shadow-black/80 text-center relative overflow-hidden">
        {/* Glow de fundo */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Ícone de bloqueio seguro */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-950/40 text-rose-400 shadow-inner mb-4">
          <ShieldAlert className="h-7 w-7" />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
          Acesso Restrito
        </h1>

        <p className="text-sm text-purple-200/70 mb-6 leading-relaxed">
          O painel de administração é de uso exclusivo da conta proprietária autorizada. Nenhuma informação, métrica ou dado confidencial é exposto a acessos não autorizados.
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onReturnToApp}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium py-2.5 px-4 transition-colors cursor-pointer shadow-md shadow-purple-950/60"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Voltar ao Hikari Perfil</span>
          </button>

          {!isAuthenticated && onOpenAuth && (
            <button
              type="button"
              onClick={onOpenAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-800/40 bg-purple-950/30 hover:bg-purple-900/40 text-purple-300 font-medium py-2.5 px-4 transition-colors cursor-pointer text-sm"
            >
              <LogIn className="h-4 w-4" />
              <span>Entrar como Proprietário</span>
            </button>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-purple-900/30 text-[11px] text-purple-400/50">
          Hikari Perfil — Sistema de Proteção Ativa
        </div>
      </div>
    </div>
  );
};
