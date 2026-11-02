import express from 'express';
import crypto from 'node:crypto';
import { getFirebaseAdminStatus, getAdminFirestore } from './firebaseAdmin.js';
import { parseAndValidateKey } from './crypto.js';
import {
  createOAuthHandshake,
  consumeOAuthHandshakeAtomic,
  saveUserMALIntegration,
  getUserMALIntegration,
  deleteUserMALIntegration,
  getValidUserAccessToken,
  refreshUserMALTokens,
  type OAuthHandshakeRecord,
  type MinimalFirestore,
} from './malStore.js';

// Cache em memória para certificados públicos x509 do Google Firebase Auth
let googleCertsCache: Record<string, string> | null = null;
let googleCertsCacheExpiry = 0;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (googleCertsCache && now < googleCertsCacheExpiry) {
    return googleCertsCache;
  }

  try {
    const res = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
    );
    if (!res.ok) {
      throw new Error(`Falha ao obter chaves públicas do Google (HTTP ${res.status})`);
    }
    const cacheControl = res.headers.get('cache-control');
    let maxAge = 3600;
    if (cacheControl) {
      const match = cacheControl.match(/max-age=(\d+)/i);
      if (match) {
        maxAge = parseInt(match[1], 10);
      }
    }
    const certs: Record<string, string> = await res.json();
    googleCertsCache = certs;
    googleCertsCacheExpiry = now + maxAge * 1000;
    return certs;
  } catch (err) {
    if (googleCertsCache) {
      return googleCertsCache;
    }
    throw err;
  }
}

interface FirebaseTokenPayload {
  iss: string;
  aud: string;
  auth_time: number;
  user_id: string;
  sub: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
}

/**
 * Valida criptograficamente o Firebase ID Token RS256 contra as chaves públicas oficiais do Google.
 */
export async function verifyFirebaseIdToken(
  rawToken: string
): Promise<{ uid: string; email?: string }> {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Token não fornecido.');
  }

  const parts = rawToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Formato JWT inválido.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg: string; kid?: string };
  let payload: FirebaseTokenPayload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    throw new Error('Falha ao decodificar partes do token.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Algoritmo do token inválido ou kid ausente.');
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Verificação de expiração (exp)
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) {
    throw new Error('Token expirado.');
  }

  // 2. Verificação de emissão (iat com 5 minutos de tolerância para clock skew)
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Token emitido no futuro.');
  }

  // 3. Verificação do Subject (sub = Firebase UID)
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Identificador de usuário (sub) ausente no token.');
  }

  // 4. Verificação de aud e iss com base no Project ID
  const expectedProjectId =
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    'hikari-user-profiles';

  if (expectedProjectId) {
    if (payload.aud !== expectedProjectId) {
      throw new Error(`Audience incompatível: esperado ${expectedProjectId}, recebido ${payload.aud}`);
    }
    const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
    if (payload.iss !== expectedIssuer) {
      throw new Error(`Issuer incompatível: esperado ${expectedIssuer}, recebido ${payload.iss}`);
    }
  }

  // 5. Validação da assinatura criptográfica RS256 com a chave pública do Google
  let certs = await getGooglePublicCerts();
  let cert = certs[header.kid];
  if (!cert) {
    googleCertsCacheExpiry = 0;
    certs = await getGooglePublicCerts();
    cert = certs[header.kid];
  }

  if (!cert) {
    throw new Error(`Chave pública oficial do Google não encontrada para kid: ${header.kid}`);
  }

  const signatureBuffer = Buffer.from(signatureB64, 'base64url');
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
  const isValid = crypto.verify('RSA-SHA256', signedData, cert, signatureBuffer);

  if (!isValid) {
    throw new Error('Assinatura do token inválida.');
  }

  return {
    uid: payload.sub,
    email: payload.email,
  };
}

export interface AuthenticatedExpressRequest extends express.Request {
  firebaseUser?: {
    uid: string;
    email?: string;
  };
}

/**
 * Middleware para exigir e validar o Firebase ID Token no cabeçalho Authorization: Bearer <token>.
 */
