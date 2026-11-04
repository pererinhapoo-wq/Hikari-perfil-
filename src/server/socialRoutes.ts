import { Router, type Request, type Response } from 'express';
import { socialStore } from './socialStore.js';
import { verifyRequestUser } from './userAuth.js';
import { getAdminFirestore } from './firebaseAdmin.js';

export const socialRouter = Router();

/**
 * POST /api/users/:targetId/report
 * Registra denúncia de perfil no Firestore (persistente entre instâncias serverless).
 */
socialRouter.post('/:targetId/report', async (req: Request, res: Response) => {
  const caller = await verifyRequestUser(req);
  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({ ok: false, message: 'Entre na sua conta para denunciar um perfil.' });
  }

  const targetId = String(req.params.targetId || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const details = String(req.body?.details || '').trim().slice(0, 600);
  const allowedReasons = new Set(['assédio ou bullying', 'spam ou golpe', 'conteúdo impróprio', 'falsidade ideológica', 'outro']);

  if (!targetId || targetId.length > 160 || targetId === caller.uid) {
    return res.status(400).json({ ok: false, message: 'Perfil selecionado para denúncia inválido.' });
  }
  if (!allowedReasons.has(reason.toLowerCase())) {
    return res.status(400).json({ ok: false, message: 'Selecione um motivo válido para a denúncia.' });
  }

  try {
    const db = getAdminFirestore();
    const recentReports = await db.collection('profile_reports')
      .where('reporterUid', '==', caller.uid)
      .limit(100)
      .get();
    const duplicate = recentReports.docs.some((doc) => {
      const data = doc.data();
      return data.targetId === targetId && data.status === 'pending';
    });
    if (duplicate) {
      return res.json({ ok: true, duplicate: true, message: 'Você já enviou uma denúncia pendente para este perfil.' });
    }

    await db.collection('profile_reports').add({
      targetId,
      reporterUid: caller.uid,
      reason,
      details,
      targetType: 'profile',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
    });
    return res.status(201).json({ ok: true, message: 'Denúncia enviada para análise.' });
  } catch (err) {
    console.error('[social] Não foi possível registrar denúncia de perfil:', err);
    return res.status(503).json({ ok: false, message: 'O serviço de denúncias está indisponível no momento. Tente novamente mais tarde.' });
  }
});

/**
 * GET /api/users/search?q=<term>&limit=10
 * Searches discoverable user profiles without leaking private fields.
 */
socialRouter.get('/search', (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const rawLimit = Number(req.query.limit ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.floor(rawLimit))) : 10;

  if (!q.trim()) {
    return res.json({ profiles: [] });
  }

  const profiles = socialStore.searchProfiles(q, limit);
  return res.json({ profiles });
});

/**
 * PUT /api/users/:userId/sync
 * Strictly owner-authenticated synchronization of profile, privacy settings, full anime catalog,
 * favorites, and activities. Returns merged authoritative social & notification state.
 */
socialRouter.put('/:userId/sync', async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId || '').trim();
  const caller = await verifyRequestUser(req);

  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: caller.reason || 'Autenticação obrigatória para sincronizar conta.',
    });
  }

  if (caller.uid !== targetUserId) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Acesso negado: você só pode sincronizar os dados da sua própria conta.',
    });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || !body.profile || typeof body.profile !== 'object') {
    return res.status(400).json({ error: 'Payload de perfil inválido.' });
  }

  const synced = socialStore.syncOwnerWorkspace(caller.uid, {
    profile: { ...body.profile, id: caller.uid },
    animes: Array.isArray(body.animes) ? body.animes : undefined,
    animesComplete: body.animesComplete !== false,
    favoriteCharacters: Array.isArray(body.favoriteCharacters) ? body.favoriteCharacters : undefined,
    favoriteCompanies: Array.isArray(body.favoriteCompanies) ? body.favoriteCompanies : undefined,
    favoritePeople: Array.isArray(body.favoritePeople) ? body.favoritePeople : undefined,
    activities: Array.isArray(body.activities) ? body.activities : undefined,
    comments: Array.isArray(body.comments) ? body.comments : undefined,
    blockedIds: Array.isArray(body.blockedIds) ? body.blockedIds : undefined,
    updatedAtMs: typeof body.updatedAtMs === 'number' ? body.updatedAtMs : Date.now(),
  });

  const socialState = socialStore.getNotificationsState(caller.uid);
  return res.json({
    ok: true,
    uid: caller.uid,
    updatedAtMs: synced.updatedAtMs,
    ...socialState,
  });
});

/**
 * GET /api/users/:idOrUsername/profile
 * Enforces backend Zero-Trust privacy:
 * - Returns HTTP 403 PRIVATE_PROFILE if target is private and caller is not the verified owner.
 * - Returns HTTP 200 with authorized public fields for public profiles, or full data for verified owner.
 */
socialRouter.get('/:idOrUsername/profile', async (req: Request, res: Response) => {
  const idOrUsername = String(req.params.idOrUsername || '').trim();
  if (!idOrUsername) {
    return res.status(400).json({ error: 'Identificador de perfil inválido.' });
  }

  const caller = await verifyRequestUser(req);
  if (caller.hadAuthHeader && !caller.authenticated) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: caller.reason || 'Token de autenticação inválido.',
    });
  }

  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const limit = Math.min(2500, Math.max(1, Number(req.query.limit ?? 1000) || 1000));

  const view = socialStore.getAuthorizedProfileView(
    idOrUsername,
    caller.authenticated ? caller.uid ?? null : null,
    { offset, limit }
  );

  if (!view) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Perfil não encontrado.',
    });
  }

  if (view.isPrivateBlocked) {
    return res.status(403).json(view);
  }

  return res.json(view);
});

