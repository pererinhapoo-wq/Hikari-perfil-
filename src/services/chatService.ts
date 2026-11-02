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

function getLocalMessagesKey(convId: string): string {
  return `${LOCAL_STORAGE_MESSAGES_KEY_PREFIX}${convId}`;
}

export function readCachedConversations(): PrivateConversation[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCachedConversations(conversations: PrivateConversation[]): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore storage quota
  }
}

export function readCachedMessages(convId: string): PrivateMessage[] {
  try {
    const raw = window.localStorage.getItem(getLocalMessagesKey(convId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCachedMessages(convId: string, messages: PrivateMessage[]): void {
  try {
    window.localStorage.setItem(getLocalMessagesKey(convId), JSON.stringify(messages));
  } catch {
    // Ignore storage quota
  }
}

/**
 * Sincroniza o contexto de privacidade do usuário atual com o servidor
 */
export async function syncUserPrivacyContext(context: UserCheckContext): Promise<void> {
  try {
    await fetch('/api/chat/sync-user-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });
  } catch {
    // Fallback silencioso caso offline
  }
}

const inFlightConversationsByUser = new Map<string, Promise<PrivateConversation[]>>();

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
          writeCachedConversations(data.conversations);
          return data.conversations;
        }
      }
    } catch {
      // Fallback para cache local
    }
    return readCachedConversations().filter((c) => c.participants.includes(userId));
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
    return data.conversation;
  } catch (err) {
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

    const res = await fetch(`/api/chat/conversations/${encodeURIComponent(convId)}/messages?${params.toString()}`);
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
  const targetConvId = payload.conversationId || getDeterministicConversationId(sender.id, recipient.id);

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

  // Atualiza cache local
  const currentCached = readCachedMessages(targetConvId);
  if (!currentCached.some((m) => m.id === sentMessage.id)) {
    writeCachedMessages(targetConvId, [...currentCached, sentMessage]);
  }

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
  const updated = cached.map((m) => (m.recipientId === userId ? { ...m, isRead: true } : m));
  writeCachedMessages(convId, updated);

  const convs = readCachedConversations();
  const convUpdated = convs.map((c) => {
    if (c.id === convId) {
      return {
        ...c,
        unreadCounts: { ...c.unreadCounts, [userId]: 0 },
        lastMessage: c.lastMessage && c.lastMessage.senderId !== userId ? { ...c.lastMessage, isRead: true } : c.lastMessage,
      };
    }
    return c;
  });
  writeCachedConversations(convUpdated);

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

  // Atualiza cache local
  const cached = readCachedMessages(convId);
  const updated = cached.map((m) => (m.id === msgId ? updatedMessage : m));
  writeCachedMessages(convId, updated);

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
 * Envia batimento de presença ativo
 */
export async function sendPresenceHeartbeat(
  userId: string,
  showOnlineStatus?: boolean
): Promise<void> {
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

/**
 * Assina atualizações em tempo real de uma conversa (com limpeza garantida e deduplicação)
 */
export function subscribeToConversation(
  convId: string,
  userId: string,
  onUpdate: (payload: { messages: PrivateMessage[]; typingUsers: string[] }) => void
): () => void {
  let isSubscribed = true;
  let lastKnownMessages: PrivateMessage[] = readCachedMessages(convId);
  let lastKnownTyping: string[] = [];

  // 1. Emissão inicial do cache se houver
  if (lastKnownMessages.length > 0) {
    onUpdate({ messages: lastKnownMessages, typingUsers: [] });
  }

  // 2. Polling inteligente no backend (mantém sincronizado sem recarregar a página)
  const poll = async () => {
    if (!isSubscribed) return;
    try {
      const res = await fetch(
        `/api/chat/conversations/${encodeURIComponent(convId)}/messages?userId=${encodeURIComponent(userId)}&limit=50`
      );
      if (res.ok && isSubscribed) {
        const data = await res.json();
        const incomingMessages: PrivateMessage[] = Array.isArray(data.messages) ? data.messages : [];
        const incomingTyping: string[] = Array.isArray(data.typingUsers) ? data.typingUsers : [];

        const isEqual = areMessagesAndTypingEqual(
          lastKnownMessages,
          incomingMessages,
          lastKnownTyping,
          incomingTyping
        );

        if (!isEqual) {
          lastKnownMessages = incomingMessages;
          lastKnownTyping = incomingTyping;
          writeCachedMessages(convId, incomingMessages);
          onUpdate({ messages: incomingMessages, typingUsers: incomingTyping });
        }
      }
    } catch {
      // Ignora erro transitório
    }
  };

  poll();
  const intervalId = window.setInterval(poll, 2500);

  // 3. Listener Firestore nativo se o Firebase estiver online
  let firestoreUnsubscribe: (() => void) | null = null;
  if (db && auth?.currentUser?.uid === userId) {
    try {
      const messagesCol = collection(db, 'conversations', convId, 'messages');
      const q = query(messagesCol, orderBy('createdAt', 'asc'), firestoreLimit(50));
      firestoreUnsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (!isSubscribed) return;
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
            const isEqual = areMessagesAndTypingEqual(
              lastKnownMessages,
              remoteMsgs,
              lastKnownTyping,
              lastKnownTyping
            );
            if (!isEqual) {
              lastKnownMessages = remoteMsgs;
              writeCachedMessages(convId, remoteMsgs);
              onUpdate({ messages: remoteMsgs, typingUsers: lastKnownTyping });
            }
          }
        },
        () => {
          // Erro no snapshot: ignora e continua usando polling
        }
      );
    } catch {
      firestoreUnsubscribe = null;
    }
  }

  return () => {
    isSubscribed = false;
    window.clearInterval(intervalId);
    if (firestoreUnsubscribe) {
      firestoreUnsubscribe();
    }
  };
}

