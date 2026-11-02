import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Bell, 
  Search, 
  User, 
  Settings, 
  Users, 
  Link2, 
  ShieldCheck, 
  LogOut, 
  LogIn,
  Check, 
  X,
  ExternalLink,
  Lock,
  Eye,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Camera,
  Shield
} from 'lucide-react';
import { UserProfile, NotificationItem, AnimeItem, AUTHORIZED_ADMIN_UID } from '../types';
import { HikariEternalBadge } from './badge/HikariEternalBadge';
import { AetherAnimatedName } from './badge/AetherAnimatedName';

interface HeaderProps {
  currentUser: UserProfile;
  activeProfile: UserProfile;
  animes?: AnimeItem[];
  searchableProfiles?: UserProfile[];
  notifications: NotificationItem[];
  isNotifOpen: boolean;
  onToggleNotif: (open: boolean) => void;
  onOpenSettings: (initialTab?: 'profile' | 'privacy' | 'connected' | 'security') => void;
  onOpenFollowers: (initialTab?: 'followers' | 'following' | 'requests') => void;
  onSelectProfile: (userId: string) => void;
  onSelectAnime?: (animeId: string) => void;
  onMarkNotificationAsRead: (id: string) => void;
  onMarkNotificationsAsRead?: (ids: string[]) => void;
  onMarkAllNotificationsAsRead: () => void;
  onSelectNotification: (notif: NotificationItem) => void;
  onSelectNotificationActor?: (notif: NotificationItem) => void;
  onNavigateTab: (tab: 'overview' | 'animes' | 'comments' | 'about' | 'activity' | 'favorites') => void;
  onAcceptRequest: (requestId: string, notifId?: string) => void;
  onRejectRequest: (requestId: string, notifId?: string) => void;
  isAuthenticated?: boolean;
  authenticatedEmail?: string | null;
  onLogout?: () => void;
  onOpenAuth?: (mode?: 'login' | 'signup') => void;
  onOpenMessages?: () => void;
  unreadMessagesCount?: number;
  onOpenAdminPanel?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeProfile: _activeProfile,
  animes = [],
  searchableProfiles = [],
  notifications,
  isNotifOpen,
  onToggleNotif,
  onOpenSettings,
  onOpenFollowers,
  onSelectProfile,
  onSelectAnime,
  onMarkNotificationAsRead,
  onMarkAllNotificationsAsRead,
  onSelectNotification,
  onSelectNotificationActor,
  onNavigateTab,
  onAcceptRequest,
  onRejectRequest,
  isAuthenticated = false,
  authenticatedEmail = null,
  onLogout,
  onOpenAuth,
  onOpenMessages,
  unreadMessagesCount = 0,
  onOpenAdminPanel,
}) => {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const notifListRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
      if (
        notifRef.current &&
        !notifRef.current.contains(target) &&
        (!notifPanelRef.current || !notifPanelRef.current.contains(target))
      ) {
        onToggleNotif(false);
      }
      if (searchRef.current && !searchRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onToggleNotif]);

  // Close notifications panel on Escape key
  useEffect(() => {
    if (!isNotifOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onToggleNotif(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isNotifOpen, onToggleNotif]);

  // Lock background scrolling cleanly while user menu is open (Item 2)
  useEffect(() => {
    if (!isUserMenuOpen) return;

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalTouchAction = document.body.style.touchAction;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.touchAction = originalTouchAction;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen]);

  const searchResults = searchQuery.trim()
    ? (isAuthenticated
        ? [
            {
              type: 'user' as const,
              id: currentUser.id,
              name: currentUser.displayName,
              sub: `@${currentUser.username} (Meu Perfil)`,
              avatar: currentUser.avatarUrl,
            },
            ...searchableProfiles
              .filter((p) => p.id && p.id !== currentUser.id)
              .map((p) => ({
                type: 'user' as const,
                id: p.id,
                name: p.displayName,
                sub: `@${p.username} (${p.isPrivate ? 'Perfil Privado' : 'Perfil Público'})`,
                avatar: p.avatarUrl,
              })),
            ...animes.map((anime) => ({
              type: 'anime' as const,
              id: anime.id,
              name: anime.title,
              sub: `Anime · ${anime.year}`,
              avatar: anime.posterUrl,
              tab: 'animes' as const,
            })),
          ]
        : [
            {
              type: 'user' as const,
              id: currentUser.id,
              name: currentUser.displayName,
              sub: `@${currentUser.username} (Perfil de Demonstração)`,
              avatar: currentUser.avatarUrl,
            },
            {
              type: 'user' as const,
              id: AUTHORIZED_ADMIN_UID,
              name: 'Aether',
              sub: '@aether (Hikari Eternal)',
              avatar: '',
            },
            {
              type: 'user' as const,
              id: 'usr_kuroha',
              name: 'Kuroha ✦',
              sub: '@kuroha_void (Perfil Privado)',
              avatar: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
            },
            {
              type: 'user' as const,
              id: 'usr_shinji',
              name: 'Shinji Kazuki',
              sub: '@shinji_mecha (Perfil Público)',
              avatar: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
            },
            ...animes.map((anime) => ({
              type: 'anime' as const,
              id: anime.id,
              name: anime.title,
              sub: `Anime · ${anime.year}`,
              avatar: anime.posterUrl,
              tab: 'animes' as const,
            })),
          ]
      ).filter(
        (item) =>
          item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.sub.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-purple-900/30 bg-[#0A0713]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Hikari Brand Identity */}
        <div className="flex items-center gap-6">
          <button 
            type="button"
            onClick={() => {
              onSelectProfile(currentUser.id);
              onNavigateTab('overview');
            }}
            className="group flex items-center gap-2 text-left focus:outline-none cursor-pointer"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-700 via-purple-600 to-indigo-500 shadow-md shadow-purple-900/40 ring-1 ring-purple-400/30 transition-transform group-hover:scale-105">
              <span className="text-lg font-black tracking-tighter text-white">光</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-bold tracking-tight text-white group-hover:text-purple-200 transition-colors">
                  Hikari
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 bg-purple-950/60 border border-purple-800/40 px-1.5 py-0.5 rounded">
                  Perfis
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Zone 2: Search */}
        <div ref={searchRef} className="relative hidden flex-1 max-w-md md:block">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-purple-400/70" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="Buscar perfis, animes ou discussões..."
              className="w-full rounded-xl border border-purple-900/40 bg-[#130E24]/90 py-2 pl-9 pr-4 text-sm text-purple-100 placeholder:text-purple-300/40 focus:border-purple-500 focus:bg-[#17112c] focus:outline-none focus:ring-1 focus:ring-purple-500/50 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 text-purple-400 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Search Dropdown Results */}
          {isSearchOpen && searchQuery.trim() && (
            <div className="absolute left-0 right-0 top-full mt-2 rounded-xl border border-purple-800/30 bg-[#130E24] p-2 shadow-2xl shadow-purple-950/80 backdrop-blur-xl z-50">
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-purple-400/70">
                Resultados
              </div>
              {searchResults.length === 0 ? (
                <div className="p-3 text-center text-xs text-purple-300/60">
                  Nenhum resultado encontrado para "{searchQuery}"
                </div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.type === 'user') {
                          onSelectProfile(item.id);
                        } else if (onSelectAnime) {
                          onSelectAnime(item.id);
                        } else {
                          onNavigateTab('animes');
                        }
                        setIsSearchOpen(false);
                        setSearchQuery('');
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-purple-900/30 transition-colors cursor-pointer"
                    >
                      {item.avatar ? (
                        <img 
                          src={item.avatar} 
                          alt={item.name} 
                          className="h-8 w-8 rounded-full object-cover border border-purple-500/30"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2D1B4E] to-[#170E2B] border border-purple-500/40 text-purple-200 font-bold text-xs select-none">
                          {item.name ? item.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 truncate text-xs font-medium text-white">
                          <AetherAnimatedName name={item.name} profileOrUid={item.id} />
                          <HikariEternalBadge profileOrUid={item.id} size="sm" />
                        </div>
                        <div className="truncate text-[11px] text-purple-300/60">{item.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Zone 3: Actions & Connected User */}
        <div className="flex items-center gap-3">
          {!isAuthenticated && onOpenAuth && (
            <button
              type="button"
              onClick={() => {
                setIsUserMenuOpen(false);
                setIsSearchOpen(false);
                onToggleNotif(false);
                onOpenAuth('login');
              }}
              className="flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-purple-950/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Entrar</span>
            </button>
          )}

          {/* Direct Messages Button */}
          {onOpenMessages && (
            <button
              type="button"
              onClick={() => {
                setIsUserMenuOpen(false);
                setIsSearchOpen(false);
                onToggleNotif(false);
                onOpenMessages();
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-purple-900/40 bg-[#130E24] text-purple-300 transition-all hover:border-purple-600/50 hover:bg-purple-900/20 hover:text-white focus:outline-none cursor-pointer"
              aria-label="Mensagens Privadas"
              title="Mensagens Privadas"
            >
              <MessageSquare className="h-4 w-4" />
              {unreadMessagesCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white shadow-sm shadow-purple-950">
                  {unreadMessagesCount}
                </span>
              )}
            </button>
          )}

          {/* Notifications Bell */}
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setIsUserMenuOpen(false);
                setIsSearchOpen(false);
                onToggleNotif(!isNotifOpen);
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-purple-900/40 bg-[#130E24] text-purple-300 transition-all hover:border-purple-600/50 hover:bg-purple-900/20 hover:text-white focus:outline-none cursor-pointer"
              aria-label="Notificações"
              aria-expanded={isNotifOpen}
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white shadow-sm shadow-purple-950">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Popover anchored below the Bell button via Portal (zero page height growth, zero layout shift, sticky with header) */}
            {isNotifOpen && typeof document !== 'undefined' && createPortal(
              <div className="fixed inset-x-0 top-[4.25rem] z-50 pointer-events-none">
                <div className="mx-auto flex max-w-7xl justify-end px-3 sm:px-6 lg:px-8">
                  <div
                    ref={notifPanelRef}
                    role="dialog"
                    aria-label="Notificações"
                    className="pointer-events-auto sm:mr-12 flex w-full max-w-full sm:w-96 sm:max-w-sm max-h-[min(26rem,calc(100vh-5rem))] sm:max-h-[min(30rem,calc(100vh-5rem))] supports-[height:100dvh]:max-h-[min(26rem,calc(100dvh-5rem))] sm:supports-[height:100dvh]:max-h-[min(30rem,calc(100dvh-5rem))] flex-col overflow-hidden rounded-2xl border border-purple-800/30 bg-[#130E24] p-3.5 shadow-2xl shadow-black/90 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Popover Header (sticky/pinned via shrink-0 while list scrolls) */}
                    <div className="flex shrink-0 flex-col gap-2 border-b border-purple-900/40 pb-2.5 px-1">
                      {/* Primeira linha: Título e botão X lado a lado */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-bold text-white">Notificações</span>
                          {unreadCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-950/90 border border-purple-700/50 px-2 py-0.5 text-[11px] font-medium text-purple-300 shrink-0">
                              <span className="font-mono tabular-nums font-semibold text-purple-200">{unreadCount}</span>
                              <span>{unreadCount === 1 ? 'nova' : 'novas'}</span>
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleNotif(false);
                          }}
                          aria-label="Fechar notificações"
                          title="Fechar"
                          className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Linha imediatamente abaixo: Marcar todas como lidas */}
                      {notifications.length > 0 && (
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            disabled={unreadCount === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onMarkAllNotificationsAsRead();
                            }}
                            className={`text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                              unreadCount > 0
                                ? 'text-purple-400 hover:text-purple-200 cursor-pointer'
                                : 'text-purple-400/40 cursor-default'
                            }`}
                          >
                            Marcar todas como lidas
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Notifications List with internal-only vertical scroll */}
                    <div
                      ref={notifListRef}
                      data-testid="notifications-scroll-list"
                      className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-2 pr-1"
                    >
                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-xs text-purple-300/50">
                          Nenhuma notificação por aqui.
                        </div>
                      ) : (
                        notifications.map((notif) => {
                          const handleActorActivate = (e: React.MouseEvent) => {
                            e.stopPropagation();
                            onMarkNotificationAsRead(notif.id);
                            onToggleNotif(false);
                            if (onSelectNotificationActor) {
                              onSelectNotificationActor(notif);
                            } else {
                              onSelectNotification(notif);
                            }
                          };

                          const handleItemActivate = () => {
                            onMarkNotificationAsRead(notif.id);
                            onToggleNotif(false);
                            onSelectNotification(notif);
                          };

                          return (
                            <div
                              key={notif.id}
                              data-notif-id={notif.id}
                              role="button"
                              tabIndex={0}
                              onClick={handleItemActivate}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleItemActivate();
                                }
                              }}
                              className={`group relative flex flex-col gap-2 rounded-xl p-2.5 transition-all duration-150 active:scale-[0.985] cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-500/50 ${
                                notif.isRead 
                                  ? 'bg-[#18122c]/40 hover:bg-[#1c1533]' 
                                  : 'bg-purple-950/40 border border-purple-700/30 hover:bg-purple-900/40'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <button
                                  type="button"
                                  onClick={handleActorActivate}
                                  aria-label={`Ver perfil de ${notif.actor.displayName}`}
                                  title={`Ver perfil de ${notif.actor.displayName}`}
                                  className="shrink-0 mt-0.5 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-400/60 hover:ring-2 hover:ring-purple-400/60 transition-all cursor-pointer"
                                >
                                  {notif.actor.avatarUrl ? (
                                    <img
                                      src={notif.actor.avatarUrl}
                                      alt={notif.actor.displayName}
                                      referrerPolicy="no-referrer"
                                      className="h-8 w-8 rounded-full object-cover border border-purple-500/30"
                                    />
                                  ) : (
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-purple-500/30 bg-gradient-to-br from-purple-700 to-indigo-800 text-xs font-bold text-white select-none">
                                      {(notif.actor.displayName || notif.actor.username || 'U').charAt(0).toUpperCase()}
                                    </span>
                                  )}
                                </button>

                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-purple-200 leading-snug">
                                    <button
                                      type="button"
                                      onClick={handleActorActivate}
                                      className="inline font-medium text-white hover:text-purple-300 hover:underline focus:outline-none focus:underline cursor-pointer text-left"
                                    >
                                      {notif.actor.displayName}
                                    </button>{' '}
                                    <span>{notif.message}</span>
                                  </p>
                                  <span className="text-[10px] text-purple-400/60 block mt-1">
                                    {notif.createdAt}
                                  </span>
                                </div>

                                {!notif.isRead && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onMarkNotificationAsRead(notif.id);
                                    }}
                                    aria-label="Marcar notificação como lida"
                                    title="Marcar como lida"
                                    className="shrink-0 mt-1.5 p-1 -m-1 rounded-full hover:bg-purple-800/40 focus:outline-none cursor-pointer"
                                  >
                                    <span className="block h-2 w-2 rounded-full bg-purple-500" />
                                  </button>
                                )}
                              </div>

                              {/* Interactive Accept / Reject controls for follow requests */}
                              {notif.type === 'follow_request' && (
                                <div
                                  className="ml-11 flex items-center gap-2 pt-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {notif.handled === 'accepted' ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                                      <Check className="h-3 w-3" /> Solicitação aceita
                                    </span>
                                  ) : notif.handled === 'rejected' ? (
                                    <span className="text-[11px] font-medium text-neutral-400 bg-neutral-900/60 px-2 py-0.5 rounded border border-neutral-700/40">
                                      Solicitação recusada
                                    </span>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          onAcceptRequest(notif.contextData?.requestId || 'req_01', notif.id);
                                        }}
                                        className="rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all active:scale-95 cursor-pointer"
                                      >
                                        Aceitar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          onRejectRequest(notif.contextData?.requestId || 'req_01', notif.id);
                                        }}
                                        className="rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/50 px-3 py-1 text-xs font-semibold text-neutral-300 transition-all active:scale-95 cursor-pointer"
                                      >
                                        Recusar
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>

          {/* Connected User Avatar with Canon 7-Item Dropdown Menu */}
          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="group flex items-center gap-2 rounded-full p-0.5 ring-2 ring-purple-600/40 hover:ring-purple-500 transition-all focus:outline-none cursor-pointer"
              aria-label="Menu do Usuário"
            >
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.displayName}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-700 to-indigo-800 text-xs font-bold text-white select-none">
                  {(currentUser.displayName || currentUser.username || 'U').charAt(0).toUpperCase()}
                </div>
              )}
            </button>

            {/* Menu da foto de perfil: EXACTLY the 7 items requested */}
            {isUserMenuOpen && (
              <>
                {/* Backdrop to prevent underlying touch movement and dismiss on outside click */}
                <div
                  className="fixed inset-0 z-40 bg-black/20 md:bg-transparent"
                  onClick={() => setIsUserMenuOpen(false)}
                  onTouchMove={(e) => {
                    e.preventDefault();
                  }}
                />

                <div
                  role="menu"
                  aria-label="Menu do Usuário"
                  className="absolute right-0 top-full mt-2 w-64 max-h-[min(30rem,calc(100vh-5rem))] supports-[height:100dvh]:max-h-[min(30rem,calc(100dvh-5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-purple-800/30 bg-[#130E24] p-2 shadow-2xl shadow-black/90 backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-100"
                  style={{ touchAction: 'pan-y' }}
                  onTouchMove={(e) => {
                    e.stopPropagation();
                  }}
                >
                {/* User info mini header inside menu */}
                <div className="border-b border-purple-900/40 px-3 py-2.5 mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-sm text-white truncate">
                    <AetherAnimatedName name={currentUser.displayName} profileOrUid={currentUser.id} />
                    <HikariEternalBadge profileOrUid={currentUser.id} size="sm" />
                  </div>
                  <div className="text-xs text-purple-400/80 truncate">@{currentUser.username}</div>
                  {isAuthenticated && authenticatedEmail && (
                    <div className="mt-0.5 text-[11px] text-purple-200/75 truncate">
                      {authenticatedEmail}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-purple-400/50">
                    Membro desde {currentUser.createdAt}
                  </div>
                </div>

                <div className="space-y-0.5 text-xs">
                  {/* 1. Meu perfil */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onSelectProfile(currentUser.id);
                      onNavigateTab('overview');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <User className="h-4 w-4 text-purple-400" />
                    <span>Meu perfil</span>
                  </button>

                  {/* 1.1 Painel de administração (Exclusivo da Conta Proprietária Aether) */}
                  {currentUser.id === AUTHORIZED_ADMIN_UID && onOpenAdminPanel && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenAdminPanel();
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer border border-purple-800/30 bg-purple-950/20"
                    >
                      <div className="flex items-center gap-2.5">
                        <Shield className="h-4 w-4 text-purple-400" />
                        <span className="font-semibold text-purple-100">Painel de administração</span>
                      </div>
                      <HikariEternalBadge profileOrUid={currentUser.id} size="sm" />
                    </button>
                  )}

                  {/* 1.2 Editar perfil e foto */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSettings('profile');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <Camera className="h-4 w-4 text-purple-400" />
                    <span>Editar perfil e foto</span>
                  </button>

                  {/* 2. Configurações */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSettings('privacy');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <Settings className="h-4 w-4 text-purple-400" />
                    <span>Configurações</span>
                  </button>

                  {/* 3. Seguidores e seguindo */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenFollowers('followers');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <Users className="h-4 w-4 text-purple-400" />
                    <span>Seguidores e seguindo</span>
                  </button>

                  {/* 4. Notificações */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onToggleNotif(true);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <Bell className="h-4 w-4 text-purple-400" />
                      <span>Notificações</span>
                    </div>
                    {unreadCount > 0 && (
                      <span className="rounded-full bg-purple-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  {/* 4.1 Mensagens privadas */}
                  {onOpenMessages && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenMessages();
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <MessageSquare className="h-4 w-4 text-purple-400" />
                        <span>Mensagens privadas</span>
                      </div>
                      {unreadMessagesCount > 0 && (
                        <span className="rounded-full bg-purple-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                          {unreadMessagesCount}
                        </span>
                      )}
                    </button>
                  )}

                  {/* 5. Contas conectadas */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSettings('connected');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <Link2 className="h-4 w-4 text-purple-400" />
                    <span>Contas conectadas</span>
                  </button>

                  {/* 6. Segurança e conta */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenSettings('security');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4 text-purple-400" />
                    <span>Segurança e conta</span>
                  </button>

                  <div className="my-1 border-t border-purple-900/40" />

                  {/* 7. Sair da conta */}
                  {isAuthenticated && onLogout ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onLogout();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 transition-colors cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 text-rose-400" />
                      <span>Sair da conta</span>
                    </button>
                  ) : (
                    <div className="space-y-1 px-1 py-0.5">
                      {onOpenAuth && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onOpenAuth('login');
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-purple-200 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                        >
                          <LogIn className="h-4 w-4 text-purple-400" />
                          <span>Entrar ou criar conta</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="Nenhuma sessão autenticada ativa."
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-neutral-500 opacity-60 cursor-not-allowed select-none"
                      >
                        <span className="flex items-center gap-2.5">
                          <LogOut className="h-4 w-4 text-neutral-500" />
                          <span>Sair da conta</span>
                        </span>
                        <span className="rounded bg-purple-950/70 border border-purple-900/40 px-1.5 py-0.5 text-[10px] font-medium text-purple-300/60">
                          Sem sessão
                        </span>
                      </button>
                      <p className="px-2 pb-1 text-[10px] leading-snug text-purple-300/50">
                        Modo demonstração sem sessão autenticada.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </header>
  );
};
