import { auth } from '../lib/firebase';

export interface AdminOverviewData {
  server: {
    status: string;
    uptimeSeconds: number;
    nodeVersion: string;
    platform: string;
    memoryRssMb: number;
    memoryHeapUsedMb: number;
  };
  owner: {
    displayName: string;
    username: string;
    uid: string;
    role: string;
  };
  counts: {
    registeredUsers: number;
    catalogAnimes: number;
    activeAlerts: number;
  };
  systemAlerts: Array<{
    id: string;
    type: 'info' | 'warning' | 'success';
    title: string;
    message: string;
  }>;
  timestamp: number;
}

export interface AdminUserData {
  id: string;
  displayName: string;
  username: string;
  createdAt: string;
  createdAtTimestamp?: number;
  isPrivate: boolean;
  followersCount: number;
  followingCount: number;
  showCommentsOnProfile: boolean;
  bio: string;
  avatarUrl: string;
  status: 'Ativa';
  isOwner: boolean;
  connectedServices: {
    anilist: boolean;
    mal: boolean;
  };
}

export interface AdminAnimeData {
  id: string;
  title: string;
  titleRomaji: string;
  year: number;
  genres: string[];
  rating: number;
  totalEpisodes: number;
  status: string;
  posterUrl: string;
}

export interface AdminModerationData {
  reports: Array<{
    id: string;
    targetType: string;
    reason: string;
    createdAt: string;
  }>;
  total: number;
  pending: number;
  systemNotice: string;
  frameworkReady: boolean;
  futureCapabilities: string[];
  automatedPunishments: string;
}

export interface AdminMetricsData {
  realMetrics: {
    totalUsersKnown: number;
    publicProfilesCount: number;
    privateProfilesCount: number;
    totalCatalogAnimes: number;
    averageCatalogRating: number;
    serverUptimeSeconds: number;
    memoryRssMb: number;
    memoryHeapUsedMb: number;
    nodeVersion: string;
  };
  unavailableMetrics: Array<{
    metric: string;
    status: string;
    reason: string;
  }>;
  timestamp: number;
}

export interface AdminSecurityData {
  status: string;
  authorizedAdminUid: string;
  isUidLocked: boolean;
  operator?: {
    role?: string;
    uid?: string;
  };
  checks: Array<{
    id: string;
    name: string;
    status: string;
    description: string;
  }>;
  secretsExposed: boolean;
  timestamp: number;
}

