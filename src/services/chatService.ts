import {
  collection,
  doc,
  query,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type {
  PrivateConversation,
  PrivateMessage,
  MessageType,
  HikariLinkPreview,
  ParticipantSummary,
} from '../types';
import {
  getDeterministicConversationId,
  extractHikariLinkPreview,
  validateMediaPayload,
  canUserMessageRecipient,
  type UserCheckContext,
} from '../utils/chatValidation';

export { getDeterministicConversationId, extractHikariLinkPreview, canUserMessageRecipient };
export type { UserCheckContext };

const LOCAL_STORAGE_CONVERSATIONS_KEY = 'hikari_chat_conversations_cache_v1';
const LOCAL_STORAGE_MESSAGES_KEY_PREFIX = 'hikari_chat_messages_cache_v1:';
const PASSIVE_UNREAD_REFRESH_COOLDOWN_MS = 60_000;
const CONVERSATIONS_LIST_POLL_MS = 4000;
const CONVERSATION_MESSAGES_POLL_MS = 2500;

function getLocalMessagesKey(convId: string): string {
  return `${LOCAL_STORAGE_MESSAGES_KEY_PREFIX}${convId}`;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// ============================================================================
// Write-through In-Memory Cache for Chat Storage (eliminates repeated JSON.parse)
// ============================================================================

let memoryConversationsCache: PrivateConversation[] | null = null;
let lastConversationsRaw: string | null = null;

const memoryMessagesCache = new Map<
  string,
  { messages: PrivateMessage[]; lastRaw: string | null }
>();

let chatStorageListenerAttached = false;

function ensureChatStorageListener(): void {
  if (chatStorageListenerAttached || typeof window === 'undefined') return;
  chatStorageListenerAttached = true;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (!event.key) {
      memoryConversationsCache = null;
      lastConversationsRaw = null;
      memoryMessagesCache.clear();
      return;
    }
    if (event.key === LOCAL_STORAGE_CONVERSATIONS_KEY) {
      memoryConversationsCache = null;
      lastConversationsRaw = null;
      notifyAllUnreadSubscribersFromCache();
      return;
    }
    if (event.key.startsWith(LOCAL_STORAGE_MESSAGES_KEY_PREFIX)) {
      const convId = event.key.slice(LOCAL_STORAGE_MESSAGES_KEY_PREFIX.length);
      if (convId) {
        memoryMessagesCache.delete(convId);
      }
    }
  });
}

export function readCachedConversations(): PrivateConversation[] {
  ensureChatStorageListener();
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryConversationsCache ?? [];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_CONVERSATIONS_KEY);
    if (memoryConversationsCache !== null && raw === lastConversationsRaw) {
      return memoryConversationsCache;
    }
    lastConversationsRaw = raw;
    if (!raw) {
      memoryConversationsCache = [];
      return memoryConversationsCache;
    }
    const parsed = JSON.parse(raw);
    memoryConversationsCache = Array.isArray(parsed) ? parsed : [];
    return memoryConversationsCache;
  } catch {
    return memoryConversationsCache ?? [];
  }
}

export function writeCachedConversations(conversations: PrivateConversation[]): void {
  ensureChatStorageListener();
  memoryConversationsCache = conversations;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const serialized = JSON.stringify(conversations);
      lastConversationsRaw = serialized;
      window.localStorage.setItem(LOCAL_STORAGE_CONVERSATIONS_KEY, serialized);
    } catch {
      // Ignore storage quota
    }
  }
  notifyAllUnreadSubscribersFromCache();
}

export function readCachedMessages(convId: string): PrivateMessage[] {
  ensureChatStorageListener();
  const cached = memoryMessagesCache.get(convId);
  if (typeof window === 'undefined' || !window.localStorage) {
    return cached?.messages ?? [];
  }
  try {
    const raw = window.localStorage.getItem(getLocalMessagesKey(convId));
    if (cached && raw === cached.lastRaw) {
      return cached.messages;
    }
    if (!raw) {
      memoryMessagesCache.set(convId, { messages: [], lastRaw: null });
      return [];
    }
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed) ? parsed : [];
    memoryMessagesCache.set(convId, { messages, lastRaw: raw });
    return messages;
  } catch {
    return cached?.messages ?? [];
  }
}

