import React, { useState, useRef, useEffect } from 'react';
import { 
  Bell, 
  Search, 
  User, 
  Settings, 
  Users, 
  Link2, 
  ShieldCheck, 
  LogOut, 
  Check, 
  X,
  ExternalLink,
  Lock,
  Eye,
  CheckCircle2,
  XCircle,
  MessageSquare
} from 'lucide-react';
import { UserProfile, NotificationItem } from '../types';

interface HeaderProps {
  currentUser: UserProfile;
  activeProfile: UserProfile;
  notifications: NotificationItem[];
  isNotifOpen: boolean;
  onToggleNotif: (open: boolean) => void;
  onOpenSettings: (initialTab?: 'profile' | 'privacy' | 'connected' | 'security') => void;
  onOpenFollowers: (initialTab?: 'followers' | 'following' | 'requests') => void;
  onSelectProfile: (userId: string) => void;
  onMarkNotificationAsRead: (id: string) => void;
  onMarkAllNotificationsAsRead: () => void;
  onSelectNotification: (notif: NotificationItem) => void;
  onNavigateTab: (tab: 'overview' | 'animes' | 'comments' | 'about' | 'activity' | 'favorites') => void;
  onAcceptRequest: (requestId: string, notifId?: string) => void;
  onRejectRequest: (requestId: string, notifId?: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeProfile,
  notifications,
  isNotifOpen,
  onToggleNotif,
  onOpenSettings,
  onOpenFollowers,
  onSelectProfile,
  onMarkNotificationAsRead,
  onMarkAllNotificationsAsRead,
  onSelectNotification,
  onNavigateTab,
  onAcceptRequest,
  onRejectRequest
}) => {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        onToggleNotif(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onToggleNotif]);

  const searchResults = searchQuery.trim() ? [
    { type: 'user', id: 'usr_hikari_001', name: 'Ren Amano', sub: '@ren_hikari (Meu Perfil)', avatar: currentUser.avatarUrl },
    { type: 'user', id: 'usr_kuroha', name: 'Kuroha ✦', sub: '@kuroha_void (Perfil Privado)', avatar: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg' },
    { type: 'user', id: 'usr_shinji', name: 'Shinji Kazuki', sub: '@shinji_mecha (Perfil Público)', avatar: '/src/assets/images/hikari_user_avatar_1793518815544.jpg' },
    { type: 'anime', id: 'anime_solo_leveling', name: 'Solo Leveling (Arise)', sub: 'Anime · Em Exibição', tab: 'animes' },
    { type: 'anime', id: 'anime_frieren', name: 'Frieren: Beyond Journey\'s End', sub: 'Anime · Concluído', tab: 'animes' }
  ].filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.sub.toLowerCase().includes(searchQuery.toLowerCase())) : [];

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
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-950/60 border border-purple-800/40 text-purple-300 text-xs font-semibold">
                          ✦
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-xs font-medium text-white">{item.name}</div>
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
          {/* Notifications Bell */}
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={() => onToggleNotif(!isNotifOpen)}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-purple-900/40 bg-[#130E24] text-purple-300 transition-all hover:border-purple-600/50 hover:bg-purple-900/20 hover:text-white focus:outline-none cursor-pointer"
              aria-label="Notificações"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white shadow-sm shadow-purple-950">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Panel: Viewport-fixed so it is ALWAYS visible anywhere on page */}
            {isNotifOpen && (
              <>
                {/* Backdrop overlay */}
                <div 
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleNotif(false);
                  }}
                  onTouchMove={(e) => {
                    if (e.target === e.currentTarget) {
                      e.preventDefault();
                    }
                  }}
                />

                {/* Fixed Panel Container */}
                <div 
                  className="fixed right-2 sm:right-6 lg:right-8 top-16 z-50 w-[calc(100vw-1rem)] sm:w-96 max-w-sm rounded-2xl border border-purple-800/40 bg-[#130E24] p-3.5 shadow-2xl shadow-black/95 backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{ maxHeight: 'calc(100vh - 5rem)' }}
                  onClick={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                >
                  {/* Popover Header with clean alignment and formatting */}
                  <div className="flex items-center justify-between gap-2 border-b border-purple-900/40 pb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">Notificações</span>
                    {unreadCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-950/90 border border-purple-700/50 px-2 py-0.5 text-[11px] font-medium text-purple-300">
                        <span className="font-mono tabular-nums font-semibold text-purple-200">{unreadCount}</span>
                        <span>{unreadCount === 1 ? 'nova' : 'novas'}</span>
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAllNotificationsAsRead();
                      }}
                      className="text-xs text-purple-400 hover:text-purple-200 font-medium transition-colors cursor-pointer"
                    >
                      Marcar todas como lidas
                    </button>
                  )}
                </div>

                {/* Notifications List */}
                <div className="mt-2 max-h-80 overflow-y-auto space-y-2 pr-1 overscroll-contain">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-purple-300/50">
                      Nenhuma notificação por aqui.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => {
                          onMarkNotificationAsRead(notif.id);
                          onToggleNotif(false);
                          onSelectNotification(notif);
                        }}
                        className={`group relative flex flex-col gap-2 rounded-xl p-2.5 transition-all duration-150 active:scale-[0.985] cursor-pointer ${
                          notif.isRead 
                            ? 'bg-[#18122c]/40 hover:bg-[#1c1533]' 
                            : 'bg-purple-950/40 border border-purple-700/30 hover:bg-purple-900/40'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <img
                            src={notif.actor.avatarUrl}
                            alt={notif.actor.displayName}
                            className="h-8 w-8 rounded-full object-cover border border-purple-500/30 shrink-0 mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-purple-200 leading-snug">
                              <strong className="text-white font-medium">{notif.actor.displayName}</strong>{' '}
                              {notif.message}
                            </p>
                            <span className="text-[10px] text-purple-400/60 block mt-1">
                              {notif.createdAt}
                            </span>
                          </div>
                          {!notif.isRead && (
                            <div className="h-2 w-2 rounded-full bg-purple-500 shrink-0 mt-2" />
                          )}
                        </div>

                        {/* Interactive Accept / Reject controls for follow requests */}
                        {notif.type === 'follow_request' && (
                          <div className="ml-11 flex items-center gap-2 pt-1">
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
                    ))
                  )}
                </div>

                {/* Popover Footer: Replaces 'Gerenciar solicitações' with 'Marcar todas como lidas' */}
                {unreadCount > 0 && (
                  <div className="mt-2.5 border-t border-purple-900/30 pt-2.5 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAllNotificationsAsRead();
                      }}
                      className="text-xs text-purple-400 hover:text-purple-200 font-medium transition-colors cursor-pointer"
                    >
                      Marcar todas como lidas
                    </button>
                  </div>
                )}
              </div>
              </>
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
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.displayName}
                className="h-8 w-8 rounded-full object-cover"
              />
            </button>

            {/* Menu da foto de perfil: EXACTLY the 7 items requested */}
            {isUserMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-purple-800/30 bg-[#130E24] p-2 shadow-2xl shadow-black/90 backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-100">
                {/* User info mini header inside menu */}
                <div className="border-b border-purple-900/40 px-3 py-2.5 mb-1">
                  <div className="font-semibold text-sm text-white truncate">{currentUser.displayName}</div>
                  <div className="text-xs text-purple-400/80 truncate">@{currentUser.username}</div>
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
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      alert('Sessão encerrada com sucesso (Simulação Etapa 1 - Auth Firebase será ativado na Etapa 2).');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 transition-colors cursor-pointer"
                  >
                    <LogOut className="h-4 w-4 text-rose-400" />
                    <span>Sair da conta</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
