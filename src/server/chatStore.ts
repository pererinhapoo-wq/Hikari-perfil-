import type {
  PrivateConversation,
  PrivateMessage,
  MessageType,
  HikariLinkPreview,
  ParticipantSummary,
  DirectMessagesPrivacy,
  AnimeItem,
} from '../types/index.js';
import { INITIAL_ANIMES } from '../data/mockData.js';

export interface UserCheckContext {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  allowDirectMessages?: boolean;
  directMessagesFrom?: DirectMessagesPrivacy;
  followingIds: string[];
  followerIds: string[];
  blockedIds: string[];
}

export function getDeterministicConversationId(userA: string, userB: string): string {
  const cleanA = userA.trim();
  const cleanB = userB.trim();
  if (!cleanA || !cleanB) {
    throw new Error('IDs de participantes inválidos.');
  }
  const sorted = [cleanA, cleanB].sort();
  return `conv_${sorted[0]}__${sorted[1]}`;
}

export function canUserMessageRecipient(
  sender: UserCheckContext,
  recipient: UserCheckContext
): { allowed: boolean; reason?: string } {
  if (sender.id === recipient.id) {
    return { allowed: false, reason: 'Você não pode iniciar uma conversa consigo mesmo.' };
  }

  // Verificação de bloqueios mútuos
  if (recipient.blockedIds.includes(sender.id)) {
    return {
      allowed: false,
      reason: 'Você foi bloqueado por este usuário e não pode enviar mensagens para ele.',
    };
  }

  if (sender.blockedIds.includes(recipient.id)) {
    return {
      allowed: false,
      reason: 'Você bloqueou este usuário. Desbloqueie-o para poder enviar mensagens.',
    };
  }

  // Verificação de recebimento de mensagens ativado
  const recipientAllowsDMs = recipient.allowDirectMessages !== false;
  if (!recipientAllowsDMs) {
    return {
      allowed: false,
      reason: `${recipient.displayName} desativou o recebimento de mensagens privadas.`,
    };
  }

  // Verificação do escopo de privacidade do destinatário
  const privacyScope = recipient.directMessagesFrom || 'everyone';

  if (privacyScope === 'followers') {
    const isSenderFollowingRecipient = recipient.followerIds.includes(sender.id);
    if (!isSenderFollowingRecipient) {
      return {
        allowed: false,
        reason: `${recipient.displayName} permite mensagens apenas de usuários que o seguem. Comece a seguir este perfil para enviar uma mensagem.`,
      };
    }
  }

  if (privacyScope === 'mutual') {
    const isSenderFollowerOfRecipient = recipient.followerIds.includes(sender.id);
    const isRecipientFollowerOfSender = sender.followerIds.includes(recipient.id);
    const isMutual = isSenderFollowerOfRecipient && isRecipientFollowerOfSender;

    if (!isMutual) {
      return {
        allowed: false,
        reason: `${recipient.displayName} permite mensagens apenas de seguidores mútuos. Ambos precisam se seguir.`,
      };
    }
  }

  return { allowed: true };
}

export function validateMediaPayload(
  mediaUrl: string | undefined,
  type: MessageType
): { valid: boolean; error?: string } {
  if (type === 'text') {
    return { valid: true };
  }

  if (!mediaUrl || typeof mediaUrl !== 'string') {
    return { valid: false, error: 'URL de mídia ausente para mensagem do tipo mídia.' };
  }

  const trimmed = mediaUrl.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'URL de mídia vazia.' };
  }

  // Prevenção estrita de esquemas inseguros
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html') ||
    lower.startsWith('data:application/')
  ) {
    return { valid: false, error: 'Formato ou esquema de URL não seguro detectado.' };
  }

  // Suporte a Data URLs de imagens seguras
  if (lower.startsWith('data:image/')) {
    const validDataHeader = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed);
    if (!validDataHeader) {
      return { valid: false, error: 'Apenas imagens PNG, JPEG, WEBP e GIF em Base64 são suportadas.' };
    }
    // Limite de 5MB para data URLs
    if (trimmed.length > 7 * 1024 * 1024) {
      return { valid: false, error: 'A imagem enviada excede o limite máximo permitido de 5MB.' };
    }
    if (type === 'gif' && !lower.startsWith('data:image/gif')) {
      return { valid: false, error: 'O arquivo enviado deve ser um GIF animado.' };
    }
    return { valid: true };
  }

  // Suporte a URLs HTTPS
  if (!lower.startsWith('https://') && !lower.startsWith('http://localhost') && !lower.startsWith('/')) {
    return { valid: false, error: 'A URL da imagem/GIF deve utilizar o protocolo seguro HTTPS.' };
  }

  if (trimmed.length > 2048) {
    return { valid: false, error: 'A URL da mídia excede o tamanho máximo de 2048 caracteres.' };
  }

  return { valid: true };
}