export function writeCachedMessages(convId: string, messages: PrivateMessage[]): void {
  ensureChatStorageListener();
  let serialized: string | null = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      serialized = JSON.stringify(messages);
      window.localStorage.setItem(getLocalMessagesKey(convId), serialized);
    } catch {
      // Ignore storage quota
    }
  }
  memoryMessagesCache.set(convId, { messages, lastRaw: serialized });
}

// ============================================================================
// Privacy Context Sync Deduplication
// ============================================================================

const lastSyncedPrivacySignatureByUserId = new Map<string, string>();
let syncPrivacyContextNetworkCalls = 0;

/**
 * Sincroniza o contexto de privacidade do usuário atual com o servidor,
 * deduplicando chamadas idênticas para evitar POSTs redundantes ao editar animes.
 */
export async function syncUserPrivacyContext(context: UserCheckContext): Promise<void> {
  if (!context.id) return;

  const normalizedPayload = {
    id: context.id,
    username: context.username,
    displayName: context.displayName,
    avatarUrl: context.avatarUrl,
    allowDirectMessages: context.allowDirectMessages !== false,
    directMessagesFrom: context.directMessagesFrom || 'everyone',
    showOnlineStatus: context.showOnlineStatus !== false,
    followingIds: [...context.followingIds].sort(),
    followerIds: [...context.followerIds].sort(),
    blockedIds: [...context.blockedIds].sort(),
  };

  const signature = JSON.stringify(normalizedPayload);
  if (lastSyncedPrivacySignatureByUserId.get(context.id) === signature) {
    return;
  }
  lastSyncedPrivacySignatureByUserId.set(context.id, signature);
  syncPrivacyContextNetworkCalls++;

  try {
    await fetch('/api/chat/sync-user-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: signature,
    });
  } catch {
    // Permite tentar novamente em caso de falha transitória
    if (lastSyncedPrivacySignatureByUserId.get(context.id) === signature) {
      lastSyncedPrivacySignatureByUserId.delete(context.id);
    }
  }
}

// ============================================================================
// Conversations Fetch & Passive Unread Counters
// ============================================================================

const inFlightConversationsByUser = new Map<string, Promise<PrivateConversation[]>>();
const lastConversationsFetchedAtByUser = new Map<string, number>();

interface PassiveUnreadBucket {
  listeners: Set<(unreadTotal: number) => void>;
  lastEmittedCount: number;
}

const passiveUnreadSubscribersByUser = new Map<string, PassiveUnreadBucket>();

function computeUnreadTotalForUser(userId: string, convs: PrivateConversation[]): number {
  let sum = 0;
  for (let i = 0; i < convs.length; i++) {
    const c = convs[i];
    if (c.participants.includes(userId)) {
      sum += c.unreadCounts?.[userId] || 0;
    }
  }
  return sum;
}

function notifyUnreadSubscribersForUser(userId: string, convs?: PrivateConversation[]): void {
  const bucket = passiveUnreadSubscribersByUser.get(userId);
  if (!bucket || bucket.listeners.size === 0) return;
  const source = convs ?? readCachedConversations();
  const nextCount = computeUnreadTotalForUser(userId, source);
  if (nextCount !== bucket.lastEmittedCount) {
    bucket.lastEmittedCount = nextCount;
    for (const listener of bucket.listeners) {
      listener(nextCount);
    }
  }
}

function notifyAllUnreadSubscribersFromCache(): void {
  if (passiveUnreadSubscribersByUser.size === 0) return;
  const cached = readCachedConversations();
  for (const userId of passiveUnreadSubscribersByUser.keys()) {
    notifyUnreadSubscribersForUser(userId, cached);
  }
}

/**
 * Consulta conversas do usuário atual (com deduplicação de requisições concorrentes)
 */
