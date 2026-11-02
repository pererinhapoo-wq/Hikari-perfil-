import {
  encryptMALTokens,
  decryptMALTokens,
  EncryptedPayload,
  MALTokenSet,
} from './crypto.js';

export interface OAuthHandshakeRecord {
  state: string;
  codeVerifier: string;
  uid: string;
  trustedOrigin: string;
  redirectUri?: string;
  createdAt: number;
  expiresAt: number;
}

export interface StoredMALIntegrationRecord {
  uid: string;
  encryptedTokens: EncryptedPayload;
  username: string;
  avatarUrl?: string;
  joinedAt?: string;
  expiresAt: number;
  updatedAt: number;
  isRefreshing?: boolean;
  refreshStartedAt?: number;
}

export interface DecryptedMALIntegration {
  uid: string;
  tokens: MALTokenSet;
  username: string;
  avatarUrl?: string;
  joinedAt?: string;
  expiresAt: number;
  updatedAt: number;
  isRefreshing?: boolean;
  refreshStartedAt?: number;
}

// Duração de validade estrita para handshakes OAuth (15 minutos conforme especificação de segurança)
export const HANDSHAKE_TTL_MS = 15 * 60 * 1000;

// Janela de antecipação para renovação automática de token (5 minutos antes de expirar)
export const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

// Timeout da trava de renovação anti-concorrência (15 segundos)
export const REFRESH_LOCK_TIMEOUT_MS = 15 * 1000;

export const MAL_HANDSHAKES_COLLECTION = 'mal_handshakes';
export const MAL_INTEGRATIONS_COLLECTION = 'mal_integrations';

/**
 * Interface mínima abstrata de Firestore suportada (compatível com Firebase Admin Firestore e simuladores em testes).
 */
export interface MinimalFirestoreDocumentSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface MinimalFirestoreDocumentRef {
  id: string;
  path: string;
  get(): Promise<MinimalFirestoreDocumentSnapshot>;
  set(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface MinimalFirestoreTransaction {
  get(ref: MinimalFirestoreDocumentRef): Promise<MinimalFirestoreDocumentSnapshot>;
  set(ref: MinimalFirestoreDocumentRef, data: Record<string, unknown>): MinimalFirestoreTransaction;
  delete(ref: MinimalFirestoreDocumentRef): MinimalFirestoreTransaction;
}

export interface MinimalFirestore {
  collection(name: string): {
    doc(id: string): MinimalFirestoreDocumentRef;
  };
  runTransaction<T>(updateFunction: (transaction: MinimalFirestoreTransaction) => Promise<T>): Promise<T>;
}

export interface MALRefreshConfig {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  fetchFn?: typeof fetch;
}

// Mapa em memória para deduplicação rápida de promessas de refresh concorrentes no mesmo processo
const inProcessRefreshPromises = new Map<string, Promise<string>>();

/**
 * Registra um novo handshake OAuth no Firestore com expiração automática em 15 minutos.
 */
export async function createOAuthHandshake(
  db: MinimalFirestore,
  input: {
    state: string;
    codeVerifier: string;
    uid: string;
    trustedOrigin: string;
    redirectUri?: string;
  }
): Promise<OAuthHandshakeRecord> {
  if (!input.state || typeof input.state !== 'string' || !input.state.trim()) {
    throw new Error('Parâmetro state é obrigatório para registrar o handshake.');
  }
  if (!input.codeVerifier || typeof input.codeVerifier !== 'string') {
    throw new Error('Parâmetro codeVerifier é obrigatório para o handshake PKCE.');
  }
  if (!input.uid || typeof input.uid !== 'string' || !input.uid.trim()) {
    throw new Error('Identificador de usuário (uid) é obrigatório.');
  }
  if (!input.trustedOrigin || typeof input.trustedOrigin !== 'string') {
    throw new Error('trustedOrigin é obrigatório para validação de segurança.');
  }

  const now = Date.now();
  const cleanRedirectUri =
    typeof input.redirectUri === 'string' && input.redirectUri.trim()
      ? input.redirectUri.trim()
      : undefined;

  const record: OAuthHandshakeRecord = {
    state: input.state.trim(),
    codeVerifier: input.codeVerifier.trim(),
    uid: input.uid.trim(),
    trustedOrigin: input.trustedOrigin.trim(),
    ...(cleanRedirectUri ? { redirectUri: cleanRedirectUri } : {}),
    createdAt: now,
    expiresAt: now + HANDSHAKE_TTL_MS,
  };

  const docRef = db.collection(MAL_HANDSHAKES_COLLECTION).doc(record.state);
  await docRef.set({ ...record });

  return record;
}

/**
 * Resgata e consome atomicamente um handshake OAuth do Firestore.
 * Utiliza uma transação atômica que lê e deleta imediatamente o documento.
 * Se o handshake não existir ou já tiver sido consumido por outra requisição simultânea,
 * retorna null, garantindo proteção total contra ataques de repetição (replay attacks).
 */
export async function consumeOAuthHandshakeAtomic(
  db: MinimalFirestore,
  state: string
): Promise<OAuthHandshakeRecord | null> {
  if (!state || typeof state !== 'string' || !state.trim()) {
    return null;
  }

  const cleanState = state.trim();
  const docRef = db.collection(MAL_HANDSHAKES_COLLECTION).doc(cleanState);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);

    if (!snap.exists) {
      return null;
    }

    const rawData = snap.data();
    if (!rawData) {
      transaction.delete(docRef);
      return null;
    }

    const record = rawData as unknown as OAuthHandshakeRecord;

    // Remove imediatamente do Firestore para impedir qualquer segundo consumo
    transaction.delete(docRef);

    // Validação de expiração temporal (15 minutos)
    const now = Date.now();
    if (typeof record.expiresAt === 'number' && now > record.expiresAt) {
      return null; // Handshake expirado
    }

    return record;
  });
}

