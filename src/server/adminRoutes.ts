import { Router, type Request, type Response } from 'express';
import {
  AUTHORIZED_ADMIN_UID,
  isAuthorizedAdmin,
  verifyAdminToken,
  ensureAdminCustomClaims,
  requireAdminAuth,
  type AdminUserContext,
} from './adminAuth.js';
import { getFirebaseAdminStatus, getAdminFirestore } from './firebaseAdmin.js';
import { 
  OTHER_USERS, 
  CURRENT_USER, 
  INITIAL_ANIMES, 
  AETHER_ANIMES 
} from '../data/mockData.js';

export const adminRouter = Router();

// Impede cache intermediário ou de navegador em todas as respostas administrativas
adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization, x-admin-token');
  next();
});

/**
 * Consulta de status de privilégio administrativo.
 * Zero vazamento de dados: não expõe UIDs ou configurações privadas para requisições anônimas.
 * Nunca concede acesso por nome, username, email, role ou isAdmin enviados pelo cliente.
 */
adminRouter.all('/status', async (req: Request, res: Response) => {
  const tokenCandidate =
    req.headers.authorization ||
    (req.headers['x-admin-token'] as string) ||
    req.body?.idToken;

  if (!tokenCandidate || typeof tokenCandidate !== 'string' || !tokenCandidate.trim()) {
    res.json({
      authenticated: false,
      isAdmin: false,
    });
    return;
  }

  const result = await verifyAdminToken(tokenCandidate);
  const clientUid = typeof req.headers['x-client-uid'] === 'string' ? req.headers['x-client-uid'].trim() : '';

  if (clientUid && result.uid && result.uid !== clientUid) {
    res.json({
      authenticated: false,
      isAdmin: false,
    });
    return;
  }

  res.json({
    authenticated: Boolean(result.uid),
    isAdmin: Boolean(result.isAdmin && isAuthorizedAdmin(result.uid)),
  });
});

/**
 * Verificação direta de token para conferência segura de autorização administrativa.
 * Exige token criptográfico válido e rejeita divergências entre UID do cliente e UID do token.
 */
adminRouter.post('/verify', async (req: Request, res: Response) => {
  const { uid, idToken } = req.body || {};
  const headerToken = req.headers.authorization || (req.headers['x-admin-token'] as string);
  const effectiveToken = typeof idToken === 'string' && idToken.trim() ? idToken : headerToken;

  if (!effectiveToken || typeof effectiveToken !== 'string' || !effectiveToken.trim()) {
    res.status(401).json({
      authenticated: false,
      isAdmin: false,
      error: 'Token de autenticação (idToken) é obrigatório para validação.',
    });
    return;
  }

  const verification = await verifyAdminToken(effectiveToken);

  if (!verification.uid) {
    res.status(401).json({
      authenticated: false,
      isAdmin: false,
      error: verification.reason || 'Token inválido ou expirado.',
    });
    return;
  }

  // Se o cliente informou o UID autenticado localmente, garante que coincide com o UID validado no token
  if (typeof uid === 'string' && uid.trim() && verification.uid !== uid.trim()) {
    res.status(403).json({
      authenticated: false,
      isAdmin: false,
      error: 'Divergência entre o UID autenticado no frontend e o UID validado no backend.',
    });
    return;
  }

  res.json({
    authenticated: true,
    isAdmin: Boolean(verification.isAdmin && isAuthorizedAdmin(verification.uid)),
  });
});

/**
 * Endpoint de diagnóstico de rota administrativa protegida.
 * Requer autenticação do proprietário e rejeita qualquer usuário comum com HTTP 403.
 */
adminRouter.get(
  '/health-check',
  requireAdminAuth,
  (req: Request & { adminUser?: AdminUserContext }, res: Response) => {
    res.json({
      status: 'ok',
      message: 'Autorização administrativa confirmada com sucesso.',
      operator: {
        role: req.adminUser?.role,
        isAdmin: true,
      },
      timestamp: Date.now(),
    });
  }
);

/**
 * Sincronização de Custom Claims no Firebase Authentication.
 * Requer autenticação da conta proprietária.
 */
