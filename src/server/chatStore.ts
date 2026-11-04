import fs from 'node:fs';
import path from 'node:path';
import type {
  PrivateConversation,
  PrivateMessage,
  ParticipantSummary,
} from '../types/index.js';
import {
  getDeterministicConversationId,
  canUserMessageRecipient,
  validateMediaPayload,
  extractHikariLinkPreview,
  type UserCheckContext,
} from '../utils/chatValidation.js';

export {
  getDeterministicConversationId,
  canUserMessageRecipient,
  validateMediaPayload,
  extractHikariLinkPreview,
  type UserCheckContext,
};

interface PersistedChatState {
  version: number;
  conversations: Record<string, PrivateConversation>;
  messages: Record<string, PrivateMessage[]>;
  lastReadAtByConvAndUser: Record<string, Record<string, number>>;
}

/**
 * Armazenamento autoritativo e persistente do servidor para o chat privado do Hikari.
 * Garante isolamento estrito por participante, persistência em disco (.data/chat-store.json)
 * entre reinícios/recarregamentos e sincronização individual de leitura por usuário e conversa.
 */
export class ChatStore {
  private conversations = new Map<string, PrivateConversation>();
  private messages = new Map<string, PrivateMessage[]>(); // conversationId -> messages (sorted ascending by createdAt)
  private lastReadAtByConvAndUser = new Map<string, Record<string, number>>();
  private userContexts = new Map<string, UserCheckContext>();
  // Presença: userId -> { lastSeen: number, isOnline: boolean, showOnlineStatus: boolean }
  private userPresence = new Map<string, { lastSeen: number; isOnline: boolean; showOnlineStatus: boolean }>();
  // Digitando: convId -> Map(userId -> lastTypingTimestamp)
  private typingStates = new Map<string, Map<string, number>>();
  private storageFilePath: string;
  private persistDisabled: boolean;

  constructor(options?: { storageFilePath?: string; ephemeral?: boolean }) {
    this.storageFilePath =
      options?.storageFilePath ?? path.resolve(process.cwd(), '.data', 'chat-store.json');
    this.persistDisabled =
      options?.ephemeral !== undefined
        ? Boolean(options.ephemeral)
        : process.env.HIKARI_EPHEMERAL_TEST_STORE === '1';

    this.seedInitialConversations();
    if (!this.persistDisabled) {
      this.loadFromDisk();
    }
  }