/**
 * Salva as credenciais do MyAnimeList para o UID autenticado, criptografando os tokens em repouso.
 */
export async function saveUserMALIntegration(
  db: MinimalFirestore,
  uid: string,
  tokens: MALTokenSet,
  metadata: {
    username: string;
    avatarUrl?: string;
    joinedAt?: string;
    expiresAt: number;
  },
  encryptionKey: string | Buffer
): Promise<void> {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('UID de usuário obrigatório para vincular a integração.');
  }

  const cleanUid = uid.trim();
  const encryptedPayload = encryptMALTokens(tokens, encryptionKey);

  const record: StoredMALIntegrationRecord = {
    uid: cleanUid,
    encryptedTokens: encryptedPayload,
    username: metadata.username,
    avatarUrl: metadata.avatarUrl || undefined,
    joinedAt: metadata.joinedAt || undefined,
    expiresAt: metadata.expiresAt,
    updatedAt: Date.now(),
    isRefreshing: false,
    refreshStartedAt: 0,
  };

  const docRef = db.collection(MAL_INTEGRATIONS_COLLECTION).doc(cleanUid);
  await docRef.set({ ...record });
}

/**
 * Resgata e descriptografa as credenciais do MyAnimeList vinculadas estritamente ao UID do usuário.
 */
export async function getUserMALIntegration(
  db: MinimalFirestore,
  uid: string,
  encryptionKey: string | Buffer
): Promise<DecryptedMALIntegration | null> {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    return null;
  }

  const cleanUid = uid.trim();
  const docRef = db.collection(MAL_INTEGRATIONS_COLLECTION).doc(cleanUid);
  const snap = await docRef.get();

  if (!snap.exists) {
    return null;
  }

  const data = snap.data();
  if (!data || !data.encryptedTokens) {
    return null;
  }

  const record = data as unknown as StoredMALIntegrationRecord;
  const decryptedTokens = decryptMALTokens(record.encryptedTokens, encryptionKey);

  return {
    uid: cleanUid,
    tokens: decryptedTokens,
    username: record.username,
    avatarUrl: record.avatarUrl,
    expiresAt: record.expiresAt,
    updatedAt: record.updatedAt,
    isRefreshing: record.isRefreshing,
    refreshStartedAt: record.refreshStartedAt,
  };
}

/**
 * Remove com segurança o registro de integração do usuário no Firestore (Desconexão).
 */
export async function deleteUserMALIntegration(
  db: MinimalFirestore,
  uid: string
): Promise<void> {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    return;
  }

  const cleanUid = uid.trim();
  const docRef = db.collection(MAL_INTEGRATIONS_COLLECTION).doc(cleanUid);
  await docRef.delete();
}

/**
 * Executa a renovação segura de token OAuth contra o endpoint oficial do MyAnimeList:
 * - Trata a rotação do refresh token emitida pelo MAL.
 * - Impede renovações concorrentes para o mesmo usuário através de trava atômica distribuída no Firestore
 *   e deduplicação em memória no processo.
 * - Salva os novos tokens criptografados com AES-256-GCM.
 */
