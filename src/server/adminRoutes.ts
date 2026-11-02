import { Router, type Request, type Response } from 'express';
import {
  AUTHORIZED_ADMIN_UID,
  isAuthorizedAdmin,
  verifyAdminToken,
  ensureAdminCustomClaims,
  requireAdminAuth,
  type AdminUserContext,
} from './adminAuth.js';

export const adminRouter = Router();

/**
 * Consulta de status de privilégio administrativo.
 * Zero vazamento de dados: não expõe UIDs ou configurações privadas para requisições anônimas.
 */
adminRouter.get('/status', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || (req.headers['x-admin-token'] as string);

  if (!authHeader) {
    res.json({
      authenticated: false,
      isAdmin: false,
    });
    return;
  }

  const result = await verifyAdminToken(authHeader);

  res.json({
    authenticated: Boolean(result.uid),
    isAdmin: result.isAdmin,
  });
});

/**
 * Verificação direta de UID ou token para conferência segura de autorização.
 */
adminRouter.post('/verify', async (req: Request, res: Response) => {
  const { uid, idToken } = req.body || {};

  // Se token foi fornecido, verifica criptograficamente
  if (idToken && typeof idToken === 'string') {
    const verification = await verifyAdminToken(idToken);
    res.json({
      isAdmin: verification.isAdmin,
      authenticated: Boolean(verification.uid),
    });
    return;
  }

  // Se apenas o UID foi consultado, verifica estritamente contra o identificador proprietário
  if (uid && typeof uid === 'string') {
    res.json({
      isAdmin: isAuthorizedAdmin(uid),
      authenticated: true,
    });
    return;
  }

  res.status(400).json({
    error: 'Parâmetro uid ou idToken é obrigatório para validação.',
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
