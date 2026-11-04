import express, { Request, Response } from 'express';
import {
  chatStore,
  canUserMessageRecipient,
  getDeterministicConversationId,
  validateMediaPayload,
  extractHikariLinkPreview,
  type UserCheckContext,
} from './chatStore.js';
import type { MessageType, ParticipantSummary } from '../types/index.js';
import { verifyRequestUser, isDemoMockUserId } from './userAuth.js';

export const chatRouter = express.Router();

/**
 * Resolves and authorizes the acting user ID for private chat endpoints:
 * - Any valid Authorization Bearer token pins `uid` to the cryptographically verified user,
 *   rejecting cross-account `claimedUserId` spoofing with HTTP 403.
 * - Invalid Authorization headers are rejected immediately with HTTP 401.
 * - Unauthenticated requests are allowed ONLY for offline Demo Mode mock IDs (`usr_hikari_001`, etc.);
 *   real user accounts strictly require a valid Bearer token (HTTP 401).
 */
async function resolveAuthorizedChatActor(
  req: Request,
  res: Response,
  claimedUserId: string | undefined | null
): Promise<string | null> {
  const cleanClaimed = typeof claimedUserId === 'string' ? claimedUserId.trim() : '';
  const caller = await verifyRequestUser(req);

  if (caller.hadAuthHeader && !caller.authenticated) {
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: caller.reason || 'Token de autenticação inválido.',
    });
    return null;
  }

  if (caller.authenticated && caller.uid) {
    if (cleanClaimed && cleanClaimed !== caller.uid) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Acesso negado: uma conta não pode consultar ou enviar mensagens em nome de outra conta.',
      });
      return null;
    }
    return caller.uid;
  }

  // Offline Demo Mode fallback strictly limited to static mock IDs
  if (cleanClaimed && isDemoMockUserId(cleanClaimed)) {
    return cleanClaimed;
  }

  if (!cleanClaimed) {
    res.status(400).json({ error: 'userId é obrigatório.' });
    return null;
  }

  res.status(401).json({
    error: 'UNAUTHORIZED',
    message: 'Autenticação obrigatória para acessar mensagens privadas.',
  });
  return null;
}

/**
 * Registra ou atualiza o contexto de privacidade do usuário no servidor
 */
chatRouter.post('/sync-user-context', async (req: Request, res: Response) => {
  const {
    id,
    username,
    displayName,
    avatarUrl,
    allowDirectMessages,
    directMessagesFrom,
    showOnlineStatus,
    followingIds,
    followerIds,
    blockedIds,
  } = req.body ?? {};

  const actorUid = await resolveAuthorizedChatActor(req, res, id);
  if (!actorUid) return;

  const ctx: UserCheckContext = {
    id: actorUid,
    username: username || 'usuario',
    displayName: displayName || 'Usuário Hikari',
    avatarUrl: avatarUrl || '',
    allowDirectMessages: allowDirectMessages !== false,
    directMessagesFrom: directMessagesFrom || 'everyone',
    showOnlineStatus: showOnlineStatus !== false,
    followingIds: Array.isArray(followingIds) ? followingIds : [],
    followerIds: Array.isArray(followerIds) ? followerIds : [],
    blockedIds: Array.isArray(blockedIds) ? blockedIds : [],
  };

  chatStore.registerUserContext(ctx);
  return res.json({ success: true, registeredId: ctx.id });
});

/**
 * Consulta se um usuário tem permissão para enviar mensagem para o destinatário
 */
chatRouter.get('/can-message', async (req: Request, res: Response) => {
  const senderId = req.query.senderId as string;
  const recipientId = req.query.recipientId as string;

  if (!senderId || !recipientId) {
    return res.status(400).json({ error: 'senderId e recipientId são obrigatórios.' });
  }

  const actorUid = await resolveAuthorizedChatActor(req, res, senderId);
  if (!actorUid) return;

  const senderCtx = chatStore.getUserContext(actorUid);
  const recipientCtx = chatStore.getUserContext(recipientId);

  if (senderCtx && recipientCtx) {
    const check = canUserMessageRecipient(senderCtx, recipientCtx);
    return res.json(check);
  }

  return res.json({ allowed: true });
});

/**
 * Lista as conversas de um usuário autenticado
 */
chatRouter.get('/conversations', async (req: Request, res: Response) => {
  const actorUid = await resolveAuthorizedChatActor(req, res, req.query.userId as string);
  if (!actorUid) return;

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const conversations = chatStore.getUserConversations(actorUid);
  return res.json({ conversations });
});

/**
 * Obtém detalhes de uma conversa específica (restrito aos 2 participantes)
 */
