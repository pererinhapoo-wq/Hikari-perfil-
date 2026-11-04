import {
  collection,
  doc,
  getDoc,
  getDocs,
  where,
  writeBatch,
  increment,
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

function isDemoMockUserId(userId: string | null | undefined): boolean {
  if (!userId || typeof userId !== 'string') return false;
  const clean = userId.trim();
  return clean.startsWith('usr_');
}

const LEGACY_CONVERSATIONS_STORAGE_KEY = 'hikari_chat_conversations_cache_v1';
const SCOPED_CONVERSATIONS_STORAGE_PREFIX = 'hikari_chat_conversations_cache_v2:';
const SCOPED_MESSAGES_STORAGE_PREFIX = 'hikari_chat_messages_cache_v2:';
const PASSIVE_UNREAD_REFRESH_COOLDOWN_MS = 60_000;
const CONVERSATIONS_LIST_POLL_MS = 4000;
const CONVERSATION_MESSAGES_POLL_MS = 2500;

let activeChatSessionUserId: string | null = null;
let chatTestTokenOverride: string | null = null;
let chatBaseUrlOverride = '';

export function configureChatServiceForTests(options: {
  token?: string | null;
  baseUrl?: string;
  activeUserId?: string | null;
}): void {
  if (options.token !== undefined) {
    chatTestTokenOverride = options.token;
  }
  if (options.baseUrl !== undefined) {
    chatBaseUrlOverride = options.baseUrl.replace(/\/+$/, '');
  }
  if (options.activeUserId !== undefined) {
    activeChatSessionUserId = options.activeUserId;
  }
}

export function setActiveChatSessionUser(userId: string | null): void {
  activeChatSessionUserId = userId ? userId.trim() || null : null;
}

function buildChatUrl(pathname: string): string {
  return `${chatBaseUrlOverride}${pathname}`;
}

async function buildChatAuthHeaders(includeJsonContentType = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  if (chatTestTokenOverride) {
    headers.Authorization = `Bearer ${chatTestTokenOverride}`;
    return headers;
  }

  if (auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Allow local/offline fallback if token renewal fails transiently
    }
  }

  return headers;
}

function resolveChatCacheScopeUid(explicitUserId?: string): string | null {
  if (explicitUserId && explicitUserId.trim()) {
    return explicitUserId.trim();
  }
  if (activeChatSessionUserId) {
    return activeChatSessionUserId;
  }
  if (auth?.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  if (passiveUnreadSubscribersByUser.size === 1) {
    return Array.from(passiveUnreadSubscribersByUser.keys())[0];
  }
  return null;
}

function getScopedConversationsKey(userId?: string): string {
  const uid = resolveChatCacheScopeUid(userId);
  return uid ? `${SCOPED_CONVERSATIONS_STORAGE_PREFIX}${uid}` : LEGACY_CONVERSATIONS_STORAGE_KEY;
}

function getScopedMessagesKey(convId: string, userId?: string): string {
  const uid = resolveChatCacheScopeUid(userId) || 'shared';
  return `${SCOPED_MESSAGES_STORAGE_PREFIX}${uid}:${convId}`;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// ============================================================================
// UID-Scoped Write-Through In-Memory Cache for Chat Storage
// ============================================================================

const memoryConversationsByScope = new Map<
  string,
  { conversations: PrivateConversation[]; lastRaw: string | null }
>();

const memoryMessagesCache = new Map<
  string,
  { messages: PrivateMessage[]; lastRaw: string | null }
>();

// Tracks explicit per-user, per-conversation read timestamps so stale in-flight polls
// never revert a viewed conversation back to unread ("barra roxa").
const lastMarkedReadAtByUserAndConv = new Map<string, number>();

let chatStorageListenerAttached = false;

function ensureChatStorageListener(): void {
  if (chatStorageListenerAttached || typeof window === 'undefined') return;
  chatStorageListenerAttached = true;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (!event.key) {
      memoryConversationsByScope.clear();
      memoryMessagesCache.clear();
      return;
    }
    if (
      event.key === LEGACY_CONVERSATIONS_STORAGE_KEY ||
      event.key.startsWith(SCOPED_CONVERSATIONS_STORAGE_PREFIX)
    ) {
      memoryConversationsByScope.delete(event.key);
      notifyAllUnreadSubscribersFromCache();
      return;
    }
    if (event.key.startsWith(SCOPED_MESSAGES_STORAGE_PREFIX)) {
      memoryMessagesCache.delete(event.key);
    }
  });
}

