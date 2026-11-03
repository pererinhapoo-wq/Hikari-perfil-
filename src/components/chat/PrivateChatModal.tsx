import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Send,
  Image as ImageIcon,
  Sparkles,
  Check,
  CheckCheck,
  Clock,
  Search,
  ArrowLeft,
  ArrowDown,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Lock,
  Loader2,
  Trash2,
  Smile,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import type {
  UserProfile,
  PrivateConversation,
  PrivateMessage,
  ParticipantSummary,
  HikariLinkPreview,
  AnimeItem,
} from '../../types';
import {
  fetchUserConversations,
  startOrGetConversation,
  fetchConversationMessages,
  sendPrivateMessage,
  markConversationAsRead,
  subscribeToConversation,
  subscribeToConversationsList,
  canUserMessageRecipient,
  toggleMessageReaction,
  sendTypingIndicator,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  type UserCheckContext,
} from '../../services/chatService';
import { HikariCardPreview } from './HikariCardPreview';
import { GifPickerPopover } from './GifPickerPopover';

interface PrivateChatModalProps {
  isOpen: boolean;
  currentUser: UserProfile;
  otherProfiles: Record<string, UserProfile>;
  initialRecipientId?: string | null;
  userAnimes?: AnimeItem[];
  followingIds: Set<string>;
  followersIds?: Set<string>;
  blockedIds: Set<string>;
  onClose: () => void;
  onNavigateToProfile: (userId: string) => void;
  onSelectAnime?: (animeTitle: string) => void;
  onToggleFollow?: (userId: string) => void;
  onToggleBlock?: (userId: string) => void;
}

