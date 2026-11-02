import { AUTHORIZED_ADMIN_UID } from '../types';

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

async function getAdminHeaders(idToken?: string | null): Promise<HeadersInit> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken.trim()}`;
  } else {
    // Fallback para teste/sessão direta do proprietário autorizado
    headers['Authorization'] = `Bearer test_token_${AUTHORIZED_ADMIN_UID}`;
  }

  return headers;
}

export async function fetchAdminStatus(idToken?: string | null): Promise<{ authenticated: boolean; isAdmin: boolean }> {
  try {
    const headers = await getAdminHeaders(idToken);
    const res = await fetch('/api/admin/status', { headers });
    if (!res.ok) {
      return { authenticated: false, isAdmin: false };
    }
    return await res.json();
  } catch {
    return { authenticated: false, isAdmin: false };
  }
}

export async function fetchAdminOverview(idToken?: string | null): Promise<AdminOverviewData> {
  const headers = await getAdminHeaders(idToken);
  const res = await fetch('/api/admin/overview', { headers });
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar a visão geral.`);
  }
  return await res.json();
}

export async function fetchAdminUsers(searchQuery = '', idToken?: string | null): Promise<{ users: AdminUserData[]; total: number; privacyGuarantee: string }> {
  const headers = await getAdminHeaders(idToken);
  const q = encodeURIComponent(searchQuery);
  const res = await fetch(`/api/admin/users${q ? `?q=${q}` : ''}`, { headers });
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar a lista de usuários.`);
  }
  return await res.json();
}

export async function fetchAdminAnimes(searchQuery = '', idToken?: string | null): Promise<{ animes: AdminAnimeData[]; total: number; policy: string }> {
  const headers = await getAdminHeaders(idToken);
  const q = encodeURIComponent(searchQuery);
  const res = await fetch(`/api/admin/animes${q ? `?q=${q}` : ''}`, { headers });
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível consultar o catálogo de animes.`);
  }
  return await res.json();
}

export async function fetchAdminModeration(idToken?: string | null): Promise<AdminModerationData> {
  const headers = await getAdminHeaders(idToken);
  const res = await fetch('/api/admin/moderation', { headers });
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar o módulo de moderação.`);
  }
  return await res.json();
}

export async function fetchAdminMetrics(idToken?: string | null): Promise<AdminMetricsData> {
  const headers = await getAdminHeaders(idToken);
  const res = await fetch('/api/admin/metrics', { headers });
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar as métricas do sistema.`);
  }
  return await res.json();
}

export async function fetchAdminSecurity(idToken?: string | null): Promise<AdminSecurityData> {
  const headers = await getAdminHeaders(idToken);
  const res = await fetch('/api/admin/security', { headers });
  if (!res.ok) {
    throw new Error(`Acesso negado (${res.status}): Não foi possível carregar os dados de segurança.`);
  }
  return await res.json();
}

export async function runAdminHealthCheck(idToken?: string | null): Promise<{ status: string; message: string; timestamp: number }> {
  const headers = await getAdminHeaders(idToken);
  const res = await fetch('/api/admin/health-check', { headers });
  if (!res.ok) {
    throw new Error(`Falha no diagnóstico (${res.status}): Acesso não autorizado.`);
  }
  return await res.json();
}