export function readCachedConversations(userId?: string): PrivateConversation[] {
  ensureChatStorageListener();
  const storageKey = getScopedConversationsKey(userId);
  const mem = memoryConversationsByScope.get(storageKey);

  if (typeof window === 'undefined' || !window.localStorage) {
    return mem?.conversations ?? [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (mem && raw === mem.lastRaw) {
      return mem.conversations;
    }
    if (!raw) {
      memoryConversationsByScope.set(storageKey, { conversations: [], lastRaw: null });
      return [];
    }
    const parsed = JSON.parse(raw);
    const conversations = Array.isArray(parsed) ? (parsed as PrivateConversation[]) : [];
    memoryConversationsByScope.set(storageKey, { conversations, lastRaw: raw });
    return conversations;
  } catch {
    return mem?.conversations ?? [];
  }
}

export function writeCachedConversations(
  conversations: PrivateConversation[],
  userId?: string
): void {
  ensureChatStorageListener();
  const scopeUid = resolveChatCacheScopeUid(userId);
  const filtered = scopeUid
    ? conversations.filter((c) => Array.isArray(c.participants) && c.participants.includes(scopeUid))
    : conversations;
  const storageKey = getScopedConversationsKey(scopeUid ?? undefined);

  let serialized: string | null = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      serialized = JSON.stringify(filtered);
      window.localStorage.setItem(storageKey, serialized);
    } catch {
      // Ignore storage quota
    }
  }
  memoryConversationsByScope.set(storageKey, { conversations: filtered, lastRaw: serialized });

  if (scopeUid) {
    notifyUnreadSubscribersForUser(scopeUid, filtered);
  } else {
    notifyAllUnreadSubscribersFromCache();
  }
}

export function readCachedMessages(convId: string, userId?: string): PrivateMessage[] {
  ensureChatStorageListener();
  const storageKey = getScopedMessagesKey(convId, userId);
  const cached = memoryMessagesCache.get(storageKey);
  if (typeof window === 'undefined' || !window.localStorage) {
    return cached?.messages ?? [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (cached && raw === cached.lastRaw) {
      return cached.messages;
    }
    if (!raw) {
      memoryMessagesCache.set(storageKey, { messages: [], lastRaw: null });
      return [];
    }
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed) ? (parsed as PrivateMessage[]) : [];
    memoryMessagesCache.set(storageKey, { messages, lastRaw: raw });
    return messages;
  } catch {
    return cached?.messages ?? [];
  }
}

export function writeCachedMessages(
  convId: string,
  messages: PrivateMessage[],
  userId?: string
): void {
  ensureChatStorageListener();
  const storageKey = getScopedMessagesKey(convId, userId);
  let serialized: string | null = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      serialized = JSON.stringify(messages);
      window.localStorage.setItem(storageKey, serialized);
    } catch {
      // Ignore storage quota
    }
  }
  memoryMessagesCache.set(storageKey, { messages, lastRaw: serialized });
}

/**
 * Purges volatile chat caches, active pollers, and listeners belonging to other accounts
 * during logout or account switching so messages/conversations never leak across sessions.
 */
export function clearChatSessionMemoryCache(keepUid?: string): void {
  const cleanKeep = keepUid?.trim() || null;
  activeChatSessionUserId = cleanKeep;

  for (const [pollerUid, poller] of Array.from(activeConversationPollers.entries())) {
    if (!cleanKeep || pollerUid !== cleanKeep) {
      stopListPollerTimer(poller);
      poller.listeners.clear();
      activeConversationPollers.delete(pollerUid);
    }
  }

  for (const [channelKey, channel] of Array.from(activeConversationChannels.entries())) {
    if (!cleanKeep || channel.userId !== cleanKeep) {
      stopChannelPollTimer(channel);
      if (channel.firestoreUnsubscribe) {
        channel.firestoreUnsubscribe();
        channel.firestoreUnsubscribe = null;
      }
      channel.listeners.clear();
      activeConversationChannels.delete(channelKey);
    }
  }

  for (const [subUid, bucket] of Array.from(passiveUnreadSubscribersByUser.entries())) {
    if (!cleanKeep || subUid !== cleanKeep) {
      bucket.listeners.clear();
      passiveUnreadSubscribersByUser.delete(subUid);
    }
  }

  memoryConversationsByScope.clear();
  memoryMessagesCache.clear();
  inFlightConversationsByUser.clear();
  lastConversationsFetchedAtByUser.clear();
  if (!cleanKeep) {
    lastSyncedPrivacySignatureByUserId.clear();
    lastMarkedReadAtByUserAndConv.clear();
  }
  detachChatVisibilityListenerIfIdle();
}

function applyClientReadFloorToConversation(
  userId: string,
  conv: PrivateConversation
): PrivateConversation {
  const localReadFloor = lastMarkedReadAtByUserAndConv.get(`${userId}::${conv.id}`) ?? 0;
  if (localReadFloor <= 0) return conv;

  const lastMsgTime = conv.lastMessage?.createdAt ?? 0;
  if (lastMsgTime <= localReadFloor && (conv.unreadCounts?.[userId] ?? 0) > 0) {
    return {
      ...conv,
      unreadCounts: {
        ...conv.unreadCounts,
        [userId]: 0,
      },
      lastMessage:
        conv.lastMessage && conv.lastMessage.senderId !== userId
          ? { ...conv.lastMessage, isRead: true }
          : conv.lastMessage,
    };
  }
  return conv;
}