async function resolveAdminToken(
  idToken?: string | null,
  forceRefresh = false
): Promise<string | null> {
  if (forceRefresh && auth?.currentUser) {
    try {
      const refreshed = await auth.currentUser.getIdToken(true);
      if (refreshed && refreshed.trim().length > 0) {
        return refreshed.trim();
      }
    } catch {
      // Se a renovação forçada falhar, tenta o token passado ou atual abaixo
    }
  }

  if (idToken && typeof idToken === 'string' && idToken.trim().length > 0) {
    return idToken.replace(/^Bearer\s+/i, '').trim();
  }

  if (auth?.currentUser) {
    try {
      const current = await auth.currentUser.getIdToken(false);
      if (current && current.trim().length > 0) {
        return current.trim();
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function getAdminHeaders(
  idToken?: string | null,
  expectedUid?: string | null,
  forceRefresh = false
): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
  };

  const resolvedToken = await resolveAdminToken(idToken, forceRefresh);
  if (resolvedToken) {
    const rawToken = resolvedToken.replace(/^Bearer\s+/i, '').trim();
    headers['Authorization'] = `Bearer ${rawToken}`;
    headers['x-admin-token'] = rawToken;
  }

  const clientUid = (expectedUid || auth?.currentUser?.uid || '').trim();
  if (clientUid) {
    headers['x-client-uid'] = clientUid;
  }

  return headers;
}

async function fetchAdminProtected(
  url: string,
  idToken?: string | null,
  init: RequestInit = {}
): Promise<Response> {
  const headers = await getAdminHeaders(idToken, undefined, false);
  let res = await fetch(url, {
    ...init,
    headers: {
      ...(headers as Record<string, string>),
      ...((init.headers as Record<string, string>) || {}),
    },
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (res.status === 401 && auth?.currentUser) {
    const refreshedHeaders = await getAdminHeaders(null, auth.currentUser.uid, true);
    res = await fetch(url, {
      ...init,
      headers: {
        ...(refreshedHeaders as Record<string, string>),
        ...((init.headers as Record<string, string>) || {}),
      },
      cache: 'no-store',
      credentials: 'same-origin',
    });
  }

  return res;
}

export async function fetchAdminStatus(
  idToken?: string | null,
  expectedUid?: string | null
): Promise<{ authenticated: boolean; isAdmin: boolean }> {
  try {
    const headers = await getAdminHeaders(idToken, expectedUid, false);
    const res = await fetch('/api/admin/status', {
      method: 'GET',
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      return { authenticated: false, isAdmin: false };
    }
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return { authenticated: false, isAdmin: false };
    }
    return {
      authenticated: Boolean(data.authenticated === true),
      isAdmin: Boolean(data.isAdmin === true),
    };
  } catch {
    return { authenticated: false, isAdmin: false };
  }
}

export async function verifyAdminAccess(
  idToken?: string | null,
  expectedUid?: string | null
): Promise<{ authenticated: boolean; isAdmin: boolean; token: string | null }> {
  const executeCheck = async (tokenCandidate: string, uid?: string | null) => {
    const cleanToken = tokenCandidate.replace(/^Bearer\s+/i, '').trim();
    if (!cleanToken) {
      return { authenticated: false, isAdmin: false, token: null };
    }

    const headers = await getAdminHeaders(cleanToken, uid, false);
    const [statusData, verifyRes] = await Promise.all([
      fetchAdminStatus(cleanToken, uid),
      fetch('/api/admin/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idToken: cleanToken,
          ...(uid ? { uid: uid.trim() } : {}),
        }),
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    ]);

    if (!verifyRes.ok) {
      return {
        authenticated: false,
        isAdmin: false,
        token: null,
        httpStatus: verifyRes.status,
      };
    }

    const verifyData = await verifyRes.json();
    const isVerifiedAdmin = Boolean(
      verifyData &&
        typeof verifyData === 'object' &&
        verifyData.authenticated === true &&
        verifyData.isAdmin === true &&
        statusData.authenticated === true &&
        statusData.isAdmin === true
    );

    return {
      authenticated: Boolean(verifyData?.authenticated === true && statusData.authenticated === true),
      isAdmin: isVerifiedAdmin,
      token: isVerifiedAdmin ? cleanToken : null,
      httpStatus: verifyRes.status,
    };
  };

  try {
    const initialToken = await resolveAdminToken(idToken, false);
    if (!initialToken) {
      return { authenticated: false, isAdmin: false, token: null };
    }

    const firstAttempt = await executeCheck(initialToken, expectedUid);
    if (firstAttempt.isAdmin) {
      return {
        authenticated: true,
        isAdmin: true,
        token: firstAttempt.token,
      };
    }

    // Se o token em cache estiver expirado (401) ou desatualizado na sessão Firebase ativa, força renovação única
    if (auth?.currentUser && (!expectedUid || auth.currentUser.uid === expectedUid)) {
      const refreshedToken = await resolveAdminToken(null, true);
      if (refreshedToken && refreshedToken !== initialToken) {
        const secondAttempt = await executeCheck(refreshedToken, expectedUid);
        return {
          authenticated: secondAttempt.authenticated,
          isAdmin: secondAttempt.isAdmin,
          token: secondAttempt.token,
        };
      }
    }

    return {
      authenticated: firstAttempt.authenticated,
      isAdmin: false,
      token: null,
    };
  } catch {
    return { authenticated: false, isAdmin: false, token: null };
  }
}

export async function fetchAdminOverview(idToken?: string | null): Promise<AdminOverviewData> {
  const res = await fetchAdminProtected('/api/admin/overview', idToken);
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar a visão geral.`);
  }
  return await res.json();
}

export async function fetchAdminUsers(searchQuery = '', idToken?: string | null): Promise<{ users: AdminUserData[]; total: number; privacyGuarantee: string }> {
  const q = encodeURIComponent(searchQuery);
  const res = await fetchAdminProtected(`/api/admin/users${q ? `?q=${q}` : ''}`, idToken);
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar a lista de usuários.`);
  }
  return await res.json();
}

export async function fetchAdminAnimes(searchQuery = '', idToken?: string | null): Promise<{ animes: AdminAnimeData[]; total: number; policy: string }> {
  const q = encodeURIComponent(searchQuery);
  const res = await fetchAdminProtected(`/api/admin/animes${q ? `?q=${q}` : ''}`, idToken);
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível consultar o catálogo de animes.`);
  }
  return await res.json();
}

export async function fetchAdminModeration(idToken?: string | null): Promise<AdminModerationData> {
  const res = await fetchAdminProtected('/api/admin/moderation', idToken);
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar o módulo de moderação.`);
  }
  return await res.json();
}

export async function fetchAdminMetrics(idToken?: string | null): Promise<AdminMetricsData> {
  const res = await fetchAdminProtected('/api/admin/metrics', idToken);
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar as métricas do sistema.`);
  }
  return await res.json();
}

export async function fetchAdminSecurity(idToken?: string | null): Promise<AdminSecurityData> {
  const res = await fetchAdminProtected('/api/admin/security', idToken);
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar os dados de segurança.`);
  }
  return await res.json();
}

export async function runAdminHealthCheck(idToken?: string | null): Promise<{ status: string; message: string; timestamp: number }> {
  const res = await fetchAdminProtected('/api/admin/health-check', idToken);
  if (!res.ok) {
    throw new Error(`Falha no diagnóstico (${res.status}): Acesso não autorizado.`);
  }
  return await res.json();
}
