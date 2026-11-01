import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Estruturas de armazenamento seguro e privado em memória no servidor (Zero vazamento para o cliente)
interface OAuthHandshake {
  codeVerifier: string;
  uid: string;
  redirectUri: string;
  createdAt: number;
}

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  username: string;
  avatarUrl?: string;
}

// Mapas privados em memória do processo do servidor (indexados estritamente por UID do Firebase)
const oauthHandshakes = new Map<string, OAuthHandshake>();
const malUserTokens = new Map<string, StoredToken>();

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

// Limpeza periódica de handshakes expirados (> 15 minutos)
function cleanupExpiredHandshakes() {
  const now = Date.now();
  for (const [state, h] of oauthHandshakes.entries()) {
    if (now - h.createdAt > 15 * 60 * 1000) {
      oauthHandshakes.delete(state);
    }
  }
}

// 1. GET /api/mal/config — Retorna status de configuração das variáveis de ambiente sem expor segredos (Rota pública)
app.get('/api/mal/config', (req, res) => {
  const clientId = process.env.MAL_CLIENT_ID?.trim();
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const redirectUri = `${protocol}://${host}/api/mal/callback`;

  res.json({
    configured: Boolean(clientId),
    clientIdConfigured: Boolean(clientId),
    redirectUri,
  });
});

