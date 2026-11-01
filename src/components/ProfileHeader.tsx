import React, { useRef } from 'react';
import { 
  Camera, 
  Trash2, 
  Calendar, 
  Lock, 
  Globe, 
  UserCheck, 
  UserPlus, 
  Clock, 
  Settings, 
  ShieldAlert,
  UserX
} from 'lucide-react';
import { UserProfile } from '../types';

interface ProfileHeaderProps {
  profile: UserProfile;
  isOwnProfile: boolean;
  isFollowing: boolean;
  isRequested: boolean;
  isBlocked: boolean;
  onFollowToggle: () => void;
  onBlockToggle: () => void;
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
  onFollowToggle,
  onBlockToggle,
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
        {profile.bannerUrl ? (
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

        {/* Banner Controls for Profile Owner */}
        {isOwnProfile && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={() => bannerInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md hover:bg-purple-900/70 transition-all border border-purple-500/30"
              title="Trocar banner do perfil"
            >
              <Camera className="h-3.5 w-3.5 text-purple-300" />
              <span>{profile.bannerUrl ? 'Trocar Banner' : 'Adicionar Banner'}</span>
            </button>
            {profile.bannerUrl && (
              <button
                onClick={onRemoveBanner}
                className="flex items-center justify-center rounded-lg bg-black/60 p-1.5 text-xs text-rose-300 backdrop-blur-md hover:bg-rose-950/80 transition-all border border-rose-500/30"
                title="Remover banner"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Profile Details Bar */}
      <div className="relative px-4 pb-6 sm:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 -mt-16 sm:-mt-20">
          {/* Avatar and Main Identity */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Avatar Container */}
            <div className="relative group shrink-0">
              <div className="h-28 w-28 sm:h-36 sm:w-36 rounded-2xl overflow-hidden border-4 border-[#130E24] bg-[#1a1333] shadow-xl shadow-black/80 ring-2 ring-purple-600/40">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-800 to-indigo-900 text-2xl font-bold text-white">
                    {profile.displayName.charAt(0)}
                  </div>
                )}
              </div>

              {/* Avatar Controls for Owner */}
              {isOwnProfile && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs">
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    className="rounded-full bg-purple-600 p-2 text-white shadow-lg hover:bg-purple-500 transition-colors"
                    title="Trocar foto de perfil"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                  {profile.avatarUrl && (
                    <button
                      onClick={onRemoveAvatar}
                      className="rounded-full bg-rose-600 p-2 text-white shadow-lg hover:bg-rose-500 transition-colors"
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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  {profile.displayName}
                </h1>
                
                {/* Privacy Badge */}
                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border ${
                  profile.isPrivate 
                    ? 'border-amber-700/40 bg-amber-950/40 text-amber-300' 
                    : 'border-purple-800/40 bg-purple-950/50 text-purple-300'
                }`}>
                  {profile.isPrivate ? (
                    <>
                      <Lock className="h-3 w-3" />
                      Perfil Privado
                    </>
                  ) : (
                    <>
                      <Globe className="h-3 w-3" />
                      Perfil Público
                    </>
                  )}
                </span>
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
                onClick={() => onOpenSettings('profile')}
                className="flex items-center gap-2 rounded-xl bg-purple-600/90 hover:bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-950 transition-all border border-purple-400/30"
              >
                <Settings className="h-4 w-4" />
                <span>Editar Perfil</span>
              </button>
            ) : (
              <>
                {/* Follow / Request to Follow button */}
                <button
                  onClick={onFollowToggle}
                  disabled={isBlocked}
                  className={`group flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all shadow-md ${
                    isBlocked
                      ? 'bg-neutral-800 text-neutral-400 cursor-not-allowed'
                      : isFollowing
                      ? 'bg-[#1e1638] text-purple-200 border border-purple-700/50 hover:bg-rose-950/50 hover:text-rose-200 hover:border-rose-500/50'
                      : isRequested
                      ? 'bg-amber-950/50 text-amber-200 border border-amber-600/50 hover:bg-rose-950/50 hover:text-rose-200 hover:border-rose-500/50'
                      : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/50 border border-purple-400/40'
                  }`}
                >
                  {isFollowing ? (
                    <>
                      <UserCheck className="h-4 w-4 text-purple-300 group-hover:hidden" />
                      <UserX className="h-4 w-4 text-rose-300 hidden group-hover:inline" />
                      <span className="group-hover:hidden">Seguindo</span>
                      <span className="hidden group-hover:inline">Deixar de seguir</span>
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

        {/* Bio, Meta and Metrics Section */}
        <div className="mt-5 space-y-4">
          {/* Bio text */}
          {profile.bio && (
            <p className="max-w-3xl text-sm leading-relaxed text-purple-200/90 whitespace-pre-line">
              {profile.bio}
            </p>
          )}

          {/* Metadata Row: Date, Location, etc. */}
          <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-purple-300/70">
            {/* Real Account Creation Date (Mandatory, non-editable) */}
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-purple-400" />
              <span>Membro desde <strong className="text-purple-200 font-medium">{profile.createdAt}</strong></span>
            </div>
          </div>

          {/* Followers & Following Counters (Tabular figures, reactive) */}
          <div className="flex items-center gap-6 border-t border-purple-900/30 pt-4">
            <button
              onClick={() => onOpenFollowers('followers')}
              className="group flex items-baseline gap-1.5 text-left focus:outline-none"
            >
              <span className="font-mono text-lg font-bold text-white tabular-nums group-hover:text-purple-300 transition-colors">
                {profile.followersCount.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs text-purple-400 group-hover:text-purple-200 transition-colors">
                seguidores
              </span>
            </button>

            <button
              onClick={() => onOpenFollowers('following')}
              className="group flex items-baseline gap-1.5 text-left focus:outline-none"
            >
              <span className="font-mono text-lg font-bold text-white tabular-nums group-hover:text-purple-300 transition-colors">
                {profile.followingCount.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs text-purple-400 group-hover:text-purple-200 transition-colors">
                seguindo
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