export async function fetchUserConversations(userId: string): Promise<PrivateConversation[]> {
  const existingRequest = inFlightConversationsByUser.get(userId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async (): Promise<PrivateConversation[]> => {
    try {
      const res = await fetch(`/api/chat/conversations?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.conversations)) {
          lastConversationsFetchedAtByUser.set(userId, Date.now());
          writeCachedConversations(data.conversations);
          notifyUnreadSubscribersForUser(userId, data.conversations);
          return data.conversations;
        }
      }
    } catch {
      // Fallback para cache local
    }
    const fallback = readCachedConversations().filter((c) => c.participants.includes(userId));
    notifyUnreadSubscribersForUser(userId, fallback);
    return fallback;
  })();

  inFlightConversationsByUser.set(userId, request);
  try {
    return await request;
  } finally {
    inFlightConversationsByUser.delete(userId);
  }
}

/**
 * Abre ou cria uma conversa entre dois participantes
 */
export async function startOrGetConversation(
  sender: ParticipantSummary,
  recipient: ParticipantSummary
): Promise<PrivateConversation> {
  const convId = getDeterministicConversationId(sender.id, recipient.id);

  try {
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, recipient }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Não foi possível iniciar a conversa.');
    }

    const data = await res.json();
    const conv: PrivateConversation = data.conversation;
    const cached = readCachedConversations();
    const nextConvs = cached.some((c) => c.id === conv.id)
      ? cached.map((c) => (c.id === conv.id ? conv : c))
      : [conv, ...cached];
    writeCachedConversations(nextConvs);
    return conv;
  } catch (err) {
    if (err instanceof Error && err.message !== 'Failed to fetch' && !err.message.includes('fetch')) {
      throw err;
    }
    // Fallback local se o servidor offline
    const cached = readCachedConversations();
    const existing = cached.find((c) => c.id === convId);
    if (existing) return existing;

    const newConv: PrivateConversation = {
      id: convId,
      participants: [sender.id, recipient.id],
      participantDetails: {
        [sender.id]: sender,
        [recipient.id]: recipient,
      },
      unreadCounts: { [sender.id]: 0, [recipient.id]: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeCachedConversations([newConv, ...cached]);
    return newConv;
  }
}

/**
 * Busca histórico paginado de mensagens de uma conversa
 */
export async function fetchConversationMessages(
  convId: string,
  userId: string,
  options?: { limit?: number; before?: number }
): Promise<{ messages: PrivateMessage[]; hasMore: boolean }> {
  try {
    const params = new URLSearchParams({
      userId,
      limit: String(options?.limit ?? 30),
    });
    if (options?.before) {
      params.set('before', String(options.before));
    }

    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(convId)}/messages?${params.toString()}`
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        if (!options?.before) {
          writeCachedMessages(convId, data.messages);
        }
        return data;
      }
    }
  } catch {
    // Fallback para cache
  }

  const cached = readCachedMessages(convId);
  const before = options?.before;
  const limit = options?.limit ?? 30;
  const filtered = before ? cached.filter((m) => m.createdAt < before) : cached;
  const startIndex = Math.max(0, filtered.length - limit);
  const slice = filtered.slice(startIndex);
  return { messages: slice, hasMore: startIndex > 0 };
}

/**
 * Envia uma mensagem direta
 */
export async function sendPrivateMessage(payload: {
  conversationId?: string;
  sender: ParticipantSummary;
  recipient: ParticipantSummary;
  text: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaMetadata?: PrivateMessage['mediaMetadata'];
  linkPreview?: HikariLinkPreview;
}): Promise<PrivateMessage> {
  const { sender, recipient, text, mediaUrl } = payload;
  const type = payload.type || (mediaUrl ? 'image' : 'text');
  const targetConvId =
    payload.conversationId || getDeterministicConversationId(sender.id, recipient.id);

  // Validação preliminar no client
  const mediaVal = validateMediaPayload(mediaUrl, type);
  if (!mediaVal.valid) {
    throw new Error(mediaVal.error);
  }

  const preview = payload.linkPreview || extractHikariLinkPreview(text);

  const res = await fetch('/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: targetConvId,
      senderId: sender.id,
      senderName: sender.displayName,
      senderUsername: sender.username,
      senderAvatarUrl: sender.avatarUrl,
      recipientId: recipient.id,
      text,
      type,
      mediaUrl,
      mediaMetadata: payload.mediaMetadata,
      linkPreview: preview,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Erro ao enviar mensagem.');
  }

  const data = await res.json();
  const sentMessage: PrivateMessage = data.message;

  // Atualiza cache local e notifica canal ativo sem esperar próximo ciclo
  const currentCached = readCachedMessages(targetConvId);
  const nextMessages = currentCached.some((m) => m.id === sentMessage.id)
    ? currentCached
    : [...currentCached, sentMessage];
  writeCachedMessages(targetConvId, nextMessages);
  emitLocalMessagesToActiveChannels(targetConvId, nextMessages);

  // Tenta persistir no Firestore se estiver inicializado com Firebase Auth
  if (db && auth?.currentUser?.uid === sender.id) {
    try {
      const msgDocRef = doc(db, 'conversations', targetConvId, 'messages', sentMessage.id);
      await setDoc(msgDocRef, {
        id: sentMessage.id,
        conversationId: targetConvId,
        senderId: sender.id,
        senderName: sender.displayName,
        senderUsername: sender.username,
        senderAvatarUrl: sender.avatarUrl,
        recipientId: recipient.id,
        text: sentMessage.text,
        type: sentMessage.type,
        ...(sentMessage.mediaUrl ? { mediaUrl: sentMessage.mediaUrl } : {}),
        ...(sentMessage.mediaMetadata ? { mediaMetadata: sentMessage.mediaMetadata } : {}),
        ...(sentMessage.linkPreview ? { linkPreview: sentMessage.linkPreview } : {}),
        isRead: false,
        createdAt: serverTimestamp(),
      });

      const convDocRef = doc(db, 'conversations', targetConvId);
      await updateDoc(convDocRef, {
        lastMessage: {
          id: sentMessage.id,
          text: sentMessage.text,
          senderId: sender.id,
          senderName: sender.displayName,
          type: sentMessage.type,
          createdAt: serverTimestamp(),
          isRead: false,
        },
        [`unreadCounts.${recipient.id}`]: 1,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignora erro do Firestore caso permissões ou modo offline
    }
  }

  return sentMessage;
}

/**
 * Marca mensagens de uma conversa como lidas
 */
export async function markConversationAsRead(convId: string, userId: string): Promise<void> {
  try {
    await fetch(`/api/chat/conversations/${encodeURIComponent(convId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  } catch {
    // Ignora erro de rede
  }

  // Atualiza cache local
  const cached = readCachedMessages(convId);
  const updated = cached.map((m) =>
    m.recipientId === userId && !m.isRead ? { ...m, isRead: true } : m
  );
  writeCachedMessages(convId, updated);
  emitLocalMessagesToActiveChannels(convId, updated);

  const convs = readCachedConversations();
  const convUpdated = convs.map((c) => {
    if (c.id === convId) {
      return {
        ...c,
        unreadCounts: { ...c.unreadCounts, [userId]: 0 },
        lastMessage:
          c.lastMessage && c.lastMessage.senderId !== userId
            ? { ...c.lastMessage, isRead: true }
            : c.lastMessage,
      };
    }
    return c;
  });
  writeCachedConversations(convUpdated);
  emitLocalConversationsToActivePoller(userId, convUpdated);

  // Firestore update se ativo
  if (db && auth?.currentUser?.uid === userId) {
    try {
      const convDocRef = doc(db, 'conversations', convId);
      await updateDoc(convDocRef, {
        [`unreadCounts.${userId}`]: 0,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignora
    }
  }
}

/**
 * Alterna reação em uma mensagem (adiciona, substitui ou remove)
 */
export async function toggleMessageReaction(
  convId: string,
  msgId: string,
  userId: string,
  emoji: string
): Promise<PrivateMessage> {
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}/reaction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, emoji }),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Não foi possível atualizar a reação.');
  }

  const data = await res.json();
  const updatedMessage: PrivateMessage = data.message;

  const cached = readCachedMessages(convId);
  const updated = cached.map((m) => (m.id === msgId ? updatedMessage : m));
  writeCachedMessages(convId, updated);
  emitLocalMessagesToActiveChannels(convId, updated);

  return updatedMessage;
}

/**
 * Envia indicador de digitação para a conversa
 */
export async function sendTypingIndicator(
  convId: string,
  userId: string,
  isTyping: boolean
): Promise<void> {
  try {
    await fetch(`/api/chat/conversations/${encodeURIComponent(convId)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isTyping }),
    });
  } catch {
    // Silencioso
  }
}

/**
 * Envia batimento de presença ativo (somente quando a aba está visível)
 */
export async function sendPresenceHeartbeat(
  userId: string,
  showOnlineStatus?: boolean
): Promise<void> {
  if (isDocumentHidden()) return;
  try {
    await fetch('/api/chat/presence/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, showOnlineStatus }),
    });
  } catch {
    // Silencioso
  }
}