export async function requireFirebaseAuth(
  req: AuthenticatedExpressRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Token de autenticação do Firebase ausente no cabeçalho Authorization.',
    });
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].trim()) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Formato do cabeçalho inválido. Utilize o formato: Authorization: Bearer <token>.',
    });
  }

  const token = match[1].trim();
  try {
    const verified = await verifyFirebaseIdToken(token);
    req.firebaseUser = verified;
    next();
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Falha na validação';
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: `Autenticação rejeitada: ${reason}`,
    });
  }
}

export interface SecureStorageContext {
  isAvailable: boolean;
  error?: string;
  db?: MinimalFirestore;
  encryptionKey?: Buffer;
}

export function getSecureStorageContext(): SecureStorageContext {
  const adminStatus = getFirebaseAdminStatus();
  if (!adminStatus.isConfigured) {
    return {
      isAvailable: false,
      error:
        'Armazenamento seguro não configurado: ' +
        (adminStatus.errorMessage || 'FIREBASE_SERVICE_ACCOUNT_KEY ausente no servidor.'),
    };
  }

  const rawKey = process.env.MAL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!rawKey) {
    return {
      isAvailable: false,
      error:
        'Armazenamento seguro não configurado: MAL_TOKEN_ENCRYPTION_KEY ausente no ambiente do servidor.',
    };
  }

  try {
    const keyBuf = parseAndValidateKey(rawKey);
    const db = getAdminFirestore();
    return {
      isAvailable: true,
      db,
      encryptionKey: keyBuf,
    };
  } catch (err) {
    return {
      isAvailable: false,
      error:
        'Chave de criptografia inválida: ' +
        (err instanceof Error ? err.message : String(err)),
    };
  }
}

export const malRouter = express.Router();

// 1. GET /config — Retorna status de configuração das variáveis de ambiente e armazenamento seguro
malRouter.get('/config', (req, res) => {
  const clientId = process.env.MAL_CLIENT_ID?.trim();
  const canonicalBaseUrl = process.env.APP_BASE_URL?.trim();
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const fallbackBaseUrl = `${protocol}://${host}`;
  const effectiveBaseUrl = canonicalBaseUrl ? canonicalBaseUrl.replace(/\/+$/, '') : fallbackBaseUrl;
  const redirectUri = `${effectiveBaseUrl}/api/mal/callback`;
  const storageCtx = getSecureStorageContext();

  res.json({
    configured: Boolean(clientId && storageCtx.isAvailable),
    clientIdConfigured: Boolean(clientId),
    storageConfigured: Boolean(storageCtx.isAvailable),
    storageError: storageCtx.isAvailable ? undefined : storageCtx.error,
    redirectUri,
  });
});