/**
 * GET /api/users/:idOrUsername/animes?offset=0&limit=1000
 * Paginated anime list endpoint with strict backend privacy blocking.
 */
socialRouter.get('/:idOrUsername/animes', async (req: Request, res: Response) => {
  const idOrUsername = String(req.params.idOrUsername || '').trim();
  const caller = await verifyRequestUser(req);
  if (caller.hadAuthHeader && !caller.authenticated) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: caller.reason || 'Token de autenticação inválido.',
    });
  }

  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const limit = Math.min(2500, Math.max(1, Number(req.query.limit ?? 1000) || 1000));

  const record = socialStore.getUserRecord(idOrUsername);
  if (!record) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Perfil não encontrado.' });
  }

  const isOwner = Boolean(caller.authenticated && caller.uid === record.uid);
  if (!isOwner && record.profile.isPrivate) {
    return res.status(403).json({
      error: 'PRIVATE_PROFILE',
      message: 'Este perfil é privado. A lista de animes não está disponível.',
      animes: [],
      totalAnimes: 0,
    });
  }

  if (!isOwner && record.profile.privacySettings?.showAnimeList === false) {
    return res.status(403).json({
      error: 'ANIME_LIST_PRIVATE',
      message: 'Este usuário ocultou sua lista de animes.',
      animes: [],
      totalAnimes: 0,
    });
  }

  const view = socialStore.getAuthorizedProfileView(
    record.uid,
    caller.authenticated ? caller.uid ?? null : null,
    { offset, limit }
  );

  if (!view || !('animes' in view)) {
    return res.status(403).json({
      error: 'PRIVATE_PROFILE',
      animes: [],
      totalAnimes: 0,
    });
  }

  return res.json({
    animes: view.animes,
    totalAnimes: view.totalAnimes,
    hasMore: view.hasMoreAnimes,
    nextOffset: view.nextAnimeOffset,
  });
});

/**
 * POST /api/users/:targetId/follow
 * Authenticated follow / follow-back / follow-request action.
 */
socialRouter.post('/:targetId/follow', async (req: Request, res: Response) => {
  const targetId = String(req.params.targetId || '').trim();
  const caller = await verifyRequestUser(req);
  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: caller.reason || 'Autenticação obrigatória para seguir usuários.',
    });
  }

  if (caller.uid === targetId) {
    return res.status(400).json({ error: 'Você não pode seguir a própria conta.' });
  }

  try {
    const result = socialStore.followUser(
      caller.uid,
      targetId,
      req.body?.followerSummary,
      req.body?.targetSummary
    );
    const callerState = socialStore.getNotificationsState(caller.uid);
    return res.json({
      ok: true,
      status: result.status,
      isFollowBack: result.isFollowBack,
      targetFollowersCount: result.targetFollowersCount,
      deliveredNotificationId: result.deliveredNotification?.id ?? null,
      callerSocialState: callerState,
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Não foi possível seguir o usuário.',
    });
  }
});

/**
 * POST /api/users/:targetId/unfollow
 */
socialRouter.post('/:targetId/unfollow', async (req: Request, res: Response) => {
  const targetId = String(req.params.targetId || '').trim();
  const caller = await verifyRequestUser(req);
  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: caller.reason || 'Autenticação obrigatória.',
    });
  }

  const result = socialStore.unfollowUser(caller.uid, targetId);
  const callerState = socialStore.getNotificationsState(caller.uid);
  return res.json({
    ok: true,
    targetFollowersCount: result.targetFollowersCount,
    callerSocialState: callerState,
  });
});

/**
 * POST /api/users/follow-requests/:requestId/respond
 */
socialRouter.post('/follow-requests/:requestId/respond', async (req: Request, res: Response) => {
  const requestId = String(req.params.requestId || '').trim();
  const action = req.body?.action === 'accept' ? 'accept' : req.body?.action === 'reject' ? 'reject' : null;
  if (!action) {
    return res.status(400).json({ error: 'Ação inválida (use accept ou reject).' });
  }

  const caller = await verifyRequestUser(req);
  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    socialStore.respondToFollowRequest(caller.uid, requestId, action);
    return res.json({
      ok: true,
      ...socialStore.getNotificationsState(caller.uid),
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Erro ao processar solicitação.',
    });
  }
});

/**
 * GET /api/users/:userId/notifications
 * Strictly restricted to the verified owner of `userId`.
 */
socialRouter.get('/:userId/notifications', async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId || '').trim();
  const caller = await verifyRequestUser(req);

  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: caller.reason || 'Autenticação obrigatória para consultar notificações.',
    });
  }

  if (caller.uid !== targetUserId) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Acesso negado: notificações pertencem exclusivamente ao titular da conta.',
    });
  }

  return res.json(socialStore.getNotificationsState(caller.uid));
});

/**
 * POST /api/users/:userId/notifications/read
 * Marks one or all notifications as read exclusively for the verified owner.
 */
socialRouter.post('/:userId/notifications/read', async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId || '').trim();
  const caller = await verifyRequestUser(req);

  if (!caller.authenticated || !caller.uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  if (caller.uid !== targetUserId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const notificationId =
    typeof req.body?.notificationId === 'string' ? req.body.notificationId : undefined;
  const notificationIds = Array.isArray(req.body?.notificationIds)
    ? req.body.notificationIds.filter((id: unknown): id is string => typeof id === 'string')
    : undefined;
  const markAll = Boolean(req.body?.markAll);

  const updated = socialStore.markNotificationsRead(caller.uid, {
    notificationId,
    notificationIds,
    markAll,
  });

  return res.json({
    ok: true,
    ...updated,
  });
});