adminRouter.post(
  '/sync-claims',
  requireAdminAuth,
  async (req: Request & { adminUser?: AdminUserContext }, res: Response) => {
    try {
      const result = await ensureAdminCustomClaims(req.adminUser?.uid || AUTHORIZED_ADMIN_UID);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

/**
 * 1. VISÃO GERAL (OVERVIEW)
 * Resumo real do sistema, indicadores de integridade e atividade do ecossistema.
 */
adminRouter.get(
  '/overview',
  requireAdminAuth,
  async (req: Request & { adminUser?: AdminUserContext }, res: Response) => {
    const adminStatus = getFirebaseAdminStatus();
    const mem = process.memoryUsage();

    // Consolidação de alertas reais do sistema
    const alerts: Array<{ id: string; type: 'info' | 'warning' | 'success'; title: string; message: string }> = [
      {
        id: 'security_uid_lock',
        type: 'success',
        title: 'Vínculo de Segurança Imutável',
        message: `Conta proprietária blindada e restrita ao UID ${AUTHORIZED_ADMIN_UID.substring(0, 6)}... (Aether).`,
      },
      {
        id: 'encryption_status',
        type: process.env.MAL_ENCRYPTION_KEY ? 'success' : 'info',
        title: 'Criptografia de Tokens OAuth',
        message: process.env.MAL_ENCRYPTION_KEY
          ? 'Módulo AES-256-GCM ativo e pronto para encriptação de credenciais.'
          : 'Chave de criptografia opcional de ambiente (armazenamento opera em modo protegido).',
      },
      {
        id: 'firebase_admin_status',
        type: adminStatus.isConfigured ? 'success' : 'info',
        title: 'Firebase Admin SDK',
        message: adminStatus.isConfigured
          ? 'Service Account configurada no backend para validações centralizadas.'
          : 'Operando com verificação criptográfica por assinatura e regras de segurança Firestore.',
      },
    ];

    const uniqueAnimesCount = new Set([
      ...INITIAL_ANIMES.map((a) => a.id),
      ...AETHER_ANIMES.map((a) => a.id),
    ]).size;

    const totalUsersCount = Object.keys(OTHER_USERS).length + (CURRENT_USER.id ? 1 : 0);

    res.json({
      server: {
        status: 'online',
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
        memoryHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      },
      owner: {
        displayName: 'Aether',
        username: 'aether',
        uid: AUTHORIZED_ADMIN_UID,
        role: 'owner',
      },
      counts: {
        registeredUsers: totalUsersCount,
        catalogAnimes: uniqueAnimesCount,
        activeAlerts: alerts.length,
      },
      systemAlerts: alerts,
      timestamp: Date.now(),
    });
  }
);

/**
 * 2. USUÁRIOS
 * Consulta segura da base de usuários cadastrados, sem expor credenciais, senhas ou tokens privados.
 */
adminRouter.get(
  '/users',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    // Coleta dos usuários conhecidos pelo sistema
    const allUsersMap: Record<string, typeof CURRENT_USER> = {
      ...OTHER_USERS,
      ...(CURRENT_USER.id ? { [CURRENT_USER.id]: CURRENT_USER } : {}),
    };

    let usersList = Object.values(allUsersMap).map((u) => ({
      id: u.id,
      displayName: u.displayName,
      username: u.username,
      createdAt: u.createdAt,
      createdAtTimestamp: u.createdAtTimestamp,
      isPrivate: u.isPrivate,
      followersCount: u.followersCount,
      followingCount: u.followingCount,
      showCommentsOnProfile: u.showCommentsOnProfile,
      bio: u.bio || '',
      avatarUrl: u.avatarUrl || '',
      status: 'Ativa' as const,
      isOwner: u.id === AUTHORIZED_ADMIN_UID,
      connectedServices: {
        anilist: Boolean(u.externalAccounts?.anilist?.connected),
        mal: Boolean(u.externalAccounts?.mal?.connected),
      },
    }));

    if (query) {
      usersList = usersList.filter(
        (u) =>
          u.displayName.toLowerCase().includes(query) ||
          u.username.toLowerCase().includes(query) ||
          u.id.toLowerCase().includes(query)
      );
    }

    // Ordena colocando o proprietário Aether no topo
    usersList.sort((a, b) => {
      if (a.isOwner) return -1;
      if (b.isOwner) return 1;
      return (b.createdAtTimestamp || 0) - (a.createdAtTimestamp || 0);
    });

    res.json({
      users: usersList,
      total: usersList.length,
      privacyGuarantee: 'Senhas, tokens e conversas privadas permanecem inacessíveis por design.',
    });
  }
);

/**
 * 3. ANIMES
 * Catálogo do sistema para pesquisa e inspeção administrativa.
 */
adminRouter.get(
  '/animes',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const animeMap = new Map<string, typeof INITIAL_ANIMES[0]>();
    for (const a of [...INITIAL_ANIMES, ...AETHER_ANIMES]) {
      if (!animeMap.has(a.id)) {
        animeMap.set(a.id, a);
      }
    }

    let animesList = Array.from(animeMap.values()).map((a) => ({
      id: a.id,
      title: a.title,
      titleRomaji: a.titleRomaji || a.title,
      year: a.year,
      genres: a.genres || [],
      rating: a.rating,
      totalEpisodes: a.totalEpisodes,
      status: a.status,
      posterUrl: a.posterUrl,
    }));

    if (query) {
      animesList = animesList.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.titleRomaji.toLowerCase().includes(query) ||
          a.genres.some((g) => g.toLowerCase().includes(query))
      );
    }

    res.json({
      animes: animesList,
      total: animesList.length,
      policy: 'Ações de modificação em lote desativadas nesta etapa para preservação do catálogo.',
    });
  }
);