interface SharedConversationsPoller {
  listeners: Set<(conversations: PrivateConversation[]) => void>;
  intervalId: number | null;
  lastEmitted: PrivateConversation[] | null;
  lastFetchedAt: number;
}

const activeConversationPollers = new Map<string, SharedConversationsPoller>();

/**
 * Assina atualizações da lista de conversas compartilhando um único poller por userId
 * para evitar requisições duplicadas ao abrir e fechar o PrivateChatModal.
 */
export function subscribeToConversationsList(
  userId: string,
  onUpdate: (conversations: PrivateConversation[]) => void
): () => void {
  let poller = activeConversationPollers.get(userId);

  if (!poller) {
    const cached = readCachedConversations().filter((c) => c.participants.includes(userId));
    poller = {
      listeners: new Set(),
      intervalId: null,
      lastEmitted: cached.length > 0 ? cached : null,
      lastFetchedAt: 0,
    };
    activeConversationPollers.set(userId, poller);
  }

  poller.listeners.add(onUpdate);

  // Emite imediatamente o snapshot em memória se já houver dados carregados
  if (poller.lastEmitted) {
    onUpdate(poller.lastEmitted);
  }

  const runPoll = async () => {
    const currentPoller = activeConversationPollers.get(userId);
    if (!currentPoller || currentPoller.listeners.size === 0) return;
    try {
      const convs = await fetchUserConversations(userId);
      const activePoller = activeConversationPollers.get(userId);
      if (!activePoller || activePoller.listeners.size === 0) return;
      activePoller.lastEmitted = convs;
      activePoller.lastFetchedAt = Date.now();
      for (const listener of activePoller.listeners) {
        listener(convs);
      }
    } catch {
      // Ignora erro transitório
    }
  };

  if (poller.intervalId === null) {
    void runPoll();
    poller.intervalId = window.setInterval(runPoll, 4000);
  } else if (Date.now() - poller.lastFetchedAt > 1500) {
    void runPoll();
  }

  return () => {
    const currentPoller = activeConversationPollers.get(userId);
    if (!currentPoller) return;
    currentPoller.listeners.delete(onUpdate);
    if (currentPoller.listeners.size === 0) {
      if (currentPoller.intervalId !== null) {
        window.clearInterval(currentPoller.intervalId);
      }
      activeConversationPollers.delete(userId);
    }
  };
}

