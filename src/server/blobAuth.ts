import type { Request, Response, NextFunction } from 'express';
import { getAdminAuth, getFirebaseAdminStatus } from './firebaseAdmin.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  provider: 'better-auth' | 'firebase' | 'test';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface SessionVerificationOptions {
  adminAuthOverride?: {
    verifyIdToken: (token: string, checkRevoked?: boolean) => Promise<{ uid: string; email?: string }>;
  };
  betterAuthFetchOverride?: (
    url: string,
    init?: RequestInit
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  nowMs?: number;
}

/**
 * Extrai o token de sessão do cabeçalho Authorization, cabeçalhos customizados ou cookies
 */
export function extractSessionToken(req: Request): string | null {
  // 1. Cabeçalho Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      const token = match[1].trim();
      if (token) return token;
    }
  }

  // 2. Cabeçalho customizado x-session-token ou x-better-auth-session
  const customHeader = req.headers['x-session-token'] || req.headers['x-better-auth-session'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }

  // 3. Cookies padrão do Better Auth e de sessões web
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string' && cookieHeader.trim()) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, ...valParts] = cookie.split('=');
      const val = valParts.join('=').trim();
      if (!val) continue;

      const trimmedName = name.trim();
      if (
        trimmedName === 'better-auth.session_token' ||
        trimmedName === '__Secure-better-auth.session_token' ||
        trimmedName === 'session_token' ||
        trimmedName === 'hikari_session'
      ) {
        return decodeURIComponent(val);
      }
    }
  }

  return null;
}

/**
 * Valida a sessão do usuário com Firebase Admin SDK ou Better Auth.
 * Rejeita qualquer tentativa com token revogado, expirado ou inválido.
 * Não utiliza fallback permissivo.
 */
export async function verifyUserSession(
  token: string,
  options: SessionVerificationOptions = {}
): Promise<AuthenticatedUser | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const cleanToken = token.trim();
  if (!cleanToken) return null;

  const nowMs = options.nowMs ?? Date.now();

  // 1. Suporte estrito a tokens de teste (apenas em ambiente de testes ou desenvolvimento)
  if (
    process.env.NODE_ENV !== 'production' &&
    (cleanToken.startsWith('test_session_') ||
      cleanToken.startsWith('test_token_') ||
      cleanToken.startsWith('better_auth_session_'))
  ) {
    let uid = '';
    if (cleanToken.startsWith('test_session_')) {
      uid = cleanToken.slice('test_session_'.length).trim();
    } else if (cleanToken.startsWith('test_token_')) {
      uid = cleanToken.slice('test_token_'.length).trim();
    } else {
      uid = cleanToken.slice('better_auth_session_'.length).trim();
    }

    if (!uid) return null;

    return {
      uid,
      provider: 'test',
    };
  }

  // 2. Validação oficial de Firebase ID Token via Firebase Admin SDK com verificação de revogação
  if (cleanToken.includes('.') && cleanToken.split('.').length === 3) {
    // Se um resolvedor de teste para o Firebase Admin foi injetado (testes unitários isolados)
    if (options.adminAuthOverride) {
      try {
        const decoded = await options.adminAuthOverride.verifyIdToken(cleanToken, true);
        if (decoded && typeof decoded.uid === 'string' && decoded.uid.trim()) {
          return {
            uid: decoded.uid.trim(),
            email: decoded.email,
            provider: 'firebase',
          };
        }
        return null;
      } catch {
        // Token inválido, expirado ou revogado no Firebase Admin -> rejeita sem fallback
        return null;
      }
    }

    // Validação de produção / runtime com Firebase Admin SDK oficial
    const adminStatus = getFirebaseAdminStatus();
    if (!adminStatus.isConfigured) {
      // Firebase Admin não configurado com credenciais válidas no servidor -> rejeita a autenticação
      // Nunca permite bypass ou fallback permissivo
      return null;
    }

    try {
      const auth = getAdminAuth();
      // 'checkRevoked = true' verifica estritamente se o token foi revogado no Firebase
      const decoded = await auth.verifyIdToken(cleanToken, true);
      if (decoded && typeof decoded.uid === 'string' && decoded.uid.trim()) {
        return {
          uid: decoded.uid.trim(),
          email: decoded.email,
          provider: 'firebase',
        };
      }
      return null;
    } catch {
      // Falha na verificação: token expirado (auth/id-token-expired), revogado (auth/id-token-revoked) ou malformado
      return null;
    }
  }

  // 3. Validação com Better Auth (consulta ativa de sessão no servidor/banco)
  // Cookies opacos ou tokens de sessão Better Auth DEVEM ser consultados ativamente
  const betterAuthApiUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
  const fetchImpl = options.betterAuthFetchOverride ?? (typeof fetch !== 'undefined' ? fetch : null);

  // Se BETTER_AUTH_URL estiver ausente, rejeita com segurança
  if (!betterAuthApiUrl || !betterAuthApiUrl.trim()) {
    return null;
  }

  if (!fetchImpl) {
    return null;
  }

  try {
    const endpoint = `${betterAuthApiUrl.trim().replace(/\/+$/, '')}/api/auth/get-session`;
    const res = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Cookie: `better-auth.session_token=${cleanToken}`,
      },
    });

    if (!res.ok) {
      // Sessão inválida, revogada ou não encontrada no Better Auth
      return null;
    }

    const data = await res.json();
    const user = data?.user;
    const session = data?.session;

    // Confirma identidade e UID exclusivamente a partir dos dados retornados pelo Better Auth
    const uid = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!uid) {
      return null;
    }

    // Rejeita usuário banido ou inativo
    if (user?.banned === true) {
      return null;
    }

    // Verificação rigorosa de expiração da sessão ativa
    if (session?.expiresAt) {
      const expiresAtMs =
        typeof session.expiresAt === 'number'
          ? session.expiresAt
          : new Date(session.expiresAt).getTime();
      if (!Number.isNaN(expiresAtMs) && expiresAtMs <= nowMs) {
        // Sessão expirada
        return null;
      }
    }

    return {
      uid,
      email: typeof user?.email === 'string' ? user.email : undefined,
      provider: 'better-auth',
    };
  } catch {
    // Falha de rede ou de comunicação com o Better Auth -> rejeita com segurança
    return null;
  }
}

/**
 * Cria o middleware requireUserAuth com opções opcionais (para injeção em testes)
 */
export function createRequireUserAuthMiddleware(options: SessionVerificationOptions = {}) {
  return async function requireUserAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = extractSessionToken(req);

    if (!token) {
      res.status(401).json({
        error: 'Autenticação necessária. Sessão não encontrada ou não fornecida.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    const user = await verifyUserSession(token, options);
    if (!user || !user.uid) {
      res.status(401).json({
        error: 'Sessão inválida, expirada ou revogada. Faça login novamente.',
        code: 'INVALID_SESSION',
      });
      return;
    }

    // Validação estrita contra personificação (impersonation):
    const clientClaimedUid =
      (typeof req.body?.userId === 'string' && req.body.userId.trim()) ||
      (typeof req.query?.userId === 'string' && (req.query.userId as string).trim());

    if (clientClaimedUid && clientClaimedUid !== user.uid) {
      res.status(403).json({
        error: 'Tentativa de personificação detectada: o identificador enviado diverge da sessão autenticada.',
        code: 'IMPERSONATION_DETECTED',
      });
      return;
    }

    req.user = user;
    next();
  };
}

/**
 * Middleware Express padrão para proteção de rotas de mídia
 */
export const requireUserAuth = createRequireUserAuthMiddleware();
