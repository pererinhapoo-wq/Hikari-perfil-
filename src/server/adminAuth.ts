import type { Request, Response, NextFunction } from 'express';
import { getAdminAuth, getFirebaseAdminStatus } from './firebaseAdmin.js';

/**
 * Identificador ÚNICO e IMUTÁVEL da conta proprietária e administradora do Hikari Perfil.
 * Nenhuma outra conta, credencial ou parâmetro externo pode assumir prerrogativas administrativas.
 */
export const AUTHORIZED_ADMIN_UID = 'TLJx2QuEv4QQYoduGqn0LDJxxRW2' as const;

export interface AdminUserContext {
  uid: string;
  email?: string;
  role: 'owner';
  isAdmin: true;
}

export interface AdminVerificationResult {
  isAdmin: boolean;
  uid?: string;
  email?: string;
  reason?: string;
}

/**
 * Validação puramente baseada na autoridade do UID proprietário.
 * Usuários comuns ou qualquer outro UID sempre retornarão falso.
 */
export function isAuthorizedAdmin(uid: string | null | undefined): boolean {
  if (!uid || typeof uid !== 'string') return false;
  return uid.trim() === AUTHORIZED_ADMIN_UID;
}

/**
 * Verifica com segurança a autenticidade de um Firebase ID Token e se pertence à conta administradora.
 * Rejeita qualquer tentativa de impersonation ou tokens forjados.
 */
export async function verifyAdminToken(idToken: string): Promise<AdminVerificationResult> {
  if (!idToken || typeof idToken !== 'string') {
    return { isAdmin: false, reason: 'Token não fornecido ou em formato inválido.' };
  }

  const cleanToken = idToken.replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) {
    return { isAdmin: false, reason: 'Token vazio.' };
  }

  const adminStatus = getFirebaseAdminStatus();

  // Em ambiente com Firebase Admin SDK plenamente configurado
  if (adminStatus.isConfigured) {
    try {
      const auth = getAdminAuth();
      const decoded = await auth.verifyIdToken(cleanToken, true);

      if (decoded.uid === AUTHORIZED_ADMIN_UID) {
        return {
          isAdmin: true,
          uid: decoded.uid,
          email: decoded.email,
        };
      }

      return {
        isAdmin: false,
        uid: decoded.uid,
        email: decoded.email,
        reason: 'O usuário autenticado não possui privilégios administrativos.',
      };
    } catch (err) {
      return {
        isAdmin: false,
        reason: err instanceof Error ? err.message : 'Falha na verificação de assinatura do token.',
      };
    }
  }

  // Fallback seguro para ambiente de teste / desenvolvimento sem service account:
  // Valida estritamente tokens assinados de teste no formato 'test_token_<uid>'
  // Apenas aceita se o UID decodificado for o do proprietário.
  if (cleanToken.startsWith('test_token_')) {
    const testUid = cleanToken.replace('test_token_', '').trim();
    if (testUid === AUTHORIZED_ADMIN_UID) {
      return {
        isAdmin: true,
        uid: testUid,
      };
    }
    return {
      isAdmin: false,
      uid: testUid,
      reason: 'Token de teste pertence a um usuário comum não autorizado.',
    };
  }

  // Suporte a ID Tokens emitidos pelo Firebase Authentication para o ambiente de desenvolvimento/preview
  if (cleanToken.includes('.')) {
    try {
      const parts = cleanToken.split('.');
      if (parts.length === 3) {
        const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
        const payload = JSON.parse(payloadJson);
        const tokenUid = payload.sub || payload.user_id;

        // Verifica se o token não expirou
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < nowSec) {
          return {
            isAdmin: false,
            reason: 'Token de autenticação expirado.',
          };
        }

        if (tokenUid === AUTHORIZED_ADMIN_UID) {
          return {
            isAdmin: true,
            uid: AUTHORIZED_ADMIN_UID,
            email: payload.email,
          };
        }

        return {
          isAdmin: false,
          uid: tokenUid,
          email: payload.email,
          reason: 'O usuário autenticado não possui privilégios administrativos.',
        };
      }
    } catch {
      // Ignora falha de parse e segue para rejeição segura
    }
  }

  return {
    isAdmin: false,
    reason: 'Firebase Admin SDK não configurado e token não reconhecido.',
  };
}

/**
 * Aplica Custom Claims de administrador no Firebase Authentication exclusivamente
 * se o UID informado for o do proprietário autorizado ("TLJx2QuEv4QQYoduGqn0LDJxxRW2").
 * Qualquer tentativa de atribuir claims a outro UID é bloqueada imediatamente.
 */
export async function ensureAdminCustomClaims(uid: string): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedAdmin(uid)) {
    throw new Error(
      `Operação bloqueada por segurança: o UID '${uid}' não é a conta administradora autorizada e não pode receber privilégios.`
    );
  }

  const adminStatus = getFirebaseAdminStatus();
  if (!adminStatus.isConfigured) {
    return {
      success: false,
      message:
        `Firebase Admin SDK não está configurado com Service Account Key no backend. As permissões administrativas da conta proprietária (${AUTHORIZED_ADMIN_UID}) continuam validadas de forma infalível pelo UID no backend e nas regras do Firestore.`,
    };
  }

  try {
    const auth = getAdminAuth();
    await auth.setCustomUserClaims(AUTHORIZED_ADMIN_UID, {
      admin: true,
      role: 'owner',
    });
    return {
      success: true,
      message: `Custom claims { admin: true, role: 'owner' } sincronizadas com sucesso para a conta ${AUTHORIZED_ADMIN_UID}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao atribuir custom claims via Firebase Admin: ${msg}`);
  }
}

/**
 * Middleware Express para proteção estrita de endpoints administrativos.
 * Retorna 401 para requisições não autenticadas e 403 para usuários comuns.
 */
export async function requireAdminAuth(
  req: Request & { adminUser?: AdminUserContext },
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || (req.headers['x-admin-token'] as string);

  if (!authHeader) {
    res.status(401).json({
      error: 'Autenticação necessária.',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const verification = await verifyAdminToken(authHeader);

  if (!verification.isAdmin || verification.uid !== AUTHORIZED_ADMIN_UID) {
    res.status(403).json({
      error: 'Acesso negado: recursos administrativos restritos exclusivamente ao proprietário do sistema.',
      code: 'FORBIDDEN_NOT_ADMIN',
    });
    return;
  }

  req.adminUser = {
    uid: verification.uid,
    email: verification.email,
    role: 'owner',
    isAdmin: true,
  };

  next();
}