function mergeServerAndConfirmedLocalMessages(
  serverMsgs: PrivateMessage[],
  localMsgs: PrivateMessage[],
  viewerId: string,
  convId: string
): PrivateMessage[] {
  const localReadFloor = lastMarkedReadAtByUserAndConv.get(`${viewerId}::${convId}`) ?? 0;
  const byId = new Map<string, PrivateMessage>();

  for (const m of serverMsgs) {
    const isReadAdjusted =
      m.recipientId === viewerId && m.createdAt <= localReadFloor ? true : m.isRead;
    byId.set(m.id, {
      ...m,
      isRead: isReadAdjusted !== m.isRead ? isReadAdjusted : m.isRead,
      status: 'sent',
    });
  }

  // Preserve in-flight, failed, and recent local messages
  const now = Date.now();
  for (const localMsg of localMsgs) {
    if (!byId.has(localMsg.id)) {
      if (localMsg.status === 'failed') {
        // Never discard failed messages; keep visible so user can see error state
        byId.set(localMsg.id, localMsg);
      } else if (localMsg.status === 'sending') {
        // Keep in-flight message while waiting for confirmation (up to 45s); transition to failed if exceeded
        if (now - localMsg.createdAt < 45_000) {
          byId.set(localMsg.id, localMsg);
        } else {
          byId.set(localMsg.id, { ...localMsg, status: 'failed' });
        }
      } else if (localMsg.senderId === viewerId && now - localMsg.createdAt < 60_000) {
        // Locally confirmed recent message kept to avoid drop due to poll latency
        byId.set(localMsg.id, localMsg);
      }
    }
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => a.createdAt - b.createdAt);
  return merged;
}

/**
 * Updates the status ('sending' | 'sent' | 'failed') of an existing local message in cache and active channels
 */
function markLocalMessageStatus(
  convId: string,
  userId: string,
  msgId: string,
  status: 'sending' | 'sent' | 'failed',
  updatedData?: Partial<PrivateMessage>
): void {
  const currentCached = readCachedMessages(convId, userId);
  let changed = false;
  const nextMessages = currentCached.map((m) => {
    if (m.id === msgId) {
      changed = true;
      return { ...m, ...(updatedData || {}), status };
    }
    return m;
  });
  if (changed) {
    writeCachedMessages(convId, nextMessages, userId);
    emitLocalMessagesToActiveChannels(convId, userId, nextMessages);
  }
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
  activeChatSessionUserId = context.id;

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
    const headers = await buildChatAuthHeaders(true);
    await fetch(buildChatUrl('/api/chat/sync-user-context'), {
      method: 'POST',
      headers,
      body: signature,
    });
  } catch {
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
  const source = convs ?? readCachedConversations(userId);
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
  for (const userId of passiveUnreadSubscribersByUser.keys()) {
    const scoped = readCachedConversations(userId);
    const fallback = scoped.length > 0 ? scoped : readCachedConversations();
    notifyUnreadSubscribersForUser(userId, fallback);
  }
}

/**
 * Consulta conversas do usuário atual (com deduplicação de requisições concorrentes)
 */
