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

export const chatRouter = express.Router();

/**
 * Registra ou atualiza o contexto de privacidade do usuário no servidor
 */
chatRouter.post('/sync-user-context', (req: Request, res: Response) => {
  const { id, username, displayName, avatarUrl, allowDirectMessages, directMessagesFrom, followingIds, followerIds, blockedIds } = req.body;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'ID de usuário obrigatório.' });
  }

  const ctx: UserCheckContext = {
    id: id.trim(),
    username: username || 'usuario',
    displayName: displayName || 'Usuário Hikari',
    avatarUrl: avatarUrl || '',
    allowDirectMessages: allowDirectMessages !== false,
    directMessagesFrom: directMessagesFrom || 'everyone',
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
chatRouter.get('/can-message', (req: Request, res: Response) => {
  const senderId = req.query.senderId as string;
  const recipientId = req.query.recipientId as string;

  if (!senderId || !recipientId) {
    return res.status(400).json({ error: 'senderId e recipientId são obrigatórios.' });
  }

  const senderCtx = chatStore.getUserContext(senderId);
  const recipientCtx = chatStore.getUserContext(recipientId);

  // Se o contexto do destinatário estiver registrado, valida estritamente
  if (senderCtx && recipientCtx) {
    const check = canUserMessageRecipient(senderCtx, recipientCtx);
    return res.json(check);
  }

  // Se algum contexto não foi sincronizado ainda, permite consulta com base nos dados parciais
  return res.json({ allowed: true });
});

/**
 * Lista as conversas de um usuário
 */
chatRouter.get('/conversations', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  const conversations = chatStore.getUserConversations(userId);
  return res.json({ conversations });
});

/**
 * Obtém detalhes de uma conversa específica
 */
chatRouter.get('/conversations/:id', (req: Request, res: Response) => {
  const convId = req.params.id;
  const userId = req.query.userId as string;

  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório para validação de acesso.' });
  }

  const conv = chatStore.getConversationById(convId, userId);
  if (!conv) {
    return res.status(404).json({ error: 'Conversa não encontrada ou acesso não autorizado.' });
  }

  return res.json({ conversation: conv });
});

/**
 * Lista mensagens de uma conversa com paginação progressiva
 */
chatRouter.get('/conversations/:id/messages', (req: Request, res: Response) => {
  const convId = req.params.id;
  const userId = req.query.userId as string;
  const limitStr = req.query.limit as string;
  const beforeStr = req.query.before as string;

  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório para validar autorização.' });
  }

  const limit = limitStr ? parseInt(limitStr, 10) : 30;
  const before = beforeStr ? parseInt(beforeStr, 10) : undefined;

  const result = chatStore.getConversationMessages(convId, userId, { limit, before });
  return res.json(result);
});

/**
 * Abre ou cria uma conversa entre dois participantes com verificação de bloqueio e privacidade
 */
chatRouter.post('/conversations', (req: Request, res: Response) => {
  const { sender, recipient } = req.body as {
    sender: ParticipantSummary;
    recipient: ParticipantSummary;
  };

  if (!sender || !recipient || !sender.id || !recipient.id) {
    return res.status(400).json({ error: 'Participantes remetente e destinatário são obrigatórios.' });
  }

  // Verificação de autorização no servidor caso os contextos estejam registrados
  const senderCtx = chatStore.getUserContext(sender.id);
  const recipientCtx = chatStore.getUserContext(recipient.id);

  if (senderCtx && recipientCtx) {
    const check = canUserMessageRecipient(senderCtx, recipientCtx);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }
  }

  const { conversation, isNew } = chatStore.createOrGetConversation(sender, recipient);
  return res.json({ conversation, isNew });
});

/**
 * Envia uma nova mensagem para a conversa
 */
chatRouter.post('/messages', (req: Request, res: Response) => {
  const {
    conversationId,
    senderId,
    senderName,
    senderUsername,
    senderAvatarUrl,
    recipientId,
    text,
    type,
    mediaUrl,
    mediaMetadata,
    linkPreview,
    id,
  } = req.body;

  if (!senderId || !recipientId) {
    return res.status(400).json({ error: 'senderId e recipientId são obrigatórios.' });
  }

  if (typeof text !== 'string' && !mediaUrl) {
    return res.status(400).json({ error: 'Texto ou mídia da mensagem é obrigatório.' });
  }

  // Verificação de bloqueios e permissões no servidor
  const senderCtx = chatStore.getUserContext(senderId);
  const recipientCtx = chatStore.getUserContext(recipientId);

  if (senderCtx && recipientCtx) {
    const check = canUserMessageRecipient(senderCtx, recipientCtx);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }
  }

  // Validação de mídia e links
  const msgType = (type || (mediaUrl ? 'image' : 'text')) as MessageType;
  const mediaValidation = validateMediaPayload(mediaUrl, msgType);
  if (!mediaValidation.valid) {
    return res.status(400).json({ error: mediaValidation.error });
  }

  try {
    const targetConvId = conversationId || getDeterministicConversationId(senderId, recipientId);
    const result = chatStore.addMessage({
      id,
      conversationId: targetConvId,
      senderId,
      senderName: senderName || 'Usuário',
      senderUsername,
      senderAvatarUrl: senderAvatarUrl || '',
      recipientId,
      text: text || '',
      type: msgType,
      mediaUrl,
      mediaMetadata,
      linkPreview,
    });

    return res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao enviar mensagem.';
    return res.status(400).json({ error: msg });
  }
});

/**
 * Marca as mensagens de uma conversa como lidas pelo leitor
 */
chatRouter.post('/conversations/:id/read', (req: Request, res: Response) => {
  const convId = req.params.id;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  const result = chatStore.markAsRead(convId, userId);
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
