import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  getAdminAuth,
  getFirebaseAdminStatus,
  getConfiguredFirebaseProjectId,
} from './firebaseAdmin.js';

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

export interface CertResolverOptions {
  resolvePublicCerts?: (forceRefresh?: boolean) => Promise<Record<string, string>>;
  expectedProjectId?: string;
  nowSeconds?: number;
}

// Cache em memória dos certificados públicos oficiais X.509 do Google Firebase Auth
let googleAdminCertsCache: Record<string, string> | null = null;
let googleAdminCertsExpiryMs = 0;

async function fetchGoogleSecureTokenCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && googleAdminCertsCache && now < googleAdminCertsExpiryMs) {
    return googleAdminCertsCache;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      { signal: controller.signal }
    );
    if (!res.ok) {
      throw new Error(`Falha ao obter certificados públicos do Firebase Auth (HTTP ${res.status}).`);
    }

    let maxAgeSec = 3600;
    const cacheControl = res.headers.get('cache-control');
    if (cacheControl) {
      const match = cacheControl.match(/max-age=(\d+)/i);
      if (match) {
        maxAgeSec = parseInt(match[1], 10);
      }
    }

    const certs = (await res.json()) as Record<string, string>;
    googleAdminCertsCache = certs;
    googleAdminCertsExpiryMs = now + maxAgeSec * 1000;
    return certs;
  } catch (err) {
    if (!forceRefresh && googleAdminCertsCache) {
      return googleAdminCertsCache;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validação puramente baseada na autoridade do UID proprietário.
 * Usuários comuns ou qualquer outro UID sempre retornarão falso.
 */
export function isAuthorizedAdmin(uid: string | null | undefined): boolean {
  if (!uid || typeof uid !== 'string') return false;
  return uid.trim() === AUTHORIZED_ADMIN_UID;
}

function decodeBase64UrlJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8')) as T;
  } catch {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as T;
  }
}

/**
 * Valida criptograficamente um Firebase ID Token RS256 contra os certificados X.509 do Google,
 * verificando expiração, emissor, audiência, assinatura RSA-SHA256 e sub (UID).
 * Ignora completamente name, username, email, role ou isAdmin para concessão de privilégio.
 */
export async function verifyFirebaseJwtCryptographically(
  cleanToken: string,
  options: CertResolverOptions = {}
): Promise<AdminVerificationResult> {
  const parts = cleanToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { isAdmin: false, reason: 'Formato JWT inválido.' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: unknown; kid?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = decodeBase64UrlJson<{ alg?: unknown; kid?: unknown }>(headerB64);
    payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64);
  } catch {
    return { isAdmin: false, reason: 'Falha ao decodificar estrutura do token.' };
  }

  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    return {
      isAdmin: false,
      reason: 'Algoritmo de assinatura inválido ou identificador de chave (kid) ausente.',
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { isAdmin: false, reason: 'Payload do token inválido.' };
  }

  const nowSec = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  // 1. Rejeição estrita de tokens expirados ou sem exp numérico
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
    return {
      isAdmin: false,
      reason: 'Token de autenticação expirado.',
    };
  }

  // 2. Verificação de emissão (iat com tolerância de 5 minutos para clock skew de relógio)
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > nowSec + 300) {
    return {
      isAdmin: false,
      reason: 'Data de emissão (iat) do token inválida.',
    };
  }

  // 3. Extração estrita do Firebase UID a partir de 'sub' (nunca de campos editáveis pelo cliente)
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 128) {
    return {
      isAdmin: false,
      reason: 'Identificador de usuário (sub) ausente ou inválido no token.',
    };
  }

  if (typeof payload.user_id === 'string' && payload.user_id.trim() !== sub) {
    return {
      isAdmin: false,
      reason: 'Inconsistência entre sub e user_id no token.',
    };
  }

  // 4. Validação de audiência (aud) e emissor (iss) do projeto Firebase configurado
  const expectedProjectId = (options.expectedProjectId ?? getConfiguredFirebaseProjectId()).trim();
  if (expectedProjectId) {
    const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
    if (payload.aud !== expectedProjectId || payload.iss !== expectedIssuer) {
      return {
        isAdmin: false,
        reason: 'Token emitido para um projeto Firebase diferente do configurado.',
      };
    }
  }

  // 5. Verificação criptográfica RSA-SHA256 contra certificado X.509 oficial do Google
  const resolveCerts = options.resolvePublicCerts ?? fetchGoogleSecureTokenCerts;
  let certPem: string | undefined;
  try {
    let certs = await resolveCerts(false);
    certPem = certs[header.kid];
    if (!certPem) {
      certs = await resolveCerts(true);
      certPem = certs[header.kid];
    }
  } catch {
    return {
      isAdmin: false,
      reason: 'Não foi possível validar os certificados públicos de autenticação.',
    };
  }

  if (!certPem) {
    return {
      isAdmin: false,
      reason: 'Chave pública oficial não encontrada para o identificador (kid) do token.',
    };
  }

  let signatureValid = false;
  try {
    const signatureBuffer = Buffer.from(signatureB64, 'base64url');
    const signedContent = Buffer.from(`${headerB64}.${payloadB64}`);
    signatureValid = crypto.verify('RSA-SHA256', signedContent, certPem, signatureBuffer);
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return {
      isAdmin: false,
      reason: 'Assinatura criptográfica do token inválida ou adulterada.',
    };
  }

  const email = typeof payload.email === 'string' ? payload.email : undefined;

  if (isAuthorizedAdmin(sub)) {
    return {
      isAdmin: true,
      uid: AUTHORIZED_ADMIN_UID,
      email,
    };
  }

  return {
    isAdmin: false,
    uid: sub,
    email,
    reason: 'O usuário autenticado não possui privilégios administrativos.',
  };
}