// 2. GET /auth-url — Gera o par de chaves PKCE e registra handshake com expiração de 15 min no Firestore
malRouter.get('/auth-url', requireFirebaseAuth, async (req: AuthenticatedExpressRequest, res) => {
  const clientId = process.env.MAL_CLIENT_ID?.trim();
  if (!clientId) {
    return res.status(400).json({
      error: 'MAL_NOT_CONFIGURED',
      message:
        'A variável de ambiente MAL_CLIENT_ID não está configurada no servidor (.env). Obtenha um Client ID no portal do desenvolvedor do MyAnimeList para habilitar a conexão real.',
    });
  }

  const storageCtx = getSecureStorageContext();
  if (!storageCtx.isAvailable || !storageCtx.db) {
    return res.status(503).json({
      error: 'STORAGE_CONFIG_MISSING',
      message: storageCtx.error || 'Armazenamento seguro não configurado no servidor.',
    });
  }

  const uid = req.firebaseUser!.uid;

  const canonicalBaseUrl = process.env.APP_BASE_URL?.trim();
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const serverOrigin = canonicalBaseUrl ? canonicalBaseUrl.replace(/\/+$/, '') : `${protocol}://${host}`;

  let trustedOrigin = serverOrigin;
  const originHeader = req.get('origin');
  if (originHeader) {
    try {
      const parsedOrigin = new URL(originHeader).origin;
      if (parsedOrigin.startsWith('http://') || parsedOrigin.startsWith('https://')) {
        trustedOrigin = parsedOrigin;
      }
    } catch {
      trustedOrigin = serverOrigin;
    }
  }

  const clientRedirectUri =
    typeof req.query.redirect_uri === 'string' && req.query.redirect_uri.trim()
      ? req.query.redirect_uri.trim()
      : undefined;

  const defaultRedirectUri = `${serverOrigin}/api/mal/callback`;
  let redirectUri = defaultRedirectUri;

  // Validação estrita para impedir redirecionamentos arbitrários
  if (clientRedirectUri) {
    try {
      const parsedRedirect = new URL(clientRedirectUri);
      const isCallbackPath =
        parsedRedirect.pathname === '/api/mal/callback' ||
        parsedRedirect.pathname === '/api/mal/callback/' ||
        parsedRedirect.pathname === '/mal/callback' ||
        parsedRedirect.pathname === '/mal/callback/';

      const isAllowedOrigin =
        parsedRedirect.origin === trustedOrigin ||
        parsedRedirect.origin === serverOrigin;

      if (isCallbackPath && isAllowedOrigin) {
        redirectUri = clientRedirectUri;
      }
    } catch {
      redirectUri = defaultRedirectUri;
    }
  }

  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  try {
    await createOAuthHandshake(storageCtx.db, {
      state,
      codeVerifier,
      uid,
      trustedOrigin,
      redirectUri,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'HANDSHAKE_CREATION_FAILED',
      message: 'Falha ao registrar sessão de autorização segura.',
    });
  }

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    code_challenge: codeVerifier,
    code_challenge_method: 'plain',
    state,
    redirect_uri: redirectUri,
  });

  const authUrl = `https://myanimelist.net/v1/oauth2/authorize?${authParams.toString()}`;

  res.json({
    url: authUrl,
    state,
  });
});