chatRouter.get('/conversations/:id', async (req: Request, res: Response) => {
  const convId = req.params.id;
  const actorUid = await resolveAuthorizedChatActor(req, res, req.query.userId as string);
  if (!actorUid) return;

  const existingAny = chatStore.getConversationById(convId);
  if (existingAny && !existingAny.participants.includes(actorUid)) {
    return res.status(403).json({ error: 'Acesso negado: você não participa desta conversa.' });
  }

  const conv = chatStore.getConversationById(convId, actorUid);
  if (!conv) {
    return res.status(404).json({ error: 'Conversa não encontrada.' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json({ conversation: conv });
});

/**
 * Lista mensagens de uma conversa com paginação progressiva (restrito aos 2 participantes)
 */
chatRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const convId = req.params.id;
  const limitStr = req.query.limit as string;
  const beforeStr = req.query.before as string;

  const actorUid = await resolveAuthorizedChatActor(req, res, req.query.userId as string);
  if (!actorUid) return;

  const existingAny = chatStore.getConversationById(convId);
  if (existingAny && !existingAny.participants.includes(actorUid)) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Acesso negado: esta conversa pertence a outros usuários.',
      messages: [],
      hasMore: false,
    });
  }

  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  const before = beforeStr ? parseInt(beforeStr, 10) : undefined;

  const result = chatStore.getConversationMessages(convId, actorUid, { limit, before });
  const typingUsers = chatStore.getTypingUsers(convId, actorUid);
  const lastReadAt = chatStore.getLastReadAt(convId, actorUid);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json({ ...result, typingUsers, lastReadAt });
});

/**
 * Abre ou cria uma conversa entre dois participantes com verificação de bloqueio e privacidade
 */
chatRouter.post('/conversations', async (req: Request, res: Response) => {
  const { sender, recipient } = (req.body ?? {}) as {
    sender?: ParticipantSummary;
    recipient?: ParticipantSummary;
  };

  if (!sender || !recipient || !sender.id || !recipient.id) {
    return res.status(400).json({ error: 'Participantes remetente e destinatário são obrigatórios.' });
  }

  const actorUid = await resolveAuthorizedChatActor(req, res, sender.id);
  if (!actorUid) return;

  if (actorUid === recipient.id) {
    return res.status(400).json({ error: 'Não é possível iniciar conversa consigo mesmo.' });
  }

  const senderCtx = chatStore.getUserContext(actorUid);
  const recipientCtx = chatStore.getUserContext(recipient.id);

  if (senderCtx && recipientCtx) {
    const check = canUserMessageRecipient(senderCtx, recipientCtx);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }
  }

  const verifiedSender: ParticipantSummary = { ...sender, id: actorUid };
  const { conversation, isNew } = chatStore.createOrGetConversation(verifiedSender, recipient);
  return res.json({ conversation, isNew });
});

/**
 * Envia uma nova mensagem para a conversa
 */
chatRouter.post('/messages', async (req: Request, res: Response) => {
  const {
    conversationId,
    senderId,
    senderName,
    senderUsername,
    senderAvatarUrl,
    recipientId,
    recipientSummary,
    text,
    type,
    mediaUrl,
    mediaMetadata,
    linkPreview,
    id,
  } = req.body ?? {};

  if (!senderId || !recipientId) {
    return res.status(400).json({ error: 'senderId e recipientId são obrigatórios.' });
  }

  const actorUid = await resolveAuthorizedChatActor(req, res, senderId);
  if (!actorUid) return;

  if (actorUid === recipientId) {
    return res.status(400).json({ error: 'Não é permitido enviar mensagem para a própria conta.' });
  }

  if (typeof text !== 'string' && !mediaUrl) {
    return res.status(400).json({ error: 'Texto ou mídia da mensagem é obrigatório.' });
  }

  const senderCtx = chatStore.getUserContext(actorUid);
  const recipientCtx = chatStore.getUserContext(recipientId);

  if (senderCtx && recipientCtx) {
    const check = canUserMessageRecipient(senderCtx, recipientCtx);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }
  }

  const msgType = (type || (mediaUrl ? 'image' : 'text')) as MessageType;
  const mediaValidation = validateMediaPayload(mediaUrl, msgType);
  if (!mediaValidation.valid) {
    return res.status(400).json({ error: mediaValidation.error });
  }

  try {
    const targetConvId = conversationId || getDeterministicConversationId(actorUid, recipientId);
    const result = chatStore.addMessage({
      id,
      conversationId: targetConvId,
      senderId: actorUid,
      senderName: senderName || 'Usuário',
      senderUsername,
      senderAvatarUrl: senderAvatarUrl || '',
      recipientId,
      recipientSummary,
      text: text || '',
      type: msgType,
      mediaUrl,
      mediaMetadata,
      linkPreview,
    });

    return res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao enviar mensagem.';
    const status = msg.includes('não autorizado') ? 403 : 400;
    return res.status(status).json({ error: msg });
  }
});