// 2. GET /api/mal/auth-url — Gera o par de chaves PKCE atrelado estritamente à identidade autenticada
app.get('/api/mal/auth-url', requireFirebaseAuth, (req: AuthenticatedExpressRequest, res) => {
  cleanupExpiredHandshakes();

  const clientId = process.env.MAL_CLIENT_ID?.trim();
  if (!clientId) {
    return res.status(400).json({
      error: 'MAL_NOT_CONFIGURED',
      message:
        'A variável de ambiente MAL_CLIENT_ID não está configurada no servidor (.env). Obtenha um Client ID no portal do desenvolvedor do MyAnimeList para habilitar a conexão real.',
    });
  }

  // O UID é extraído EXCLUSIVAMENTE do token verificado (não confia em query params)
  const uid = req.firebaseUser!.uid;

  const clientRedirectUri =
    typeof req.query.redirect_uri === 'string' && req.query.redirect_uri.trim()
      ? req.query.redirect_uri.trim()
      : undefined;

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const defaultRedirectUri = `${protocol}://${host}/api/mal/callback`;
  const redirectUri = clientRedirectUri || defaultRedirectUri;

  // Geração de code_verifier (64 caracteres seguros conforme especificação RFC 7636 / MyAnimeList)
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  oauthHandshakes.set(state, {
    codeVerifier,
    uid,
    redirectUri,
    createdAt: Date.now(),
  });

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

// 3. GET /api/mal/callback — Callback de autorização do MAL (Valida state, troca code por token e fecha popup via postMessage)
app.get(['/api/mal/callback', '/api/mal/callback/'], async (req, res) => {
  cleanupExpiredHandshakes();

  const { code, state, error, error_description } = req.query;

  // Helper para renderizar a página HTML leve de resposta no popup
  const renderPopupResult = (payload: { success: boolean; message: string; data?: unknown }) => {
    const escapedMsg = JSON.stringify(payload.message);
    const postData = JSON.stringify(payload);

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
      h2 { margin-top: 0; font-size: 16px; color: ${payload.success ? '#a855f7' : '#f43f5e'}; }
      p { font-size: 13px; color: #EDE8F5; opacity: 0.85; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${payload.success ? 'Conexão Realizada!' : 'Erro de Autorização'}</h2>
      <p id="status-msg">${payload.message}</p>
      <p style="font-size: 11px; opacity: 0.6; margin-top: 16px;">Esta janela será fechada automaticamente...</p>
    </div>
    <script>
      (function() {
        var payload = ${postData};
        if (window.opener) {
          window.opener.postMessage(
            payload.success 
              ? { 
                  type: 'MAL_AUTH_SUCCESS', 
                  payload: { username: payload.data.username, picture: payload.data.avatarUrl },
                  username: payload.data.username, 
                  avatarUrl: payload.data.avatarUrl 
                }
              : { type: 'MAL_AUTH_ERROR', message: payload.message },
            window.location.origin
          );
          setTimeout(function() { window.close(); }, 800);
        } else {
          document.getElementById('status-msg').textContent += ' (Você pode fechar esta aba e retornar ao Hikari).';
        }
      })();
    </script>
  </body>
</html>`);
  };

  if (error) {
    return renderPopupResult({
      success: false,
      message: `Autorização cancelada ou recusada no MyAnimeList: ${error_description || error}`,
    });
  }

  if (typeof code !== 'string' || typeof state !== 'string') {
    return renderPopupResult({
      success: false,
      message: 'Parâmetros de autorização inválidos ou ausentes na resposta do MyAnimeList.',
    });
  }

  const handshake = oauthHandshakes.get(state);
  if (!handshake || !handshake.uid) {
    return renderPopupResult({
      success: false,
      message: 'Sessão de autorização expirada ou não vinculada a uma identidade autenticada. Tente novamente.',
    });
  }

  oauthHandshakes.delete(state);

  const clientId = process.env.MAL_CLIENT_ID?.trim();
  const clientSecret = process.env.MAL_CLIENT_SECRET?.trim() || '';

  if (!clientId) {
    return renderPopupResult({
      success: false,
      message: 'Configuração do MAL_CLIENT_ID ausente no servidor.',
    });
  }

  try {
    // Troca o código de autorização pelo token de acesso oficial na API do MAL
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: handshake.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: handshake.redirectUri,
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

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || tokenData.message || 'Falha ao obter token de acesso.';
      return renderPopupResult({
        success: false,
        message: `Erro na autenticação com o MyAnimeList: ${errMsg}`,
      });
    }

    // Consulta os dados do usuário conectado no endpoint /users/@me
    const userRes = await fetch('https://api.myanimelist.net/v2/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userRes.json();
    if (!userRes.ok || !userData.name) {
      return renderPopupResult({
        success: false,
        message: 'Não foi possível obter as informações do perfil do usuário no MyAnimeList.',
      });
    }

    const storedToken: StoredToken = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in || 2678400) * 1000,
      username: userData.name,
      avatarUrl: userData.picture || undefined,
    };

    // Armazena com segurança no servidor, indexando estritamente pelo UID autenticado do Firebase
    malUserTokens.set(handshake.uid, storedToken);

    return renderPopupResult({
      success: true,
      message: `Conta @${userData.name} autorizada com sucesso!`,
      data: {
        username: userData.name,
        avatarUrl: userData.picture || '',
      },
    });
  } catch (err) {
    return renderPopupResult({
      success: false,
      message: `Erro de comunicação com a API do MyAnimeList: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// 4. GET /api/mal/animelist — Consulta a lista de animes (Exige Firebase ID Token e vincula ao UID autenticado)
app.get('/api/mal/animelist', requireFirebaseAuth, async (req: AuthenticatedExpressRequest, res) => {
  const uid = req.firebaseUser!.uid;

  const tokenRecord = malUserTokens.get(uid);

  if (!tokenRecord || !tokenRecord.accessToken) {
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
      'https://api.myanimelist.net/v2/users/@me/animelist?fields=list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched},num_episodes,alternative_titles,genres,start_date,media_type,average_episode_duration&limit=100&offset=0';

    let pageCount = 0;
    const maxPages = 20; // Até 2.000 animes por segurança

    while (nextUrl && pageCount < maxPages) {
      const listRes = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${tokenRecord.accessToken}`,
        },
      });

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

      const listJson: MALListResponse = await listRes.json();
      if (!listRes.ok) {
        return res.status(listRes.status).json({
          error: 'MAL_API_ERROR',
          message: 'Erro ao consultar animes no MyAnimeList.',
        });
      }

      if (Array.isArray(listJson.data)) {
        allEntries.push(...listJson.data);
      }

      nextUrl = listJson.paging?.next || null;
      pageCount++;
    }

    // Mapeamento normalizado para o modelo de animes do Hikari
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

// 5. POST /api/mal/disconnect — Remove o token do servidor de forma segura (Exige Firebase ID Token)
app.post('/api/mal/disconnect', requireFirebaseAuth, (req: AuthenticatedExpressRequest, res) => {
  const uid = req.firebaseUser!.uid;
  malUserTokens.delete(uid);
  res.json({ success: true });
});

// 6. Integração do Frontend com Vite em Desenvolvimento ou Produção
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hikari Profiles server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().catch((err) => {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  });
}