// 3. GET /callback — Callback de autorização do MAL (Consome handshake atomicamente, troca code por token e persiste com AES-256-GCM)
malRouter.get(['/callback', '/callback/'], async (req, res) => {
  const { code, state, error } = req.query;

  const canonicalBaseUrl = process.env.APP_BASE_URL?.trim();
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const defaultOrigin = canonicalBaseUrl ? canonicalBaseUrl.replace(/\/+$/, '') : `${protocol}://${host}`;
  let targetOrigin = defaultOrigin;

  const renderPopupResult = (
    result:
      | { success: true; username: string; avatarUrl: string }
      | { success: false; message: string }
  ) => {
    const postData = result.success
      ? {
          type: 'MAL_AUTH_SUCCESS',
          username: result.username,
          avatarUrl: result.avatarUrl,
        }
      : {
          type: 'MAL_AUTH_ERROR',
          message: result.message,
        };

    const displayTitle = result.success ? 'Conexão Realizada!' : 'Erro de Autorização';
    const displayMessage = result.success
      ? `Conta @${result.username} autorizada com sucesso!`
      : result.message;
    const titleColor = result.success ? '#a855f7' : '#f43f5e';

    const escapeHtml = (text: string) =>
      text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>MyAnimeList — Autorização</title>
    <style>
      body {
        background: #0A0713;
        color: #EDE8F5;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        padding: 24px;
        text-align: center;
      }
      .card {
        background: #130E24;
        border: 1px solid #3b2d54;
        border-radius: 16px;
        padding: 24px;
        max-width: 380px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }
      h2 { margin-top: 0; font-size: 16px; color: ${titleColor}; }
      p { font-size: 13px; color: #EDE8F5; opacity: 0.85; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${escapeHtml(displayTitle)}</h2>
      <p id="status-msg">${escapeHtml(displayMessage)}</p>
      <p style="font-size: 11px; opacity: 0.6; margin-top: 16px;">Esta janela será fechada automaticamente...</p>
    </div>
    <script>
      (function() {
        var postData = ${JSON.stringify(postData)};
        var targetOrigin = ${JSON.stringify(targetOrigin)};
        var messageDispatched = false;

        function notifyOpenerAndClose() {
          if (messageDispatched) return;
          messageDispatched = true;

          if (window.opener && !window.opener.closed) {
            try {
              window.opener.postMessage(postData, targetOrigin);
            } catch (err) {
              console.error('Falha ao comunicar com a janela principal:', err);
            }
          }

          setTimeout(function() {
            try {
              window.close();
            } catch (err) {}
          }, 600);
        }

        notifyOpenerAndClose();
      })();
    </script>
  </body>
</html>`);
  };

  if (error) {
    const isDenied = error === 'access_denied';
    const message = isDenied
      ? 'Autorização cancelada ou recusada no MyAnimeList.'
      : 'Não foi possível concluir a autorização no MyAnimeList.';
    return renderPopupResult({ success: false, message });
  }

  if (typeof code !== 'string' || typeof state !== 'string') {
    return renderPopupResult({
      success: false,
      message: 'Parâmetros de autorização inválidos ou ausentes na resposta do MyAnimeList.',
    });
  }

  const storageCtx = getSecureStorageContext();
  if (!storageCtx.isAvailable || !storageCtx.db || !storageCtx.encryptionKey) {
    return renderPopupResult({
      success: false,
      message: storageCtx.error || 'Armazenamento seguro não configurado no servidor.',
    });
  }

  let handshake: OAuthHandshakeRecord | null = null;
  try {
    handshake = await consumeOAuthHandshakeAtomic(storageCtx.db, state);
  } catch {
    return renderPopupResult({
      success: false,
      message: 'Erro ao validar a sessão de autorização no banco de dados.',
    });
  }

  if (!handshake || !handshake.uid) {
    return renderPopupResult({
      success: false,
      message: 'Sessão de autorização expirada, inválida ou já utilizada. Tente novamente.',
    });
  }

  try {
    targetOrigin = new URL(handshake.trustedOrigin).origin;
  } catch {
    targetOrigin = defaultOrigin;
  }

  const clientId = process.env.MAL_CLIENT_ID?.trim();
  const clientSecret = process.env.MAL_CLIENT_SECRET?.trim() || '';

  if (!clientId) {
    return renderPopupResult({
      success: false,
      message: 'Serviço do MyAnimeList não configurado no servidor.',
    });
  }

  try {
    const defaultRedirectUri = `${defaultOrigin}/api/mal/callback`;
    const effectiveRedirectUri =
      typeof handshake.redirectUri === 'string' && handshake.redirectUri.trim()
        ? handshake.redirectUri.trim()
        : defaultRedirectUri;

    const tokenBody = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: handshake.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: effectiveRedirectUri,
    });

    if (clientSecret) {
      tokenBody.append('client_secret', clientSecret);
    }

    const tokenRes = await fetch('https://myanimelist.net/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    });

    let tokenData: any = {};
    const rawContentType = tokenRes.headers.get('content-type') || '';
    if (rawContentType.includes('application/json')) {
      try {
        tokenData = await tokenRes.json();
      } catch {
        tokenData = {};
      }
    } else {
      try {
        await tokenRes.text();
      } catch {
        // ignore
      }
    }

    if (!tokenRes.ok || !tokenData.access_token) {
      const safeErrorCode = typeof tokenData.error === 'string' ? tokenData.error : undefined;
      const safeErrorMessage =
        typeof tokenData.message === 'string'
          ? tokenData.message
          : typeof tokenData.hint === 'string'
          ? tokenData.hint
          : undefined;

      console.error('[MAL OAuth Token Exchange Error]', {
        status: tokenRes.status,
        statusText: tokenRes.statusText,
        error: safeErrorCode || (rawContentType.includes('application/json') ? 'UNKNOWN_JSON_ERROR' : 'NON_JSON_RESPONSE'),
        message: safeErrorMessage,
      });

      return renderPopupResult({
        success: false,
        message: 'Falha ao autenticar com o MyAnimeList. Verifique a autorização e tente novamente.',
      });
    }

    const userRes = await fetch('https://api.myanimelist.net/v2/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userRes.json();
    if (!userRes.ok || !userData.name || typeof userData.name !== 'string') {
      return renderPopupResult({
        success: false,
        message: 'Não foi possível obter as informações do perfil do usuário no MyAnimeList.',
      });
    }

    const expiresInSec = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 2678400;

    await saveUserMALIntegration(
      storageCtx.db,
      handshake.uid,
      {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      },
      {
        username: userData.name,
        avatarUrl: userData.picture || undefined,
        expiresAt: Date.now() + expiresInSec * 1000,
      },
      storageCtx.encryptionKey
    );

    return renderPopupResult({
      success: true,
      username: userData.name,
      avatarUrl: userData.picture || '',
    });
  } catch (err) {
    return renderPopupResult({
      success: false,
      message: 'Erro interno ao comunicar com os servidores do MyAnimeList. Tente novamente mais tarde.',
    });
  }
});

// 4. GET /animelist — Consulta a lista de animes com renovação automática de token e rotação segura
malRouter.get('/animelist', requireFirebaseAuth, async (req: AuthenticatedExpressRequest, res) => {
  const uid = req.firebaseUser!.uid;

  const storageCtx = getSecureStorageContext();
  if (!storageCtx.isAvailable || !storageCtx.db || !storageCtx.encryptionKey) {
    return res.status(503).json({
      error: 'STORAGE_CONFIG_MISSING',
      message: storageCtx.error || 'Armazenamento seguro não configurado no servidor.',
    });
  }

  const clientId = process.env.MAL_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.MAL_CLIENT_SECRET?.trim() || '';

  let accessToken: string | null = null;
  try {
    accessToken = await getValidUserAccessToken(
      storageCtx.db,
      uid,
      storageCtx.encryptionKey,
      { clientId, clientSecret }
    );
  } catch (refreshErr) {
    return res.status(401).json({
      error: 'MAL_TOKEN_EXPIRED',
      message: 'Sua autorização com o MyAnimeList expirou e não pôde ser renovada. Conecte sua conta novamente.',
    });
  }

  if (!accessToken) {
    return res.status(403).json({
      error: 'MAL_NOT_LINKED',
      message: 'Nenhuma conta MyAnimeList vinculada à sua identidade autenticada. Conecte sua conta primeiro.',
    });
  }

  try {
    interface MALNode {
      id: number;
      title: string;
      main_picture?: { large?: string; medium?: string };
      alternative_titles?: { synonyms?: string[]; en?: string; ja?: string };
      start_date?: string;
      genres?: { id: number; name: string }[];
      num_episodes?: number;
      average_episode_duration?: number;
    }

    interface MALEntryRaw {
      node: MALNode;
      list_status: {
        status?: string;
        score?: number;
        num_episodes_watched?: number;
        is_rewatching?: boolean;
        num_times_rewatched?: number;
      };
    }

    interface MALListResponse {
      data?: MALEntryRaw[];
      paging?: {
        next?: string;
        previous?: string;
      };
    }

    const allEntries: MALEntryRaw[] = [];
    let nextUrl: string | null =
      'https://api.myanimelist.net/v2/users/@me/animelist?fields=list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched},num_episodes,alternative_titles,genres,start_date,media_type,average_episode_duration&limit=1000&offset=0';

    let pageCount = 0;
    const maxPages = 20; // Com limit=1000, suporta até 20.000 entradas em poucas requisições

    while (nextUrl && pageCount < maxPages) {
      let listRes: Response;
      try {
        listRes = await fetch(nextUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(12000),
        });
      } catch (fetchErr) {
        return res.status(504).json({
          error: 'MAL_TIMEOUT',
          message: `Tempo limite de conexão esgotado ao consultar o MyAnimeList: ${fetchErr instanceof Error ? fetchErr.message : 'timeout'}`,
        });
      }

      if (listRes.status === 401) {
        try {
          accessToken = await refreshUserMALTokens(
            storageCtx.db,
            uid,
            storageCtx.encryptionKey,
            { clientId, clientSecret }
          );

          listRes = await fetch(nextUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: AbortSignal.timeout(12000),
          });
        } catch {
          return res.status(401).json({
            error: 'MAL_TOKEN_EXPIRED',
            message: 'O token de acesso do MyAnimeList expirou e a renovação falhou. Conecte sua conta novamente.',
          });
        }
      }

      if (listRes.status === 401) {
        return res.status(401).json({
          error: 'MAL_TOKEN_EXPIRED',
          message: 'O token de acesso do MyAnimeList expirou. Conecte sua conta novamente.',
        });
      }

      if (listRes.status === 429) {
        return res.status(429).json({
          error: 'MAL_RATE_LIMIT',
          message: 'Limite de requisições atingido no MyAnimeList. Tente novamente em alguns segundos.',
        });
      }

      if (!listRes.ok) {
        return res.status(listRes.status).json({
          error: 'MAL_API_ERROR',
          message: 'Erro ao consultar animes no MyAnimeList.',
        });
      }

      let listJson: MALListResponse;
      try {
        listJson = await listRes.json();
      } catch {
        return res.status(502).json({
          error: 'MAL_API_ERROR',
          message: 'Resposta em formato inválido retornada pelo MyAnimeList.',
        });
      }

      if (Array.isArray(listJson.data)) {
        allEntries.push(...listJson.data);
      }

      nextUrl = listJson.paging?.next || null;
      pageCount++;
    }

    // Se o limite de páginas for atingido e ainda existirem mais entradas pendentes,
    // não retorna sucesso incompleto mascarando falha de paginação.
    if (nextUrl) {
      return res.status(500).json({
        error: 'MAL_LIST_TOO_LARGE',
        message: 'A lista de animes no MyAnimeList excede o limite máximo suportado para importação em uma única operação.',
      });
    }

    const mappedEntries = allEntries.map((item) => {
      const node = item.node;
      const status = item.list_status?.status;

      let hikariStatus = 'watching';
      if (status === 'completed') hikariStatus = 'completed';
      else if (status === 'plan_to_watch') hikariStatus = 'planned';
      else if (status === 'on_hold') hikariStatus = 'on_hold';
      else if (status === 'dropped') hikariStatus = 'dropped';
      else if (status === 'watching') hikariStatus = 'watching';

      const currentEpisode = typeof item.list_status?.num_episodes_watched === 'number'
        ? Math.max(0, item.list_status.num_episodes_watched)
        : 0;

      const totalEpisodes = typeof node.num_episodes === 'number' && node.num_episodes > 0
        ? node.num_episodes
        : 0;

      const rawScore = typeof item.list_status?.score === 'number' ? item.list_status.score : 0;
      const rating = Math.min(10, Math.max(0, rawScore));

      const year = node.start_date
        ? parseInt(node.start_date.substring(0, 4), 10) || new Date().getFullYear()
        : new Date().getFullYear();

      const genres = Array.isArray(node.genres) ? node.genres.map((g) => g.name) : [];

      const durationMinutes =
        typeof node.average_episode_duration === 'number' && node.average_episode_duration > 0
          ? Math.round(node.average_episode_duration / 60)
          : undefined;

      const rewatchCount =
        typeof item.list_status?.num_times_rewatched === 'number' && item.list_status.num_times_rewatched > 0
          ? item.list_status.num_times_rewatched
          : item.list_status?.is_rewatching
          ? 1
          : undefined;

      return {
        malId: node.id,
        title: node.title,
        titleRomaji: node.alternative_titles?.ja || undefined,
        posterUrl: node.main_picture?.large || node.main_picture?.medium || '',
        status: hikariStatus,
        currentEpisode,
        totalEpisodes,
        rating,
        year,
        genres,
        episodeDurationMinutes: durationMinutes,
        rewatchCount,
      };
    });

    res.json({
      entries: mappedEntries,
      totalCount: mappedEntries.length,
    });
  } catch (err) {
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: `Falha ao processar lista do MyAnimeList: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// 5. POST /disconnect — Remove o registro de integração do usuário no Firestore (Exige Firebase ID Token)
malRouter.post('/disconnect', requireFirebaseAuth, async (req: AuthenticatedExpressRequest, res) => {
  const uid = req.firebaseUser!.uid;
  const storageCtx = getSecureStorageContext();
  if (storageCtx.isAvailable && storageCtx.db) {
    try {
      await deleteUserMALIntegration(storageCtx.db, uid);
    } catch {
      // ignore
    }
  }
  res.json({ success: true });
});

export default malRouter;
