import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Search,
  ShieldAlert
} from 'lucide-react';
import { UserProfile, AnimeItem } from '../../types';
import {
  fetchAniListUser,
  fetchAniListAnimeList,
  calculateAniListImportPreview,
  mergeAniListImport,
  STATUS_LABELS_PT,
  type AniListUser,
  type AniListAnimeEntry,
  type AniListImportPreview
} from '../../services/anilistService';
import {
  fetchMALServerStatus,
  fetchMALAuthUrl,
  fetchMALAnimeList,
  disconnectMALServer,
  calculateMALImportPreview,
  mergeMALImport,
  MAL_STATUS_LABELS_PT,
  type MALAnimeEntry,
  type MALImportPreview,
  type MALServerStatus,
} from '../../services/malService';
import { useAuth } from '../../contexts/AuthContext';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: 'profile' | 'privacy' | 'connected' | 'security';
  openSyncKey?: number;
  profile: UserProfile;
  currentAnimes?: AnimeItem[];
  onClose: () => void;
  onSaveProfile: (updated: Partial<UserProfile>) => void;
  onUpdateAvatar: (url: string) => void;
  onUpdateBanner: (url: string) => void;
  onRemoveAvatar: () => void;
  onRemoveBanner: () => void;
  onSyncAniList?: (
    mergedAnimes: AnimeItem[],
    anilistAccount: UserProfile['externalAccounts']['anilist']
  ) => void;
  onSyncMAL?: (
    mergedAnimes: AnimeItem[],
    malAccount: UserProfile['externalAccounts']['mal']
  ) => void;
  blockedIds?: string[];
  otherProfiles?: Record<string, UserProfile>;
  onUnblockUser?: (userId: string) => void;
}

