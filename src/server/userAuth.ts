import type { Request } from 'express';
import { getAdminAuth, getFirebaseAdminStatus } from './firebaseAdmin.js';
import { verifyFirebaseJwtCryptographically } from './adminAuth.js';
import { CURRENT_USER, OTHER_USERS } from '../data/mockData.js';

export interface VerifiedCallerResult {
  authenticated: boolean;
  uid?: string;
  email?: string;
  hadAuthHeader: boolean;
  errorCode?: 'INVALID_TOKEN' | 'EXPIRED_TOKEN';
  reason?: string;
}

const VALID_UID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

const DEMO_MOCK_UIDS = new Set<string>([
  CURRENT_USER.id,
  ...Object.keys(OTHER_USERS),
]);

/**
 * Checks whether an ID belongs strictly to the built-in offline Demo Mode catalog.
 * Real Firebase user accounts never match these static mock IDs.
 */
export function isDemoMockUserId(userId: string | null | undefined): boolean {
  if (!userId || typeof userId !== 'string') return false;
  return DEMO_MOCK_UIDS.has(userId.trim());
}

/**
 * Verifies a Firebase ID token for any non-anonymous user account using:
 * 1. Controlled synthetic test token (`test_token_<uid>`) strictly outside production (`NODE_ENV !== 'production'`).
 * 2. Firebase Admin SDK (`verifyIdToken`) when configured.
 * 3. Cryptographic RS256 verification against official Google SecureToken X.509 certificates.
 *
 * Never trusts unverified client headers (`x-client-uid`) or query/body `userId`.
 */
export async function verifyAuthenticatedUserToken(
  rawHeaderOrToken: string | undefined | null
): Promise<VerifiedCallerResult> {
  if (!rawHeaderOrToken || typeof rawHeaderOrToken !== 'string') {
    return { authenticated: false, hadAuthHeader: false };
  }

  const trimmedHeader = rawHeaderOrToken.trim();
  if (!trimmedHeader) {
    return { authenticated: false, hadAuthHeader: false };
  }

  const cleanToken = trimmedHeader.replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) {
    return {
      authenticated: false,
      hadAuthHeader: true,
      errorCode: 'INVALID_TOKEN',
      reason: 'Cabeçalho Authorization vazio ou malformado.',
    };
  }

  // Strictly isolated automated test support (disabled in production)
  if (process.env.NODE_ENV !== 'production' && cleanToken.startsWith('test_token_')) {
    const testUid = cleanToken.slice('test_token_'.length).trim();
    if (!testUid || !VALID_UID_REGEX.test(testUid)) {
      return {
        authenticated: false,
        hadAuthHeader: true,
        errorCode: 'INVALID_TOKEN',
        reason: 'Identificador de token de teste inválido.',
      };
    }
    return {
      authenticated: true,
      uid: testUid,
      email: `${testUid}@test.hikari.local`,
      hadAuthHeader: true,
    };
  }

  // 1. Firebase Admin SDK verification when service account is available
  if (getFirebaseAdminStatus().isConfigured) {
    try {
      const adminAuth = getAdminAuth();
      const decoded = await adminAuth.verifyIdToken(cleanToken, true);
      if (!decoded || !decoded.uid || !VALID_UID_REGEX.test(decoded.uid)) {
        return {
          authenticated: false,
          hadAuthHeader: true,
          errorCode: 'INVALID_TOKEN',
          reason: 'Token sem UID válido.',
        };
      }
      if (decoded.firebase?.sign_in_provider === 'anonymous') {
        return {
          authenticated: false,
          hadAuthHeader: true,
          errorCode: 'INVALID_TOKEN',
          reason: 'Sessões anônimas não têm permissão para acessar dados de conta.',
        };
      }
      return {
        authenticated: true,
        uid: decoded.uid,
        email: decoded.email,
        hadAuthHeader: true,
      };
    } catch {
      return {
        authenticated: false,
        hadAuthHeader: true,
        errorCode: 'INVALID_TOKEN',
        reason: 'Token Firebase inválido, expirado ou revogado.',
      };
    }
  }

  // 2. Cryptographic RS256 verification against Google X.509 public certs (works without service account)
  const cryptoVerified = await verifyFirebaseJwtCryptographically(cleanToken);
  if (cryptoVerified.uid && VALID_UID_REGEX.test(cryptoVerified.uid)) {
    return {
      authenticated: true,
      uid: cryptoVerified.uid,
      email: cryptoVerified.email,
      hadAuthHeader: true,
    };
  }

  return {
    authenticated: false,
    hadAuthHeader: true,
    errorCode: 'INVALID_TOKEN',
    reason: cryptoVerified.reason || 'Assinatura ou formato do token inválido.',
  };
}

/**
 * Extracts and verifies the authenticated caller from an Express request.
 */
export async function verifyRequestUser(req: Request): Promise<VerifiedCallerResult> {
  const rawAuth = req.headers.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  return verifyAuthenticatedUserToken(authHeader);
}
