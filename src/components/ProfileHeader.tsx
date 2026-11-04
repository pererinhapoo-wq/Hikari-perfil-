import React, { useRef } from 'react';
import { 
  Camera, 
  Trash2, 
  Lock, 
  UserCheck, 
  UserPlus, 
  Clock, 
  Settings, 
  ShieldAlert,
  UserX,
  Loader2,
  MessageSquare
} from 'lucide-react';
import { UserProfile } from '../types';
import { HikariEternalBadge } from './badge/HikariEternalBadge';
import { AetherAnimatedName } from './badge/AetherAnimatedName';

interface ProfileHeaderProps {
  profile: UserProfile;
  isOwnProfile: boolean;
  isFollowing: boolean;
  isRequested: boolean;
  isBlocked: boolean;
  isFollowPending?: boolean;
  canDirectMessage?: boolean;
  directMessageDisabledReason?: string;
  onFollowToggle: () => void;
  onBlockToggle: () => void;
  onOpenDirectMessage?: () => void;
  onOpenSettings: (tab?: 'profile' | 'privacy' | 'connected' | 'security') => void;
  onOpenFollowers: (tab: 'followers' | 'following') => void;
  onUpdateAvatar: (url: string) => void;
  onUpdateBanner: (url: string) => void;
  onRemoveAvatar: () => void;
  onRemoveBanner: () => void;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  profile,
  isOwnProfile,
  isFollowing,
  isRequested,
  isBlocked,
  isFollowPending = false,
  canDirectMessage = true,
  directMessageDisabledReason,
  onFollowToggle,
  onBlockToggle,
  onOpenDirectMessage,
  onOpenSettings,
  onOpenFollowers,
  onUpdateAvatar,
  onUpdateBanner,
  onRemoveAvatar,
  onRemoveBanner
}) => {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onUpdateAvatar(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onUpdateBanner(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-purple-900/30 bg-[#130E24] shadow-2xl">
      {/* Hidden File Inputs for Device Image Upload */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarChange}
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBannerChange}
      />

      {/* Banner Area */}
      <div className="relative h-48 w-full sm:h-64 md:h-80 bg-gradient-to-br from-purple-950 via-[#18112e] to-[#0A0713]">
        {(isOwnProfile || !profile.isPrivate) && profile.bannerUrl ? (
          <img
            src={profile.bannerUrl}
            alt="Banner do perfil"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-r from-purple-950/70 via-indigo-950/50 to-[#130E24]" />
        )}

        {/* Gradient overlay for text contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#130E24] via-[#130E24]/30 to-transparent" />


      </div>

      {/* Profile Details Bar */}
      <div className="relative px-4 pb-6 sm:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 -mt-16 sm:-mt-20">
          {/* Avatar and Main Identity */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Avatar Container */}
            <div className="relative group shrink-0">
              <div 
                className={`h-28 w-28 sm:h-36 sm:w-36 rounded-2xl overflow-hidden border-4 border-[#130E24] bg-[#1a1333] shadow-xl shadow-black/80 ring-2 ring-purple-600/40 ${isOwnProfile ? 'cursor-pointer' : ''}`}
                onClick={isOwnProfile ? () => onOpenSettings('profile') : undefined}
                title={isOwnProfile ? 'Editar foto e informações do perfil' : profile.displayName}
              >
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-800 to-indigo-900 text-2xl font-bold text-white">
                    {profile.displayName.charAt(0)}
                  </div>
                )}
              </div>

              {/* Avatar Controls for Owner (Desktop Hover) */}
              {isOwnProfile && (
                <div className="hidden sm:flex absolute inset-0 items-center justify-center gap-2 rounded-2xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      avatarInputRef.current?.click();
                    }}
                    className="rounded-full bg-purple-600 p-2 text-white shadow-lg hover:bg-purple-500 transition-colors cursor-pointer"
                    title="Trocar foto de perfil"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                  {profile.avatarUrl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAvatar();
                      }}
                      className="rounded-full bg-rose-600 p-2 text-white shadow-lg hover:bg-rose-500 transition-colors cursor-pointer"
                      title="Remover foto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}


            </div>

            {/* Display Name, Username & Privacy Status */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  <AetherAnimatedName name={profile.displayName} profileOrUid={profile} />
                </h1>
                
                {/* Selo Exclusivo Hikari Eternal — renderizado estritamente para o UID proprietário */}
                <HikariEternalBadge profileOrUid={profile} />

                {/* Privacy Badge (exibido apenas quando o perfil for privado) */}
                {profile.isPrivate && (
                  <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border border-amber-700/40 bg-amber-950/40 text-amber-300">
                    <Lock className="h-3 w-3" />
                    Perfil Privado
                  </span>
                )}
              </div>
              <div className="text-sm font-medium text-purple-400">
                @{profile.username}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2 sm:pt-0">
            {isOwnProfile ? (
              <button
                type="button"
                onClick={() => onOpenSettings('profile')}
                className="group inline-flex items-center gap-2 rounded-xl border border-purple-500/40 bg-purple-950/70 hover:bg-purple-900/80 hover:border-purple-400 text-purple-100 hover:text-white px-4 py-2 text-xs sm:text-sm font-semibold transition-all duration-150 shadow-md shadow-purple-950/60 backdrop-blur-md active:scale-95 cursor-pointer"
                title="Editar informações do perfil"
              >
                <Settings className="h-4 w-4 text-purple-300 group-hover:rotate-45 transition-transform duration-300 motion-reduce:transform-none" />
                <span>Editar Perfil</span>
              </button>
            ) : (
              <>
                {/* Follow / Request to Follow button */}
                <button
                  type="button"
                  onClick={onFollowToggle}
                  disabled={isBlocked || isFollowPending}
                  className={`group flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all shadow-md active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${
                    isBlocked
                      ? 'bg-neutral-800 text-neutral-400 cursor-not-allowed'
                      : isFollowing
                      ? 'bg-[#1e1638] text-rose-200 border border-rose-500/40 hover:bg-rose-950/70 hover:text-white hover:border-rose-400/60 shadow-rose-950/40'
                      : isRequested
                      ? 'bg-amber-950/50 text-amber-200 border border-amber-600/50 hover:bg-rose-950/50 hover:text-rose-200 hover:border-rose-500/50'
                      : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/50 border border-purple-400/40'
                  }`}
                  title={
                    isBlocked
                      ? 'Usuário bloqueado'
                      : isFollowing
                      ? 'Deixar de seguir'
                      : isRequested
                      ? 'Cancelar solicitação'
                      : profile.isPrivate
                      ? 'Solicitar para Seguir'
                      : 'Seguir'
                  }
                >
                  {isFollowPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
                      <span>{isFollowing ? 'Removendo...' : 'Seguindo...'}</span>
                    </>
                  ) : isFollowing ? (
                    <>
                      <UserX className="h-4 w-4 text-rose-300" />
                      <span>Deixar de seguir</span>
                    </>
                  ) : isRequested ? (
                    <>
                      <Clock className="h-4 w-4 text-amber-300 group-hover:hidden" />
                      <UserX className="h-4 w-4 text-rose-300 hidden group-hover:inline" />
                      <span className="group-hover:hidden">Solicitado</span>
                      <span className="hidden group-hover:inline">Cancelar solicitação</span>
                    </>
                  ) : profile.isPrivate ? (
                    <>
                      <Lock className="h-4 w-4" />
                      <span>Solicitar para Seguir</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      <span>Seguir</span>
                    </>
                  )}
                </button>

                {/* Direct Message button respecting recipient privacy */}
                <button
                  type="button"
                  onClick={onOpenDirectMessage}
                  disabled={isBlocked || canDirectMessage === false}
                  className={`group flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold border transition-all cursor-pointer shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
                    canDirectMessage === false || isBlocked
                      ? 'bg-[#150f26] border-purple-950/60 text-purple-400/50'
                      : 'bg-[#1e153b] border-purple-500/40 text-purple-200 hover:bg-purple-900/80 hover:text-white hover:border-purple-400'
                  }`}
                  title={
                    isBlocked
                      ? 'Usuário bloqueado'
                      : directMessageDisabledReason || 'Enviar mensagem privada'
                  }
                >
                  <MessageSquare className="h-4 w-4 text-purple-300 group-hover:scale-110 transition-transform" />
                  <span>Mensagem</span>
                </button>

                {/* Block / Unblock toggle */}
                <button
                  onClick={onBlockToggle}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition-colors ${
                    isBlocked
                      ? 'bg-rose-900/60 border-rose-500 text-rose-100 hover:bg-rose-800'
                      : 'bg-[#18112c] border-purple-900/50 text-purple-300 hover:text-rose-300 hover:border-rose-800/60'
                  }`}
                  title={isBlocked ? 'Desbloquear usuário' : 'Bloquear usuário'}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>{isBlocked ? 'Bloqueado' : 'Bloquear'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Bio and Metrics Section */}
        <div className="mt-4 space-y-3">
          {/* Bio text */}
          {(isOwnProfile || !profile.isPrivate) && profile.bio && (
            <p className="max-w-3xl text-sm leading-relaxed text-purple-200/90 whitespace-pre-line">
              {profile.bio}
            </p>
          )}

          {/* Followers & Following Redesigned Badges */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={!isOwnProfile && profile.isPrivate}
              onClick={() => {
                if (!isOwnProfile && profile.isPrivate) return;
                onOpenFollowers('followers');
              }}
              className="group inline-flex items-center gap-2 rounded-xl border border-purple-900/40 bg-[#16102a]/80 hover:bg-purple-950/80 hover:border-purple-500/50 px-3.5 py-1.5 sm:py-2 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 shadow-sm active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              title="Ver lista de seguidores"
            >
              <span className="font-mono text-base sm:text-lg font-bold text-white tabular-nums group-hover:text-purple-200 transition-colors">
                {profile.followersCount.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs font-medium text-purple-400 group-hover:text-purple-300 transition-colors">
                seguidores
              </span>
            </button>

            <button
              type="button"
              disabled={!isOwnProfile && profile.isPrivate}
              onClick={() => {
                if (!isOwnProfile && profile.isPrivate) return;
                onOpenFollowers('following');
              }}
              className="group inline-flex items-center gap-2 rounded-xl border border-purple-900/40 bg-[#16102a]/80 hover:bg-purple-950/80 hover:border-purple-500/50 px-3.5 py-1.5 sm:py-2 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 shadow-sm active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              title="Ver pessoas seguidas"
            >
              <span className="font-mono text-base sm:text-lg font-bold text-white tabular-nums group-hover:text-purple-200 transition-colors">
                {profile.followingCount.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs font-medium text-purple-400 group-hover:text-purple-300 transition-colors">
                seguindo
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