export async function refreshUserMALTokens(
  db: MinimalFirestore,
  uid: string,
  encryptionKey: string | Buffer,
  config: MALRefreshConfig
): Promise<string> {
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new Error('UID de usuário obrigatório para renovação.');
  }

  const cleanUid = uid.trim();

  // 1. Deduplicação rápida no mesmo processo
  const existingPromise = inProcessRefreshPromises.get(cleanUid);
  if (existingPromise) {
    return existingPromise;
  }

  const executeRefresh = async (): Promise<string> => {
    const docRef = db.collection(MAL_INTEGRATIONS_COLLECTION).doc(cleanUid);
    const now = Date.now();

    // 2. Trava atômica no Firestore para proteger contra múltiplas instâncias serverless
    let currentRefreshToken: string | undefined;
    let username = '';
    let avatarUrl: string | undefined;

    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists) {
        throw new Error('MAL_NOT_LINKED: Nenhuma integração ativa para este usuário.');
      }

      const raw = snap.data() as unknown as StoredMALIntegrationRecord;
      const decrypted = decryptMALTokens(raw.encryptedTokens, encryptionKey);

      if (!decrypted.refreshToken) {
        throw new Error('MAL_NO_REFRESH_TOKEN: Nenhum refresh token disponível para renovação.');
      }

      // Verificar se outra instância serverless já está executando o refresh no momento
      if (raw.isRefreshing && raw.refreshStartedAt && now - raw.refreshStartedAt < REFRESH_LOCK_TIMEOUT_MS) {
        // Trava ativa em outra instância
        throw new Error('MAL_REFRESH_IN_PROGRESS: Renovação já em andamento em outra instância.');
      }

      currentRefreshToken = decrypted.refreshToken;
      username = raw.username;
      avatarUrl = raw.avatarUrl;

      // Adquirir a trava atômica
      transaction.set(docRef, {
        ...raw,
        isRefreshing: true,
        refreshStartedAt: now,
      });
    });

    if (!currentRefreshToken) {
      throw new Error('MAL_NO_REFRESH_TOKEN: Nenhum refresh token disponível.');
    }

    const fetchImpl = config.fetchFn || fetch;
    const endpoint = config.tokenEndpoint || 'https://myanimelist.net/v1/oauth2/token';

    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
    });

    if (config.clientSecret) {
      tokenBody.append('client_secret', config.clientSecret);
    }

    let tokenRes: Response;
    try {
      tokenRes = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenBody.toString(),
      });
    } catch (fetchErr) {
      // Liberar a trava no erro de rede
      try {
        const snap = await docRef.get();
        if (snap.exists && snap.data()) {
          const raw = snap.data() as unknown as StoredMALIntegrationRecord;
          await docRef.set({ ...raw, isRefreshing: false });
        }
      } catch {
        // ignore
      }
      throw new Error('Erro de comunicação com o MyAnimeList durante a renovação.');
    }

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      // Liberar trava
      try {
        const snap = await docRef.get();
        if (snap.exists && snap.data()) {
          const raw = snap.data() as unknown as StoredMALIntegrationRecord;
          await docRef.set({ ...raw, isRefreshing: false });
        }
      } catch {
        // ignore
      }

      // Se o refresh token foi revogado ou é inválido (400 ou 401)
      if (tokenRes.status === 400 || tokenRes.status === 401) {
        throw new Error('MAL_REFRESH_TOKEN_EXPIRED: Sessão de autorização revogada pelo MyAnimeList. Conecte sua conta novamente.');
      }

      throw new Error('Falha ao renovar autorização com o MyAnimeList.');
    }

    // Sucesso: salvar novos tokens com rotação de refresh token
    const newAccessToken = tokenData.access_token as string;
    const newRefreshToken = (tokenData.refresh_token as string) || currentRefreshToken;
    const expiresInSec = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 2678400;

    await saveUserMALIntegration(
      db,
      cleanUid,
      {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
      {
        username,
        avatarUrl,
        expiresAt: Date.now() + expiresInSec * 1000,
      },
      encryptionKey
    );

    return newAccessToken;
  };

  const promise = executeRefresh().finally(() => {
    inProcessRefreshPromises.delete(cleanUid);
  });

  inProcessRefreshPromises.set(cleanUid, promise);
  return promise;
}

/**
 * Obtém um token de acesso válido para o usuário autenticado.
 * Se o token estiver expirado ou a menos de 5 minutos de expirar, executa a renovação automática.
 */
export async function getValidUserAccessToken(
  db: MinimalFirestore,
  uid: string,
  encryptionKey: string | Buffer,
  config: MALRefreshConfig
): Promise<string | null> {
  const integration = await getUserMALIntegration(db, uid, encryptionKey);
  if (!integration) {
    return null;
  }

  const now = Date.now();
  const isExpiringSoon = now >= integration.expiresAt - TOKEN_REFRESH_THRESHOLD_MS;

  if (isExpiringSoon && integration.tokens.refreshToken) {
    try {
      return await refreshUserMALTokens(db, uid, encryptionKey, config);
    } catch {
      // Se a renovação falhar mas o token ainda não expirou estritamente, tenta usar o atual
      if (now < integration.expiresAt) {
        return integration.tokens.accessToken;
      }
      throw new Error('MAL_TOKEN_EXPIRED: O token expirou e não pôde ser renovado. Conecte sua conta novamente.');
    }
  }

  return integration.tokens.accessToken;
}