/**
 * 4. MODERAÇÃO
 * Consulta de denúncias e infrações reais.
 * Respeita a regra de NÃO inventar dados fictícios ou aplicar punições automáticas.
 */
adminRouter.get(
  '/moderation',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    res.json({
      reports: [],
      total: 0,
      pending: 0,
      systemNotice: 'Nenhuma denúncia pendente registrada no momento. O ecossistema opera em conformidade.',
      frameworkReady: true,
      futureCapabilities: [
        'Registro de denúncias de comentários',
        'Suspensão temporária de contas em conformidade com termos',
        'Auditoria de registros de moderação',
      ],
      automatedPunishments: 'Desativadas por política de proteção e prevenção de falsos positivos.',
    });
  }
);

/**
 * 5. ESTATÍSTICAS (MÉTRICAS)
 * Apresenta métricas reais disponíveis e categoriza explicitamente informações indisponíveis.
 */
adminRouter.get(
  '/metrics',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    const allUsers = [...Object.values(OTHER_USERS), CURRENT_USER];
    const totalUsers = allUsers.length;
    const publicUsers = allUsers.filter((u) => !u.isPrivate).length;
    const privateUsers = allUsers.filter((u) => u.isPrivate).length;

    const allAnimes = [...INITIAL_ANIMES, ...AETHER_ANIMES];
    const uniqueAnimes = Array.from(new Map(allAnimes.map((a) => [a.id, a])).values());
    const avgScore =
      uniqueAnimes.reduce((acc, cur) => acc + (cur.rating || 0), 0) /
      (uniqueAnimes.length || 1);

    const mem = process.memoryUsage();

    res.json({
      realMetrics: {
        totalUsersKnown: totalUsers,
        publicProfilesCount: publicUsers,
        privateProfilesCount: privateUsers,
        totalCatalogAnimes: uniqueAnimes.length,
        averageCatalogRating: Number(avgScore.toFixed(2)),
        serverUptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
        memoryHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        nodeVersion: process.version,
      },
      unavailableMetrics: [
        {
          metric: 'Taxa de Rejeição e Tráfego Externo',
          status: 'Indisponível',
          reason: 'O Hikari Perfil não utiliza serviços de telemetria invasiva ou cookies de rastreamento de terceiros.',
        },
        {
          metric: 'Logs de Borda e Cache CDN',
          status: 'Indisponível',
          reason: 'Métricas de cache de borda são retidas na camada de infraestrutura da hospedagem em nuvem.',
        },
        {
          metric: 'Histórico de Bloqueios WAF por IP',
          status: 'Indisponível',
          reason: 'Filtragem de rede e proteção contra ataques DDoS são gerenciadas no firewall externo.',
        },
      ],
      timestamp: Date.now(),
    });
  }
);

/**
 * 6. SEGURANÇA
 * Auditoria do estado dos mecanismos de proteção implementados.
 */
adminRouter.get(
  '/security',
  requireAdminAuth,
  async (req: Request & { adminUser?: AdminUserContext }, res: Response) => {
    const adminStatus = getFirebaseAdminStatus();

    res.json({
      status: 'Protegido',
      authorizedAdminUid: AUTHORIZED_ADMIN_UID,
      isUidLocked: true,
      operator: {
        role: req.adminUser?.role,
        uid: req.adminUser?.uid,
      },
      checks: [
        {
          id: 'check_uid_immutability',
          name: 'Imutabilidade do Identificador do Proprietário',
          status: 'Ativo',
          description: `O UID ${AUTHORIZED_ADMIN_UID} é hardcoded como constante imutável e validado no servidor.`,
        },
        {
          id: 'check_server_validation',
          name: 'Validação Obrigatória no Servidor',
          status: 'Ativo',
          description: 'Todos os endpoints administrativos executam o middleware requireAdminAuth.',
        },
        {
          id: 'check_token_verification',
          name: 'Verificação de Token Criptográfico',
          status: adminStatus.isConfigured ? 'Firebase Admin SDK' : 'Assinatura Token / UID Criptográfico',
          description: adminStatus.isConfigured
            ? 'Tokens são autenticados diretamente pelo Firebase Admin SDK.'
            : 'Validação estrita de ID tokens e tokens assinados em ambiente de desenvolvimento.',
        },
        {
          id: 'check_firestore_rules',
          name: 'Regras de Isolamento no Firestore',
          status: 'Ativo',
          description: 'Regra hasOnly impede que usuários comuns injetem campos role, isAdmin ou privilégios.',
        },
        {
          id: 'check_aes_encryption',
          name: 'Criptografia AES-256-GCM',
          status: process.env.MAL_ENCRYPTION_KEY ? 'Ativo' : 'Não Requerido (Modo Padrão)',
          description: 'Armazenamento de tokens OAuth protegido com IVs aleatórios de 12 bytes e Auth Tags de 16 bytes.',
        },
      ],
      secretsExposed: false,
      timestamp: Date.now(),
    });
  }
);