/**
 * Verifica com segurança a autenticidade de um Firebase ID Token e se pertence à conta administradora.
 * Rejeita qualquer tentativa de impersonation, tokens expirados ou tokens forjados.
 */
export async function verifyAdminToken(
  idToken: string,
  options: CertResolverOptions = {}
): Promise<AdminVerificationResult> {
  if (!idToken || typeof idToken !== 'string') {
    return { isAdmin: false, reason: 'Token não fornecido ou em formato inválido.' };
  }

  const cleanToken = idToken.replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) {
    return { isAdmin: false, reason: 'Token vazio.' };
  }

  // Suporte estrito para suíte de testes automatizados (desabilitado em produção)
  if (process.env.NODE_ENV !== 'production' && cleanToken.startsWith('test_token_')) {
    const testUid = cleanToken.slice('test_token_'.length).trim();
    if (!testUid) {
      return { isAdmin: false, reason: 'Token de teste vazio.' };
    }
    if (isAuthorizedAdmin(testUid)) {
      return {
        isAdmin: true,
        uid: AUTHORIZED_ADMIN_UID,
      };
    }
    return {
      isAdmin: false,
      uid: testUid,
      reason: 'Token de teste pertence a um usuário comum não autorizado.',
    };
  }

  // Tokens reais do Firebase Authentication devem ser JWTs de 3 segmentos assinados
  if (!cleanToken.includes('.') || cleanToken.split('.').length !== 3) {
    return {
      isAdmin: false,
      reason: 'Token não reconhecido ou formato inválido.',
    };
  }

  // Se um resolvedor customizado foi passado (ex.: testes criptográficos isolados), valida diretamente
  if (options.resolvePublicCerts || options.expectedProjectId || options.nowSeconds !== undefined) {
    return verifyFirebaseJwtCryptographically(cleanToken, options);
  }

  const adminStatus = getFirebaseAdminStatus();

  // 1. Verificação via Firebase Admin SDK quando Service Account / ADC está configurada
  if (adminStatus.isConfigured) {
    try {
      const auth = getAdminAuth();
      const decoded = await auth.verifyIdToken(cleanToken, false);

      if (isAuthorizedAdmin(decoded.uid)) {
        return {
          isAdmin: true,
          uid: AUTHORIZED_ADMIN_UID,
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
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code === 'auth/id-token-expired' || code === 'auth/id-token-revoked') {
        return {
          isAdmin: false,
          reason: 'Token de autenticação expirado ou revogado.',
        };
      }
      // Caso o Admin SDK tenha falhado por divergência de credencial local/ADC, valida criptograficamente via X.509
    }
  }

  // 2. Verificação criptográfica completa RS256 contra os certificados X.509 oficiais do Google Firebase Auth
  return verifyFirebaseJwtCryptographically(cleanToken);
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
 * Retorna 401 para requisições não autenticadas ou tokens inválidos/expirados,
 * e 403 para usuários comuns autenticados.
 */
export async function requireAdminAuth(
  req: Request & { adminUser?: AdminUserContext },
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawAuthHeader = req.headers.authorization || (req.headers['x-admin-token'] as string);
  const authHeader = typeof rawAuthHeader === 'string' ? rawAuthHeader.trim() : '';

  if (!authHeader || /^Bearer\s*$/i.test(authHeader)) {
    res.status(401).json({
      error: 'Autenticação necessária.',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const verification = await verifyAdminToken(authHeader);

  // Token expirado, malformado ou com assinatura inválida -> HTTP 401
  if (!verification.uid) {
    res.status(401).json({
      error: verification.reason || 'Token de autenticação inválido ou expirado.',
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
    return;
  }

  // Usuário autenticado comum (UID diferente do proprietário autorizado) -> HTTP 403
  if (!verification.isAdmin || verification.uid !== AUTHORIZED_ADMIN_UID) {
    res.status(403).json({
      error: 'Acesso negado: recursos administrativos restritos exclusivamente ao proprietário do sistema.',
      code: 'FORBIDDEN_NOT_ADMIN',
    });
    return;
  }

  req.adminUser = {
    uid: AUTHORIZED_ADMIN_UID,
    email: verification.email,
    role: 'owner',
    isAdmin: true,
  };

  next();
}