function formatExternalAccountDate(rawDate?: string | null): string | null {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) {
    return trimmed;
  }
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'profile',
  openSyncKey,
  profile,
  currentAnimes = [],
  onClose,
  onSaveProfile,
  onUpdateAvatar,
  onUpdateBanner,
  onRemoveAvatar,
  onRemoveBanner,
  onSyncAniList,
  onSyncMAL,
  blockedIds = [],
  otherProfiles = {},
  onUnblockUser
}) => {
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  const [prevOpenSyncKey, setPrevOpenSyncKey] = useState(openSyncKey);
  const [prevProfileId, setPrevProfileId] = useState(profile.id);
  const [activeTab, setActiveTab] = useState<'profile' | 'privacy' | 'connected' | 'security'>(initialTab);

  const { user } = useAuth();

  // Synchronously update activeTab when explicitly opened to a target section via menu/button
  if (openSyncKey !== undefined ? prevOpenSyncKey !== openSyncKey : prevInitialTab !== initialTab) {
    setPrevOpenSyncKey(openSyncKey);
    setPrevInitialTab(initialTab);
    setActiveTab(initialTab);
  }

  // Form State (preserved across modal close/reopen for the same profile.id)
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [isPrivate, setIsPrivate] = useState(profile.isPrivate);
  
  // Category-level privacy settings state
  const [showAnimeList, setShowAnimeList] = useState(profile.privacySettings?.showAnimeList ?? true);
  const [showFavorites, setShowFavorites] = useState(profile.privacySettings?.showFavorites ?? true);
  const [showActivity, setShowActivity] = useState(profile.privacySettings?.showActivity ?? true);
  const [showCommentsOnProfile, setShowCommentsOnProfile] = useState(profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile);
  
  // Direct messages privacy states
  const [allowDirectMessages, setAllowDirectMessages] = useState(profile.privacySettings?.allowDirectMessages ?? true);
  const [directMessagesFrom, setDirectMessagesFrom] = useState<'everyone' | 'followers' | 'mutual'>(
    profile.privacySettings?.directMessagesFrom ?? 'everyone'
  );
  const [showOnlineStatus, setShowOnlineStatus] = useState(profile.privacySettings?.showOnlineStatus !== false);
  
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Connected accounts state
  const [anilistConnected, setAnilistConnected] = useState(profile.externalAccounts.anilist.connected);
  const [anilistUsername, setAnilistUsername] = useState(profile.externalAccounts.anilist.username || '');
  const [anilistAvatarUrl, setAnilistAvatarUrl] = useState(profile.externalAccounts.anilist.avatarUrl || '');
  const [anilistLastSync, setAnilistLastSync] = useState(profile.externalAccounts.anilist.lastSync || '');
  const [anilistAccountCreatedAt, setAnilistAccountCreatedAt] = useState(profile.externalAccounts.anilist.accountCreatedAt || '');

  const [malConnected, setMalConnected] = useState(profile.externalAccounts.mal.connected);
  const [malUsername, setMalUsername] = useState(profile.externalAccounts.mal.username || '');
  const [malAvatarUrl, setMalAvatarUrl] = useState(profile.externalAccounts.mal.avatarUrl || '');
  const [malLastSync, setMalLastSync] = useState(profile.externalAccounts.mal.lastSync || '');
  const [malAccountCreatedAt, setMalAccountCreatedAt] = useState(
    formatExternalAccountDate(profile.externalAccounts.mal.accountCreatedAt) || profile.externalAccounts.mal.accountCreatedAt || ''
  );

  // Re-initialize form fields only if the active user account (profile.id) changes
  if (prevProfileId !== profile.id) {
    setPrevProfileId(profile.id);
    setDisplayName(profile.displayName);
    setUsername(profile.username);
    setBio(profile.bio);
    setIsPrivate(profile.isPrivate);
    setShowAnimeList(profile.privacySettings?.showAnimeList ?? true);
    setShowFavorites(profile.privacySettings?.showFavorites ?? true);
    setShowActivity(profile.privacySettings?.showActivity ?? true);
    setShowCommentsOnProfile(profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile);
    setAllowDirectMessages(profile.privacySettings?.allowDirectMessages ?? true);
    setDirectMessagesFrom(profile.privacySettings?.directMessagesFrom ?? 'everyone');
    setShowOnlineStatus(profile.privacySettings?.showOnlineStatus !== false);
    setAnilistConnected(profile.externalAccounts.anilist.connected);
    setAnilistUsername(profile.externalAccounts.anilist.username || '');
    setAnilistAvatarUrl(profile.externalAccounts.anilist.avatarUrl || '');
    setAnilistLastSync(profile.externalAccounts.anilist.lastSync || '');
    setAnilistAccountCreatedAt(profile.externalAccounts.anilist.accountCreatedAt || '');
    setMalConnected(profile.externalAccounts.mal.connected);
    setMalUsername(profile.externalAccounts.mal.username || '');
    setMalAvatarUrl(profile.externalAccounts.mal.avatarUrl || '');
    setMalLastSync(profile.externalAccounts.mal.lastSync || '');
    setMalAccountCreatedAt(
      formatExternalAccountDate(profile.externalAccounts.mal.accountCreatedAt) ||
        profile.externalAccounts.mal.accountCreatedAt ||
        ''
    );
  }

  // MAL Server status & connection state
  const [malStatus, setMalStatus] = useState<MALServerStatus | null>(null);
  const [isStartingMALAuth, setIsStartingMALAuth] = useState(false);
  const [malAuthError, setMalAuthError] = useState<string | null>(null);
  const [isConfirmingDisconnectMAL, setIsConfirmingDisconnectMAL] = useState(false);

  // Referências para controle seguro do ciclo de vida e comunicação do popup OAuth do MAL
  const malPopupRef = useRef<Window | null>(null);
  const malAuthHandledRef = useRef<boolean>(false);
  const malCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // MAL Collection Query, Preview and Import state
  const [isFetchingMALList, setIsFetchingMALList] = useState(false);
  const [malListError, setMalListError] = useState<string | null>(null);
  const [rawMALEntries, setRawMALEntries] = useState<MALAnimeEntry[] | null>(null);
  const [malPreview, setMalPreview] = useState<MALImportPreview | null>(null);
  const [updateExistingProgressMAL, setUpdateExistingProgressMAL] = useState(true);
  const [isImportingMAL, setIsImportingMAL] = useState(false);
  const [malSuccessMsg, setMalSuccessMsg] = useState<string | null>(null);

  // Check MAL server status on mount
  useEffect(() => {
    let isMounted = true;
    fetchMALServerStatus()
      .then((status) => {
        if (isMounted) setMalStatus(status);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Escuta estrita e segura do callback OAuth do MyAnimeList via postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 1. Validar origem confiável (deve ser estritamente igual à origem da aplicação principal)
      if (typeof window === 'undefined') return;
      if (event.origin !== window.location.origin) {
        return;
      }

      // 2. Validar que a janela de origem é exatamente a janela do popup do MAL aberta nesta sessão
      if (!malPopupRef.current || event.source !== malPopupRef.current) {
        return;
      }

      // 3. Garantir processamento único da resposta do popup
      if (malAuthHandledRef.current) {
        return;
      }

      // 4. Validar se os dados recebidos formam um objeto válido
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'MAL_AUTH_SUCCESS') {
        // Validação estrita da estrutura e tipos esperados
        if (
          typeof data.username !== 'string' ||
          !data.username.trim() ||
          typeof data.avatarUrl !== 'string'
        ) {
          return;
        }

        malAuthHandledRef.current = true;

        if (malCheckTimerRef.current) {
          clearInterval(malCheckTimerRef.current);
          malCheckTimerRef.current = null;
        }

        // Encerra a janela de popup de forma segura (sem fechar a janela principal)
        try {
          if (malPopupRef.current && !malPopupRef.current.closed) {
            malPopupRef.current.close();
          }
        } catch {
          // ignore
        }
        malPopupRef.current = null;

        const username = data.username.trim();
        const avatarUrl = data.avatarUrl.trim();
        const rawJoinedAt = typeof data.joinedAt === 'string' ? data.joinedAt.trim() : undefined;
        const formattedJoinedAt = formatExternalAccountDate(rawJoinedAt) || undefined;

        setMalConnected(true);
        setMalUsername(username);
        setMalAvatarUrl(avatarUrl);
        if (formattedJoinedAt) {
          setMalAccountCreatedAt(formattedJoinedAt);
        }
        setMalAuthError(null);
        setIsStartingMALAuth(false);
        setMalSuccessMsg(`Conta @${username} do MyAnimeList conectada com sucesso!`);
        onSaveProfile({
          externalAccounts: {
            ...profile.externalAccounts,
            mal: {
              connected: true,
              username,
              avatarUrl,
              accountCreatedAt: formattedJoinedAt || malAccountCreatedAt || undefined,
            },
          },
        });
      } else if (data.type === 'MAL_AUTH_ERROR') {
        // Validação estrita do erro recebido
        if (typeof data.message !== 'string' || !data.message.trim()) {
          return;
        }

        malAuthHandledRef.current = true;

        if (malCheckTimerRef.current) {
          clearInterval(malCheckTimerRef.current);
          malCheckTimerRef.current = null;
        }

        try {
          if (malPopupRef.current && !malPopupRef.current.closed) {
            malPopupRef.current.close();
          }
        } catch {
          // ignore
        }
        malPopupRef.current = null;

        setMalAuthError(data.message.trim());
        setIsStartingMALAuth(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (malCheckTimerRef.current) {
        clearInterval(malCheckTimerRef.current);
        malCheckTimerRef.current = null;
      }
    };
  }, [profile.externalAccounts, onSaveProfile]);

  const handleConnectMAL = async () => {
    setIsStartingMALAuth(true);
    setMalAuthError(null);
    setMalSuccessMsg(null);
    malAuthHandledRef.current = false;

    if (malCheckTimerRef.current) {
      clearInterval(malCheckTimerRef.current);
      malCheckTimerRef.current = null;
    }

    try {
      if (!user) {
        setMalAuthError(
          'É necessário estar autenticado com uma conta Hikari para autorizar a sincronização com o MyAnimeList.'
        );
        setIsStartingMALAuth(false);
        return;
      }

      const status = await fetchMALServerStatus();
      setMalStatus(status);
      if (!status.configured) {
        setMalAuthError(
          'O Client ID do MyAnimeList ainda não foi configurado no servidor. Defina a variável de ambiente MAL_CLIENT_ID.'
        );
        setIsStartingMALAuth(false);
        return;
      }

      const idToken = await user.getIdToken();
      const { url } = await fetchMALAuthUrl(idToken);
      const width = 600;
      const height = 750;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        url,
        'mal_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
      );

      if (!popup) {
        setMalAuthError('O navegador bloqueou a janela pop-up. Por favor, permita pop-ups para conectar ao MyAnimeList.');
        setIsStartingMALAuth(false);
        return;
      }

      malPopupRef.current = popup;

      malCheckTimerRef.current = setInterval(() => {
        if (popup.closed) {
          if (malCheckTimerRef.current) {
            clearInterval(malCheckTimerRef.current);
            malCheckTimerRef.current = null;
          }
          malPopupRef.current = null;
          if (!malAuthHandledRef.current) {
            setIsStartingMALAuth(false);
          }
        }
      }, 500);
    } catch (err) {
      malPopupRef.current = null;
      if (malCheckTimerRef.current) {
        clearInterval(malCheckTimerRef.current);
        malCheckTimerRef.current = null;
      }
      setMalAuthError(err instanceof Error ? err.message : 'Falha ao iniciar autenticação com o MyAnimeList.');
      setIsStartingMALAuth(false);
    }
  };

  const handleDisconnectMAL = async () => {
    if (user) {
      try {
        const idToken = await user.getIdToken();
        await disconnectMALServer(idToken);
      } catch {
        // offline/demo fallback
      }
    }
    setMalConnected(false);
    setMalUsername('');
    setMalAvatarUrl('');
    setMalLastSync('');
    setMalAccountCreatedAt('');
    setMalPreview(null);
    setRawMALEntries(null);
    setIsConfirmingDisconnectMAL(false);
    onSaveProfile({
      externalAccounts: {
        ...profile.externalAccounts,
        mal: { connected: false },
      },
    });
    setMalSuccessMsg('Conta MyAnimeList desconectada. Sua lista de animes e animes manuais foram preservados.');
  };

  const handleFetchMALList = async () => {
    setIsFetchingMALList(true);
    setMalListError(null);
    setMalPreview(null);
    setMalSuccessMsg(null);
    try {
      if (!user) {
        setMalListError(
          'É necessário estar autenticado com uma conta Hikari para consultar a lista do MyAnimeList.'
        );
        return;
      }
      const idToken = await user.getIdToken();
      const entries = await fetchMALAnimeList(idToken);
      setRawMALEntries(entries);
      const preview = calculateMALImportPreview(entries, currentAnimes, malUsername);
      setMalPreview(preview);
    } catch (err) {
      setMalListError(
        err instanceof Error ? err.message : 'Falha ao buscar a lista do MyAnimeList.'
      );
    } finally {
      setIsFetchingMALList(false);
    }
  };

  const handleConfirmMALImport = () => {
    if (!rawMALEntries || !malPreview) return;
    setIsImportingMAL(true);
    const { mergedList, addedCount, updatedCount } = mergeMALImport(
      rawMALEntries,
      currentAnimes,
      updateExistingProgressMAL
    );

    const now = new Date();
    const formattedDate = `${now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })} às ${now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;

    setMalLastSync(formattedDate);

    if (onSyncMAL) {
      onSyncMAL(mergedList, {
        connected: true,
        username: malUsername,
        avatarUrl: malAvatarUrl,
        lastSync: formattedDate,
        accountCreatedAt: malAccountCreatedAt || undefined,
      });
    }

    setMalSuccessMsg(
      `Importação do MyAnimeList concluída com sucesso! ${addedCount} novos animes adicionados e ${updatedCount} animes atualizados na sua lista.`
    );
    setMalPreview(null);
    setRawMALEntries(null);
    setIsImportingMAL(false);
  };
  
  // AniList Connection form state
  const [inputAniListUsername, setInputAniListUsername] = useState('');
  const [isCheckingAniListUser, setIsCheckingAniListUser] = useState(false);
  const [aniListUserError, setAniListUserError] = useState<string | null>(null);
  const [verifiedAniListUser, setVerifiedAniListUser] = useState<AniListUser | null>(null);
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);

  // AniList Collection Query, Preview and Import state
  const [isFetchingCollection, setIsFetchingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [rawIncomingEntries, setRawIncomingEntries] = useState<AniListAnimeEntry[] | null>(null);
  const [aniListPreview, setAniListPreview] = useState<AniListImportPreview | null>(null);
  const [updateExistingProgress, setUpdateExistingProgress] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  // Avatar selection source ('custom' | 'anilist' | 'mal')
  const [avatarSource, setAvatarSource] = useState<'custom' | 'anilist' | 'mal'>('custom');

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape key dismissal without re-triggering scroll lock on parent re-renders
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Bloqueio do fundo apenas enquanto o modal está aberto e restauração exata do scroll ao fechar
  useLayoutEffect(() => {
    if (!isOpen || typeof window === 'undefined' || typeof document === 'undefined') return;

    const savedScrollY =
      window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const savedScrollX =
      window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollBarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);

    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevLeft = document.body.style.left;
    const prevRight = document.body.style.right;
    const prevWidth = document.body.style.width;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    if (scrollBarWidth > 0) {
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }

    return () => {
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.left = prevLeft;
      document.body.style.right = prevRight;
      document.body.style.width = prevWidth;
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.scrollTo({
        top: savedScrollY,
        left: savedScrollX,
        behavior: 'instant' as ScrollBehavior,
      });
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

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
        showCommentsOnProfile,
        allowDirectMessages,
        directMessagesFrom,
        showOnlineStatus,
      },
      externalAccounts: {
        anilist: { 
          connected: anilistConnected, 
          username: anilistConnected ? anilistUsername : undefined,
          avatarUrl: anilistConnected ? anilistAvatarUrl : undefined,
          lastSync: anilistConnected ? anilistLastSync : undefined,
          accountCreatedAt: anilistConnected ? (anilistAccountCreatedAt || undefined) : undefined
        },
        mal: { 
          connected: malConnected, 
          username: malConnected ? malUsername : undefined,
          avatarUrl: malConnected ? malAvatarUrl : undefined,
          lastSync: malConnected ? malLastSync : undefined,
          accountCreatedAt: malConnected ? (malAccountCreatedAt || undefined) : undefined
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
    e.target.value = '';
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
    e.target.value = '';
  };

  return createPortal(
    <div 
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto overscroll-contain"
      style={{
        paddingTop: 'max(0.625rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(0.625rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.625rem, env(safe-area-inset-right))',
      }}
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-2xl my-auto rounded-2xl border border-purple-900/40 bg-[#130E24] shadow-2xl flex flex-col h-[min(92dvh,820px)] sm:h-[85vh] max-h-[820px] overflow-hidden overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Hidden File Inputs */}
        <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
        <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerFile} />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-purple-900/30 px-5 sm:px-6 py-3.5 sm:py-4 shrink-0 bg-[#0e0a1b]">
          <div className="min-w-0 pr-3">
            <h2 className="text-base sm:text-lg font-bold text-white truncate">
              {activeTab === 'profile' && 'Editar Perfil'}
              {activeTab === 'privacy' && 'Configurações de Privacidade'}
              {activeTab === 'connected' && 'Contas Conectadas'}
              {activeTab === 'security' && 'Configurações de Privacidade'}
            </h2>
            <p className="text-[11px] sm:text-xs text-purple-300/60 mt-0.5 truncate">
              {activeTab === 'profile' && 'Personalize suas fotos, nome de exibição, usuário e biografia.'}
              {activeTab === 'privacy' && 'Preferências de visibilidade do perfil e listas de animes.'}
              {activeTab === 'connected' && 'Gerencie conexões seguras com plataformas externas parceiras.'}
              {activeTab === 'security' && 'Preferências de visibilidade do perfil e listas de animes.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-2 text-purple-400 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile Navigation Tabs (Horizontal Bar) */}
        <div className="flex sm:hidden border-b border-purple-900/30 bg-[#0c0818] px-3 py-2 gap-2 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/50'
                : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Editar Perfil</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              activeTab === 'privacy' || activeTab === 'security'
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/50'
                : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Privacidade</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('connected')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
              activeTab === 'connected'
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/50'
                : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>Contas Conectadas</span>
          </button>
        </div>

        {/* Modal Body with Desktop Sidebar and Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Navigation Sidebar (Desktop) */}
          <div className="hidden sm:flex sm:w-56 flex-col shrink-0 border-r border-purple-900/30 bg-[#0e0a1b] p-3.5 space-y-3.5">
            <div>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
                Perfil
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'profile'
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-950'
                    : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                }`}
              >
                <User className="h-4 w-4" />
                <span>Editar Perfil</span>
              </button>
            </div>

            <div>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
                Configurações da Conta
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('privacy')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'privacy' || activeTab === 'security'
                      ? 'bg-purple-600 text-white shadow-sm shadow-purple-950'
                      : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                  }`}
                >
                  <Shield className="h-4 w-4" />
                  <span>Privacidade</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('connected')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'connected'
                      ? 'bg-purple-600 text-white shadow-sm shadow-purple-950'
                      : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
                  }`}
                >
                  <Link2 className="h-4 w-4" />
                  <span>Contas Conectadas</span>
                </button>
              </div>
            </div>
          </div>

          {/* Form Content Area */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 pb-8">
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
                    <label className="text-xs font-semibold text-purple-200">Nome de Exibição</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-purple-500 focus:outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-purple-200">Nome de Usuário (@)</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-purple-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-purple-200">Biografia</label>
                  <textarea
                    rows={3}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Conte sobre seus gêneros favoritos de anime e interesses..."
                    className="w-full rounded-xl border border-purple-900/50 bg-[#0A0713] px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder:text-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors leading-relaxed"
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

                {/* Section: Direct Messages Privacy Control */}
                <div className="space-y-3 pt-2 border-t border-purple-900/30">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-purple-400" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                      Mensagens Privadas (Direct Messages)
                    </h4>
                  </div>

                  {/* Toggle: Permitir recebimento de mensagens privadas */}
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-3.5">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-white">Receber Mensagens Privadas</span>
                      <p className="text-[11px] text-purple-300/70">
                        Habilitar ou desativar completamente a caixa de entrada de conversas no perfil.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={allowDirectMessages}
                      aria-label="Receber mensagens privadas"
                      onClick={() => setAllowDirectMessages(!allowDirectMessages)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        allowDirectMessages ? 'bg-purple-600' : 'bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          allowDirectMessages ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Scope of Who Can Message */}
                  {allowDirectMessages && (
                    <div className="rounded-xl border border-purple-900/40 bg-[#0c0819] p-3.5 space-y-3 animate-in fade-in">
                      <span className="text-xs font-bold text-white block">
                        Quem pode enviar mensagens para você:
                      </span>

                      <div className="space-y-2">
                        {/* Option 1: Everyone */}
                        <label
                          className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                            directMessagesFrom === 'everyone'
                              ? 'bg-purple-950/60 border-purple-500 text-white'
                              : 'bg-[#0A0713] border-purple-900/30 text-purple-200/80 hover:border-purple-800/60'
                          }`}
                        >
                          <input
                            type="radio"
                            name="directMessagesFrom"
                            value="everyone"
                            checked={directMessagesFrom === 'everyone'}
                            onChange={() => setDirectMessagesFrom('everyone')}
                            className="mt-0.5 text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                            <span className="text-xs font-bold block">Qualquer membro do Hikari</span>
                            <span className="text-[11px] text-purple-300/60 block">
                              Qualquer usuário da comunidade pode iniciar uma conversa com você.
                            </span>
                          </div>
                        </label>

                        {/* Option 2: Followers */}
                        <label
                          className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                            directMessagesFrom === 'followers'
                              ? 'bg-purple-950/60 border-purple-500 text-white'
                              : 'bg-[#0A0713] border-purple-900/30 text-purple-200/80 hover:border-purple-800/60'
                          }`}
                        >
                          <input
                            type="radio"
                            name="directMessagesFrom"
                            value="followers"
                            checked={directMessagesFrom === 'followers'}
                            onChange={() => setDirectMessagesFrom('followers')}
                            className="mt-0.5 text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                            <span className="text-xs font-bold block">Apenas seguidores</span>
                            <span className="text-[11px] text-purple-300/60 block">
                              Somente usuários que já seguem o seu perfil podem enviar mensagens.
                            </span>
                          </div>
                        </label>

                        {/* Option 3: Mutual */}
                        <label
                          className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                            directMessagesFrom === 'mutual'
                              ? 'bg-purple-950/60 border-purple-500 text-white'
                              : 'bg-[#0A0713] border-purple-900/30 text-purple-200/80 hover:border-purple-800/60'
                          }`}
                        >
                          <input
                            type="radio"
                            name="directMessagesFrom"
                            value="mutual"
                            checked={directMessagesFrom === 'mutual'}
                            onChange={() => setDirectMessagesFrom('mutual')}
                            className="mt-0.5 text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                            <span className="text-xs font-bold block">Apenas seguidores mútuos</span>
                            <span className="text-[11px] text-purple-300/60 block">
                              Ambos precisam se seguir para poder abrir ou enviar mensagens.
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section: Status Online no Chat (Presença) */}
                <div className="space-y-3 pt-2 border-t border-purple-900/30">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                      Status de Presença no Chat
                    </h4>
                  </div>

                  <div className="flex items-start justify-between gap-4 rounded-xl border border-purple-900/30 bg-[#0A0713] p-3.5">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-white">Mostrar quando estou online</span>
                      <p className="text-[11px] text-purple-300/70">
                        Exibir um pequeno ponto verde ao lado do seu nome e avatar no chat quando você estiver ativo no Hikari.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showOnlineStatus}
                      aria-label="Mostrar status online no chat"
                      onClick={() => setShowOnlineStatus(!showOnlineStatus)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        showOnlineStatus ? 'bg-emerald-600' : 'bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          showOnlineStatus ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="rounded-xl bg-[#0c0819] border border-purple-900/40 p-2.5 text-[11px] text-purple-200/80 leading-relaxed">
                    {showOnlineStatus ? (
                      <span>
                        Seu status de presença está <strong>visível</strong>. Outros participantes verão o indicador verde discreto enquanto você estiver navegando ou conversando.
                      </span>
                    ) : (
                      <span>
                        Seu status de presença está <strong>oculto</strong>. Os outros membros da comunidade não visualizarão o indicador verde no seu perfil nem nas conversas.
                      </span>
                    )}
                  </div>
                </div>

                {/* Section: Blocked Users Management */}
                <div className="space-y-3 pt-2 border-t border-purple-900/30">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-purple-400" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                      Usuários Bloqueados ({blockedIds.length})
                    </h4>
                  </div>

                  {blockedIds.length > 0 ? (
                    <div className="space-y-2 rounded-xl border border-purple-900/30 bg-[#0A0713] p-3 max-h-48 overflow-y-auto">
                      {blockedIds.map((bId) => {
                        const targetUser = otherProfiles[bId];
                        const name = targetUser?.displayName || bId;
                        const userAt = targetUser?.username || bId;

                        return (
                          <div
                            key={bId}
                            className="flex items-center justify-between gap-3 p-2 rounded-lg bg-[#140D24] border border-purple-950/60"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {targetUser?.avatarUrl ? (
                                <img
                                  src={targetUser.avatarUrl}
                                  alt={name}
                                  className="h-8 w-8 rounded-lg object-cover border border-purple-900/40 shrink-0"
                                />
                              ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-900 text-xs font-bold text-white shrink-0">
                                  {name.charAt(0)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <span className="text-xs font-bold text-white truncate block">
                                  {name}
                                </span>
                                <span className="text-[10px] text-purple-400/70 truncate block">
                                  @{userAt}
                                </span>
                              </div>
                            </div>

                            {onUnblockUser && (
                              <button
                                type="button"
                                onClick={() => onUnblockUser(bId)}
                                className="rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-600/40 px-2.5 py-1 text-xs font-semibold text-rose-200 transition-colors cursor-pointer shrink-0"
                              >
                                Desbloquear
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-purple-900/20 bg-[#0A0713] p-3.5 text-xs text-purple-300/60 text-center">
                      Nenhum usuário bloqueado no momento.
                    </div>
                  )}
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
                    Vincule suas contas de plataformas parceiras para consultar e importar sua lista de animes e foto de perfil.
                  </p>
                </div>

                {/* Success Banners */}
                {importSuccessMsg && (
                  <div
                    role="alert"
                    className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 text-xs text-emerald-200 animate-in fade-in"
                  >
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{importSuccessMsg}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setImportSuccessMsg(null)}
                      className="text-emerald-400 hover:text-white cursor-pointer shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {malSuccessMsg && (
                  <div
                    role="alert"
                    className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 text-xs text-emerald-200 animate-in fade-in"
                  >
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{malSuccessMsg}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMalSuccessMsg(null)}
                      className="text-emerald-400 hover:text-white cursor-pointer shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* AniList Card & Management */}
                <div className="rounded-xl border border-purple-900/40 bg-[#0A0713] p-4 space-y-4">
                  {/* AniList Top Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#02A9FF]/15 text-[#02A9FF] border border-[#02A9FF]/30 font-bold shrink-0 text-base shadow-sm">
                        AL
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">AniList</span>
                          {anilistConnected ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                              <Check className="h-2.5 w-2.5" /> Conectado
                            </span>
                          ) : (
                            <span className="rounded bg-neutral-900/80 border border-neutral-700/50 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                              Não conectado
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-purple-300/60 mt-0.5">
                          {anilistConnected
                            ? `Conta vinculada: @${anilistUsername}`
                            : 'Vincule seu nome de usuário público para importar sua coleção de animes.'}
                        </p>
                      </div>
                    </div>

                    {/* Quick status button when connected */}
                    {anilistConnected && !isConfirmingDisconnect && (
                      <button
                        type="button"
                        onClick={() => setIsConfirmingDisconnect(true)}
                        className="rounded-lg border border-rose-900/50 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 hover:text-rose-100 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer self-start sm:self-auto shrink-0"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>

                  {/* Disconnect Confirmation Alert */}
                  {anilistConnected && isConfirmingDisconnect && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3.5 space-y-2.5">
                      <div className="flex items-start gap-2 text-amber-200 text-xs">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                        <div>
                          <p className="font-semibold text-white">
                            Desconectar @{anilistUsername}?
                          </p>
                          <p className="text-[11px] text-amber-200/80 mt-0.5">
                            Sua lista de animes já importada permanecerá 100% intacta no Hikari. Somente o vínculo do nome de usuário será desfeito.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => setIsConfirmingDisconnect(false)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-purple-300 hover:text-white transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAnilistConnected(false);
                            setAnilistUsername('');
                            setAnilistAvatarUrl('');
                            setAnilistLastSync('');
                            setAnilistAccountCreatedAt('');
                            setAniListPreview(null);
                            setRawIncomingEntries(null);
                            setIsConfirmingDisconnect(false);
                            onSaveProfile({
                              externalAccounts: {
                                ...profile.externalAccounts,
                                anilist: { connected: false },
                              },
                            });
                            setImportSuccessMsg('Conta AniList desconectada. Sua lista de animes foi preservada.');
                          }}
                          className="rounded-lg bg-rose-700 hover:bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer"
                        >
                          Confirmar Desconexão
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Connected Account Details & Primary Actions */}
                  {anilistConnected && (
                    <div className="rounded-xl border border-purple-900/30 bg-[#120d22] p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {anilistAvatarUrl ? (
                            <img
                              src={anilistAvatarUrl}
                              alt={`Avatar AniList de ${anilistUsername}`}
                              className="h-10 w-10 rounded-full object-cover border border-purple-500/40 shrink-0"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-950 border border-purple-700 text-xs font-bold text-white shrink-0">
                              {anilistUsername.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white">@{anilistUsername}</span>
                              <a
                                href={`https://anilist.co/user/${encodeURIComponent(anilistUsername)}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-purple-400 hover:text-purple-200 transition-colors"
                                title="Abrir perfil no AniList"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <div className="mt-1 space-y-0.5 text-[11px]">
                              <div className="flex items-center gap-1.5 text-purple-300/80">
                                <Calendar className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                                <span>
                                  Criação da conta:{' '}
                                  <span className="text-purple-200/90 font-medium">
                                    Não disponibilizada pela plataforma
                                  </span>
                                </span>
                              </div>
                              <span className="text-purple-400/70 block">
                                {anilistLastSync
                                  ? `Última sincronização: ${anilistLastSync}`
                                  : 'Nenhuma importação realizada ainda nesta sessão.'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons: Import & Sync Avatar */}
                        <div className="flex flex-wrap items-center gap-2">
                          {anilistAvatarUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateAvatar(anilistAvatarUrl);
                                setImportSuccessMsg('Foto de perfil do Hikari atualizada com o avatar do AniList!');
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-800/40 bg-purple-950/60 hover:bg-purple-900/60 px-3 py-1.5 text-xs font-medium text-purple-200 transition-colors cursor-pointer"
                              title="Aplicar avatar do AniList como sua foto de perfil no Hikari"
                            >
                              <Camera className="h-3.5 w-3.5 text-purple-400" />
                              <span>Usar como foto de perfil</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isFetchingCollection || isImporting}
                            onClick={async () => {
                              setIsFetchingCollection(true);
                              setCollectionError(null);
                              setAniListPreview(null);
                              setImportSuccessMsg(null);
                              try {
                                const entries = await fetchAniListAnimeList(anilistUsername);
                                setRawIncomingEntries(entries);
                                const preview = calculateAniListImportPreview(
                                  entries,
                                  currentAnimes,
                                  anilistUsername
                                );
                                setAniListPreview(preview);
                              } catch (err) {
                                setCollectionError(
                                  err instanceof Error ? err.message : 'Falha ao buscar a lista do AniList.'
                                );
                              } finally {
                                setIsFetchingCollection(false);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isFetchingCollection ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Buscando lista...</span>
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5" />
                                <span>Consultar e Importar Lista</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Error Banner when fetching collection */}
                      {collectionError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                          <div className="flex-1">
                            <span className="leading-relaxed">{collectionError}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Disconnected State: Form to Enter Username & Validate via GraphQL */}
                  {!anilistConnected && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="anilist-username-input"
                          className="block text-xs font-medium text-purple-200"
                        >
                          Nome de usuário público no AniList
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <div className="relative flex-1 flex items-center">
                            <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-purple-400/70" />
                            <input
                              id="anilist-username-input"
                              type="text"
                              value={inputAniListUsername}
                              disabled={isCheckingAniListUser}
                              onChange={(e) => {
                                setInputAniListUsername(e.target.value);
                                setAniListUserError(null);
                                setVerifiedAniListUser(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (inputAniListUsername.trim() && !isCheckingAniListUser) {
                                    // Trigger check
                                    const cleanName = inputAniListUsername.trim();
                                    setIsCheckingAniListUser(true);
                                    setAniListUserError(null);
                                    setVerifiedAniListUser(null);
                                    fetchAniListUser(cleanName)
                                      .then((user) => setVerifiedAniListUser(user))
                                      .catch((err) =>
                                        setAniListUserError(
                                          err instanceof Error ? err.message : 'Erro ao buscar usuário.'
                                        )
                                      )
                                      .finally(() => setIsCheckingAniListUser(false));
                                  }
                                }
                              }}
                              placeholder="Ex: Test, seu_usuario_anilist"
                              className="w-full rounded-xl border border-purple-900/40 bg-[#120d22] py-2 pl-10 pr-3 text-xs text-white placeholder:text-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={!inputAniListUsername.trim() || isCheckingAniListUser}
                            onClick={async () => {
                              const cleanName = inputAniListUsername.trim();
                              if (!cleanName) return;
                              setIsCheckingAniListUser(true);
                              setAniListUserError(null);
                              setVerifiedAniListUser(null);
                              try {
                                const user = await fetchAniListUser(cleanName);
                                setVerifiedAniListUser(user);
                              } catch (err) {
                                setAniListUserError(
                                  err instanceof Error ? err.message : 'Erro ao validar conta no AniList.'
                                );
                              } finally {
                                setIsCheckingAniListUser(false);
                              }
                            }}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isCheckingAniListUser ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Verificando...</span>
                              </>
                            ) : (
                              <span>Verificar Usuário</span>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Error feedback */}
                      {aniListUserError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                          <span className="leading-relaxed">{aniListUserError}</span>
                        </div>
                      )}

                      {/* Verified User Confirmation Card */}
                      {verifiedAniListUser && (
                        <div className="rounded-xl border border-purple-700/50 bg-[#16102b] p-3.5 space-y-3 animate-in fade-in">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              {verifiedAniListUser.avatarUrl ? (
                                <img
                                  src={verifiedAniListUser.avatarUrl}
                                  alt={verifiedAniListUser.name}
                                  className="h-10 w-10 rounded-full object-cover border border-purple-500/40 shrink-0"
                                />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-900 text-xs font-bold text-white shrink-0">
                                  {verifiedAniListUser.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <div className="text-xs font-bold text-white">
                                  {verifiedAniListUser.name}
                                </div>
                                <div className="text-[11px] text-purple-300/70">
                                  Perfil verificado com sucesso no AniList
                                  {typeof verifiedAniListUser.animeCount === 'number' &&
                                    ` (${verifiedAniListUser.animeCount} animes na lista)`}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setAnilistConnected(true);
                                setAnilistUsername(verifiedAniListUser.name);
                                setAnilistAvatarUrl(verifiedAniListUser.avatarUrl);
                                onSaveProfile({
                                  externalAccounts: {
                                    ...profile.externalAccounts,
                                    anilist: {
                                      connected: true,
                                      username: verifiedAniListUser.name,
                                      avatarUrl: verifiedAniListUser.avatarUrl,
                                    },
                                  },
                                });
                                setImportSuccessMsg(
                                  `Conta @${verifiedAniListUser.name} conectada com sucesso! Você já pode consultar e importar sua lista de animes.`
                                );
                                setVerifiedAniListUser(null);
                                setInputAniListUsername('');
                              }}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer shrink-0"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Conectar Esta Conta</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PREVIEW & CONFIRMATION PANEL (Triggered upon fetching anime list) */}
                  {aniListPreview && rawIncomingEntries && (
                    <div className="rounded-xl border border-purple-700/60 bg-[#16102c] p-4 space-y-4 animate-in fade-in">
                      <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                            <Layers className="h-4 w-4 text-purple-400" />
                            <span>Prévia de Importação: @{aniListPreview.username}</span>
                          </h4>
                          <p className="text-[11px] text-purple-300/70 mt-0.5">
                            Revise os dados antes de confirmar a importação para o seu perfil.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAniListPreview(null)}
                          className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Summary Metrics Pills */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="rounded-lg bg-[#0e0a1c] border border-purple-900/40 p-2.5 text-center">
                          <span className="text-base font-bold text-white block">
                            {aniListPreview.totalIncoming}
                          </span>
                          <span className="text-[10px] text-purple-300/60 uppercase font-medium">
                            Total no AniList
                          </span>
                        </div>

                        <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/30 p-2.5 text-center">
                          <span className="text-base font-bold text-emerald-300 block">
                            +{aniListPreview.newItems.length}
                          </span>
                          <span className="text-[10px] text-emerald-400/80 uppercase font-medium">
                            Novos para adicionar
                          </span>
                        </div>

                        <div className="rounded-lg bg-purple-950/60 border border-purple-700/40 p-2.5 text-center">
                          <span className="text-base font-bold text-purple-200 block">
                            {aniListPreview.matchedItems.length}
                          </span>
                          <span className="text-[10px] text-purple-300/70 uppercase font-medium">
                            Já no seu perfil
                          </span>
                        </div>

                        <div className="rounded-lg bg-indigo-950/40 border border-indigo-500/30 p-2.5 text-center">
                          <span className="text-base font-bold text-indigo-300 block">
                            {aniListPreview.itemsWithUpdates.length}
                          </span>
                          <span className="text-[10px] text-indigo-300/70 uppercase font-medium">
                            Com atualizações
                          </span>
                        </div>
                      </div>

                      {/* Merge Preferences Toggle */}
                      <div className="rounded-xl border border-purple-900/40 bg-[#0e0a1c] p-3 space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={updateExistingProgress}
                            onChange={(e) => setUpdateExistingProgress(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-purple-700 text-purple-600 focus:ring-purple-500 focus:ring-offset-0 bg-[#120d22] cursor-pointer"
                          />
                          <div className="text-xs">
                            <span className="font-semibold text-white block">
                              Atualizar progresso e notas dos animes já existentes
                            </span>
                            <span className="text-[11px] text-purple-300/70 block mt-0.5">
                              Seus animes favoritos e registros manuais do Hikari nunca serão removidos ou desmarcados.
                            </span>
                          </div>
                        </label>
                      </div>

                      {/* Scrollable Sample Preview of Incoming Items */}
                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider block">
                          Amostra da Lista a ser Importada ({rawIncomingEntries.length} animes):
                        </span>
                        <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 divide-y divide-purple-900/20">
                          {rawIncomingEntries.slice(0, 30).map((entry) => {
                            const isNew = !aniListPreview.matchedItems.some(
                              (m) => m.incoming.anilistId === entry.anilistId
                            );
                            const matched = aniListPreview.matchedItems.find(
                              (m) => m.incoming.anilistId === entry.anilistId
                            );
                            const hasChanges = Boolean(matched && matched.hasChanges);

                            return (
                              <div
                                key={entry.anilistId}
                                className="flex items-center justify-between gap-3 py-1.5 text-xs"
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  {entry.posterUrl ? (
                                    <img
                                      src={entry.posterUrl}
                                      alt={entry.title}
                                      className="h-9 w-6 rounded object-cover border border-purple-900/50 shrink-0"
                                    />
                                  ) : (
                                    <div className="h-9 w-6 rounded bg-purple-950 border border-purple-800 shrink-0" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-white">{entry.title}</div>
                                    <div className="text-[10px] text-purple-300/60 truncate">
                                      {STATUS_LABELS_PT[entry.status]} · Ep. {entry.currentEpisode}/{entry.totalEpisodes || '?'}
                                      {entry.rating > 0 && ` · Nota ${entry.rating}/10`}
                                    </div>
                                  </div>
                                </div>

                                <div className="shrink-0 text-right">
                                  {isNew ? (
                                    <span className="rounded bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                      Novo
                                    </span>
                                  ) : hasChanges ? (
                                    <span className="rounded bg-indigo-950/80 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                                      Atualizar
                                    </span>
                                  ) : (
                                    <span className="rounded bg-neutral-900 border border-neutral-700/40 px-2 py-0.5 text-[10px] text-neutral-400">
                                      Sem alterações
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {rawIncomingEntries.length > 30 && (
                          <div className="text-[10px] text-purple-400/60 text-center pt-1">
                            ... e mais {rawIncomingEntries.length - 30} animes na lista.
                          </div>
                        )}
                      </div>

                      {/* Confirmation Action Bar */}
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-purple-900/40">
                        <span className="text-[11px] text-purple-300/70">
                          {aniListPreview.newItems.length} novos animes serão adicionados
                          {updateExistingProgress &&
                            aniListPreview.itemsWithUpdates.length > 0 &&
                            ` e ${aniListPreview.itemsWithUpdates.length} animes atualizados`}
                          .
                        </span>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            disabled={isImporting}
                            onClick={() => setAniListPreview(null)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-white transition-colors cursor-pointer"
                          >
                            Cancelar
                          </button>

                          <button
                            type="button"
                            disabled={isImporting}
                            onClick={() => {
                              setIsImporting(true);
                              const { mergedList, addedCount, updatedCount } = mergeAniListImport(
                                rawIncomingEntries,
                                currentAnimes,
                                updateExistingProgress
                              );

                              const now = new Date();
                              const formattedDate = `${now.toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              })} às ${now.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`;

                              setAnilistLastSync(formattedDate);

                              if (onSyncAniList) {
                                onSyncAniList(mergedList, {
                                  connected: true,
                                  username: anilistUsername,
                                  avatarUrl: anilistAvatarUrl,
                                  lastSync: formattedDate,
                                });
                              }

                              setImportSuccessMsg(
                                `Importação concluída com sucesso! ${addedCount} novos animes adicionados e ${updatedCount} animes atualizados na sua lista.`
                              );
                              setAniListPreview(null);
                              setRawIncomingEntries(null);
                              setIsImporting(false);
                            }}
                            className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-purple-950 transition-all cursor-pointer"
                          >
                            {isImporting ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Gravando animes...</span>
                              </>
                            ) : (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>Confirmar e Importar</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* MyAnimeList Section */}
                <div className="space-y-4 rounded-xl border border-purple-900/40 bg-[#0A0713] p-4">
                  {/* Top Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2E51A2]/20 text-[#4e74ca] border border-[#2E51A2]/40 font-bold shrink-0 text-base shadow-sm">
                        MAL
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">MyAnimeList</span>
                          {malConnected ? (
                            <span className="rounded bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-300 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Conectado
                            </span>
                          ) : (
                            <span className="rounded bg-purple-950/70 border border-purple-800/40 px-1.5 py-0.2 text-[10px] text-purple-300/70 font-medium">
                              OAuth 2.0 PKCE
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-purple-300/60 mt-0.5">
                          {malConnected
                            ? `Sincronizado com @${malUsername}`
                            : 'Conecte sua conta MyAnimeList oficial via autorização segura OAuth 2.0 com PKCE.'}
                        </p>
                      </div>
                    </div>

                    {/* Disconnect button in header if connected */}
                    {malConnected && (
                      <button
                        type="button"
                        onClick={() => setIsConfirmingDisconnectMAL(true)}
                        className="rounded-lg border border-purple-800/40 bg-purple-950/40 hover:bg-rose-950/50 hover:border-rose-700/60 hover:text-rose-200 px-3 py-1.5 text-xs font-medium text-purple-300 transition-colors cursor-pointer self-start sm:self-auto"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>

                  {/* Disconnect Confirmation Alert */}
                  {malConnected && isConfirmingDisconnectMAL && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3.5 space-y-2.5">
                      <div className="flex items-start gap-2 text-amber-200 text-xs">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                        <div>
                          <p className="font-semibold text-white">
                            Desconectar @{malUsername} do MyAnimeList?
                          </p>
                          <p className="text-[11px] text-amber-200/80 mt-0.5">
                            Sua lista de animes já importada permanecerá 100% intacta no Hikari. Somente o vínculo do token com a sessão será desfeito.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => setIsConfirmingDisconnectMAL(false)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-purple-300 hover:text-white transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={handleDisconnectMAL}
                          className="rounded-lg bg-rose-700 hover:bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer"
                        >
                          Confirmar Desconexão
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Connected Account Details & Primary Actions */}
                  {malConnected && (
                    <div className="rounded-xl border border-purple-900/30 bg-[#120d22] p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {malAvatarUrl ? (
                            <img
                              src={malAvatarUrl}
                              alt={`Avatar MyAnimeList de ${malUsername}`}
                              className="h-10 w-10 rounded-full object-cover border border-[#2E51A2]/50 shrink-0"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1b2b52] border border-[#2E51A2] text-xs font-bold text-white shrink-0">
                              {malUsername.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white">@{malUsername}</span>
                              <a
                                href={`https://myanimelist.net/profile/${encodeURIComponent(malUsername)}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-purple-400 hover:text-purple-200 transition-colors"
                                title="Abrir perfil no MyAnimeList"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <div className="mt-1 space-y-0.5 text-[11px]">
                              <div className="flex items-center gap-1.5 text-purple-300/80">
                                <Calendar className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                <span>
                                  Criação da conta:{' '}
                                  <strong className="text-purple-200/90 font-medium">
                                    {malAccountCreatedAt || 'Informação indisponível'}
                                  </strong>
                                </span>
                              </div>
                              <span className="text-purple-400/70 block">
                                {malLastSync
                                  ? `Última sincronização: ${malLastSync}`
                                  : 'Nenhuma importação realizada ainda nesta sessão.'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons: Import & Sync Avatar */}
                        <div className="flex flex-wrap items-center gap-2">
                          {malAvatarUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateAvatar(malAvatarUrl);
                                setMalSuccessMsg('Foto de perfil do Hikari atualizada com o avatar do MyAnimeList!');
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E51A2]/40 bg-[#16213f]/60 hover:bg-[#1f2e56]/60 px-3 py-1.5 text-xs font-medium text-blue-200 transition-colors cursor-pointer"
                              title="Aplicar avatar do MyAnimeList como sua foto de perfil no Hikari"
                            >
                              <Camera className="h-3.5 w-3.5 text-blue-400" />
                              <span>Usar como foto de perfil</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isFetchingMALList || isImportingMAL}
                            onClick={handleFetchMALList}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2E51A2] hover:bg-[#254388] disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
                          >
                            {isFetchingMALList ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Buscando lista MAL...</span>
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5" />
                                <span>Consultar e Importar Lista</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Error Banner when fetching MAL list */}
                      {malListError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                          <div className="flex-1">
                            <span className="leading-relaxed">{malListError}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Disconnected State: Connect via OAuth PKCE or show missing config guidance */}
                  {!malConnected && (
                    <div className="space-y-3 pt-1">
                      {/* Configuration notice if server has no MAL_CLIENT_ID */}
                      {malStatus && !malStatus.configured && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3.5 space-y-2">
                          <div className="flex items-start gap-2 text-xs text-amber-200">
                            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                            <div>
                              <p className="font-semibold text-white">
                                Configuração necessária para MyAnimeList OAuth 2.0 PKCE
                              </p>
                              <p className="text-[11px] text-amber-200/80 mt-1 leading-relaxed">
                                Para autenticar contas reais via MyAnimeList API v2 oficial, defina a credencial <code className="bg-black/50 px-1 py-0.5 rounded text-amber-300 font-mono">MAL_CLIENT_ID</code> no arquivo de ambiente do servidor.
                              </p>
                              <div className="mt-2 text-[11px] text-amber-200/90 space-y-1">
                                <div><strong>URI de Redirecionamento oficial a cadastrar no MAL:</strong></div>
                                <code className="block bg-black/60 border border-amber-500/30 px-2.5 py-1.5 rounded text-purple-200 break-all select-all font-mono text-[11px]">
                                  {malStatus.redirectUri || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/mal/callback`}
                                </code>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Connect button */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-purple-300/80">
                          {malStatus?.configured
                            ? 'Clique abaixo para abrir a janela oficial de autorização do MyAnimeList.'
                            : 'O fluxo OAuth 2.0 PKCE com code_verifier/code_challenge seguro e rotas de backend estão totalmente implementados.'}
                        </p>
                        <button
                          type="button"
                          disabled={isStartingMALAuth}
                          onClick={handleConnectMAL}
                          className="flex items-center justify-center gap-2 rounded-xl bg-[#2E51A2] hover:bg-[#254388] disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed shrink-0"
                        >
                          {isStartingMALAuth ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Conectando...</span>
                            </>
                          ) : (
                            <>
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>Conectar com MyAnimeList</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Error feedback */}
                      {malAuthError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                          <span className="leading-relaxed">{malAuthError}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MAL PREVIEW & CONFIRMATION PANEL */}
                  {malPreview && rawMALEntries && (
                    <div className="rounded-xl border border-[#2E51A2]/60 bg-[#111628] p-4 space-y-4 animate-in fade-in">
                      <div className="flex items-center justify-between border-b border-[#2E51A2]/30 pb-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                            <Layers className="h-4 w-4 text-blue-400" />
                            <span>Prévia de Importação: @{malPreview.username} (MyAnimeList)</span>
                          </h4>
                          <p className="text-[11px] text-blue-200/70 mt-0.5">
                            Revise os dados antes de confirmar a importação para o seu perfil.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMalPreview(null)}
                          className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Summary Metrics Pills */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="rounded-lg bg-[#0a0d17] border border-[#2E51A2]/30 p-2.5 text-center">
                          <span className="text-base font-bold text-white block">
                            {malPreview.totalIncoming}
                          </span>
                          <span className="text-[10px] text-blue-300/60 uppercase font-medium">
                            Total no MAL
                          </span>
                        </div>

                        <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/30 p-2.5 text-center">
                          <span className="text-base font-bold text-emerald-300 block">
                            +{malPreview.newItems.length}
                          </span>
                          <span className="text-[10px] text-emerald-400/80 uppercase font-medium">
                            Novos para adicionar
                          </span>
                        </div>

                        <div className="rounded-lg bg-purple-950/60 border border-purple-700/40 p-2.5 text-center">
                          <span className="text-base font-bold text-purple-200 block">
                            {malPreview.matchedItems.length}
                          </span>
                          <span className="text-[10px] text-purple-300/70 uppercase font-medium">
                            Já no seu perfil
                          </span>
                        </div>

                        <div className="rounded-lg bg-indigo-950/40 border border-indigo-500/30 p-2.5 text-center">
                          <span className="text-base font-bold text-indigo-300 block">
                            {malPreview.itemsWithUpdates.length}
                          </span>
                          <span className="text-[10px] text-indigo-300/70 uppercase font-medium">
                            Com atualizações
                          </span>
                        </div>
                      </div>

                      {/* Merge Preferences Toggle */}
                      <div className="rounded-xl border border-[#2E51A2]/30 bg-[#0a0d17] p-3 space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={updateExistingProgressMAL}
                            onChange={(e) => setUpdateExistingProgressMAL(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-purple-700 text-[#2E51A2] focus:ring-[#2E51A2] focus:ring-offset-0 bg-[#120d22] cursor-pointer"
                          />
                          <div className="text-xs">
                            <span className="font-semibold text-white block">
                              Atualizar progresso e notas dos animes já existentes
                            </span>
                            <span className="text-[11px] text-purple-300/70 block mt-0.5">
                              Seus animes favoritos e registros manuais do Hikari nunca serão removidos ou desmarcados.
                            </span>
                          </div>
                        </label>
                      </div>

                      {/* Scrollable Sample Preview of Incoming MAL Items */}
                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wider block">
                          Amostra da Lista a ser Importada ({rawMALEntries.length} animes):
                        </span>
                        <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 divide-y border-t border-b border-[#2E51A2]/20 divide-[#2E51A2]/20">
                          {rawMALEntries.slice(0, 30).map((entry) => {
                            const isNew = !malPreview.matchedItems.some(
                              (m) => m.incoming.malId === entry.malId
                            );
                            const matched = malPreview.matchedItems.find(
                              (m) => m.incoming.malId === entry.malId
                            );
                            const hasChanges = Boolean(matched && matched.hasChanges);

                            return (
                              <div
                                key={entry.malId}
                                className="flex items-center justify-between gap-3 py-1.5 text-xs"
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  {entry.posterUrl ? (
                                    <img
                                      src={entry.posterUrl}
                                      alt={entry.title}
                                      className="h-9 w-6 rounded object-cover border border-[#2E51A2]/50 shrink-0"
                                    />
                                  ) : (
                                    <div className="h-9 w-6 rounded bg-[#101931] border border-[#2E51A2]/40 shrink-0" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-white">{entry.title}</div>
                                    <div className="text-[10px] text-blue-200/70 truncate">
                                      {MAL_STATUS_LABELS_PT[entry.status]} · Ep. {entry.currentEpisode}/{entry.totalEpisodes || '?'}
                                      {entry.rating > 0 && ` · Nota ${entry.rating}/10`}
                                    </div>
                                  </div>
                                </div>

                                <div className="shrink-0 text-right">
                                  {isNew ? (
                                    <span className="rounded bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                      Novo
                                    </span>
                                  ) : hasChanges ? (
                                    <span className="rounded bg-indigo-950/80 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                                      Atualizar
                                    </span>
                                  ) : (
                                    <span className="rounded bg-neutral-900 border border-neutral-700/40 px-2 py-0.5 text-[10px] text-neutral-400">
                                      Sem alterações
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {rawMALEntries.length > 30 && (
                          <div className="text-[10px] text-blue-300/60 text-center pt-1">
                            ... e mais {rawMALEntries.length - 30} animes na lista.
                          </div>
                        )}
                      </div>

                      {/* Confirmation Action Bar */}
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-[#2E51A2]/30">
                        <span className="text-[11px] text-blue-200/80">
                          {malPreview.newItems.length} novos animes serão adicionados
                          {updateExistingProgressMAL &&
                            malPreview.itemsWithUpdates.length > 0 &&
                            ` e ${malPreview.itemsWithUpdates.length} animes atualizados`}
                          .
                        </span>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            disabled={isImportingMAL}
                            onClick={() => setMalPreview(null)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-white transition-colors cursor-pointer"
                          >
                            Cancelar
                          </button>

                          <button
                            type="button"
                            disabled={isImportingMAL}
                            onClick={handleConfirmMALImport}
                            className="flex items-center gap-1.5 rounded-lg bg-[#2E51A2] hover:bg-[#254388] disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white shadow-md transition-all cursor-pointer"
                          >
                            {isImportingMAL ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Gravando animes...</span>
                              </>
                            ) : (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>Confirmar e Importar</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Privacy & Security Footnote */}
                <div className="flex items-start gap-2.5 rounded-xl bg-purple-950/40 p-3.5 text-[11px] text-purple-300/80 border border-purple-900/30">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-purple-400 mt-0.5" />
                  <span>
                    <strong>Segurança e Privacidade:</strong> As integrações com o AniList e o MyAnimeList utilizam as APIs oficiais (GraphQL e OAuth 2.0 com PKCE). Não solicitamos senhas nem expomos credenciais externas ou tokens no frontend.
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


                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer with Action Buttons */}
        <div className="flex items-center justify-between border-t border-purple-900/30 px-4 sm:px-6 py-3.5 sm:py-4 bg-[#0e0a1b] shrink-0">
          <div className="min-h-5 flex items-center">
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium animate-in fade-in">
                <Check className="h-4 w-4" />
                Alterações salvas!
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-xs font-semibold text-purple-300 hover:text-white hover:bg-purple-950/40 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-purple-950 transition-all border border-purple-400/40 cursor-pointer active:scale-98"
            >
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