  public resetForTests(ephemeral = true): void {
    this.persistDisabled = ephemeral;
    this.clearAll();
    this.seedInitialConversations();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storageFilePath)) return;
      const raw = fs.readFileSync(this.storageFilePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<PersistedChatState>;
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.conversations && typeof parsed.conversations === 'object') {
        for (const [convId, conv] of Object.entries(parsed.conversations)) {
          if (conv && typeof conv === 'object' && Array.isArray(conv.participants)) {
            this.conversations.set(convId, conv);
          }
        }
      }

      if (parsed.messages && typeof parsed.messages === 'object') {
        for (const [convId, msgs] of Object.entries(parsed.messages)) {
          if (Array.isArray(msgs)) {
            const sorted = [...msgs].sort((a, b) => a.createdAt - b.createdAt);
            this.messages.set(convId, sorted);
          }
        }
      }

      if (parsed.lastReadAtByConvAndUser && typeof parsed.lastReadAtByConvAndUser === 'object') {
        for (const [convId, readMap] of Object.entries(parsed.lastReadAtByConvAndUser)) {
          if (readMap && typeof readMap === 'object') {
            this.lastReadAtByConvAndUser.set(convId, { ...readMap });
          }
        }
      }
    } catch {
      // Ignore malformed local persistence gracefully
    }
  }

  private saveToDisk(): void {
    if (this.persistDisabled) return;
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const conversationsObj: Record<string, PrivateConversation> = {};
      for (const [id, conv] of this.conversations.entries()) {
        conversationsObj[id] = conv;
      }
      const messagesObj: Record<string, PrivateMessage[]> = {};
      for (const [id, msgs] of this.messages.entries()) {
        messagesObj[id] = msgs;
      }
      const readObj: Record<string, Record<string, number>> = {};
      for (const [id, rMap] of this.lastReadAtByConvAndUser.entries()) {
        readObj[id] = rMap;
      }

      const payload: PersistedChatState = {
        version: 1,
        conversations: conversationsObj,
        messages: messagesObj,
        lastReadAtByConvAndUser: readObj,
      };
      const tmpPath = `${this.storageFilePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmpPath, this.storageFilePath);
    } catch {
      // Safe fallback in read-only filesystems
    }
  }

  public registerUserContext(ctx: UserCheckContext): void {
    this.userContexts.set(ctx.id, { ...ctx });
    if (ctx.showOnlineStatus !== undefined) {
      const existing = this.userPresence.get(ctx.id);
      if (existing) {
        existing.showOnlineStatus = ctx.showOnlineStatus;
      }
    }
  }

  public getUserContext(userId: string): UserCheckContext | undefined {
    return this.userContexts.get(userId);
  }

  /**
   * Registra presença do usuário (heartbeat ativo ou desconexão)
   */
  public recordPresence(userId: string, isOnline: boolean, showOnlineStatus?: boolean): void {
    const cleanId = userId.trim();
    if (!cleanId) return;

    let visibility = showOnlineStatus;
    if (visibility === undefined) {
      const ctx = this.userContexts.get(cleanId);
      visibility = ctx?.showOnlineStatus ?? true;
    }

    this.userPresence.set(cleanId, {
      lastSeen: Date.now(),
      isOnline,
      showOnlineStatus: visibility !== false,
    });
  }

  /**
   * Verifica se o usuário está online no momento, respeitando a privacidade e expiração
   */
  public isUserOnline(userId: string): boolean {
    const entry = this.userPresence.get(userId);
    if (!entry) return false;
    if (!entry.showOnlineStatus) return false;
    if (!entry.isOnline) return false;
    return Date.now() - entry.lastSeen < 45000;
  }

  public getUserPresenceSummary(userId: string): { isOnline: boolean; lastSeen?: number } {
    const entry = this.userPresence.get(userId);
    if (!entry || !entry.showOnlineStatus) {
      return { isOnline: false };
    }
    const online = entry.isOnline && Date.now() - entry.lastSeen < 45000;
    return { isOnline: online, lastSeen: entry.lastSeen };
  }

  /**
   * Atualiza o estado de digitação com expiração automática
   */
  public setTyping(convId: string, userId: string, isTyping: boolean): void {
    let convTyping = this.typingStates.get(convId);
    if (!convTyping) {
      convTyping = new Map<string, number>();
      this.typingStates.set(convId, convTyping);
    }

    if (isTyping) {
      convTyping.set(userId, Date.now());
    } else {
      convTyping.delete(userId);
    }
  }

  /**
   * Retorna os IDs dos participantes que estão digitando no momento (expiração de 4.5s)
   */
  public getTypingUsers(convId: string, excludeUserId?: string): string[] {
    const convTyping = this.typingStates.get(convId);
    if (!convTyping) return [];

    const now = Date.now();
    const active: string[] = [];

    for (const [uid, timestamp] of convTyping.entries()) {
      if (now - timestamp > 4500) {
        convTyping.delete(uid);
      } else if (!excludeUserId || uid !== excludeUserId) {
        active.push(uid);
      }
    }

    return active;
  }

  private seedInitialConversations(): void {
    const now = Date.now();
    const tenMinAgo = now - 10 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const yesterday = now - 24 * 60 * 60 * 1000;

    // Conversa 1: Kuroha (usr_kuroha) e Ren Amano (usr_hikari_001) — Modo Demonstração
    const conv1Id = getDeterministicConversationId('usr_hikari_001', 'usr_kuroha');
    const msg1: PrivateMessage = {
      id: 'msg_seed_01',
      conversationId: conv1Id,
      senderId: 'usr_kuroha',
      senderName: 'Kuroha ✦',
      senderUsername: 'kuroha_void',
      senderAvatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
      recipientId: 'usr_hikari_001',
      text: 'Oi Ren! Vi que você favoritou a trilha sonora de Frieren composta pelo Evan Call. A faixa do episódio 26 é espetacular!',
      type: 'text',
      isRead: false,
      createdAt: tenMinAgo,
    };

    const msg1Link: PrivateMessage = {
      id: 'msg_seed_02',
      conversationId: conv1Id,
      senderId: 'usr_kuroha',
      senderName: 'Kuroha ✦',
      senderUsername: 'kuroha_void',
      senderAvatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
      recipientId: 'usr_hikari_001',
      text: "Dá uma olhada no anime Frieren: Beyond Journey's End se ainda não terminou!",
      type: 'link',
      linkPreview: {
        url: 'https://hikari.tv/anime/anime_frieren',
        type: 'anime',
        title: "Frieren: Beyond Journey's End",
        description: 'Sousou no Frieren (2023)',
        imageUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-gviZ5zgQL7ee.jpg',
        badge: '★ 9.8 • 28 eps',
        extraInfo: {
          rating: 9.8,
          status: 'completed',
          episodes: '28 episódios',
          year: 2023,
          genres: ['Aventura', 'Drama', 'Fantasia'],
        },
      },
      isRead: false,
      createdAt: tenMinAgo + 1000,
    };

    this.conversations.set(conv1Id, {
      id: conv1Id,
      participants: ['usr_hikari_001', 'usr_kuroha'],
      participantDetails: {
        usr_hikari_001: {
          id: 'usr_hikari_001',
          displayName: 'Ren Amano',
          username: 'ren_hikari',
          avatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
        },
        usr_kuroha: {
          id: 'usr_kuroha',
          displayName: 'Kuroha ✦',
          username: 'kuroha_void',
          avatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
          isOnline: true,
        },
      },
      lastMessage: {
        id: msg1Link.id,
        text: msg1Link.text,
        senderId: 'usr_kuroha',
        senderName: 'Kuroha ✦',
        type: 'link',
        createdAt: msg1Link.createdAt,
        isRead: false,
      },
      unreadCounts: {
        usr_hikari_001: 2,
        usr_kuroha: 0,
      },
      createdAt: yesterday,
      updatedAt: msg1Link.createdAt,
    });

    this.messages.set(conv1Id, [msg1, msg1Link]);

    // Conversa 2: Shinji Kazuki (usr_shinji) e Ren Amano (usr_hikari_001) — Modo Demonstração
    const conv2Id = getDeterministicConversationId('usr_hikari_001', 'usr_shinji');
    const msg2: PrivateMessage = {
      id: 'msg_seed_03',
      conversationId: conv2Id,
      senderId: 'usr_hikari_001',
      senderName: 'Ren Amano',
      senderUsername: 'ren_hikari',
      senderAvatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
      recipientId: 'usr_shinji',
      text: 'Você já assistiu os episódios mais recentes de Solo Leveling? A animação nas lutas das sombras ficou inacreditável.',
      type: 'text',
      isRead: true,
      createdAt: oneHourAgo,
    };

    const msg3: PrivateMessage = {
      id: 'msg_seed_04',
      conversationId: conv2Id,
      senderId: 'usr_shinji',
      senderName: 'Shinji Kazuki',
      senderUsername: 'shinji_mecha',
      senderAvatarUrl: '',
      recipientId: 'usr_hikari_001',
      text: 'Sim! A direção do estúdio A-1 Pictures superou todas as minhas expectativas!',
      type: 'text',
      isRead: true,
      createdAt: oneHourAgo + 2000,
    };

    this.conversations.set(conv2Id, {
      id: conv2Id,
      participants: ['usr_hikari_001', 'usr_shinji'],
      participantDetails: {
        usr_hikari_001: {
          id: 'usr_hikari_001',
          displayName: 'Ren Amano',
          username: 'ren_hikari',
          avatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
        },
        usr_shinji: {
          id: 'usr_shinji',
          displayName: 'Shinji Kazuki',
          username: 'shinji_mecha',
          avatarUrl: '',
          isOnline: false,
        },
      },
      lastMessage: {
        id: msg3.id,
        text: msg3.text,
        senderId: 'usr_shinji',
        senderName: 'Shinji Kazuki',
        type: 'text',
        createdAt: msg3.createdAt,
        isRead: true,
      },
      unreadCounts: {
        usr_hikari_001: 0,
        usr_shinji: 0,
      },
      createdAt: yesterday,
      updatedAt: msg3.createdAt,
    });

    this.messages.set(conv2Id, [msg2, msg3]);
  }

  public isParticipant(convId: string, userId: string): boolean {
    const conv = this.conversations.get(convId);
    if (!conv) return false;
    return conv.participants.includes(userId);
  }

  public getLastReadAt(convId: string, userId: string): number {
    return this.lastReadAtByConvAndUser.get(convId)?.[userId] ?? 0;
  }

  public getUserConversations(userId: string): PrivateConversation[] {
    const list: PrivateConversation[] = [];
    for (const conv of this.conversations.values()) {
      if (conv.participants.includes(userId)) {
        const copy: PrivateConversation = {
          ...conv,
          participantDetails: { ...conv.participantDetails },
          unreadCounts: { ...conv.unreadCounts },
        };
        for (const pId of copy.participants) {
          if (copy.participantDetails[pId]) {
            copy.participantDetails[pId] = {
              ...copy.participantDetails[pId],
              isOnline: this.isUserOnline(pId),
            };
          }
        }
        list.push(copy);
      }
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getConversationById(convId: string, requestingUserId?: string): PrivateConversation | null {
    const conv = this.conversations.get(convId);
    if (!conv) return null;
    if (requestingUserId && !conv.participants.includes(requestingUserId)) {
      return null;
    }
    const copy: PrivateConversation = {
      ...conv,
      participantDetails: { ...conv.participantDetails },
      unreadCounts: { ...conv.unreadCounts },
    };
    for (const pId of copy.participants) {
      if (copy.participantDetails[pId]) {
        copy.participantDetails[pId] = {
          ...copy.participantDetails[pId],
          isOnline: this.isUserOnline(pId),
        };
      }
    }
    return copy;
  }

  public getConversationMessages(
    convId: string,
    requestingUserId: string,
    options?: { limit?: number; before?: number }
  ): { messages: PrivateMessage[]; hasMore: boolean } {
    const conv = this.conversations.get(convId);
    if (!conv || !conv.participants.includes(requestingUserId)) {
      return { messages: [], hasMore: false };
    }

    const all = this.messages.get(convId) || [];
    const before = options?.before;
    const limit = options?.limit ?? 50;

    let filtered = all;
    if (before && Number.isFinite(before)) {
      filtered = all.filter((m) => m.createdAt < before);
    }

    const startIndex = Math.max(0, filtered.length - limit);
    const slice = filtered.slice(startIndex);
    const hasMore = startIndex > 0;

    return { messages: slice, hasMore };
  }

  public createOrGetConversation(
    sender: ParticipantSummary,
    recipient: ParticipantSummary
  ): { conversation: PrivateConversation; isNew: boolean } {
    const convId = getDeterministicConversationId(sender.id, recipient.id);
    const existing = this.conversations.get(convId);
    if (existing) {
      existing.participantDetails[sender.id] = { ...sender, isOnline: this.isUserOnline(sender.id) };
      existing.participantDetails[recipient.id] = { ...recipient, isOnline: this.isUserOnline(recipient.id) };
      this.saveToDisk();
      return { conversation: { ...existing, unreadCounts: { ...existing.unreadCounts } }, isNew: false };
    }

    const now = Date.now();
    const newConv: PrivateConversation = {
      id: convId,
      participants: [sender.id, recipient.id],
      participantDetails: {
        [sender.id]: { ...sender, isOnline: this.isUserOnline(sender.id) },
        [recipient.id]: { ...recipient, isOnline: this.isUserOnline(recipient.id) },
      },
      unreadCounts: {
        [sender.id]: 0,
        [recipient.id]: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.conversations.set(convId, newConv);
    if (!this.messages.has(convId)) {
      this.messages.set(convId, []);
    }
    this.saveToDisk();

    return { conversation: { ...newConv, unreadCounts: { ...newConv.unreadCounts } }, isNew: true };
  }

  public addMessage(
    payload: Omit<PrivateMessage, 'id' | 'createdAt' | 'isRead'> & {
      id?: string;
      createdAt?: number;
      recipientSummary?: ParticipantSummary;
    }
  ): { message: PrivateMessage; conversation: PrivateConversation } {
    const { conversationId, senderId, recipientId, text, type } = payload;
    const deterministicId = getDeterministicConversationId(senderId, recipientId);
    let conv = this.conversations.get(conversationId) ?? this.conversations.get(deterministicId);

    // Auto-create conversation if sender & recipient are valid and conversation wasn't initialized yet
    // (only when conversationId matches the deterministic pair ID, preserving Zero-Trust against arbitrary IDs)
    if (!conv && (!conversationId || conversationId === deterministicId)) {
      const senderCtx = this.userContexts.get(senderId);
      const recipientCtx = this.userContexts.get(recipientId);
      const senderSummary: ParticipantSummary = {
        id: senderId,
        displayName: payload.senderName || senderCtx?.displayName || 'Usuário Hikari',
        username: payload.senderUsername || senderCtx?.username || senderId,
        avatarUrl: payload.senderAvatarUrl || senderCtx?.avatarUrl || '',
      };
      const recipientSummary: ParticipantSummary = payload.recipientSummary ?? {
        id: recipientId,
        displayName: recipientCtx?.displayName || 'Usuário Hikari',
        username: recipientCtx?.username || recipientId,
        avatarUrl: recipientCtx?.avatarUrl || '',
      };
      conv = this.createOrGetConversation(senderSummary, recipientSummary).conversation;
      conv = this.conversations.get(conv.id)!;
    }

    if (!conv) {
      throw new Error('Conversa não encontrada para este par de participantes.');
    }

    if (!conv.participants.includes(senderId) || !conv.participants.includes(recipientId)) {
      throw new Error('Participante não autorizado nesta conversa.');
    }

    const mediaCheck = validateMediaPayload(payload.mediaUrl, type);
    if (!mediaCheck.valid) {
      throw new Error(mediaCheck.error || 'Mídia inválida.');
    }

    let linkPreview = payload.linkPreview;
    if (!linkPreview && (type === 'link' || text.includes('http') || text.includes('/anime/'))) {
      linkPreview = extractHikariLinkPreview(text);
    }

    const now = payload.createdAt || Date.now();
    const msgId = payload.id || `msg_${now}_${Math.random().toString(36).slice(2, 9)}`;

    const convMessages = this.messages.get(conv.id) || [];
    const existingMsg = convMessages.find((m) => m.id === msgId);
    if (existingMsg) {
      return { message: { ...existingMsg }, conversation: { ...conv, unreadCounts: { ...conv.unreadCounts } } };
    }

    const recipientLastReadAt = this.getLastReadAt(conv.id, recipientId);
    const alreadyReadByTimestamp = recipientLastReadAt > 0 && now <= recipientLastReadAt;

    const message: PrivateMessage = {
      id: msgId,
      conversationId: conv.id,
      senderId,
      senderName: payload.senderName,
      senderUsername: payload.senderUsername,
      senderAvatarUrl: payload.senderAvatarUrl,
      recipientId,
      text: text.slice(0, 2000),
      type,
      mediaUrl: payload.mediaUrl,
      mediaMetadata: payload.mediaMetadata,
      linkPreview,
      reactions: payload.reactions ? { ...payload.reactions } : {},
      isRead: alreadyReadByTimestamp,
      createdAt: now,
      status: 'sent',
    };

    convMessages.push(message);
    convMessages.sort((a, b) => a.createdAt - b.createdAt);
    this.messages.set(conv.id, convMessages);

    // Recalculate exact unread count per user from actual unread messages so it never drifts
    let recipientUnread = 0;
    for (const m of convMessages) {
      if (m.recipientId === recipientId && !m.isRead) {
        recipientUnread++;
      }
    }
    conv.unreadCounts[recipientId] = recipientUnread;

    const latestMsg = convMessages[convMessages.length - 1] ?? message;
    conv.lastMessage = {
      id: latestMsg.id,
      text: latestMsg.text,
      senderId: latestMsg.senderId,
      senderName: latestMsg.senderName,
      type: latestMsg.type,
      createdAt: latestMsg.createdAt,
      isRead: latestMsg.isRead,
    };
    conv.updatedAt = Math.max(conv.updatedAt, latestMsg.createdAt);

    this.setTyping(conv.id, senderId, false);
    this.saveToDisk();

    return {
      message: { ...message },
      conversation: { ...conv, unreadCounts: { ...conv.unreadCounts } },
    };
  }

  /**
   * Adiciona, altera ou remove a reação com emoji de um participante na mensagem
   */
  public toggleReaction(
    convId: string,
    msgId: string,
    userId: string,
    rawEmoji: string
  ): { message: PrivateMessage; action: 'added' | 'removed' } {
    const conv = this.conversations.get(convId);
    if (!conv || !conv.participants.includes(userId)) {
      throw new Error('Acesso não autorizado para reagir a mensagens desta conversa.');
    }

    const emoji = rawEmoji.trim();
    if (!emoji || emoji.length > 8) {
      throw new Error('Emoji de reação inválido.');
    }

    const convMessages = this.messages.get(convId) || [];
    const targetMsg = convMessages.find((m) => m.id === msgId);
    if (!targetMsg) {
      throw new Error('Mensagem não encontrada nesta conversa.');
    }

    if (!targetMsg.reactions) {
      targetMsg.reactions = {};
    }

    const currentList = targetMsg.reactions[emoji] || [];
    const userIndex = currentList.indexOf(userId);

    let action: 'added' | 'removed' = 'added';

    if (userIndex !== -1) {
      const updated = currentList.filter((id) => id !== userId);
      action = 'removed';
      if (updated.length === 0) {
        delete targetMsg.reactions[emoji];
      } else {
        targetMsg.reactions[emoji] = updated;
      }
    } else {
      targetMsg.reactions[emoji] = [...new Set([...currentList, userId])];
      action = 'added';
    }

    this.saveToDisk();
    return { message: { ...targetMsg }, action };
  }

  public markAsRead(
    convId: string,
    readerUserId: string
  ): { updatedCount: number; lastReadAt: number } {
    const conv = this.conversations.get(convId);
    const now = Date.now();
    if (!conv || !conv.participants.includes(readerUserId)) {
      return { updatedCount: 0, lastReadAt: now };
    }

    conv.unreadCounts[readerUserId] = 0;
    if (conv.lastMessage && conv.lastMessage.senderId !== readerUserId) {
      conv.lastMessage.isRead = true;
    }

    const readMap = this.lastReadAtByConvAndUser.get(convId) ?? {};
    readMap[readerUserId] = Math.max(readMap[readerUserId] ?? 0, now);
    this.lastReadAtByConvAndUser.set(convId, readMap);

    const convMessages = this.messages.get(convId) || [];
    let updatedCount = 0;
    for (const msg of convMessages) {
      if (msg.recipientId === readerUserId && !msg.isRead) {
        msg.isRead = true;
        updatedCount++;
      }
    }

    this.saveToDisk();
    return { updatedCount, lastReadAt: readMap[readerUserId] };
  }

  public clearAll(): void {
    this.conversations.clear();
    this.messages.clear();
    this.lastReadAtByConvAndUser.clear();
    this.userContexts.clear();
    this.userPresence.clear();
    this.typingStates.clear();
  }
}

export const chatStore = new ChatStore();