export async function fetchUserConversations(userId: string): Promise<PrivateConversation[]> {
  if (!userId) return [];
  activeChatSessionUserId = userId;

  const existingRequest = inFlightConversationsByUser.get(userId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async (): Promise<PrivateConversation[]> => {
    // 1. Direct Firestore query when authenticated with Firebase
    if (db && auth?.currentUser?.uid === userId) {
      try {
        const q = query(
          collection(db, 'conversations'),
          where('participants', 'array-contains', userId)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const firestoreConvs: PrivateConversation[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data();
            const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
            const updatedAtMs = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now();
            const lastMsgRaw = data.lastMessage;
            firestoreConvs.push({
              id: docSnap.id,
              participants: data.participants || [],
              participantDetails: data.participantDetails || {},
              lastMessage: lastMsgRaw
                ? {
                    ...lastMsgRaw,
                    createdAt: lastMsgRaw.createdAt?.toMillis
                      ? lastMsgRaw.createdAt.toMillis()
                      : (lastMsgRaw.createdAt || Date.now()),
                  }
                : undefined,
              unreadCounts: data.unreadCounts || {},
              createdAt: createdAtMs,
              updatedAt: updatedAtMs,
            });
          });

          const serverConvs = firestoreConvs
            .filter((c) => Array.isArray(c.participants) && c.participants.includes(userId))
            .map((c) => applyClientReadFloorToConversation(userId, c));

          // Preserve any optimistic/local conversation created recently not yet in remote
          const cached = readCachedConversations(userId);
          const serverIds = new Set(serverConvs.map((c) => c.id));
          const now = Date.now();
          for (const localConv of cached) {
            if (
              !serverIds.has(localConv.id) &&
              localConv.participants.includes(userId) &&
              now - localConv.updatedAt < 60_000
            ) {
              serverConvs.push(localConv);
            }
          }
          serverConvs.sort((a, b) => b.updatedAt - a.updatedAt);

          lastConversationsFetchedAtByUser.set(userId, Date.now());
          writeCachedConversations(serverConvs, userId);
          notifyUnreadSubscribersForUser(userId, serverConvs);
          return serverConvs;
        }
      } catch (fsErr) {
        console.warn('[Hikari Chat] Direct Firestore conversations query fallback:', fsErr);
      }
    }

    // 2. Fallback to Express backend
    try {
      const headers = await buildChatAuthHeaders(false);
      const res = await fetch(
        buildChatUrl(`/api/chat/conversations?userId=${encodeURIComponent(userId)}`),
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.conversations)) {
          const serverConvs = (data.conversations as PrivateConversation[])
            .filter((c) => Array.isArray(c.participants) && c.participants.includes(userId))
            .map((c) => applyClientReadFloorToConversation(userId, c));

          // Preserve any optimistic/local conversation created moments ago not yet in a stale poll
          const cached = readCachedConversations(userId);
          const serverIds = new Set(serverConvs.map((c) => c.id));
          const now = Date.now();
          for (const localConv of cached) {
            if (
              !serverIds.has(localConv.id) &&
              localConv.participants.includes(userId) &&
              now - localConv.updatedAt < 60_000
            ) {
              serverConvs.push(localConv);
            }
          }
          serverConvs.sort((a, b) => b.updatedAt - a.updatedAt);

          lastConversationsFetchedAtByUser.set(userId, Date.now());
          writeCachedConversations(serverConvs, userId);
          notifyUnreadSubscribersForUser(userId, serverConvs);
          return serverConvs;
        }
      }
    } catch {
      // Fallback para cache local isolado por UID
    }
    const fallback = readCachedConversations(userId).filter((c) => c.participants.includes(userId));
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
  const rawSenderId = sender.id ? sender.id.trim() : '';
  const isDemoSender = isDemoMockUserId(rawSenderId);

  let effectiveSenderId: string;
  if (auth?.currentUser) {
    effectiveSenderId = auth.currentUser.uid;
    if (rawSenderId && rawSenderId !== effectiveSenderId && !isDemoSender) {
      throw new Error('Usuário autenticado não corresponde ao remetente da conversa.');
    }
  } else if (isDemoSender) {
    effectiveSenderId = rawSenderId;
  } else {
    throw new Error('Sessão não autenticada. É necessário estar conectado para iniciar conversas.');
  }

  activeChatSessionUserId = effectiveSenderId;
  const convId = getDeterministicConversationId(effectiveSenderId, recipient.id);

  const safeSender: ParticipantSummary = {
    ...sender,
    id: effectiveSenderId,
    displayName: (sender.displayName || sender.username || 'Usuário').slice(0, 60),
    username: (sender.username || 'usuario').slice(0, 32),
    avatarUrl: (sender.avatarUrl || '').length <= 2048 ? sender.avatarUrl || '' : '',
  };
  const safeRecipient: ParticipantSummary = {
    ...recipient,
    id: recipient.id.trim(),
    displayName: (recipient.displayName || recipient.username || 'Usuário').slice(0, 60),
    username: (recipient.username || 'usuario').slice(0, 32),
    avatarUrl: (recipient.avatarUrl || '').length <= 2048 ? recipient.avatarUrl || '' : '',
  };

  try {
    const headers = await buildChatAuthHeaders(true);
    const res = await fetch(buildChatUrl('/api/chat/conversations'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ sender: safeSender, recipient: safeRecipient }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Não foi possível iniciar a conversa.');
    }

    const data = await res.json();
    const conv: PrivateConversation = data.conversation;
    const cached = readCachedConversations(effectiveSenderId);
    const nextConvs = cached.some((c) => c.id === conv.id)
      ? cached.map((c) => (c.id === conv.id ? conv : c))
      : [conv, ...cached];
    writeCachedConversations(nextConvs, effectiveSenderId);

    // Ensure Firestore parent conversation doc exists when authenticated with Firebase
    if (db && auth?.currentUser?.uid === effectiveSenderId) {
      try {
        const convDocRef = doc(db, 'conversations', convId);
        const snap = await getDoc(convDocRef);
        if (!snap.exists()) {
          await setDoc(convDocRef, {
            id: convId,
            participants: [effectiveSenderId, safeRecipient.id],
            participantDetails: {
              [effectiveSenderId]: {
                id: effectiveSenderId,
                displayName: safeSender.displayName,
                username: safeSender.username,
                avatarUrl: safeSender.avatarUrl,
              },
              [safeRecipient.id]: {
                id: safeRecipient.id,
                displayName: safeRecipient.displayName,
                username: safeRecipient.username,
                avatarUrl: safeRecipient.avatarUrl,
              },
            },
            unreadCounts: { [effectiveSenderId]: 0, [safeRecipient.id]: 0 },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (firestoreErr) {
        console.warn('[Hikari Chat] Failed to ensure conversation document in Firestore:', firestoreErr);
      }
    }

    return conv;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message !== 'Failed to fetch' &&
      !err.message.includes('fetch')
    ) {
      throw err;
    }
    const cached = readCachedConversations(effectiveSenderId);
    const existing = cached.find((c) => c.id === convId);
    if (existing) return existing;

    const newConv: PrivateConversation = {
      id: convId,
      participants: [effectiveSenderId, safeRecipient.id],
      participantDetails: {
        [effectiveSenderId]: safeSender,
        [safeRecipient.id]: safeRecipient,
      },
      unreadCounts: { [effectiveSenderId]: 0, [safeRecipient.id]: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeCachedConversations([newConv, ...cached], effectiveSenderId);
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
  activeChatSessionUserId = userId;

  // 1. Direct Firestore messages query when authenticated with Firebase
  if (db && auth?.currentUser?.uid === userId) {
    try {
      const messagesCol = collection(db, 'conversations', convId, 'messages');
      const q = query(
        messagesCol,
        orderBy('createdAt', 'asc'),
        firestoreLimit(options?.limit ?? 50)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const firestoreMsgs: PrivateMessage[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
          firestoreMsgs.push({
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
        if (!options?.before) {
          const localCached = readCachedMessages(convId, userId);
          const merged = mergeServerAndConfirmedLocalMessages(
            firestoreMsgs,
            localCached,
            userId,
            convId
          );
          writeCachedMessages(convId, merged, userId);
          return {
            messages: merged,
            hasMore: false,
          };
        }
      }
    } catch (fsMsgErr) {
      console.warn('[Hikari Chat] Direct Firestore messages fetch failed, falling back to server:', fsMsgErr);
    }
  }

  // 2. Fallback to Express backend
  try {
    const params = new URLSearchParams({
      userId,
      limit: String(options?.limit ?? 50),
    });
    if (options?.before) {
      params.set('before', String(options.before));
    }

    const headers = await buildChatAuthHeaders(false);
    const res = await fetch(
      buildChatUrl(
        `/api/chat/conversations/${encodeURIComponent(convId)}/messages?${params.toString()}`
      ),
      { headers }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        const serverMessages = data.messages as PrivateMessage[];
        if (!options?.before) {
          const localCached = readCachedMessages(convId, userId);
          const merged = mergeServerAndConfirmedLocalMessages(
            serverMessages,
            localCached,
            userId,
            convId
          );
          writeCachedMessages(convId, merged, userId);
          return {
            messages: merged,
            hasMore: Boolean(data.hasMore),
          };
        }
        return data;
      }
    }
  } catch {
    // Fallback para cache isolado por UID
  }

  const cached = readCachedMessages(convId, userId);
  const before = options?.before;
  const limit = options?.limit ?? 50;
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

  // Enforce authenticated sender identity (Zero-Trust)
  const rawSenderId = sender.id ? sender.id.trim() : '';
  const isDemoSender = isDemoMockUserId(rawSenderId);

  let effectiveSenderId: string;
  if (auth?.currentUser) {
    effectiveSenderId = auth.currentUser.uid;
    if (rawSenderId && rawSenderId !== effectiveSenderId && !isDemoSender) {
      throw new Error('Usuário autenticado não corresponde ao remetente da mensagem.');
    }
  } else if (isDemoSender) {
    effectiveSenderId = rawSenderId;
  } else {
    throw new Error('Sessão não autenticada. É necessário estar conectado para enviar mensagens.');
  }

  activeChatSessionUserId = effectiveSenderId;

  const type = payload.type || (mediaUrl ? 'image' : 'text');
  const safeSender: ParticipantSummary = {
    ...sender,
    id: effectiveSenderId,
    displayName: (sender.displayName || sender.username || 'Usuário').slice(0, 60),
    username: (sender.username || 'usuario').slice(0, 32),
    avatarUrl: (sender.avatarUrl || '').length <= 2048 ? sender.avatarUrl || '' : '',
  };
  const safeRecipient: ParticipantSummary = {
    ...recipient,
    id: recipient.id.trim(),
    displayName: (recipient.displayName || recipient.username || 'Usuário').slice(0, 60),
    username: (recipient.username || 'usuario').slice(0, 32),
    avatarUrl: (recipient.avatarUrl || '').length <= 2048 ? recipient.avatarUrl || '' : '',
  };

  const targetConvId =
    payload.conversationId || getDeterministicConversationId(effectiveSenderId, safeRecipient.id);

  const trimmedText = text ? text.trim() : '';
  if (!trimmedText && !mediaUrl) {
    throw new Error('A mensagem não pode ser vazia.');
  }
  if (trimmedText.length > 2000) {
    throw new Error('A mensagem excede o limite de 2000 caracteres.');
  }

  const mediaVal = validateMediaPayload(mediaUrl, type);
  if (!mediaVal.valid) {
    throw new Error(mediaVal.error);
  }

  const preview = payload.linkPreview || extractHikariLinkPreview(text);

  // Generate optimistic message with status 'sending'
  const nowMs = Date.now();
  const msgId = `msg_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;

  const optimisticMessage: PrivateMessage = {
    id: msgId,
    conversationId: targetConvId,
    senderId: effectiveSenderId,
    senderName: safeSender.displayName,
    senderUsername: safeSender.username,
    senderAvatarUrl: safeSender.avatarUrl,
    recipientId: safeRecipient.id,
    text,
    type,
    mediaUrl,
    mediaMetadata: payload.mediaMetadata,
    linkPreview: preview,
    isRead: false,
    createdAt: nowMs,
    status: 'sending',
  };

  // 1. Atualiza imediatamente o cache de mensagens do remetente com status 'sending'
  const currentCached = readCachedMessages(targetConvId, effectiveSenderId);
  const nextMessages = [...currentCached.filter((m) => m.id !== msgId), optimisticMessage];
  writeCachedMessages(targetConvId, nextMessages, effectiveSenderId);
  emitLocalMessagesToActiveChannels(targetConvId, effectiveSenderId, nextMessages);

  // 2. Atualiza a lista de conversas em cache do remetente
  const cachedConvs = readCachedConversations(effectiveSenderId);
  const lastMsgSnippet = {
    id: optimisticMessage.id,
    text: optimisticMessage.text,
    senderId: effectiveSenderId,
    senderName: safeSender.displayName,
    type: optimisticMessage.type,
    createdAt: optimisticMessage.createdAt,
    isRead: false,
  };
  let nextConvs: PrivateConversation[];
  if (cachedConvs.some((c) => c.id === targetConvId)) {
    nextConvs = cachedConvs.map((c) =>
      c.id === targetConvId
        ? {
            ...c,
            lastMessage: lastMsgSnippet,
            updatedAt: Math.max(c.updatedAt, optimisticMessage.createdAt),
          }
        : c
    );
  } else {
    nextConvs = [
      {
        id: targetConvId,
        participants: [effectiveSenderId, safeRecipient.id],
        participantDetails: {
          [effectiveSenderId]: safeSender,
          [safeRecipient.id]: safeRecipient,
        },
        lastMessage: lastMsgSnippet,
        unreadCounts: { [effectiveSenderId]: 0, [safeRecipient.id]: 1 },
        createdAt: optimisticMessage.createdAt,
        updatedAt: optimisticMessage.createdAt,
      },
      ...cachedConvs,
    ];
  }
  nextConvs.sort((a, b) => b.updatedAt - a.updatedAt);
  writeCachedConversations(nextConvs, effectiveSenderId);
  emitLocalConversationsToActivePoller(effectiveSenderId, nextConvs);

  // 3. Persistência no Backend Express
  let serverMessage: PrivateMessage | null = null;
  let backendError: string | null = null;
  try {
    const headers = await buildChatAuthHeaders(true);
    const res = await fetch(buildChatUrl('/api/chat/messages'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: msgId,
        conversationId: targetConvId,
        senderId: effectiveSenderId,
        senderName: safeSender.displayName,
        senderUsername: safeSender.username,
        senderAvatarUrl: safeSender.avatarUrl,
        recipientId: safeRecipient.id,
        recipientName: safeRecipient.displayName,
        recipientUsername: safeRecipient.username,
        recipientAvatarUrl: safeRecipient.avatarUrl,
        text,
        type,
        mediaUrl,
        mediaMetadata: payload.mediaMetadata,
        linkPreview: preview,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      serverMessage = data.message;
    } else {
      const errData = await res.json().catch(() => ({}));
      backendError = errData.error || 'Falha ao sincronizar com servidor de chat.';
      console.warn('[Hikari Chat] Backend message persist error:', backendError);
    }
  } catch (netErr) {
    backendError = 'Erro de rede ao conectar com servidor de chat.';
    console.warn('[Hikari Chat] Network error contacting chat backend:', netErr);
  }

  // 4. Persistência atômica no Firestore via writeBatch (cria doc pai e mensagem de uma só vez)
  let firestorePersisted = false;
  if (db && auth?.currentUser?.uid === effectiveSenderId) {
    try {
      const convDocRef = doc(db, 'conversations', targetConvId);
      const msgDocRef = doc(db, 'conversations', targetConvId, 'messages', msgId);
      const convSnap = await getDoc(convDocRef);

      const batch = writeBatch(db);

      if (!convSnap.exists()) {
        batch.set(convDocRef, {
          id: targetConvId,
          participants: [effectiveSenderId, safeRecipient.id],
          participantDetails: {
            [effectiveSenderId]: {
              id: effectiveSenderId,
              displayName: safeSender.displayName,
              username: safeSender.username,
              avatarUrl: safeSender.avatarUrl,
            },
            [safeRecipient.id]: {
              id: safeRecipient.id,
              displayName: safeRecipient.displayName,
              username: safeRecipient.username,
              avatarUrl: safeRecipient.avatarUrl,
            },
          },
          lastMessage: {
            id: msgId,
            text,
            senderId: effectiveSenderId,
            senderName: safeSender.displayName,
            type,
            createdAt: serverTimestamp(),
            isRead: false,
          },
          unreadCounts: {
            [effectiveSenderId]: 0,
            [safeRecipient.id]: 1,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(convDocRef, {
          lastMessage: {
            id: msgId,
            text,
            senderId: effectiveSenderId,
            senderName: safeSender.displayName,
            type,
            createdAt: serverTimestamp(),
            isRead: false,
          },
          [`unreadCounts.${safeRecipient.id}`]: increment(1),
          updatedAt: serverTimestamp(),
        });
      }

      batch.set(msgDocRef, {
        id: msgId,
        conversationId: targetConvId,
        senderId: effectiveSenderId,
        senderName: safeSender.displayName,
        senderUsername: safeSender.username,
        senderAvatarUrl: safeSender.avatarUrl,
        recipientId: safeRecipient.id,
        text,
        type,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(payload.mediaMetadata ? { mediaMetadata: payload.mediaMetadata } : {}),
        ...(preview ? { linkPreview: preview } : {}),
        isRead: false,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      firestorePersisted = true;
    } catch (fsErr) {
      console.error('[Hikari Chat] Failed to persist message batch in Firestore:', fsErr);
    }
  }

  // 5. Verificação de persistência
  if (!serverMessage && !firestorePersisted) {
    // Both backends failed to persist: mark optimistic message as 'failed'
    markLocalMessageStatus(targetConvId, effectiveSenderId, msgId, 'failed');
    throw new Error(backendError || 'Não foi possível gravar a mensagem. Verifique sua conexão e tente novamente.');
  }

  // Confirmation succeeded: mark as 'sent'
  const confirmedMessage: PrivateMessage = {
    ...(serverMessage || optimisticMessage),
    id: msgId,
    status: 'sent',
  };
  markLocalMessageStatus(targetConvId, effectiveSenderId, msgId, 'sent', confirmedMessage);
  return confirmedMessage;
}

/**
 * Marca mensagens de uma conversa como lidas (individual por usuário e por conversa)
 */
export async function markConversationAsRead(convId: string, userId: string): Promise<void> {
  if (!convId || !userId) return;
  activeChatSessionUserId = userId;

  const readTimestamp = Date.now();
  lastMarkedReadAtByUserAndConv.set(`${userId}::${convId}`, readTimestamp);

  // 1. Atualização imediata e otimista do estado local de mensagens e conversas (remove a barra roxa na hora!)
  const cached = readCachedMessages(convId, userId);
  const unreadIncomingIds: string[] = [];
  const updated = cached.map((m) => {
    if (m.recipientId === userId && !m.isRead) {
      unreadIncomingIds.push(m.id);
      return { ...m, isRead: true };
    }
    return m;
  });
  writeCachedMessages(convId, updated, userId);
  emitLocalMessagesToActiveChannels(convId, userId, updated);

  const convs = readCachedConversations(userId);
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
  writeCachedConversations(convUpdated, userId);
  emitLocalConversationsToActivePoller(userId, convUpdated);
  notifyUnreadSubscribersForUser(userId, convUpdated);

  // 2. Persiste e sincroniza no backend
  try {
    const headers = await buildChatAuthHeaders(true);
    await fetch(buildChatUrl(`/api/chat/conversations/${encodeURIComponent(convId)}/read`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId }),
    });
  } catch {
    // Ignora erro transitório de rede
  }

  // 3. Persiste no Firestore (tanto unreadCounts quanto isRead das mensagens individuais)
  if (db && auth?.currentUser?.uid === userId) {
    const firestoreDb = db;
    try {
      const convDocRef = doc(firestoreDb, 'conversations', convId);
      await updateDoc(convDocRef, {
        [`unreadCounts.${userId}`]: 0,
        [`lastReadAtByUser.${userId}`]: readTimestamp,
        updatedAt: serverTimestamp(),
      });
      if (unreadIncomingIds.length > 0) {
        await Promise.all(
          unreadIncomingIds.map((msgId) =>
            updateDoc(doc(firestoreDb, 'conversations', convId, 'messages', msgId), {
              isRead: true,
            }).catch((err) => {
              console.warn('[Hikari Chat] Failed to mark message isRead in Firestore:', msgId, err);
            })
          )
        );
      }
    } catch (fsErr) {
      console.warn('[Hikari Chat] Failed to mark conversation as read in Firestore:', fsErr);
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
  activeChatSessionUserId = userId;
  const headers = await buildChatAuthHeaders(true);
  const res = await fetch(
    buildChatUrl(
      `/api/chat/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}/reaction`
    ),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, emoji }),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Não foi possível atualizar a reação.');
  }

  const data = await res.json();
  const updatedMessage: PrivateMessage = data.message;

  const cached = readCachedMessages(convId, userId);
  const updated = cached.map((m) => (m.id === msgId ? updatedMessage : m));
  writeCachedMessages(convId, updated, userId);
  emitLocalMessagesToActiveChannels(convId, userId, updated);

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
    const headers = await buildChatAuthHeaders(true);
    await fetch(buildChatUrl(`/api/chat/conversations/${encodeURIComponent(convId)}/typing`), {
      method: 'POST',
      headers,
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
    const headers = await buildChatAuthHeaders(true);
    await fetch(buildChatUrl('/api/chat/presence/heartbeat'), {
      method: 'POST',
      headers,
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
    if (
      !chatTestTokenOverride &&
      !auth?.currentUser &&
      typeof navigator !== 'undefined' &&
      navigator.sendBeacon
    ) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(buildChatUrl('/api/chat/presence/offline'), blob);
    } else {
      void buildChatAuthHeaders(true).then((headers) => {
        fetch(buildChatUrl('/api/chat/presence/offline'), {
          method: 'POST',
          headers,
          body: payload,
          keepalive: true,
        }).catch(() => {});
      });
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
    const headers = await buildChatAuthHeaders(false);
    const res = await fetch(
      buildChatUrl(
        `/api/chat/conversations/${encodeURIComponent(channel.convId)}/messages?userId=${encodeURIComponent(channel.userId)}&limit=50`
      ),
      { headers }
    );
    if (!res.ok || channel.listeners.size === 0) return;

    const data = await res.json();
    const serverMessages: PrivateMessage[] = Array.isArray(data.messages) ? data.messages : [];
    const incomingTyping: string[] = Array.isArray(data.typingUsers) ? data.typingUsers : [];

    const incomingMessages = mergeServerAndConfirmedLocalMessages(
      serverMessages,
      channel.lastKnownMessages,
      channel.userId,
      channel.convId
    );

    const isEqual = areMessagesAndTypingEqual(
      channel.lastKnownMessages,
      incomingMessages,
      channel.lastKnownTyping,
      incomingTyping
    );

    if (!isEqual) {
      channel.lastKnownMessages = incomingMessages;
      channel.lastKnownTyping = incomingTyping;
      writeCachedMessages(channel.convId, incomingMessages, channel.userId);
      const payload = { messages: incomingMessages, typingUsers: incomingTyping };
      for (const listener of channel.listeners) {
        listener(payload);
      }
    }
  } catch {
    // Ignora erro transitório sem apagar mensagens em exibição
  }
}

function startChannelPollTimerIfNeeded(channel: SharedConversationChannel): void {
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

function emitLocalMessagesToActiveChannels(
  convId: string,
  userId: string,
  messages: PrivateMessage[]
): void {
  for (const channel of activeConversationChannels.values()) {
    if (channel.convId === convId && channel.userId === userId && channel.listeners.size > 0) {
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
 */
export function subscribeToUnreadMessagesCount(
  userId: string,
  onUnreadChange: (unreadCount: number) => void
): () => void {
  if (!userId) return () => {};
  activeChatSessionUserId = userId;

  attachChatVisibilityListener();

  let bucket = passiveUnreadSubscribersByUser.get(userId);
  if (!bucket) {
    const scopedCached = readCachedConversations(userId);
    const sourceConvs = scopedCached.length > 0 ? scopedCached : readCachedConversations();
    const initialCount = computeUnreadTotalForUser(userId, sourceConvs);
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
 * Assina atualizações em tempo real de uma conversa aberta (isolada por userId + convId).
 */
export function subscribeToConversation(
  convId: string,
  userId: string,
  onUpdate: ConversationUpdateListener
): () => void {
  activeChatSessionUserId = userId;
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
      lastKnownMessages: readCachedMessages(convId, userId),
      lastKnownTyping: [],
    };
    activeConversationChannels.set(channelKey, channel);
  }

  channel.listeners.add(onUpdate);

  if (channel.lastKnownMessages.length > 0 || channel.lastKnownTyping.length > 0) {
    onUpdate({
      messages: channel.lastKnownMessages,
      typingUsers: channel.lastKnownTyping,
    });
  }

  if (isNewChannel) {
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

            activeChannel.firestoreRealtimeActive = true;
            stopChannelPollTimer(activeChannel);

            const mergedMsgs = mergeServerAndConfirmedLocalMessages(
              remoteMsgs,
              activeChannel.lastKnownMessages,
              userId,
              convId
            );

            const isEqual = areMessagesAndTypingEqual(
              activeChannel.lastKnownMessages,
              mergedMsgs,
              activeChannel.lastKnownTyping,
              activeChannel.lastKnownTyping
            );
            if (!isEqual) {
              activeChannel.lastKnownMessages = mergedMsgs;
              writeCachedMessages(convId, mergedMsgs, userId);
              const payload = {
                messages: mergedMsgs,
                typingUsers: activeChannel.lastKnownTyping,
              };
              for (const listener of activeChannel.listeners) {
                listener(payload);
              }
            }
          },
          (snapshotErr) => {
            console.warn('[Hikari Chat] Realtime conversation snapshot error, using polling fallback:', snapshotErr);
            activeChannel.firestoreRealtimeActive = false;
            startChannelPollTimerIfNeeded(activeChannel);
          }
        );
      } catch (err) {
        console.warn('[Hikari Chat] Failed to register Firestore realtime listener:', err);
        channel.firestoreUnsubscribe = null;
        channel.firestoreRealtimeActive = false;
      }
    }

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
 * Assina atualizações da lista de conversas enquanto o PrivateChatModal está aberto.
 */
export function subscribeToConversationsList(
  userId: string,
  onUpdate: (conversations: PrivateConversation[]) => void
): () => void {
  activeChatSessionUserId = userId;
  attachChatVisibilityListener();
  let poller = activeConversationPollers.get(userId);

  if (!poller) {
    const cached = readCachedConversations(userId).filter((c) => c.participants.includes(userId));
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
