import React from 'react';
import { 
  Calendar, 
  Lock, 
  Globe, 
  User
} from 'lucide-react';
import { UserProfile } from '../../types';

interface AboutTabProps {
  profile: UserProfile;
}

export const AboutTab: React.FC<AboutTabProps> = ({ profile }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Main Bio Card */}
      <div className="md:col-span-2 space-y-6">
        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-5 sm:p-6 shadow-xl">
          <div className="flex items-center gap-2 border-b border-purple-900/30 pb-3">
            <User className="h-4 w-4 text-purple-400" />
            <h3 className="font-bold text-base text-white">Biografia do Usuário</h3>
          </div>
          <div className="mt-4 text-sm leading-relaxed text-purple-100/90 whitespace-pre-line">
            {profile.bio || 'Este usuário ainda não redigiu uma biografia personalizada.'}
          </div>
        </div>
      </div>

      {/* Account Facts & Privacy Card (Strictly account facts & visibility) */}
      <div className="space-y-6">
        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-5 shadow-xl space-y-4">
          <h4 className="font-bold text-sm text-white border-b border-purple-900/30 pb-2.5">
            Informações da Conta
          </h4>

          {/* Creation Date - Real and Protected */}
          <div className="flex items-start gap-3">
            <Calendar className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[11px] text-purple-300/60 block">Data de Criação</span>
              <span className="text-xs font-semibold text-white">{profile.createdAt}</span>
              <span className="text-[10px] text-purple-400/50 block mt-0.5">Registro imutável no sistema</span>
            </div>
          </div>

          {/* Privacy Status (Visibility) */}
          <div className="flex items-start gap-3">
            {profile.isPrivate ? (
              <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <Globe className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div>
              <span className="text-[11px] text-purple-300/60 block">Visibilidade</span>
              <span className="text-xs font-semibold text-white">
                {profile.isPrivate ? 'Perfil Privado (Requer Aprovação)' : 'Perfil Público'}
              </span>
            </div>
          </div>

          {/* External Connected Accounts */}
          {(profile.externalAccounts?.mal?.connected || profile.externalAccounts?.anilist?.connected) && (
            <div className="border-t border-purple-900/30 pt-3 space-y-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-400 block">
                Contas Externas Vinculadas
              </span>

              {profile.externalAccounts.mal.connected && (
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-[#2E51A2]/30 text-[#6d94e8] text-[9px] font-bold shrink-0 mt-0.5 border border-[#2E51A2]/40">
                    MAL
                  </div>
                  <div>
                    <span className="text-[11px] text-purple-300/60 block">MyAnimeList (@{profile.externalAccounts.mal.username})</span>
                    <span className="text-xs font-semibold text-white">
                      Criação da conta: {profile.externalAccounts.mal.accountCreatedAt || 'Informação indisponível'}
                    </span>
                  </div>
                </div>
              )}

              {profile.externalAccounts.anilist.connected && (
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-[#02A9FF]/20 text-[#02A9FF] text-[9px] font-bold shrink-0 mt-0.5 border border-[#02A9FF]/30">
                    AL
                  </div>
                  <div>
                    <span className="text-[11px] text-purple-300/60 block">AniList (@{profile.externalAccounts.anilist.username})</span>
                    <span className="text-xs font-semibold text-purple-300/80">
                      Criação da conta: Não disponibilizada pela plataforma
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
