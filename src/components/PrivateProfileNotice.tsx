import React from 'react';
import { Lock, UserPlus, Clock, Check } from 'lucide-react';
import { UserProfile } from '../types';

interface PrivateProfileNoticeProps {
  profile: UserProfile;
  isRequested: boolean;
  onRequestFollow: () => void;
}

export const PrivateProfileNotice: React.FC<PrivateProfileNoticeProps> = ({
  profile,
  isRequested,
  onRequestFollow
}) => {
  return (
    <div className="rounded-2xl border border-purple-900/40 bg-[#130E24]/90 p-8 sm:p-12 text-center shadow-2xl backdrop-blur-md max-w-xl mx-auto my-6">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-950/80 border border-purple-700/40 text-purple-400 shadow-inner">
        <Lock className="h-8 w-8" />
      </div>

      <h3 className="mt-4 text-xl font-bold text-white">Este Perfil é Privado</h3>
      
      <p className="mt-2 text-sm text-purple-200/80 leading-relaxed">
        As listas de animes, histórico de comentários no Hikari e atividades de{' '}
        <strong className="text-white">{profile.displayName}</strong> estão protegidas. 
        Envie uma solicitação para seguir para ter acesso ao conteúdo quando for aprovado.
      </p>

      <div className="mt-6 flex justify-center">
        <button
          onClick={onRequestFollow}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all shadow-lg ${
            isRequested
              ? 'bg-amber-950/60 text-amber-200 border border-amber-600/50 hover:bg-amber-900/60'
              : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/50 border border-purple-400/40'
          }`}
        >
          {isRequested ? (
            <>
              <Clock className="h-4 w-4 text-amber-300" />
              <span>Solicitação Enviada (Aguardando Aprovação)</span>
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" />
              <span>Enviar Solicitação para Seguir</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-6 text-[11px] text-purple-400/50">
        Apenas seguidores aprovados têm acesso às abas de animes e atividades deste perfil.
      </div>
    </div>
  );
};