/**
 * Envia evento de desconexão (ao fechar janela ou ocultar aba)
 */
export function sendPresenceOffline(userId: string): void {
  try {
    const payload = JSON.stringify({ userId });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/chat/presence/offline', blob);
    } else {
      fetch('/api/chat/presence/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Silencioso
  }
}

function areMessagesAndTypingEqual(
  prevMsgs: PrivateMessage[],
  newMsgs: PrivateMessage[],
  prevTyping: string[],
  newTyping: string[]
): boolean {
  if (prevMsgs.length !== newMsgs.length) return false;
  if (prevTyping.length !== newTyping.length) return false;
  for (let i = 0; i < prevTyping.length; i++) {
    if (prevTyping[i] !== newTyping[i]) return false;
  }

  for (let i = 0; i < newMsgs.length; i++) {
    const p = prevMsgs[i];
    const n = newMsgs[i];
    if (p.id !== n.id || p.isRead !== n.isRead || p.text !== n.text) return false;

    const pReact = p.reactions || {};
    const nReact = n.reactions || {};
    const pKeys = Object.keys(pReact);
    const nKeys = Object.keys(nReact);
    if (pKeys.length !== nKeys.length) return false;
    for (const key of nKeys) {
      const pUsers = pReact[key] || [];
      const nUsers = nReact[key] || [];
      if (pUsers.length !== nUsers.length) return false;
    }
  }

  return true;
}

// ============================================================================
// Deduplicated Active Conversation Channel & Visibility-Aware Pollers
// ============================================================================

type ConversationUpdateListener = (payload: {
  messages: PrivateMessage[];
  typingUsers: string[];
}) => void;

interface SharedConversationChannel {
  key: string;
  convId: string;
  userId: string;
  listeners: Set<ConversationUpdateListener>;
  intervalId: ReturnType<typeof setInterval> | null;
  firestoreUnsubscribe: (() => void) | null;
  firestoreRealtimeActive: boolean;
  lastKnownMessages: PrivateMessage[];
  lastKnownTyping: string[];
}

interface SharedConversationsPoller {
  userId: string;
  listeners: Set<(conversations: PrivateConversation[]) => void>;
  intervalId: ReturnType<typeof setInterval> | null;
  lastEmitted: PrivateConversation[] | null;
  lastFetchedAt: number;
}

const activeConversationChannels = new Map<string, SharedConversationChannel>();
const activeConversationPollers = new Map<string, SharedConversationsPoller>();

let chatVisibilityListenerRegistered = false;

function stopChannelPollTimer(channel: SharedConversationChannel): void {
  if (channel.intervalId !== null) {
    clearInterval(channel.intervalId);
    channel.intervalId = null;
  }
}

function stopListPollerTimer(poller: SharedConversationsPoller): void {
  if (poller.intervalId !== null) {
    clearInterval(poller.intervalId);
    poller.intervalId = null;
  }
}

async function pollChannelOnce(channel: SharedConversationChannel): Promise<void> {
  if (
    channel.listeners.size === 0 ||
    isDocumentHidden() ||
    channel.firestoreRealtimeActive
  ) {
    return;
  }

  try {
    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(channel.convId)}/messages?userId=${encodeURIComponent(channel.userId)}&limit=50`
    );
    if (!res.ok || channel.listeners.size === 0) return;

    const data = await res.json();
    const incomingMessages: PrivateMessage[] = Array.isArray(data.messages) ? data.messages : [];
    const incomingTyping: string[] = Array.isArray(data.typingUsers) ? data.typingUsers : [];

    const isEqual = areMessagesAndTypingEqual(
      channel.lastKnownMessages,
      incomingMessages,
      channel.lastKnownTyping,
      incomingTyping
    );

    if (!isEqual) {
      channel.lastKnownMessages = incomingMessages;
      channel.lastKnownTyping = incomingTyping;
      writeCachedMessages(channel.convId, incomingMessages);
      const payload = { messages: incomingMessages, typingUsers: incomingTyping };
      for (const listener of channel.listeners) {
        listener(payload);
      }
    }
  } catch {
    // Ignora erro transitório
  }
}

function startChannelPollTimerIfNeeded(channel: SharedConversationChannel): void {
  // Evita rodar simultaneamente onSnapshot em tempo real e polling HTTP duplicado
  if (channel.firestoreRealtimeActive) {
    stopChannelPollTimer(channel);
    return;
  }
  if (channel.intervalId !== null || channel.listeners.size === 0 || isDocumentHidden()) {
    return;
  }
  channel.intervalId = setInterval(() => {
    if (isDocumentHidden() || channel.firestoreRealtimeActive) {
      stopChannelPollTimer(channel);
      return;
    }
    void pollChannelOnce(channel);
  }, CONVERSATION_MESSAGES_POLL_MS);
}

async function pollConversationsListOnce(poller: SharedConversationsPoller): Promise<void> {
  if (poller.listeners.size === 0 || isDocumentHidden()) return;
  try {
    const convs = await fetchUserConversations(poller.userId);
    if (poller.listeners.size === 0) return;
    poller.lastEmitted = convs;
    poller.lastFetchedAt = Date.now();
    for (const listener of poller.listeners) {
      listener(convs);
    }
  } catch {
    // Ignora erro transitório
  }
}

function startListPollerTimerIfNeeded(poller: SharedConversationsPoller): void {
  if (poller.intervalId !== null || poller.listeners.size === 0 || isDocumentHidden()) {
    return;
  }
  poller.intervalId = setInterval(() => {
    if (isDocumentHidden()) {
      stopListPollerTimer(poller);
      return;
    }
    void pollConversationsListOnce(poller);
  }, CONVERSATIONS_LIST_POLL_MS);
}

function emitLocalMessagesToActiveChannels(convId: string, messages: PrivateMessage[]): void {
  for (const channel of activeConversationChannels.values()) {
    if (channel.convId === convId && channel.listeners.size > 0) {
      channel.lastKnownMessages = messages;
      const payload = { messages, typingUsers: channel.lastKnownTyping };
      for (const listener of channel.listeners) {
        listener(payload);
      }
    }
  }
}

function emitLocalConversationsToActivePoller(
  userId: string,
  allConversations: PrivateConversation[]
): void {
  const poller = activeConversationPollers.get(userId);
  if (!poller || poller.listeners.size === 0) return;
  const filtered = allConversations.filter((c) => c.participants.includes(userId));
  poller.lastEmitted = filtered;
  for (const listener of poller.listeners) {
    listener(filtered);
  }
}

function handleChatVisibilityChange(): void {
  if (isDocumentHidden()) {
    for (const poller of activeConversationPollers.values()) {
      stopListPollerTimer(poller);
    }
    for (const channel of activeConversationChannels.values()) {
      stopChannelPollTimer(channel);
    }
    return;
  }

  const now = Date.now();

  // Retorno ao primeiro plano: reativa somente os pollers/canais de modais realmente abertos
  for (const poller of activeConversationPollers.values()) {
    if (poller.listeners.size > 0) {
      void pollConversationsListOnce(poller);
      startListPollerTimerIfNeeded(poller);
    }
  }

  for (const channel of activeConversationChannels.values()) {
    if (channel.listeners.size > 0 && !channel.firestoreRealtimeActive) {
      void pollChannelOnce(channel);
      startChannelPollTimerIfNeeded(channel);
    }
  }

  // Atualiza contador passivo de não lidas apenas se estiver obsoleto (> 60s) e sem poller ativo
  for (const [userId, bucket] of passiveUnreadSubscribersByUser.entries()) {
    if (bucket.listeners.size === 0 || activeConversationPollers.has(userId)) continue;
    const lastFetch = lastConversationsFetchedAtByUser.get(userId) ?? 0;
    if (now - lastFetch >= PASSIVE_UNREAD_REFRESH_COOLDOWN_MS) {
      void fetchUserConversations(userId);
    }
  }
}

function attachChatVisibilityListener(): void {
  if (chatVisibilityListenerRegistered || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', handleChatVisibilityChange);
  chatVisibilityListenerRegistered = true;
}

function detachChatVisibilityListenerIfIdle(): void {
  if (!chatVisibilityListenerRegistered || typeof document === 'undefined') return;
  if (
    activeConversationChannels.size === 0 &&
    activeConversationPollers.size === 0 &&
    passiveUnreadSubscribersByUser.size === 0
  ) {
    document.removeEventListener('visibilitychange', handleChatVisibilityChange);
    chatVisibilityListenerRegistered = false;
  }
}

/**
 * Assina o contador de mensagens não lidas SEM criar polling global em segundo plano.
 * - Emite imediatamente a partir do cache.
 * - Faz 1 consulta inicial única na sessão (quando visível).
 * - Atualiza instantaneamente em eventos locais (ler/enviar/abrir chat) ou retorno ao primeiro plano após cooldown.
 */
export function subscribeToUnreadMessagesCount(
  userId: string,
  onUnreadChange: (unreadCount: number) => void
): () => void {
  if (!userId) return () => {};

  attachChatVisibilityListener();

  let bucket = passiveUnreadSubscribersByUser.get(userId);
  if (!bucket) {
    const initialCount = computeUnreadTotalForUser(userId, readCachedConversations());
    bucket = {
      listeners: new Set(),
      lastEmittedCount: initialCount,
    };
    passiveUnreadSubscribersByUser.set(userId, bucket);
  }

  bucket.listeners.add(onUnreadChange);
  onUnreadChange(bucket.lastEmittedCount);

  const lastFetch = lastConversationsFetchedAtByUser.get(userId) ?? 0;
  if (!isDocumentHidden() && Date.now() - lastFetch >= PASSIVE_UNREAD_REFRESH_COOLDOWN_MS) {
    void fetchUserConversations(userId);
  }

  return () => {
    const currentBucket = passiveUnreadSubscribersByUser.get(userId);
    if (!currentBucket) return;
    currentBucket.listeners.delete(onUnreadChange);
    if (currentBucket.listeners.size === 0) {
      passiveUnreadSubscribersByUser.delete(userId);
    }
    detachChatVisibilityListenerIfIdle();
  };
}

/**
 * Assina atualizações em tempo real de uma conversa aberta:
 * - Mantém estritamente UMA assinatura compartilhada por (userId, convId).
 * - Se o listener onSnapshot do Firestore estiver ativo e entregando dados, desativa o polling HTTP duplicado.
 * - Pausa automaticamente qualquer polling quando a aba está oculta e limpa todos os timers ao fechar.
 */
export function subscribeToConversation(
  convId: string,
  userId: string,
  onUpdate: ConversationUpdateListener
): () => void {
  const channelKey = `${userId}::${convId}`;
  attachChatVisibilityListener();

  let channel = activeConversationChannels.get(channelKey);
  const isNewChannel = !channel;

  if (!channel) {
    channel = {
      key: channelKey,
      convId,
      userId,
      listeners: new Set(),
      intervalId: null,
      firestoreUnsubscribe: null,
      firestoreRealtimeActive: false,
      lastKnownMessages: readCachedMessages(convId),
      lastKnownTyping: [],
    };
    activeConversationChannels.set(channelKey, channel);
  }

  channel.listeners.add(onUpdate);

  // Emissão imediata do cache/estado conhecido
  if (channel.lastKnownMessages.length > 0 || channel.lastKnownTyping.length > 0) {
    onUpdate({
      messages: channel.lastKnownMessages,
      typingUsers: channel.lastKnownTyping,
    });
  }

  if (isNewChannel) {
    // 1. Tenta conectar listener Firestore nativo se autenticado com o mesmo UID
    if (db && auth?.currentUser?.uid === userId) {
      try {
        const messagesCol = collection(db, 'conversations', convId, 'messages');
        const q = query(messagesCol, orderBy('createdAt', 'asc'), firestoreLimit(50));
        const activeChannel = channel;
        channel.firestoreUnsubscribe = onSnapshot(
          q,
          (snapshot) => {
            if (activeChannel.listeners.size === 0) return;

            const remoteMsgs: PrivateMessage[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
              remoteMsgs.push({
                id: docSnap.id,
                conversationId: convId,
                senderId: data.senderId,
                senderName: data.senderName,
                senderUsername: data.senderUsername,
                senderAvatarUrl: data.senderAvatarUrl || '',
                recipientId: data.recipientId,
                text: data.text || '',
                type: data.type || 'text',
                mediaUrl: data.mediaUrl,
                mediaMetadata: data.mediaMetadata,
                linkPreview: data.linkPreview,
                reactions: data.reactions || {},
                isRead: data.isRead ?? false,
                createdAt: createdAtMs,
                status: 'sent',
              });
            });

            if (remoteMsgs.length > 0) {
              // onSnapshot ativo com documentos reais: interrompe polling HTTP redundante
              activeChannel.firestoreRealtimeActive = true;
              stopChannelPollTimer(activeChannel);

              const isEqual = areMessagesAndTypingEqual(
                activeChannel.lastKnownMessages,
                remoteMsgs,
                activeChannel.lastKnownTyping,
                activeChannel.lastKnownTyping
              );
              if (!isEqual) {
                activeChannel.lastKnownMessages = remoteMsgs;
                writeCachedMessages(convId, remoteMsgs);
                const payload = {
                  messages: remoteMsgs,
                  typingUsers: activeChannel.lastKnownTyping,
                };
                for (const listener of activeChannel.listeners) {
                  listener(payload);
                }
              }
            }
          },
          () => {
            // Fallback seguro para polling caso o snapshot falhe (ex: permissões/offline)
            activeChannel.firestoreRealtimeActive = false;
            startChannelPollTimerIfNeeded(activeChannel);
          }
        );
      } catch {
        channel.firestoreUnsubscribe = null;
        channel.firestoreRealtimeActive = false;
      }
    }

    // 2. Faz 1 sincronização inicial e inicia polling controlado apenas se necessário e aba visível
    if (!isDocumentHidden()) {
      void pollChannelOnce(channel);
    }
    startChannelPollTimerIfNeeded(channel);
  }

  return () => {
    const currentChannel = activeConversationChannels.get(channelKey);
    if (!currentChannel) return;
    currentChannel.listeners.delete(onUpdate);
    if (currentChannel.listeners.size === 0) {
      stopChannelPollTimer(currentChannel);
      if (currentChannel.firestoreUnsubscribe) {
        currentChannel.firestoreUnsubscribe();
        currentChannel.firestoreUnsubscribe = null;
      }
      activeConversationChannels.delete(channelKey);
    }
    detachChatVisibilityListenerIfIdle();
  };
}

/**
 * Assina atualizações da lista de conversas enquanto o PrivateChatModal está aberto:
 * - Compartilha um único poller por userId.
 * - Pausa automaticamente quando document.visibilityState === 'hidden'.
 * - Encerra imediatamente o timer ao fechar o modal.
 */
export function subscribeToConversationsList(
  userId: string,
  onUpdate: (conversations: PrivateConversation[]) => void
): () => void {
  attachChatVisibilityListener();
  let poller = activeConversationPollers.get(userId);

  if (!poller) {
    const cached = readCachedConversations().filter((c) => c.participants.includes(userId));
    poller = {
      userId,
      listeners: new Set(),
      intervalId: null,
      lastEmitted: cached.length > 0 ? cached : null,
      lastFetchedAt: 0,
    };
    activeConversationPollers.set(userId, poller);
  }

  poller.listeners.add(onUpdate);

  if (poller.lastEmitted) {
    onUpdate(poller.lastEmitted);
  }

  if (!isDocumentHidden() && Date.now() - poller.lastFetchedAt > 1500) {
    void pollConversationsListOnce(poller);
  }
  startListPollerTimerIfNeeded(poller);

  return () => {
    const currentPoller = activeConversationPollers.get(userId);
    if (!currentPoller) return;
    currentPoller.listeners.delete(onUpdate);
    if (currentPoller.listeners.size === 0) {
      stopListPollerTimer(currentPoller);
      activeConversationPollers.delete(userId);
    }
    detachChatVisibilityListenerIfIdle();
  };
}

/**
 * Diagnósticos em tempo real para verificação automatizada da Etapa 2 (zero polling com chat fechado / aba oculta).
 */
export function getChatServiceDiagnostics(): {
  activeListPollTimers: number;
  activeConversationPollTimers: number;
  activeFirestoreListeners: number;
  passiveUnreadSubscribers: number;
  syncPrivacyContextNetworkCalls: number;
} {
  let activeListPollTimers = 0;
  for (const poller of activeConversationPollers.values()) {
    if (poller.intervalId !== null) activeListPollTimers++;
  }

  let activeConversationPollTimers = 0;
  let activeFirestoreListeners = 0;
  for (const channel of activeConversationChannels.values()) {
    if (channel.intervalId !== null) activeConversationPollTimers++;
    if (channel.firestoreUnsubscribe !== null) activeFirestoreListeners++;
  }

  let passiveUnreadSubscribers = 0;
  for (const bucket of passiveUnreadSubscribersByUser.values()) {
    passiveUnreadSubscribers += bucket.listeners.size;
  }

  return {
    activeListPollTimers,
    activeConversationPollTimers,
    activeFirestoreListeners,
    passiveUnreadSubscribers,
    syncPrivacyContextNetworkCalls,
  };
}

export function resetChatServiceMetrics(): void {
  syncPrivacyContextNetworkCalls = 0;
  lastSyncedPrivacySignatureByUserId.clear();
  lastConversationsFetchedAtByUser.clear();
}