const QUICK_REACTION_EMOJIS = ['❤️', '🔥', '✨', '😂', '🌸', '👏', '😮', '💯'];

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatConversationDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return 'Ontem';
  }

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export const PrivateChatModal: React.FC<PrivateChatModalProps> = ({
  isOpen,
  currentUser,
  otherProfiles,
  initialRecipientId,
  userAnimes = [],
  followingIds,
  followersIds = new Set(),
  blockedIds,
  onClose,
  onNavigateToProfile,
  onSelectAnime,
  onToggleFollow,
  onToggleBlock,
}) => {
  const [conversations, setConversations] = useState<PrivateConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Typing & Online state
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [activeReactionPickerMsgId, setActiveReactionPickerMsgId] = useState<string | null>(null);
  const [unreadNewMessagesCount, setUnreadNewMessagesCount] = useState(0);

  // Composition State
  const [inputText, setInputText] = useState('');
  const [pendingMediaUrl, setPendingMediaUrl] = useState<string | null>(null);
  const [pendingMediaType, setPendingMediaType] = useState<'image' | 'gif' | null>(null);
  const [pendingMediaTitle, setPendingMediaTitle] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Popover State (Unificado para Imagens e GIFs)
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);

  // Mobile View Navigation State: 'list' or 'chat'
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // DOM Refs & Scroll state tracking
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const isInitialLoadRef = useRef<boolean>(true);
  const prevMessagesLengthRef = useRef<number>(0);
  const scrollStateBeforePrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingPingRef = useRef<number>(0);

  const currentSummary: ParticipantSummary = useMemo(
    () => ({
      id: currentUser.id,
      displayName: currentUser.displayName,
      username: currentUser.username,
      avatarUrl: currentUser.avatarUrl,
    }),
    [currentUser]
  );

  // Helper to build UserCheckContext
  const getContextForUser = useCallback(
    (profile: UserProfile): UserCheckContext => {
      const isCurrent = profile.id === currentUser.id;
      return {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        allowDirectMessages: profile.privacySettings?.allowDirectMessages ?? true,
        directMessagesFrom: profile.privacySettings?.directMessagesFrom ?? 'everyone',
        showOnlineStatus: profile.privacySettings?.showOnlineStatus !== false,
        followingIds: isCurrent ? Array.from(followingIds) : [],
        followerIds: isCurrent ? Array.from(followersIds) : [],
        blockedIds: isCurrent ? Array.from(blockedIds) : [],
      };
    },
    [currentUser, followingIds, followersIds, blockedIds]
  );

  // Presence Heartbeat Loop (pausa timer quando a aba está oculta e retoma ao voltar ao primeiro plano)
  useEffect(() => {
    if (!isOpen || !currentUser.id) return;
    const showOnline = currentUser.privacySettings?.showOnlineStatus !== false;
    let intervalId: number | null = null;

    const startHeartbeatTimer = () => {
      if (intervalId !== null || document.visibilityState === 'hidden') return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'hidden') {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          return;
        }
        void sendPresenceHeartbeat(currentUser.id, showOnline);
      }, 20000);
    };

    const stopHeartbeatTimer = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (document.visibilityState !== 'hidden') {
      void sendPresenceHeartbeat(currentUser.id, showOnline);
      startHeartbeatTimer();
    }

    const handleVisibilityOrUnload = () => {
      if (document.visibilityState === 'hidden') {
        stopHeartbeatTimer();
        sendPresenceOffline(currentUser.id);
      } else {
        void sendPresenceHeartbeat(currentUser.id, showOnline);
        startHeartbeatTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrUnload);
    window.addEventListener('beforeunload', handleVisibilityOrUnload);

    return () => {
      stopHeartbeatTimer();
      document.removeEventListener('visibilitychange', handleVisibilityOrUnload);
      window.removeEventListener('beforeunload', handleVisibilityOrUnload);
      sendPresenceOffline(currentUser.id);
    };
  }, [isOpen, currentUser.id, currentUser.privacySettings?.showOnlineStatus]);

  // Subscribe to Conversations List
  useEffect(() => {
    if (!isOpen || !currentUser.id) return;
    const unsubscribe = subscribeToConversationsList(currentUser.id, (list) => {
      setConversations(list);
    });
    return () => unsubscribe();
  }, [isOpen, currentUser.id]);

  // Handle Initial Recipient prop (e.g. clicked "Mensagem" button on another profile)
  useEffect(() => {
    if (!isOpen || !initialRecipientId || initialRecipientId === currentUser.id) return;

    const targetProfile = otherProfiles[initialRecipientId];
    if (!targetProfile) return;

    const recipientSummary: ParticipantSummary = {
      id: targetProfile.id,
      displayName: targetProfile.displayName,
      username: targetProfile.username,
      avatarUrl: targetProfile.avatarUrl,
    };

    startOrGetConversation(currentSummary, recipientSummary)
      .then((conv) => {
        setActiveConvId(conv.id);
        setMobileView('chat');
        setConversations((prev) => {
          if (prev.some((c) => c.id === conv.id)) return prev;
          return [conv, ...prev];
        });
      })
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : 'Erro ao iniciar conversa.');
      });
  }, [isOpen, initialRecipientId, currentUser.id, currentSummary, otherProfiles]);

  // Subscribe to Active Conversation Messages & Typing
  useEffect(() => {
    if (!isOpen || !activeConvId || !currentUser.id) {
      setMessages([]);
      setTypingUserIds([]);
      setUnreadNewMessagesCount(0);
      return;
    }

    setIsLoadingMessages(true);
    isInitialLoadRef.current = true;
    setUnreadNewMessagesCount(0);
    markConversationAsRead(activeConvId, currentUser.id);

    const unsubscribe = subscribeToConversation(activeConvId, currentUser.id, ({ messages: newMsgs, typingUsers }) => {
      setMessages(newMsgs);
      setTypingUserIds(typingUsers);
      setIsLoadingMessages(false);
    });

    return () => {
      unsubscribe();
      // Ao sair da conversa, limpa o estado de digitação imediatamente
      if (activeConvId && currentUser.id) {
        sendTypingIndicator(activeConvId, currentUser.id, false);
      }
    };
  }, [isOpen, activeConvId, currentUser.id]);

  // Detect scroll position to check if user is near bottom
  const handleContainerScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNear = distanceToBottom < 100;
    isNearBottomRef.current = isNear;

    if (isNear) {
      setUnreadNewMessagesCount(0);
    }
  }, []);

  // Precise scroll restoration: nunca forçar rolagem para baixo quando o usuário subiu para ler
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || messages.length === 0) return;

    // 1. Primeira abertura da conversa: rola diretamente para o final
    if (isInitialLoadRef.current) {
      container.scrollTop = container.scrollHeight;
      isInitialLoadRef.current = false;
      isNearBottomRef.current = true;
      prevMessagesLengthRef.current = messages.length;
      return;
    }

    // 2. Preservar exatamente a posição visual ao carregar mensagens anteriores (paginação)
    if (scrollStateBeforePrependRef.current) {
      const delta = container.scrollHeight - scrollStateBeforePrependRef.current.scrollHeight;
      container.scrollTop = scrollStateBeforePrependRef.current.scrollTop + delta;
      scrollStateBeforePrependRef.current = null;
      prevMessagesLengthRef.current = messages.length;
      return;
    }

    const lastMsg = messages[messages.length - 1];
    const isSentByMe = lastMsg?.senderId === currentUser.id;

    // 3. Rolar para o final somente se o próprio usuário enviou ou se ele já estava próximo do final
    if (isSentByMe || isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadNewMessagesCount(0);
    } else if (messages.length > prevMessagesLengthRef.current) {
      // Chegou mensagem nova enquanto o usuário lia mensagens antigas: não interrompe a leitura!
      setUnreadNewMessagesCount((prev) => prev + (messages.length - prevMessagesLengthRef.current));
    }

    prevMessagesLengthRef.current = messages.length;
  }, [messages, currentUser.id]);

  // Active conversation object and partner profile
  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConvId) || null;
  }, [conversations, activeConvId]);

  const activePartner = useMemo(() => {
    if (!activeConversation) return null;
    const partnerId = activeConversation.participants.find((id) => id !== currentUser.id);
    if (!partnerId) return null;

    const profile = otherProfiles[partnerId];
    const registered = activeConversation.participantDetails[partnerId];

    return {
      id: partnerId,
      displayName: profile?.displayName || registered?.displayName || 'Usuário Hikari',
      username: profile?.username || registered?.username || 'usuario',
      avatarUrl: profile?.avatarUrl || registered?.avatarUrl || '',
      isPrivate: profile?.isPrivate ?? false,
      privacySettings: profile?.privacySettings,
      isOnline: registered?.isOnline ?? false,
    };
  }, [activeConversation, currentUser.id, otherProfiles]);

  // Check Privacy and Blocking permissions for active conversation
  const privacyCheck = useMemo(() => {
    if (!activePartner) return { allowed: true };

    const senderCtx = getContextForUser(currentUser);
    const partnerProfile = otherProfiles[activePartner.id] || {
      id: activePartner.id,
      username: activePartner.username,
      displayName: activePartner.displayName,
      avatarUrl: activePartner.avatarUrl,
      privacySettings: activePartner.privacySettings,
    };
    const recipientCtx = getContextForUser(partnerProfile as UserProfile);

    recipientCtx.followerIds = followingIds.has(activePartner.id) ? [currentUser.id] : [];
    senderCtx.followerIds = followersIds.has(activePartner.id) ? [activePartner.id] : [];

    return canUserMessageRecipient(senderCtx, recipientCtx);
  }, [activePartner, currentUser, getContextForUser, otherProfiles, followingIds, followersIds]);

  // Filter conversations by search
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => {
      const partnerId = c.participants.find((id) => id !== currentUser.id);
      if (!partnerId) return false;
      const details = c.participantDetails[partnerId];
      const profile = otherProfiles[partnerId];
      const name = (profile?.displayName || details?.displayName || '').toLowerCase();
      const user = (profile?.username || details?.username || '').toLowerCase();
      return name.includes(q) || user.includes(q);
    });
  }, [conversations, searchQuery, currentUser.id, otherProfiles]);

  // Load older messages for progressive pagination without visual jumps
  const handleLoadOlderMessages = async () => {
    if (!activeConvId || isLoadingOlder || messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (container) {
      scrollStateBeforePrependRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }

    setIsLoadingOlder(true);
    const oldestTimestamp = messages[0]?.createdAt;

    try {
      const result = await fetchConversationMessages(activeConvId, currentUser.id, {
        limit: 25,
        before: oldestTimestamp,
      });

      if (result.messages.length > 0) {
        setMessages((prev) => [...result.messages, ...prev]);
      }
      setHasMoreMessages(result.hasMore);
    } catch {
      scrollStateBeforePrependRef.current = null;
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // Typing event handler with debounced broadcast
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (!activeConvId || !currentUser.id) return;

    const now = Date.now();
    if (val.trim() && now - lastTypingPingRef.current > 2000) {
      lastTypingPingRef.current = now;
      sendTypingIndicator(activeConvId, currentUser.id, true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (activeConvId && currentUser.id) {
        sendTypingIndicator(activeConvId, currentUser.id, false);
      }
    }, 2500);
  };

  // Toggle emoji reaction on message
  const handleToggleReaction = async (msgId: string, emoji: string) => {
    if (!activeConvId || !currentUser.id) return;
    setActiveReactionPickerMsgId(null);

    // Otimista
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = { ...(m.reactions || {}) };
        const currentList = reactions[emoji] || [];
        const hasUser = currentList.includes(currentUser.id);
        if (hasUser) {
          const updated = currentList.filter((id) => id !== currentUser.id);
          if (updated.length === 0) {
            delete reactions[emoji];
          } else {
            reactions[emoji] = updated;
          }
        } else {
          reactions[emoji] = [...currentList, currentUser.id];
        }
        return { ...m, reactions };
      })
    );

    try {
      const updatedMsg = await toggleMessageReaction(activeConvId, msgId, currentUser.id, emoji);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? updatedMsg : m)));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao atualizar reação.');
    }
  };

  // Send message action
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activePartner || isSending) return;

    const trimmedText = inputText.trim();
    if (!trimmedText && !pendingMediaUrl) return;

    if (!privacyCheck.allowed) {
      setErrorMessage(privacyCheck.reason || 'Envio não autorizado.');
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    // Notifica que parou de digitar
    if (activeConvId && currentUser.id) {
      sendTypingIndicator(activeConvId, currentUser.id, false);
    }

    const partnerSummary: ParticipantSummary = {
      id: activePartner.id,
      displayName: activePartner.displayName,
      username: activePartner.username,
      avatarUrl: activePartner.avatarUrl,
    };

    const type: 'text' | 'image' | 'gif' = pendingMediaType || (pendingMediaUrl ? 'image' : 'text');

    try {
      const sentMsg = await sendPrivateMessage({
        conversationId: activeConvId || undefined,
        sender: currentSummary,
        recipient: partnerSummary,
        text: trimmedText,
        type,
        mediaUrl: pendingMediaUrl || undefined,
      });

      // Atualização imediata
      setMessages((prev) => [...prev, sentMsg]);
      setInputText('');
      setPendingMediaUrl(null);
      setPendingMediaType(null);
      setPendingMediaTitle(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao enviar mensagem.');
    } finally {
      setIsSending(false);
    }
  };

  // Keyboard shortcut: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Dismiss popovers / lightbox on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (enlargedImageUrl) {
          setEnlargedImageUrl(null);
        } else if (activeReactionPickerMsgId) {
          setActiveReactionPickerMsgId(null);
        } else if (isMediaPickerOpen) {
          setIsMediaPickerOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, enlargedImageUrl, activeReactionPickerMsgId, isMediaPickerOpen, onClose]);

  // Independent background scroll lock protocol:
  // Freezes document.body cleanly with top/left offset and restores exact scroll position on close
  useEffect(() => {
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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mensagens Privadas"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 overscroll-contain select-none sm:select-auto touch-none"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-4xl md:max-w-5xl h-full sm:h-[min(88dvh,760px)] rounded-none sm:rounded-2xl border-0 sm:border border-purple-900/40 bg-[#0A0713] shadow-2xl flex flex-col overflow-hidden overscroll-contain touch-auto select-auto"
        onClick={(e) => {
          e.stopPropagation();
          setActiveReactionPickerMsgId(null);
        }}
      >

        {/* Global Modal Header */}
        <div className="flex items-center justify-between border-b border-purple-900/30 px-4 sm:px-6 py-3 shrink-0 bg-[#0e091d]/90">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-300">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Mensagens Privadas
              </h2>
              <p className="text-[11px] text-purple-300/60 hidden sm:block">
                Comunicação segura com reações, GIFs animados e status online em tempo real
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 text-purple-300/70 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer active:scale-95"
              title="Fechar chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Main Body: Two Columns on Desktop, Switchable on Mobile */}
        <div className="flex flex-1 min-h-0 overflow-hidden relative">
          {/* COLUMN 1: Conversation List */}
          <div
            className={`w-full sm:w-80 md:w-96 flex-col border-r border-purple-900/30 bg-[#0d081b] shrink-0 ${
              mobileView === 'chat' ? 'hidden sm:flex' : 'flex'
            }`}
          >
            {/* Search Box */}
            <div className="p-3 border-b border-purple-900/30 bg-[#0A0713]/60">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-purple-400/60" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar conversas..."
                  className="w-full rounded-xl border border-purple-900/40 bg-[#120B24] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Conversation Items List */}
            <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-purple-950/40">
              {filteredConversations.map((conv) => {
                const partnerId = conv.participants.find((id) => id !== currentUser.id) || '';
                const partnerProfile = otherProfiles[partnerId];
                const registered = conv.participantDetails[partnerId];
                const displayName = partnerProfile?.displayName || registered?.displayName || 'Usuário Hikari';
                const username = partnerProfile?.username || registered?.username || 'usuario';
                const avatarUrl = partnerProfile?.avatarUrl || registered?.avatarUrl || '';
                const unreadCount = conv.unreadCounts[currentUser.id] || 0;
                const isActive = conv.id === activeConvId;

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setActiveConvId(conv.id);
                      setMobileView('chat');
                    }}
                    className={`w-full text-left flex items-start gap-3 p-3 transition-colors cursor-pointer group active:scale-[0.99] ${
                      isActive
                        ? 'bg-purple-950/60 border-l-4 border-l-purple-500'
                        : 'hover:bg-purple-950/30'
                    }`}
                  >
                    {/* Avatar with discreet online green dot */}
                    <div className="relative shrink-0">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={displayName}
                          className="h-11 w-11 rounded-xl object-cover border border-purple-900/40"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-900/50 border border-purple-700/40 text-sm font-bold text-white">
                          {displayName.charAt(0) || 'U'}
                        </div>
                      )}
                      {registered?.isOnline && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[#0d081b] animate-pulse motion-reduce:animate-none shadow-sm shadow-emerald-500/50"
                          title="Online agora"
                        />
                      )}
                    </div>

                    {/* Content snippet */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white truncate group-hover:text-purple-200">
                          {displayName}
                        </span>
                        {conv.lastMessage && (
                          <span className="text-[10px] text-purple-400/60 shrink-0 font-mono">
                            {formatConversationDate(conv.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-purple-400/70 truncate flex items-center gap-1.5">
                        <span>@{username}</span>
                        {registered?.isOnline && (
                          <span className="text-[10px] text-emerald-400 font-semibold">• online</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p
                          className={`text-xs truncate ${
                            unreadCount > 0
                              ? 'font-semibold text-purple-100'
                              : 'text-purple-300/60'
                          }`}
                        >
                          {conv.lastMessage ? (
                            conv.lastMessage.type === 'image' ? (
                              '📷 Imagem enviada'
                            ) : conv.lastMessage.type === 'gif' ? (
                              '🎬 GIF animado'
                            ) : conv.lastMessage.type === 'link' ? (
                              '🔗 Anime link'
                            ) : (
                              conv.lastMessage.text
                            )
                          ) : (
                            'Nenhuma mensagem ainda'
                          )}
                        </p>

                        {unreadCount > 0 && (
                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-600 px-1 text-[10px] font-bold text-white shadow-sm shadow-purple-950 shrink-0">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {filteredConversations.length === 0 && (
                <div className="p-8 text-center space-y-2">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-950/40 text-purple-400 border border-purple-800/30">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <h4 className="text-xs font-bold text-white">Nenhuma conversa encontrada</h4>
                  <p className="text-[11px] text-purple-300/60 max-w-xs mx-auto leading-relaxed">
                    Você pode iniciar conversas clicando no botão &quot;Mensagem&quot; no perfil de outros usuários do Hikari.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* COLUMN 2: Active Chat View */}
          <div
            className={`flex-1 flex-col bg-[#0A0713] relative ${
              mobileView === 'list' ? 'hidden sm:flex' : 'flex'
            }`}
          >
            {activePartner ? (
              <>
                {/* Active Chat Header with Online Indicator */}
                <div className="flex items-center justify-between border-b border-purple-900/30 px-4 py-2.5 bg-[#0e091d]/80 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Mobile Back Button */}
                    <button
                      type="button"
                      onClick={() => setMobileView('list')}
                      className="sm:hidden rounded-lg p-1.5 text-purple-300 hover:bg-purple-900/40 cursor-pointer"
                      title="Voltar para conversas"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>

                    {/* Partner Avatar with Online Dot */}
                    <div
                      className="relative shrink-0 cursor-pointer"
                      onClick={() => onNavigateToProfile(activePartner.id)}
                    >
                      {activePartner.avatarUrl ? (
                        <img
                          src={activePartner.avatarUrl}
                          alt={activePartner.displayName}
                          className="h-10 w-10 rounded-xl object-cover border border-purple-800/40"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-900/50 border border-purple-700/40 text-sm font-bold text-white">
                          {activePartner.displayName.charAt(0) || 'U'}
                        </div>
                      )}
                      {activePartner.isOnline && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[#0e091d] animate-pulse motion-reduce:animate-none shadow-sm shadow-emerald-500/50"
                          title="Online agora"
                        />
                      )}
                    </div>

                    {/* Partner Names & Online Indicator Text */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onNavigateToProfile(activePartner.id)}
                          className="text-xs sm:text-sm font-bold text-white truncate hover:text-purple-300 transition-colors cursor-pointer text-left"
                        >
                          {activePartner.displayName}
                        </button>
                        {activePartner.isPrivate && (
                          <span title="Perfil Privado">
                            <Lock className="h-3 w-3 text-amber-400 shrink-0" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] truncate">
                        <span className="text-purple-400/80">@{activePartner.username}</span>
                        {activePartner.isOnline ? (
                          <span className="flex items-center gap-1 text-emerald-400 font-semibold text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Online agora
                          </span>
                        ) : (
                          <span className="text-purple-400/40 text-[10px]">• Offline</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Header Actions: Follow & Block status */}
                  <div className="flex items-center gap-2">
                    {onToggleFollow && (
                      <button
                        type="button"
                        onClick={() => onToggleFollow(activePartner.id)}
                        className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border transition-all cursor-pointer active:scale-95 ${
                          followingIds.has(activePartner.id)
                            ? 'bg-purple-950/70 border-purple-800/50 text-purple-200 hover:border-rose-500/50 hover:text-rose-200'
                            : 'bg-purple-600 hover:bg-purple-500 text-white border-purple-500 shadow-sm'
                        }`}
                      >
                        {followingIds.has(activePartner.id) ? (
                          <>
                            <UserCheck className="h-3 w-3" />
                            <span>Seguindo</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="h-3 w-3" />
                            <span>Seguir</span>
                          </>
                        )}
                      </button>
                    )}

                    {onToggleBlock && (
                      <button
                        type="button"
                        onClick={() => onToggleBlock(activePartner.id)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium border transition-colors cursor-pointer active:scale-95 ${
                          blockedIds.has(activePartner.id)
                            ? 'bg-rose-950 border-rose-500 text-rose-200'
                            : 'bg-purple-950/40 border-purple-900/40 text-purple-400 hover:text-rose-300'
                        }`}
                        title={blockedIds.has(activePartner.id) ? 'Desbloquear' : 'Bloquear usuário'}
                      >
                        <ShieldAlert className="h-3 w-3" />
                        <span className="hidden md:inline">
                          {blockedIds.has(activePartner.id) ? 'Bloqueado' : 'Bloquear'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Privacy Warning Banner (if blocked or restricted) */}
                {!privacyCheck.allowed && (
                  <div className="p-3 bg-amber-950/40 border-b border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span className="leading-snug">{privacyCheck.reason}</span>
                    </div>

                    {!followingIds.has(activePartner.id) && onToggleFollow && (
                      <button
                        type="button"
                        onClick={() => onToggleFollow(activePartner.id)}
                        className="rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1 text-xs font-semibold shrink-0 cursor-pointer transition-colors active:scale-95"
                      >
                        Seguir @{activePartner.username}
                      </button>
                    )}
                  </div>
                )}

                {/* Message Stream */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleContainerScroll}
                  className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3.5 bg-gradient-to-b from-[#0A0713] via-[#0c0817] to-[#0A0713] relative"
                >
                  {/* Load more button */}
                  {hasMoreMessages && (
                    <div className="text-center py-1">
                      <button
                        type="button"
                        disabled={isLoadingOlder}
                        onClick={handleLoadOlderMessages}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-purple-950/60 hover:bg-purple-900/70 border border-purple-800/40 px-3 py-1 text-xs font-medium text-purple-300 transition-colors cursor-pointer active:scale-95"
                      >
                        {isLoadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                        <span>Carregar mensagens anteriores</span>
                      </button>
                    </div>
                  )}

                  {isLoadingMessages && messages.length === 0 && (
                    <div className="flex h-48 items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                    </div>
                  )}

                  {messages.map((msg) => {
                    const isSender = msg.senderId === currentUser.id;
                    const isReactionPickerOpen = activeReactionPickerMsgId === msg.id;

                    return (
                      <div
                        key={msg.id}
                        className={`group relative flex items-end gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200 ${
                          isSender ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {/* Partner Avatar for incoming messages */}
                        {!isSender && (
                          <div className="h-7 w-7 rounded-lg overflow-hidden border border-purple-800/40 shrink-0 mb-1">
                            {msg.senderAvatarUrl ? (
                              <img
                                src={msg.senderAvatarUrl}
                                alt={msg.senderName}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-purple-900 text-[10px] font-bold text-white">
                                {msg.senderName.charAt(0) || 'U'}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Floating quick reaction trigger button */}
                        <div
                          className={`opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center mb-1 shrink-0 ${
                            isSender ? 'order-first mr-1' : 'ml-1'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveReactionPickerMsgId(isReactionPickerOpen ? null : msg.id);
                            }}
                            className="p-1 rounded-full text-purple-400/70 hover:text-purple-200 hover:bg-purple-900/40 cursor-pointer active:scale-90 transition-transform"
                            title="Reagir com emoji"
                          >
                            <Smile className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Quick Reaction Emoji Popover */}
                        {isReactionPickerOpen && (
                          <div
                            className={`absolute z-30 -top-10 flex items-center gap-1 rounded-full border border-purple-800/60 bg-[#160e2b] px-2 py-1 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 ${
                              isSender ? 'right-4' : 'left-8'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {QUICK_REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleToggleReaction(msg.id, emoji)}
                                className="rounded-full p-1 text-sm hover:scale-125 transition-transform cursor-pointer active:scale-95"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Message Bubble Container */}
                        <div
                          className={`max-w-[85%] sm:max-w-md rounded-2xl px-3.5 py-2.5 shadow-md transition-all ${
                            isSender
                              ? 'bg-gradient-to-br from-purple-700 via-purple-600 to-indigo-700 text-white rounded-br-xs border border-purple-500/40'
                              : 'bg-[#18112e] text-[#EDE8F5] rounded-bl-xs border border-purple-900/50'
                          }`}
                        >
                          {/* Attached Media (Image / Animated GIF) */}
                          {msg.mediaUrl && (
                            <div className="mb-2 overflow-hidden rounded-xl border border-purple-900/50 bg-black/40 relative">
                              <img
                                src={msg.mediaUrl}
                                alt="Mídia compartilhada"
                                className="max-h-72 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                loading="lazy"
                                onClick={() => setEnlargedImageUrl(msg.mediaUrl!)}
                              />
                              {msg.type === 'gif' && (
                                <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider backdrop-blur-sm pointer-events-none">
                                  GIF
                                </span>
                              )}
                            </div>
                          )}

                          {/* Message Text */}
                          {msg.text && (
                            <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
                              {msg.text}
                            </p>
                          )}

                          {/* Hikari Rich Card Preview */}
                          {msg.linkPreview && (
                            <HikariCardPreview
                              preview={msg.linkPreview}
                              onSelectAnime={onSelectAnime}
                            />
                          )}

                          {/* Reactions Pill Display */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-1 border-t border-purple-800/30">
                              {Object.entries(msg.reactions).map(([emoji, userIds]) => {
                                if (!userIds || userIds.length === 0) return null;
                                const hasReacted = userIds.includes(currentUser.id);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleToggleReaction(msg.id, emoji)}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border transition-all cursor-pointer active:scale-90 ${
                                      hasReacted
                                        ? 'bg-purple-950/90 border-purple-400 text-white shadow-sm shadow-purple-900'
                                        : 'bg-[#0e0720]/80 border-purple-900/60 text-purple-200/90 hover:border-purple-600'
                                    }`}
                                    title={`${userIds.length} pessoa(s) reagiram com ${emoji}`}
                                  >
                                    <span className="text-xs leading-none">{emoji}</span>
                                    <span className="text-[10px] font-bold">{userIds.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Timestamp and delivery state */}
                          <div
                            className={`flex items-center gap-1 justify-end pt-1 text-[10px] ${
                              isSender ? 'text-purple-200/80' : 'text-purple-400/70'
                            }`}
                          >
                            <span>{formatMessageTime(msg.createdAt)}</span>
                            {isSender && (
                              <>
                                {msg.status === 'sending' ? (
                                  <Clock className="h-2.5 w-2.5" />
                                ) : msg.isRead ? (
                                  <span title="Lida">
                                    <CheckCheck className="h-3 w-3 text-emerald-300" />
                                  </span>
                                ) : (
                                  <span title="Enviada">
                                    <Check className="h-3 w-3 text-purple-200" />
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Typing Indicator: 3 Animated Violet Dots in Stream */}
                  {typingUserIds.length > 0 && (
                    <div className="flex items-end gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150">
                      <div className="h-7 w-7 rounded-lg overflow-hidden border border-purple-800/40 shrink-0 mb-1">
                        {activePartner.avatarUrl ? (
                          <img
                            src={activePartner.avatarUrl}
                            alt={activePartner.displayName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-purple-900 text-[10px] font-bold text-white">
                            {activePartner.displayName.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="bg-[#18112e] text-[#EDE8F5] rounded-2xl rounded-bl-xs border border-purple-900/50 px-3.5 py-2 shadow-md flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.3s]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.15s]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" />
                        </div>
                        <span className="text-[11px] text-purple-300/80 italic font-medium">
                          {activePartner.displayName} está digitando...
                        </span>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Floating "Novas mensagens ↓" Pill Button */}
                {unreadNewMessagesCount > 0 && (
                  <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
                    <button
                      type="button"
                      onClick={() => {
                        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                        setUnreadNewMessagesCount(0);
                      }}
                      className="flex items-center gap-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow-lg shadow-purple-950/80 border border-purple-400/50 cursor-pointer active:scale-95 transition-all"
                    >
                      <span>Novas mensagens ({unreadNewMessagesCount})</span>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Staged Media Bar before sending */}
                {pendingMediaUrl && (
                  <div className="p-3 bg-[#130B24] border-t border-purple-900/40 flex items-center justify-between gap-3 animate-in fade-in">
                    <div className="flex items-center gap-3">
                      <div className="relative h-14 w-14 rounded-lg overflow-hidden border border-purple-600/50 bg-black/50">
                        <img
                          src={pendingMediaUrl}
                          alt="Prévia anexo"
                          className="h-full w-full object-cover"
                        />
                        {pendingMediaType === 'gif' && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[8px] font-bold text-white uppercase">
                            GIF
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">
                          {pendingMediaType === 'gif'
                            ? `GIF Animado pronto: ${pendingMediaTitle || 'Galeria'}`
                            : `Imagem pronta: ${pendingMediaTitle || 'Arquivo'}`}
                        </span>
                        <span className="text-[11px] text-purple-300/70">
                          Pressione Enter ou clique em Enviar.
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPendingMediaUrl(null);
                        setPendingMediaType(null);
                        setPendingMediaTitle(null);
                      }}
                      className="rounded-lg p-1 text-purple-400 hover:text-rose-300 cursor-pointer active:scale-90"
                      title="Remover anexo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Error Banner */}
                {errorMessage && (
                  <div className="px-4 py-2 bg-rose-950/60 border-t border-rose-500/40 text-xs text-rose-200 flex items-center justify-between">
                    <span>{errorMessage}</span>
                    <button
                      type="button"
                      onClick={() => setErrorMessage(null)}
                      className="text-rose-400 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Typing / Composition Bar */}
                <div className="p-3 bg-[#0e091d] border-t border-purple-900/30 relative">
                  {/* Popover Unificado de Mídia (Imagens e GIFs) */}
                  <GifPickerPopover
                    isOpen={isMediaPickerOpen}
                    onClose={() => setIsMediaPickerOpen(false)}
                    onSelectMedia={(url, type, title) => {
                      setPendingMediaUrl(url);
                      setPendingMediaType(type);
                      setPendingMediaTitle(title);
                      if (!inputText && type === 'gif' && title) {
                        setInputText(title);
                      }
                    }}
                  />

                  <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                    {/* Media Action Button (Unificado para Imagem e GIF) */}
                    <div className="flex items-center gap-1 pb-1">
                      <button
                        type="button"
                        disabled={!privacyCheck.allowed || isSending}
                        onClick={() => setIsMediaPickerOpen(!isMediaPickerOpen)}
                        className={`rounded-xl p-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
                          isMediaPickerOpen
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-purple-300 hover:bg-purple-900/40 hover:text-white'
                        }`}
                        title="Anexar imagem ou GIF animado"
                      >
                        <ImageIcon className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Textarea Input */}
                    <div className="flex-1 min-w-0">
                      <textarea
                        rows={1}
                        disabled={!privacyCheck.allowed || isSending}
                        value={inputText}
                        onChange={handleTextareaChange}
                        onKeyDown={handleKeyDown}
                        placeholder={
                          privacyCheck.allowed
                            ? `Mensagem para @${activePartner.username}...`
                            : 'Envio bloqueado pelas preferências de privacidade.'
                        }
                        className="w-full resize-none rounded-xl border border-purple-900/50 bg-[#0A0713] px-3.5 py-2 text-xs sm:text-sm text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none transition-colors max-h-32 disabled:bg-neutral-900/50 disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* Send Button */}
                    <button
                      type="submit"
                      disabled={
                        !privacyCheck.allowed ||
                        isSending ||
                        (!inputText.trim() && !pendingMediaUrl)
                      }
                      className="rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white p-2.5 transition-all shadow-md shadow-purple-950 cursor-pointer disabled:cursor-not-allowed shrink-0 active:scale-95"
                      title="Enviar mensagem (Enter)"
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-purple-200" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-950/40 border border-purple-800/30 text-purple-400 shadow-xl">
                  <MessageSquare className="h-8 w-8" />
                </div>
                <h3 className="text-base font-bold text-white">Selecione uma conversa</h3>
                <p className="text-xs text-purple-300/60 max-w-sm leading-relaxed">
                  Escolha uma conversa na barra lateral ou visite o perfil de um usuário para iniciar uma nova mensagem privada no Hikari.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Lightbox Modal for enlarged image and GIF view */}
        {enlargedImageUrl && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4 animate-in fade-in cursor-zoom-out"
            onClick={() => setEnlargedImageUrl(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-purple-900/50 bg-black/70">
              <img
                src={enlargedImageUrl}
                alt="Visualização ampliada"
                className="max-h-[85vh] max-w-full object-contain"
              />
              <button
                type="button"
                onClick={() => setEnlargedImageUrl(null)}
                className="absolute top-3 right-3 rounded-xl bg-black/70 p-2 text-white hover:bg-purple-900/80 cursor-pointer active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