/**
 * Marca as mensagens de uma conversa como lidas exclusivamente pelo leitor autenticado
 */
chatRouter.post('/conversations/:id/read', async (req: Request, res: Response) => {
  const convId = req.params.id;
  const { userId } = req.body ?? {};

  const actorUid = await resolveAuthorizedChatActor(req, res, userId);
  if (!actorUid) return;

  const existingAny = chatStore.getConversationById(convId);
  if (existingAny && !existingAny.participants.includes(actorUid)) {
    return res.status(403).json({ error: 'Acesso negado a esta conversa.' });
  }

  const result = chatStore.markAsRead(convId, actorUid);
  return res.json({ success: true, ...result });
});

/**
 * Resolve metadados e preview seguro de links do Hikari
 */
chatRouter.get('/preview', (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) {
    return res.status(400).json({ error: 'URL necessária para preview.' });
  }

  const preview = extractHikariLinkPreview(url);
  if (!preview) {
    return res.status(404).json({ error: 'Não foi possível extrair preview seguro para esta URL.' });
  }

  return res.json({ preview });
});

/**
 * Atualiza o indicador de digitação na conversa
 */
chatRouter.post('/conversations/:id/typing', async (req: Request, res: Response) => {
  const convId = req.params.id;
  const { userId, isTyping } = req.body ?? {};

  const actorUid = await resolveAuthorizedChatActor(req, res, userId);
  if (!actorUid) return;

  const existingAny = chatStore.getConversationById(convId);
  if (existingAny && !existingAny.participants.includes(actorUid)) {
    return res.status(403).json({ error: 'Acesso negado a esta conversa.' });
  }

  chatStore.setTyping(convId, actorUid, Boolean(isTyping));
  const typingUsers = chatStore.getTypingUsers(convId, actorUid);
  return res.json({ success: true, typingUsers });
});

/**
 * Alterna ou registra reação com emoji em uma mensagem
 */
chatRouter.post('/conversations/:id/messages/:msgId/reaction', async (req: Request, res: Response) => {
  const { id: convId, msgId } = req.params;
  const { userId, emoji } = req.body ?? {};

  if (!emoji) {
    return res.status(400).json({ error: 'userId e emoji são obrigatórios para registrar reação.' });
  }

  const actorUid = await resolveAuthorizedChatActor(req, res, userId);
  if (!actorUid) return;

  try {
    const result = chatStore.toggleReaction(convId, msgId, actorUid, emoji);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao registrar reação.';
    const status = message.includes('não autorizado') ? 403 : 400;
    return res.status(status).json({ error: message });
  }
});

/**
 * Envia heartbeat de presença do usuário
 */
chatRouter.post('/presence/heartbeat', async (req: Request, res: Response) => {
  const { userId, showOnlineStatus } = req.body ?? {};
  const actorUid = await resolveAuthorizedChatActor(req, res, userId);
  if (!actorUid) return;

  chatStore.recordPresence(actorUid, true, showOnlineStatus);
  return res.json({ success: true, isOnline: chatStore.isUserOnline(actorUid) });
});

/**
 * Notifica desconexão ou fechamento de aba (compatível com navigator.sendBeacon)
 */
chatRouter.post('/presence/offline', async (req: Request, res: Response) => {
  let userId = req.body?.userId;
  let tokenFromBody = req.body?.idToken;
  if (!userId && typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      userId = parsed.userId;
      tokenFromBody = parsed.idToken;
    } catch {
      // ignore
    }
  }

  const caller = await verifyRequestUser(req);
  if (caller.authenticated && caller.uid) {
    chatStore.recordPresence(caller.uid, false);
    return res.json({ success: true });
  }

  if (typeof tokenFromBody === 'string' && tokenFromBody.trim()) {
    const { verifyAuthenticatedUserToken } = await import('./userAuth.js');
    const verified = await verifyAuthenticatedUserToken(tokenFromBody);
    if (verified.authenticated && verified.uid) {
      chatStore.recordPresence(verified.uid, false);
      return res.json({ success: true });
    }
  }

  if (typeof userId === 'string' && isDemoMockUserId(userId)) {
    chatStore.recordPresence(userId, false);
  }
  return res.json({ success: true });
});

/**
 * Consulta status de presença de uma lista de usuários
 */
chatRouter.get('/presence/users', (req: Request, res: Response) => {
  const idsParam = req.query.ids as string;
  if (!idsParam) {
    return res.json({ presence: {} });
  }

  const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean);
  const presenceMap: Record<string, boolean> = {};
  for (const id of ids) {
    presenceMap[id] = chatStore.isUserOnline(id);
  }

  return res.json({ presence: presenceMap });
});