export function extractHikariLinkPreview(
  text: string,
  catalog: AnimeItem[] = INITIAL_ANIMES
): HikariLinkPreview | undefined {
  if (!text || typeof text !== 'string') return undefined;

  // 1. Detecção de URLs do domínio Hikari (ex: https://hikari.app/anime/solo_leveling, /anime/frieren)
  const hikariUrlRegex = /(?:https?:\/\/(?:[a-zA-Z0-9-]+\.)?hikari\.(?:app|tv|moe|local)\/|^\/|\s\/)(anime|perfil|comentario)\/([a-zA-Z0-9_-]+)/i;
  const match = text.match(hikariUrlRegex);

  if (match) {
    const kind = match[1].toLowerCase();
    const id = match[2].toLowerCase();

    if (kind === 'anime') {
      const found = catalog.find(
        (a) =>
          a.id.toLowerCase() === id ||
          a.id.toLowerCase() === `anime_${id}` ||
          a.title.toLowerCase().includes(id.replace(/[-_]/g, ' '))
      );

      if (found) {
        return {
          url: match[0].trim(),
          type: 'anime',
          title: found.title,
          description: found.titleRomaji || `Ano ${found.year} • ${found.genres.join(', ')}`,
          imageUrl: found.posterUrl,
          badge: `★ ${found.rating.toFixed(1)} • ${found.currentEpisode}/${found.totalEpisodes} eps`,
          extraInfo: {
            rating: found.rating,
            status: found.status,
            episodes: `${found.totalEpisodes} episódios`,
            year: found.year,
            genres: found.genres,
          },
        };
      }
    }
  }

  // 2. Detecção inteligente de títulos do catálogo oficial Hikari citados na mensagem
  for (const anime of catalog) {
    const lowerTitle = anime.title.toLowerCase();
    const cleanText = text.toLowerCase();
    if (cleanText.includes(lowerTitle) && lowerTitle.length >= 5) {
      return {
        url: `https://hikari.tv/anime/${anime.id}`,
        type: 'anime',
        title: anime.title,
        description: anime.titleRomaji ? `${anime.titleRomaji} (${anime.year})` : `Lançamento: ${anime.year}`,
        imageUrl: anime.posterUrl,
        badge: `★ ${anime.rating.toFixed(1)} Hikari`,
        extraInfo: {
          rating: anime.rating,
          status: anime.status,
          episodes: `${anime.totalEpisodes} eps`,
          year: anime.year,
          genres: anime.genres,
        },
      };
    }
  }

  // 3. Detecção de URLs genéricas externas seguras (apenas exibição sem simulação falsa de metadados)
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    const rawUrl = urlMatch[0];
    try {
      const parsed = new URL(rawUrl);
      return {
        url: parsed.href,
        type: 'external',
        title: parsed.hostname,
        description: parsed.pathname.length > 1 ? parsed.pathname : 'Link externo verificado',
      };
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Armazenamento em memória autoritativo do servidor para o chat do Hikari,
 * sincronizável entre chamadas e requisições REST/Vercel.
 */
class ChatStore {
  private conversations = new Map<string, PrivateConversation>();
  private messages = new Map<string, PrivateMessage[]>(); // conversationId -> messages (sorted ascending by createdAt)
  private userContexts = new Map<string, UserCheckContext>();

  constructor() {
    this.seedInitialConversations();
  }

  public registerUserContext(ctx: UserCheckContext): void {
    this.userContexts.set(ctx.id, { ...ctx });
  }

  public getUserContext(userId: string): UserCheckContext | undefined {
    return this.userContexts.get(userId);
  }

  private seedInitialConversations(): void {
    const now = Date.now();
    const tenMinAgo = now - 10 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const yesterday = now - 24 * 60 * 60 * 1000;

    // Conversa 1: Kuroha (usr_kuroha) e Ren Amano (usr_hikari_001)
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
      text: 'Dá uma olhada no anime Frieren: Beyond Journey\'s End se ainda não terminou!',
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

    // Conversa 2: Shinji Kazuki (usr_shinji) e Ren Amano (usr_hikari_001)
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

  public getUserConversations(userId: string): PrivateConversation[] {
    const list: PrivateConversation[] = [];
    for (const conv of this.conversations.values()) {
      if (conv.participants.includes(userId)) {
        list.push({ ...conv });
      }
    }
    // Ordena da mais recente para a mais antiga
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getConversationById(convId: string, requestingUserId?: string): PrivateConversation | null {
    const conv = this.conversations.get(convId);
    if (!conv) return null;
    if (requestingUserId && !conv.participants.includes(requestingUserId)) {
      return null;
    }
    return { ...conv };
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
    const limit = options?.limit ?? 30;

    let filtered = all;
    if (before && Number.isFinite(before)) {
      filtered = all.filter((m) => m.createdAt < before);
    }

    // Carregamento progressivo a partir do final (mensagens mais recentes)
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
      // Atualiza metadados dos participantes se mudaram
      existing.participantDetails[sender.id] = { ...sender };
      existing.participantDetails[recipient.id] = { ...recipient };
      return { conversation: { ...existing }, isNew: false };
    }

    const now = Date.now();
    const newConv: PrivateConversation = {
      id: convId,
      participants: [sender.id, recipient.id],
      participantDetails: {
        [sender.id]: { ...sender },
        [recipient.id]: { ...recipient },
      },
      unreadCounts: {
        [sender.id]: 0,
        [recipient.id]: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.conversations.set(convId, newConv);
    this.messages.set(convId, []);

    return { conversation: { ...newConv }, isNew: true };
  }

  public addMessage(
    payload: Omit<PrivateMessage, 'id' | 'createdAt' | 'isRead'> & { id?: string; createdAt?: number }
  ): { message: PrivateMessage; conversation: PrivateConversation } {
    const { conversationId, senderId, recipientId, text, type } = payload;
    let conv = this.conversations.get(conversationId);

    if (!conv) {
      const convId = getDeterministicConversationId(senderId, recipientId);
      conv = this.conversations.get(convId);
    }

    if (!conv) {
      throw new Error('Conversa não encontrada para este par de participantes.');
    }

    if (!conv.participants.includes(senderId) || !conv.participants.includes(recipientId)) {
      throw new Error('Participante não autorizado nesta conversa.');
    }

    // Validação de Mídia
    const mediaCheck = validateMediaPayload(payload.mediaUrl, type);
    if (!mediaCheck.valid) {
      throw new Error(mediaCheck.error || 'Mídia inválida.');
    }

    // Extração automática de preview para links se não informado
    let linkPreview = payload.linkPreview;
    if (!linkPreview && (type === 'link' || text.includes('http') || text.includes('/anime/'))) {
      linkPreview = extractHikariLinkPreview(text);
    }

    const now = payload.createdAt || Date.now();
    const msgId = payload.id || `msg_${now}_${Math.random().toString(36).slice(2, 9)}`;

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
      isRead: false,
      createdAt: now,
      status: 'sent',
    };

    const convMessages = this.messages.get(conv.id) || [];
    convMessages.push(message);
    this.messages.set(conv.id, convMessages);

    // Atualiza metadados da conversa
    const currentUnread = conv.unreadCounts[recipientId] || 0;
    conv.unreadCounts[recipientId] = currentUnread + 1;
    conv.lastMessage = {
      id: message.id,
      text: message.text,
      senderId: message.senderId,
      senderName: message.senderName,
      type: message.type,
      createdAt: message.createdAt,
      isRead: false,
    };
    conv.updatedAt = now;

    return { message, conversation: { ...conv } };
  }

  public markAsRead(convId: string, readerUserId: string): { updatedCount: number } {
    const conv = this.conversations.get(convId);
    if (!conv || !conv.participants.includes(readerUserId)) {
      return { updatedCount: 0 };
    }

    conv.unreadCounts[readerUserId] = 0;
    if (conv.lastMessage && conv.lastMessage.senderId !== readerUserId) {
      conv.lastMessage.isRead = true;
    }

    const convMessages = this.messages.get(convId) || [];
    let updatedCount = 0;
    for (const msg of convMessages) {
      if (msg.recipientId === readerUserId && !msg.isRead) {
        msg.isRead = true;
        updatedCount++;
      }
    }

    return { updatedCount };
  }

  public clearAll(): void {
    this.conversations.clear();
    this.messages.clear();
    this.userContexts.clear();
  }
}

export const chatStore = new ChatStore();
