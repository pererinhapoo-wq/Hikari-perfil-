import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  User, 
  Shield, 
  Link2, 
  ShieldCheck, 
  Camera, 
  Trash2, 
  Check, 
  Lock, 
  Globe, 
  MessageSquare, 
  Calendar,
  ExternalLink,
  AlertCircle
} from 'lucide-react';
import { UserProfile } from '../../types';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: 'profile' | 'privacy' | 'connected' | 'security';
  profile: UserProfile;
  onClose: () => void;
  onSaveProfile: (updated: Partial<UserProfile>) => void;
  onUpdateAvatar: (url: string) => void;
  onUpdateBanner: (url: string) => void;
  onRemoveAvatar: () => void;
  onRemoveBanner: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'profile',
  profile,
  onClose,
  onSaveProfile,
  onUpdateAvatar,
  onUpdateBanner,
  onRemoveAvatar,
  onRemoveBanner
}) => {
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  const [activeTab, setActiveTab] = useState<'profile' | 'privacy' | 'connected' | 'security'>(initialTab);

  // Synchronously update activeTab whenever initialTab prop changes (no render delay or flash)
  if (prevInitialTab !== initialTab) {
    setPrevInitialTab(initialTab);
    setActiveTab(initialTab);
  }

  // Form State
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [isPrivate] = useState(profile.isPrivate);
  
  // Category-level privacy settings state
  const [showAnimeList, setShowAnimeList] = useState(profile.privacySettings?.showAnimeList ?? true);
  const [showFavorites, setShowFavorites] = useState(profile.privacySettings?.showFavorites ?? true);
  const [showActivity, setShowActivity] = useState(profile.privacySettings?.showActivity ?? true);
  const [showCommentsOnProfile, setShowCommentsOnProfile] = useState(profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile);
  
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Connected accounts state
  const [anilistConnected, setAnilistConnected] = useState(profile.externalAccounts.anilist.connected);
  const [malConnected, setMalConnected] = useState(profile.externalAccounts.mal.connected);
  
  // Avatar selection source ('custom' | 'anilist' | 'mal')
  const [avatarSource, setAvatarSource] = useState<'custom' | 'anilist' | 'mal'>('custom');

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveProfile({
      displayName,
      username,
      bio,
      isPrivate,
      showCommentsOnProfile,
      privacySettings: {
        showAnimeList,
        showFavorites,
        showActivity,
        showCommentsOnProfile
      },
      externalAccounts: {
        anilist: { 
          connected: anilistConnected, 
          username: anilistConnected ? (profile.externalAccounts.anilist.username || username || profile.username) : undefined,
          avatarUrl: anilistConnected ? profile.externalAccounts.anilist.avatarUrl : undefined
        },
        mal: { 
          connected: malConnected, 
          username: malConnected ? (profile.externalAccounts.mal.username || username || profile.username) : undefined,
          avatarUrl: malConnected ? profile.externalAccounts.mal.avatarUrl : undefined
        }
      }
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 800);
  };

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleBannerFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 overscroll-contain"
      onClick={onClose}
      onTouchMove={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div 
        className="relative w-full max-w-2xl rounded-2xl border border-purple-900/40 bg-[#130E24] shadow-2xl flex flex-col max-h-[90vh] overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Hidden File Inputs */}
        <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
        <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerFile} />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-purple-900/30 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">
              {activeTab === 'profile' && 'Editar Perfil'}
              {activeTab === 'privacy' && 'Configurações & Privacidade'}
              {activeTab === 'connected' && 'Contas Conectadas'}
              {activeTab === 'security' && 'Segurança e Conta'}
            </h2>
            <p className="text-[11px] text-purple-300/60">
              {activeTab === 'profile' && 'Personalize suas fotos, nome de exibição, usuário e biografia.'}
              {activeTab === 'privacy' && 'Preferências de visibilidade do perfil e histórico de comentários.'}
              {activeTab === 'connected' && 'Gerencie conexões seguras com plataformas externas parceiras.'}
              {activeTab === 'security' && 'Informações de registro e segurança da sua conta Hikari.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/30 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body with Sidebar and Content */}
        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
          {/* Navigation Sidebar */}
          <div className="w-full sm:w-52 border-b sm:border-b-0 sm:border-r border-purple-900/30 bg-[#0e0a1b] p-3 space-y-3">
            <div>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
                Perfil
              </div>
              <button
                onClick={() => setActiveTab('profile')}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === 'profile'
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                }`}
              >
                <User className="h-4 w-4" />
                <span>Editar Perfil</span>
              </button>
            </div>

            <div>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
                Configurações da Conta
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => setActiveTab('privacy')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                    activeTab === 'privacy'
                      ? 'bg-purple-600 text-white'
                      : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                  }`}
                >
                  <Shield className="h-4 w-4" />
                  <span>Privacidade</span>
                </button>

                <button
                  onClick={() => setActiveTab('connected')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                    activeTab === 'connected'
                      ? 'bg-purple-600 text-white'
                      : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                  }`}
                >
                  <Link2 className="h-4 w-4" />
                  <span>Contas Conectadas</span>
                </button>

                <button
                  onClick={() => setActiveTab('security')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                    activeTab === 'security'
                      ? 'bg-purple-600 text-white'
                      : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>Segurança e Dados</span>
                </button>
              </div>
            </div>
          </div>

          {/* Form Content Area */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            {activeTab === 'profile' && (
              <div className="space-y-5">
                {/* Visual Image Customization */}
                <div className="space-y-3">
                  <label className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                    Imagens do Perfil
                  </label>
                  
                  {/* Banner Preview and Buttons */}
                  <div className="relative h-28 w-full rounded-xl overflow-hidden border border-purple-900/40 bg-purple-950/30">
                    {profile.bannerUrl ? (
                      <img src={profile.bannerUrl} alt="Preview banner" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-purple-400">
                        Nenhum banner ativo
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2">
                      <button
                        onClick={() => bannerInputRef.current?.click()}
                        className="rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white shadow-md flex items-center gap-1.5"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        <span>Substituir Banner</span>
                      </button>
                      {profile.bannerUrl && (
                        <button
                          onClick={onRemoveBanner}
                          className="rounded-lg bg-rose-950/80 hover:bg-rose-900 px-2 py-1.5 text-xs text-rose-200 border border-rose-500/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Avatar Preview and Buttons */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-4">
                      {profile.avatarUrl ? (
                        <img
                          src={profile.avatarUrl}
                          alt="Preview avatar"
                          className="h-16 w-16 rounded-2xl object-cover border-2 border-purple-500/40 shrink-0"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-800 to-indigo-900 border-2 border-purple-500/40 text-xl font-bold text-white shrink-0">
                          {displayName.charAt(0) || 'U'}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          className="rounded-lg bg-purple-950/80 hover:bg-purple-900 border border-purple-700/40 px-3 py-1.5 text-xs font-medium text-purple-200 flex items-center gap-1.5 cursor-pointer"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          <span>Carregar Nova Foto</span>
                        </button>
                        {profile.avatarUrl && (
                          <button
                            type="button"
                            onClick={onRemoveAvatar}
                            className="rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-700/40 px-2.5 py-1.5 text-xs text-rose-300 cursor-pointer"
                          >
                            Remover Foto
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Option to sync avatar from connected accounts when available */}
                    {(profile.externalAccounts.anilist.connected || profile.externalAccounts.mal.connected) && (
                      <div className="rounded-xl border border-purple-900/40 bg-[#0e0a1b] p-3 space-y-2">
                        <span className="text-[11px] font-semibold text-purple-300 block">
                          Origem do Avatar (Contas Conectadas)
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {profile.externalAccounts.anilist.connected && profile.externalAccounts.anilist.avatarUrl && (
                            <button
                              type="button"
                              onClick={() => onUpdateAvatar(profile.externalAccounts.anilist.avatarUrl!)}
                              className="rounded-lg bg-purple-950/70 hover:bg-purple-900 border border-purple-800/40 px-2.5 py-1 text-xs text-purple-200 flex items-center gap-2 transition-colors cursor-pointer"
                            >
                              <img 
                                src={profile.externalAccounts.anilist.avatarUrl} 
                                alt="AniList Avatar" 
                                className="h-5 w-5 rounded-full object-cover"
                              />
                              <span>Usar foto do AniList</span>
                            </button>
                          )}
                          {profile.externalAccounts.mal.connected && profile.externalAccounts.mal.avatarUrl && (
                            <button
                              type="button"
                              onClick={() => onUpdateAvatar(profile.externalAccounts.mal.avatarUrl!)}
                              className="rounded-lg bg-purple-950/70 hover:bg-purple-900 border border-purple-800/40 px-2.5 py-1 text-xs text-purple-200 flex items-center gap-2 transition-colors cursor-pointer"
                            >
                              <img 
                                src={profile.externalAccounts.mal.avatarUrl} 
                                alt="MAL Avatar" 
                                className="h-5 w-5 rounded-full object-cover"
                              />
                              <span>Usar foto do MyAnimeList</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Text Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-purple-200">Nome de Exibição</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-purple-200">Nome de Usuário (@)</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-purple-200">Biografia</label>
                  <textarea
                    rows={3}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Conte sobre seus gêneros favoritos de anime e interesses..."
                    className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] px-3 py-2 text-xs text-white placeholder:text-purple-400/40 focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white">Configurações de Privacidade</h3>
                  <p className="mt-1 text-xs text-purple-300/70">
                    Defina como outros membros do Hikari visualizam seu perfil e a privacidade das suas listas de animes.
                  </p>
                </div>

                {/* Dedicated Anime Lists Privacy Setting (Public vs Private) */}
                <div className="rounded-xl border border-purple-800/40 bg-[#0A0713] p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        {showAnimeList ? (
                          <Globe className="h-4 w-4 text-purple-400 shrink-0" />
                        ) : (
                          <Lock className="h-4 w-4 text-amber-400 shrink-0" />
                        )}
                        <span className="text-xs font-bold text-white">Privacidade das Listas de Animes</span>
                      </div>
                      <p className="text-[11px] text-purple-300/70">
                        Escolha se visitantes podem abrir e visualizar os animes das suas listas por status.
                      </p>
                    </div>

                    {/* Segmented Public / Private Selector */}
                    <div
                      role="group"
                      aria-label="Privacidade das listas de animes"
                      className="inline-flex items-center gap-1 rounded-xl border border-purple-900/50 bg-[#130E24] p-1 shrink-0 self-start sm:self-auto"
                    >
                      <button
                        type="button"
                        data-testid="anime-list-privacy-public"
                        aria-pressed={showAnimeList}
                        onClick={() => setShowAnimeList(true)}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                          showAnimeList
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-purple-300/70 hover:text-white'
                        }`}
                      >
                        <Globe className="h-3.5 w-3.5" />
                        <span>Públicas</span>
                      </button>
                      <button
                        type="button"
                        data-testid="anime-list-privacy-private"
                        aria-pressed={!showAnimeList}
                        onClick={() => setShowAnimeList(false)}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                          !showAnimeList
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-purple-300/70 hover:text-white'
                        }`}
                      >
                        <Lock className="h-3.5 w-3.5" />
                        <span>Privadas</span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#140e26] border border-purple-900/40 p-2.5 text-[11px] text-purple-200/80 leading-relaxed">
                    {showAnimeList ? (
                      <span>
                        Suas listas estão <strong>públicas</strong>. Visitantes podem clicar nas estatísticas de status (Assistindo, Concluídos, Planejados, Em espera e Abandonados) e visualizar os animes correspondentes.
                      </span>
                    ) : (
                      <span>
                        Suas listas estão <strong>privadas</strong>. Os números do Anime Stats continuam visíveis no seu perfil, mas outras pessoas não podem abrir nem visualizar os animes das listas. Você continua tendo acesso normal às suas próprias listas.
                      </span>
                    )}
                  </div>
                </div>

                {/* Setting: Visibilidade Geral do Perfil */}
                <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-4 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {isPrivate ? (
                        <Lock className="h-4 w-4 text-amber-400" />
                      ) : (
                        <Globe className="h-4 w-4 text-purple-400" />
                      )}
                      <span className="text-xs font-bold text-white">
                        {isPrivate ? 'Perfil com Aprovação de Seguidores' : 'Perfil Aberto a Visitantes'}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-purple-300/80 whitespace-nowrap">
                      {isPrivate ? 'Restrito a seguidores' : 'Visível'}
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-300/70 leading-relaxed">
                    {isPrivate
                      ? 'Novos visitantes precisam ter a solicitação aprovada antes de visualizar as seções autorizadas do perfil.'
                      : 'Seu perfil pode ser visitado normalmente, respeitando individualmente cada preferência de privacidade abaixo.'}
                  </p>
                </div>

                {/* Fine-grained Category Privacy Controls */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                    Outras Preferências de Visibilidade
                  </h4>

                  {/* Toggle 2: Favoritos */}
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-3.5">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-white">Seção de Favoritos</span>
                      <p className="text-[11px] text-purple-300/70">
                        Exibir seus animes, personagens, empresas e pessoas favoritas no perfil.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showFavorites}
                      aria-label="Exibir seção de favoritos"
                      onClick={() => setShowFavorites(!showFavorites)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        showFavorites ? 'bg-purple-600' : 'bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          showFavorites ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Toggle 3: Atividades Recentes */}
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-3.5">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-white">Atividades Recentes</span>
                      <p className="text-[11px] text-purple-300/70">
                        Compartilhar episódios assistidos e atualizações no feed de atividade do perfil.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showActivity}
                      aria-label="Exibir atividades recentes"
                      onClick={() => setShowActivity(!showActivity)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        showActivity ? 'bg-purple-600' : 'bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          showActivity ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Toggle 4: Histórico de Comentários */}
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-3.5">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-white">Histórico de Comentários</span>
                      <p className="text-[11px] text-purple-300/70">
                        Exibir comentários feitos no site principal Hikari na aba de Comentários do seu perfil.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showCommentsOnProfile}
                      aria-label="Exibir histórico de comentários"
                      onClick={() => setShowCommentsOnProfile(!showCommentsOnProfile)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        showCommentsOnProfile ? 'bg-purple-600' : 'bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          showCommentsOnProfile ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Persistence Notice */}
                <div className="rounded-xl bg-purple-950/30 border border-purple-900/30 p-3 text-[11px] text-purple-300/80 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
                  <span>
                    Suas preferências de privacidade são salvas individualmente na sua conta e mantidas ao sair e entrar novamente, sem apagar nenhuma lista ou estatística existente.
                  </span>
                </div>
              </div>
            )}

            {activeTab === 'connected' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white">Contas Conectadas</h3>
                  <p className="mt-1 text-xs text-purple-300/70">
                    Prepare a sincronização das suas listas e notas com plataformas externas parceiras.
                  </p>
                </div>

                {/* AniList Card */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#02A9FF]/10 text-[#02A9FF] border border-[#02A9FF]/30 font-bold">
                      AL
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">AniList</div>
                      <p className="text-[11px] text-purple-300/60">
                        {anilistConnected ? 'Conta conectada com sucesso' : 'Importação e sincronização de progresso'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setAnilistConnected(!anilistConnected);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      anilistConnected
                        ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                        : 'bg-purple-600 text-white hover:bg-purple-500'
                    }`}
                  >
                    {anilistConnected ? 'Desconectar' : 'Conectar via OAuth'}
                  </button>
                </div>

                {/* MyAnimeList Card */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2E51A2]/10 text-[#2E51A2] border border-[#2E51A2]/30 font-bold">
                      MAL
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">MyAnimeList</div>
                      <p className="text-[11px] text-purple-300/60">
                        {malConnected ? 'Conta conectada com sucesso' : 'Sincronizar notas e episódios assistidos'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setMalConnected(!malConnected);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      malConnected
                        ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                        : 'bg-purple-600 text-white hover:bg-purple-500'
                    }`}
                  >
                    {malConnected ? 'Desconectar' : 'Conectar via OAuth'}
                  </button>
                </div>

                <div className="flex items-start gap-2 rounded-xl bg-purple-950/40 p-3 text-[11px] text-purple-300/80 border border-purple-900/30">
                  <AlertCircle className="h-4 w-4 shrink-0 text-purple-400 mt-0.5" />
                  <span>
                    <strong>Segurança:</strong> O Hikari nunca solicita nem armazena suas senhas de plataformas externas. A autenticação utiliza o protocolo seguro OAuth 2.0 PKCE.
                  </span>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white">Segurança e Dados da Conta</h3>
                  <p className="mt-1 text-xs text-purple-300/70">
                    Gerenciamento de credenciais e integridade das informações do perfil.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Account Creation Date Notice */}
                  <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-4 space-y-1">
                    <span className="text-[11px] text-purple-400 font-semibold uppercase tracking-wider">
                      Registro de Conta
                    </span>
                    <div className="flex items-center gap-2 text-xs text-white">
                      <Calendar className="h-4 w-4 text-purple-400" />
                      <span>Conta criada em <strong>{profile.createdAt}</strong></span>
                    </div>
                    <p className="text-[10px] text-purple-300/60">
                      A data de criação é registrada pelo servidor e protegida por regras invioláveis de banco de dados.
                    </p>
                  </div>

                  {/* Future Firebase Auth Integration Preview */}
                  <div className="rounded-xl border border-purple-900/30 bg-[#0A0713] p-4 space-y-3">
                    <span className="text-[11px] text-purple-400 font-semibold uppercase tracking-wider">
                      Método de Autenticação (Etapa 2)
                    </span>
                    <div className="flex items-center justify-between text-xs text-white">
                      <span>Login com Conta Google & E-mail</span>
                      <span className="text-purple-400 font-medium">Firebase Auth</span>
                    </div>
                    <p className="text-[10px] text-purple-300/60">
                      Na Etapa 2 deste projeto, ativaremos a persistência em tempo real no Firestore e o fluxo de login oficial com Google.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer with Save Button */}
        <div className="flex items-center justify-between border-t border-purple-900/30 px-6 py-4 bg-[#0e0a1b]">
          <div>
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <Check className="h-4 w-4" />
                Alterações salvas!
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-purple-300 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-purple-950 transition-all border border-purple-400/40"
            >
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
