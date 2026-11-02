import type { User as FirebaseUser } from 'firebase/auth';
import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db, firebaseConfigStatus } from './firebase';
import type {
  UserProfile,
  PrivacySettings,
  AnimeItem,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
  HikariComment,
  UserActivity,
  NotificationItem,
  FollowUser,
  FollowRequest,
} from '../types';
import { AUTHORIZED_ADMIN_UID } from '../types';
import {
  computeAnimeStats,
  EMPTY_ANIME_STATS,
  sanitizeAnimeStatsSummary,
  type AnimeStatsSummary,
} from '../utils/animeStats';

export const USER_WORKSPACE_STORAGE_PREFIX = 'hikari_user_workspace_v1:';
export const PUBLIC_PROFILES_STORAGE_KEY = 'hikari_public_profiles_v1';

const LOCAL_STORAGE_WRITE_DEBOUNCE_MS = 300;
const FIRESTORE_SAVE_DEBOUNCE_MS = 350;
const PUBLIC_PROFILE_REMOTE_TTL_MS = 60_000;

export interface PublicProfileProjection {
  profile: UserProfile;
  animeStats: AnimeStatsSummary;
  publicAnimes: AnimeItem[];
  updatedAtMs: number;
}

export type FirestoreSyncStatus =
  | 'idle'
  | 'synced'
  | 'empty_remote'
  | 'permission_denied'
  | 'unconfigured'
  | 'error';

export interface UserProfileOverrides {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  followersCount?: number;
  followingCount?: number;
  isPrivate?: boolean;
  showCommentsOnProfile?: boolean;
  privacySettings?: PrivacySettings;
  externalAccounts?: UserProfile['externalAccounts'];
}

export interface UserPersonalWorkspace {
  version: 1;
  uid: string;
  profileOverrides: UserProfileOverrides;
  animes: AnimeItem[];
  favoriteCharacters: FavoriteCharacter[];
  favoriteCompanies: FavoriteCompany[];
  favoritePeople: FavoritePerson[];
  comments: HikariComment[];
  activities: UserActivity[];
  notifications: NotificationItem[];
  followers: FollowUser[];
  following: FollowUser[];
  followRequests: FollowRequest[];
  followingIds: string[];
  requestedIds: string[];
  blockedIds: string[];
  updatedAtMs: number;
}

// ============================================================================
// Write-through In-Memory Caches + Debounced Persistence + Diagnostics
// ============================================================================

interface CachedWorkspaceEntry {
  workspace: UserPersonalWorkspace;
  lastRaw: string | null;
  dirty: boolean;
}

const workspaceMemoryCache = new Map<string, CachedWorkspaceEntry>();
const workspaceWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

let publicProfilesRawMapCache: Record<string, unknown> | null = null;
let publicProfilesSanitizedCache: Record<string, PublicProfileProjection> | null = null;
let publicProfilesLastRaw: string | null = null;
let publicProfilesDirty = false;
let publicProfilesWriteTimer: ReturnType<typeof setTimeout> | null = null;

const lastProjectionSignatureByUid = new Map<
  string,
  { profileSig: string; animesRef: readonly AnimeItem[]; updatedAtMs: number }
>();

interface RemoteDocExistenceMeta {
  userDocExists: boolean;
  personalDocExists: boolean;
  lastUserProfileSig: string | null;
}

const remoteDocMetaByUid = new Map<string, RemoteDocExistenceMeta>();

interface PendingFirestoreSave {
  uid: string;
  resolvedProfile: UserProfile;
  workspace: UserPersonalWorkspace;
  timer: ReturnType<typeof setTimeout> | null;
  resolvers: Array<(status: FirestoreSyncStatus) => void>;
}

const pendingFirestoreSavesByUid = new Map<string, PendingFirestoreSave>();
const inFlightFirestoreCommitByUid = new Map<string, Promise<FirestoreSyncStatus>>();

const remotePublicProfileCache = new Map<
  string,
  { profile: UserProfile | null; fetchedAtMs: number }
>();
const inFlightPublicProfileLoads = new Map<string, Promise<UserProfile | null>>();

let lifecycleListenersAttached = false;

let metricsJsonParseCalls = 0;
let metricsJsonStringifyCalls = 0;
let metricsFirestoreGetDocCalls = 0;
let metricsFirestoreBatchCommits = 0;

export function getWorkspaceStorageMetrics() {
  return {
    jsonParseCalls: metricsJsonParseCalls,
    jsonStringifyCalls: metricsJsonStringifyCalls,
    firestoreGetDocCalls: metricsFirestoreGetDocCalls,
    firestoreBatchCommits: metricsFirestoreBatchCommits,
    pendingLocalWorkspaceWrites: workspaceWriteTimers.size,
    pendingPublicProfilesWrite: publicProfilesWriteTimer !== null,
    pendingFirestoreSaves: pendingFirestoreSavesByUid.size,
  };
}

export function resetWorkspaceStorageMetrics(): void {
  metricsJsonParseCalls = 0;
  metricsJsonStringifyCalls = 0;
  metricsFirestoreGetDocCalls = 0;
  metricsFirestoreBatchCommits = 0;
}

function flushSingleWorkspaceToLocalStorage(uid: string): void {
  const timer = workspaceWriteTimers.get(uid);
  if (timer !== undefined) {
    clearTimeout(timer);
    workspaceWriteTimers.delete(uid);
  }

  const cached = workspaceMemoryCache.get(uid);
  if (!cached || !cached.dirty) return;
  cached.dirty = false;

  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    metricsJsonStringifyCalls++;
    const serialized = JSON.stringify(cached.workspace);
    cached.lastRaw = serialized;
    window.localStorage.setItem(getUserWorkspaceStorageKey(uid), serialized);
  } catch {
    // Keep in-memory workspace intact even if browser storage quota is exceeded
  }
}

function flushPublicProfilesToLocalStorage(): void {
  if (publicProfilesWriteTimer !== null) {
    clearTimeout(publicProfilesWriteTimer);
    publicProfilesWriteTimer = null;
  }

  if (!publicProfilesDirty || !publicProfilesRawMapCache) return;
  publicProfilesDirty = false;

  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    metricsJsonStringifyCalls++;
    const serialized = JSON.stringify(publicProfilesRawMapCache);
    publicProfilesLastRaw = serialized;
    window.localStorage.setItem(PUBLIC_PROFILES_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota errors while preserving in-memory state
  }
}

/**
 * Flushes all debounced localStorage writes synchronously (invoked automatically on
 * pagehide / beforeunload / visibilitychange -> hidden, and available for deterministic tests).
 */
export function flushPendingWorkspaceStorageWrites(): void {
  for (const uid of Array.from(workspaceMemoryCache.keys())) {
    flushSingleWorkspaceToLocalStorage(uid);
  }
  flushPublicProfilesToLocalStorage();
}

function ensureLifecycleListeners(): void {
  if (lifecycleListenersAttached || typeof window === 'undefined') return;
  lifecycleListenersAttached = true;

  const handleFlush = () => {
    flushPendingWorkspaceStorageWrites();
    for (const uid of Array.from(pendingFirestoreSavesByUid.keys())) {
      void executeQueuedFirestoreSave(uid);
    }
  };

  window.addEventListener('pagehide', handleFlush);
  window.addEventListener('beforeunload', handleFlush);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleFlush();
      }
    });
  }

  window.addEventListener('storage', (event: StorageEvent) => {
    if (!event.key) {
      workspaceMemoryCache.clear();
      publicProfilesRawMapCache = null;
      publicProfilesSanitizedCache = null;
      publicProfilesLastRaw = null;
      return;
    }

    if (event.key === PUBLIC_PROFILES_STORAGE_KEY) {
      publicProfilesRawMapCache = null;
      publicProfilesSanitizedCache = null;
      publicProfilesLastRaw = null;
      publicProfilesDirty = false;
      return;
    }

    if (event.key.startsWith(USER_WORKSPACE_STORAGE_PREFIX)) {
      const targetUid = event.key.slice(USER_WORKSPACE_STORAGE_PREFIX.length);
      if (targetUid) {
        workspaceMemoryCache.delete(targetUid);
      }
    }
  });
}

export function getUserWorkspaceStorageKey(uid: string): string {
  const cleanUid = uid.trim();
  if (!cleanUid) {
    throw new Error('UID inválido para isolamento de armazenamento.');
  }
  return `${USER_WORKSPACE_STORAGE_PREFIX}${cleanUid}`;
}

export function createEmptyUserWorkspace(uid: string): UserPersonalWorkspace {
  const cleanUid = uid.trim();
  if (!cleanUid) {
    throw new Error('UID inválido ao inicializar espaço pessoal.');
  }
  return {
    version: 1,
    uid: cleanUid,
    profileOverrides: {},
    animes: [],
    favoriteCharacters: [],
    favoriteCompanies: [],
    favoritePeople: [],
    comments: [],
    activities: [],
    notifications: [],
    followers: [],
    following: [],
    followRequests: [],
    followingIds: [],
    requestedIds: [],
    blockedIds: [],
    updatedAtMs: 0,
  };
}

export function buildProfileFromFirebaseUser(
  firebaseUser: FirebaseUser,
  overrides: UserProfileOverrides = {}
): UserProfile {
  const emailPrefix = firebaseUser.email ? firebaseUser.email.split('@')[0] : 'usuario';
  const cleanedPrefix = emailPrefix
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const fallbackUsername =
    cleanedPrefix.length >= 3
      ? cleanedPrefix.slice(0, 32)
      : `${cleanedPrefix || 'usuario'}_hikari`.slice(0, 32);

  const creationMs = firebaseUser.metadata.creationTime
    ? Date.parse(firebaseUser.metadata.creationTime)
    : Date.now();
  const validCreationMs = Number.isNaN(creationMs) ? Date.now() : creationMs;
  const formattedCreatedAt = new Date(validCreationMs).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const isAdmin = firebaseUser.uid === AUTHORIZED_ADMIN_UID;
  const defaultAdminDisplayName = 'Aether';
  const defaultAdminUsername = 'aether';
  const defaultAdminAvatar = '';
  const defaultAdminBanner = '';
  const defaultAdminBio =
    'Guardião do ecossistema Hikari e apreciador de narrativas profundas e inesquecíveis.';

  const resolvedUsername =
    typeof overrides.username === 'string' && overrides.username.trim().length > 0
      ? overrides.username.trim()
      : isAdmin
      ? defaultAdminUsername
      : fallbackUsername;

  const resolvedDisplayName =
    typeof overrides.displayName === 'string' && overrides.displayName.trim().length > 0
      ? overrides.displayName.trim()
      : isAdmin
      ? defaultAdminDisplayName
      : firebaseUser.displayName?.trim() || emailPrefix || 'Usuário Hikari';

  return {
    id: firebaseUser.uid,
    username: resolvedUsername,
    displayName: resolvedDisplayName,
    avatarUrl:
      overrides.avatarUrl !== undefined
        ? overrides.avatarUrl
        : isAdmin
        ? defaultAdminAvatar
        : firebaseUser.photoURL || '',
    bannerUrl:
      overrides.bannerUrl !== undefined
        ? overrides.bannerUrl
        : isAdmin
        ? defaultAdminBanner
        : '',
    bio:
      overrides.bio !== undefined
        ? overrides.bio
        : isAdmin
        ? defaultAdminBio
        : '',
    createdAt: formattedCreatedAt,
    createdAtTimestamp: validCreationMs,
    followersCount:
      typeof overrides.followersCount === 'number' && overrides.followersCount >= 0
        ? overrides.followersCount
        : 0,
    followingCount:
      typeof overrides.followingCount === 'number' && overrides.followingCount >= 0
        ? overrides.followingCount
        : 0,
    isPrivate: typeof overrides.isPrivate === 'boolean' ? overrides.isPrivate : false,
    showCommentsOnProfile:
      typeof overrides.showCommentsOnProfile === 'boolean'
        ? overrides.showCommentsOnProfile
        : true,
    privacySettings: overrides.privacySettings ?? {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true,
      allowDirectMessages: true,
      directMessagesFrom: 'everyone',
      showOnlineStatus: true,
    },
    externalAccounts: overrides.externalAccounts ?? {
      anilist: { connected: false },
      mal: { connected: false },
    },
  };
}

function sanitizeOverrides(raw: unknown): UserProfileOverrides {
  if (typeof raw !== 'object' || raw === null) return {};
  const src = raw as Record<string, unknown>;
  const overrides: UserProfileOverrides = {};

  if (typeof src.username === 'string') overrides.username = src.username;
  if (typeof src.displayName === 'string') overrides.displayName = src.displayName;
  if (typeof src.avatarUrl === 'string') overrides.avatarUrl = src.avatarUrl;
  if (typeof src.bannerUrl === 'string') overrides.bannerUrl = src.bannerUrl;
  if (typeof src.bio === 'string') overrides.bio = src.bio;
  if (typeof src.followersCount === 'number' && Number.isFinite(src.followersCount)) {
    overrides.followersCount = Math.max(0, Math.floor(src.followersCount));
  }
  if (typeof src.followingCount === 'number' && Number.isFinite(src.followingCount)) {
    overrides.followingCount = Math.max(0, Math.floor(src.followingCount));
  }
  if (typeof src.isPrivate === 'boolean') overrides.isPrivate = src.isPrivate;
  if (typeof src.showCommentsOnProfile === 'boolean') {
    overrides.showCommentsOnProfile = src.showCommentsOnProfile;
  }
  if (typeof src.privacySettings === 'object' && src.privacySettings !== null) {
    const ps = src.privacySettings as Record<string, unknown>;
    const hasAnyPrivacyKey =
      typeof ps.showAnimeList === 'boolean' ||
      typeof ps.showFavorites === 'boolean' ||
      typeof ps.showActivity === 'boolean' ||
      typeof ps.showCommentsOnProfile === 'boolean' ||
      typeof ps.allowDirectMessages === 'boolean' ||
      typeof ps.directMessagesFrom === 'string' ||
      typeof ps.showOnlineStatus === 'boolean';
    if (hasAnyPrivacyKey) {
      overrides.privacySettings = {
        showAnimeList: typeof ps.showAnimeList === 'boolean' ? ps.showAnimeList : true,
        showFavorites: typeof ps.showFavorites === 'boolean' ? ps.showFavorites : true,
        showActivity: typeof ps.showActivity === 'boolean' ? ps.showActivity : true,
        showCommentsOnProfile:
          typeof ps.showCommentsOnProfile === 'boolean'
            ? ps.showCommentsOnProfile
            : typeof src.showCommentsOnProfile === 'boolean'
            ? src.showCommentsOnProfile
            : true,
        allowDirectMessages:
          typeof ps.allowDirectMessages === 'boolean' ? ps.allowDirectMessages : true,
        directMessagesFrom:
          ps.directMessagesFrom === 'followers' || ps.directMessagesFrom === 'mutual'
            ? ps.directMessagesFrom
            : 'everyone',
        showOnlineStatus:
          typeof ps.showOnlineStatus === 'boolean' ? ps.showOnlineStatus : true,
      };
    }
  }
  if (typeof src.externalAccounts === 'object' && src.externalAccounts !== null) {
    const ext = src.externalAccounts as Record<string, unknown>;
    const anilistRaw =
      typeof ext.anilist === 'object' && ext.anilist !== null
        ? (ext.anilist as Record<string, unknown>)
        : {};
    const malRaw =
      typeof ext.mal === 'object' && ext.mal !== null
        ? (ext.mal as Record<string, unknown>)
        : {};
    overrides.externalAccounts = {
      anilist: {
        connected: Boolean(anilistRaw.connected),
        ...(typeof anilistRaw.username === 'string' ? { username: anilistRaw.username } : {}),
        ...(typeof anilistRaw.avatarUrl === 'string' ? { avatarUrl: anilistRaw.avatarUrl } : {}),
        ...(typeof anilistRaw.lastSync === 'string' ? { lastSync: anilistRaw.lastSync } : {}),
        ...(typeof anilistRaw.accountCreatedAt === 'string'
          ? { accountCreatedAt: anilistRaw.accountCreatedAt }
          : {}),
      },
      mal: {
        connected: Boolean(malRaw.connected),
        ...(typeof malRaw.username === 'string' ? { username: malRaw.username } : {}),
        ...(typeof malRaw.avatarUrl === 'string' ? { avatarUrl: malRaw.avatarUrl } : {}),
        ...(typeof malRaw.lastSync === 'string' ? { lastSync: malRaw.lastSync } : {}),
        ...(typeof malRaw.accountCreatedAt === 'string'
          ? { accountCreatedAt: malRaw.accountCreatedAt }
          : {}),
      },
    };
  }

  return overrides;
}

export function sanitizeWorkspaceForUid(
  raw: unknown,
  expectedUid: string
): UserPersonalWorkspace | null {
  const cleanUid = expectedUid.trim();
  if (!cleanUid || typeof raw !== 'object' || raw === null) {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.uid !== cleanUid) {
    return null;
  }

  return {
    version: 1,
    uid: cleanUid,
    profileOverrides: sanitizeOverrides(candidate.profileOverrides),
    animes: Array.isArray(candidate.animes) ? (candidate.animes as AnimeItem[]) : [],
    favoriteCharacters: Array.isArray(candidate.favoriteCharacters)
      ? (candidate.favoriteCharacters as FavoriteCharacter[])
      : [],
    favoriteCompanies: Array.isArray(candidate.favoriteCompanies)
      ? (candidate.favoriteCompanies as FavoriteCompany[])
      : [],
    favoritePeople: Array.isArray(candidate.favoritePeople)
      ? (candidate.favoritePeople as FavoritePerson[])
      : [],
    comments: Array.isArray(candidate.comments) ? (candidate.comments as HikariComment[]) : [],
    activities: Array.isArray(candidate.activities)
      ? (candidate.activities as UserActivity[])
      : [],
    notifications: Array.isArray(candidate.notifications)
      ? (candidate.notifications as NotificationItem[])
      : [],
    followers: Array.isArray(candidate.followers) ? (candidate.followers as FollowUser[]) : [],
    following: Array.isArray(candidate.following) ? (candidate.following as FollowUser[]) : [],
    followRequests: Array.isArray(candidate.followRequests)
      ? (candidate.followRequests as FollowRequest[])
      : [],
    followingIds: Array.isArray(candidate.followingIds)
      ? candidate.followingIds.filter((x): x is string => typeof x === 'string')
      : [],
    requestedIds: Array.isArray(candidate.requestedIds)
      ? candidate.requestedIds.filter((x): x is string => typeof x === 'string')
      : [],
    blockedIds: Array.isArray(candidate.blockedIds)
      ? candidate.blockedIds.filter((x): x is string => typeof x === 'string')
      : [],
    updatedAtMs:
      typeof candidate.updatedAtMs === 'number' && Number.isFinite(candidate.updatedAtMs)
        ? Math.max(0, Math.floor(candidate.updatedAtMs))
        : 0,
  };
}

export function readLocalUserWorkspace(uid: string): UserPersonalWorkspace | null {
  const cleanUid = uid.trim();
  if (!cleanUid) return null;
  ensureLifecycleListeners();

  const cached = workspaceMemoryCache.get(cleanUid);
  if (cached && cached.dirty) {
    return cached.workspace;
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    return cached?.workspace ?? null;
  }

  try {
    const raw = window.localStorage.getItem(getUserWorkspaceStorageKey(cleanUid));
    if (!raw) {
      workspaceMemoryCache.delete(cleanUid);
      return null;
    }
    if (cached && cached.lastRaw === raw) {
      return cached.workspace;
    }

    metricsJsonParseCalls++;
    const parsed: unknown = JSON.parse(raw);
    const sanitized = sanitizeWorkspaceForUid(parsed, cleanUid);
    if (sanitized) {
      workspaceMemoryCache.set(cleanUid, {
        workspace: sanitized,
        lastRaw: raw,
        dirty: false,
      });
    }
    return sanitized;
  } catch {
    return cached?.workspace ?? null;
  }
}

export function writeLocalUserWorkspace(
  uid: string,
  workspace: UserPersonalWorkspace,
  options?: { immediate?: boolean }
): UserPersonalWorkspace {
  const cleanUid = uid.trim();
  if (!cleanUid) {
    throw new Error('UID inválido ao salvar espaço pessoal.');
  }
  ensureLifecycleListeners();

  const normalized: UserPersonalWorkspace = {
    ...workspace,
    version: 1,
    uid: cleanUid,
    updatedAtMs: workspace.updatedAtMs > 0 ? Math.floor(workspace.updatedAtMs) : Date.now(),
  };

  const existing = workspaceMemoryCache.get(cleanUid);
  workspaceMemoryCache.set(cleanUid, {
    workspace: normalized,
    lastRaw: existing?.lastRaw ?? null,
    dirty: true,
  });

  if (options?.immediate) {
    flushSingleWorkspaceToLocalStorage(cleanUid);
    return normalized;
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    const existingTimer = workspaceWriteTimers.get(cleanUid);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      workspaceWriteTimers.delete(cleanUid);
      flushSingleWorkspaceToLocalStorage(cleanUid);
    }, LOCAL_STORAGE_WRITE_DEBOUNCE_MS);
    workspaceWriteTimers.set(cleanUid, timer);
  }

  return normalized;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry !== undefined) {
          result[key] = stripUndefinedDeep(entry);
        }
      }
      return result as T;
    }
  }
  return value;
}

function getFirestoreErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function sanitizeFirestoreUsername(username: string): string {
  const cleaned = username
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (cleaned.length >= 3) {
    return cleaned.slice(0, 32);
  }
  return `${cleaned || 'usuario'}_hikari`.slice(0, 32);
}

function computeFirestoreUserProfileSignature(resolvedProfile: UserProfile): {
  safeUsername: string;
  safeDisplayName: string;
  safeAvatarUrl: string;
  safeBannerUrl: string;
  safeBio: string;
  isPrivate: boolean;
  showCommentsOnProfile: boolean;
  privacySettings: {
    showAnimeList: boolean;
    showFavorites: boolean;
    showActivity: boolean;
    showCommentsOnProfile: boolean;
  };
  signature: string;
} {
  const safeUsername = sanitizeFirestoreUsername(resolvedProfile.username);
  const safeDisplayName = (resolvedProfile.displayName.trim() || 'Usuário Hikari').slice(0, 60);
  const safeAvatarUrl =
    resolvedProfile.avatarUrl.length <= 2048 ? resolvedProfile.avatarUrl : '';
  const safeBannerUrl =
    resolvedProfile.bannerUrl.length <= 2048 ? resolvedProfile.bannerUrl : '';
  const safeBio = resolvedProfile.bio.slice(0, 500);
  const isPrivate = Boolean(resolvedProfile.isPrivate);
  const showCommentsOnProfile = Boolean(resolvedProfile.showCommentsOnProfile);
  const privacySettings = {
    showAnimeList: Boolean(resolvedProfile.privacySettings.showAnimeList),
    showFavorites: Boolean(resolvedProfile.privacySettings.showFavorites),
    showActivity: Boolean(resolvedProfile.privacySettings.showActivity),
    showCommentsOnProfile: Boolean(resolvedProfile.privacySettings.showCommentsOnProfile),
  };

  const signature = [
    safeUsername,
    safeDisplayName,
    safeAvatarUrl,
    safeBannerUrl,
    safeBio,
    isPrivate ? '1' : '0',
    showCommentsOnProfile ? '1' : '0',
    privacySettings.showAnimeList ? '1' : '0',
    privacySettings.showFavorites ? '1' : '0',
    privacySettings.showActivity ? '1' : '0',
    privacySettings.showCommentsOnProfile ? '1' : '0',
  ].join('\u001f');

  return {
    safeUsername,
    safeDisplayName,
    safeAvatarUrl,
    safeBannerUrl,
    safeBio,
    isPrivate,
    showCommentsOnProfile,
    privacySettings,
    signature,
  };
}

export async function loadUserWorkspaceFromFirestore(uid: string): Promise<{
  workspace: UserPersonalWorkspace | null;
  status: FirestoreSyncStatus;
}> {
  const cleanUid = uid.trim();
  if (!cleanUid) {
    return { workspace: null, status: 'error' };
  }
  if (!firebaseConfigStatus.isInitialized || !db) {
    return { workspace: null, status: 'unconfigured' };
  }

  try {
    const personalRef = doc(db, 'users', cleanUid, 'workspace', 'personal');
    const profileRef = doc(db, 'users', cleanUid);

    metricsFirestoreGetDocCalls += 2;
    const [personalSnap, profileSnap] = await Promise.all([
      getDoc(personalRef),
      getDoc(profileRef),
    ]);

    remoteDocMetaByUid.set(cleanUid, {
      userDocExists: profileSnap.exists(),
      personalDocExists: personalSnap.exists(),
      lastUserProfileSig: null,
    });

    if (personalSnap.exists()) {
      const data = personalSnap.data();
      const updatedAtTimestamp = data.updatedAt as Timestamp | undefined;
      const remoteUpdatedAtMs =
        typeof data.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
          ? data.updatedAtMs
          : updatedAtTimestamp && typeof updatedAtTimestamp.toMillis === 'function'
          ? updatedAtTimestamp.toMillis()
          : Date.now();

      const sanitized = sanitizeWorkspaceForUid(
        {
          ...data,
          updatedAtMs: remoteUpdatedAtMs,
        },
        cleanUid
      );

      if (sanitized) {
        return { workspace: sanitized, status: 'synced' };
      }
    }

    if (profileSnap.exists()) {
      const pData = profileSnap.data();
      if (pData.uid === cleanUid) {
        const base = createEmptyUserWorkspace(cleanUid);
        const updatedAtTs = pData.updatedAt as Timestamp | undefined;
        base.profileOverrides = sanitizeOverrides(pData);
        base.updatedAtMs =
          updatedAtTs && typeof updatedAtTs.toMillis === 'function'
            ? updatedAtTs.toMillis()
            : Date.now();
        return { workspace: base, status: 'synced' };
      }
    }

    return { workspace: null, status: 'empty_remote' };
  } catch (err) {
    const code = getFirestoreErrorCode(err);
    if (code === 'permission-denied') {
      return { workspace: null, status: 'permission_denied' };
    }
    return { workspace: null, status: 'error' };
  }
}

async function performFirestoreBatchCommit(
  cleanUid: string,
  resolvedProfile: UserProfile,
  workspace: UserPersonalWorkspace,
  allowNotFoundRetry = true
): Promise<FirestoreSyncStatus> {
  if (!firebaseConfigStatus.isInitialized || !db) {
    return 'unconfigured';
  }

  try {
    const userDocRef = doc(db, 'users', cleanUid);
    const personalDocRef = doc(db, 'users', cleanUid, 'workspace', 'personal');

    let docMeta = remoteDocMetaByUid.get(cleanUid);
    if (!docMeta) {
      metricsFirestoreGetDocCalls += 2;
      const [existingProfileSnap, existingPersonalSnap] = await Promise.all([
        getDoc(userDocRef),
        getDoc(personalDocRef),
      ]);
      docMeta = {
        userDocExists: existingProfileSnap.exists(),
        personalDocExists: existingPersonalSnap.exists(),
        lastUserProfileSig: null,
      };
      remoteDocMetaByUid.set(cleanUid, docMeta);
    }

    const profilePrepared = computeFirestoreUserProfileSignature(resolvedProfile);
    const shouldWriteUserDoc =
      !docMeta.userDocExists || docMeta.lastUserProfileSig !== profilePrepared.signature;

    // Cap inline data URLs inside Firestore personal workspace if larger than 400KB to respect 1MB doc limit
    const safeOverrides: UserProfileOverrides = stripUndefinedDeep({
      ...workspace.profileOverrides,
      ...(typeof workspace.profileOverrides.avatarUrl === 'string' &&
      workspace.profileOverrides.avatarUrl.length > 400_000
        ? { avatarUrl: '' }
        : {}),
      ...(typeof workspace.profileOverrides.bannerUrl === 'string' &&
      workspace.profileOverrides.bannerUrl.length > 400_000
        ? { bannerUrl: '' }
        : {}),
    });

    const workspaceFields = stripUndefinedDeep({
      profileOverrides: safeOverrides,
      animes: workspace.animes.slice(0, 2000),
      favoriteCharacters: workspace.favoriteCharacters.slice(0, 50),
      favoriteCompanies: workspace.favoriteCompanies.slice(0, 50),
      favoritePeople: workspace.favoritePeople.slice(0, 50),
      comments: workspace.comments.slice(0, 1000),
      activities: workspace.activities.slice(0, 1000),
      notifications: workspace.notifications.slice(0, 500),
      followers: workspace.followers.slice(0, 2000),
      following: workspace.following.slice(0, 2000),
      followRequests: workspace.followRequests.slice(0, 500),
      followingIds: workspace.followingIds.slice(0, 2000),
      requestedIds: workspace.requestedIds.slice(0, 500),
      blockedIds: workspace.blockedIds.slice(0, 500),
      updatedAtMs: Math.max(0, Math.floor(workspace.updatedAtMs || Date.now())),
    });

    const batch = writeBatch(db);

    if (shouldWriteUserDoc) {
      if (!docMeta.userDocExists) {
        batch.set(userDocRef, {
          uid: cleanUid,
          username: profilePrepared.safeUsername,
          displayName: profilePrepared.safeDisplayName,
          avatarUrl: profilePrepared.safeAvatarUrl,
          bannerUrl: profilePrepared.safeBannerUrl,
          bio: profilePrepared.safeBio,
          isPrivate: profilePrepared.isPrivate,
          showCommentsOnProfile: profilePrepared.showCommentsOnProfile,
          privacySettings: profilePrepared.privacySettings,
          followersCount: 0,
          followingCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(userDocRef, {
          username: profilePrepared.safeUsername,
          displayName: profilePrepared.safeDisplayName,
          avatarUrl: profilePrepared.safeAvatarUrl,
          bannerUrl: profilePrepared.safeBannerUrl,
          bio: profilePrepared.safeBio,
          isPrivate: profilePrepared.isPrivate,
          showCommentsOnProfile: profilePrepared.showCommentsOnProfile,
          privacySettings: profilePrepared.privacySettings,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (!docMeta.personalDocExists) {
      batch.set(personalDocRef, {
        uid: cleanUid,
        ...workspaceFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(personalDocRef, {
        ...workspaceFields,
        updatedAt: serverTimestamp(),
      });
    }

    metricsFirestoreBatchCommits++;
    await batch.commit();

    remoteDocMetaByUid.set(cleanUid, {
      userDocExists: true,
      personalDocExists: true,
      lastUserProfileSig: profilePrepared.signature,
    });

    return 'synced';
  } catch (err) {
    const code = getFirestoreErrorCode(err);
    if (allowNotFoundRetry && (code === 'not-found' || code.endsWith('/not-found'))) {
      remoteDocMetaByUid.delete(cleanUid);
      return performFirestoreBatchCommit(cleanUid, resolvedProfile, workspace, false);
    }
    if (code === 'permission-denied') {
      return 'permission_denied';
    }
    return 'error';
  }
}

async function executeQueuedFirestoreSave(uid: string): Promise<FirestoreSyncStatus> {
  const pending = pendingFirestoreSavesByUid.get(uid);
  if (!pending) {
    return 'idle';
  }

  if (pending.timer !== null) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  pendingFirestoreSavesByUid.delete(uid);

  const priorCommit = inFlightFirestoreCommitByUid.get(uid);
  if (priorCommit) {
    try {
      await priorCommit;
    } catch {
      // Ignore prior error
    }
  }

  const commitPromise = performFirestoreBatchCommit(
    pending.uid,
    pending.resolvedProfile,
    pending.workspace
  );
  inFlightFirestoreCommitByUid.set(uid, commitPromise);

  try {
    const status = await commitPromise;
    for (const resolve of pending.resolvers) {
      resolve(status);
    }
    return status;
  } finally {
    if (inFlightFirestoreCommitByUid.get(uid) === commitPromise) {
      inFlightFirestoreCommitByUid.delete(uid);
    }
  }
}

export async function flushPendingWorkspaceWrites(): Promise<void> {
  flushPendingWorkspaceStorageWrites();
  const uids = Array.from(pendingFirestoreSavesByUid.keys());
  if (uids.length > 0) {
    await Promise.all(uids.map((uid) => executeQueuedFirestoreSave(uid)));
  }
}

export async function saveUserWorkspaceToFirestore(
  uid: string,
  resolvedProfile: UserProfile,
  workspace: UserPersonalWorkspace,
  options?: { immediate?: boolean }
): Promise<FirestoreSyncStatus> {
  const cleanUid = uid.trim();
  if (!cleanUid || workspace.uid !== cleanUid || resolvedProfile.id !== cleanUid) {
    return 'error';
  }
  if (!firebaseConfigStatus.isInitialized || !db) {
    return 'unconfigured';
  }

  ensureLifecycleListeners();

  if (options?.immediate) {
    const existingPending = pendingFirestoreSavesByUid.get(cleanUid);
    if (existingPending) {
      if (existingPending.timer !== null) {
        clearTimeout(existingPending.timer);
      }
      pendingFirestoreSavesByUid.delete(cleanUid);
      const status = await performFirestoreBatchCommit(cleanUid, resolvedProfile, workspace);
      for (const resolve of existingPending.resolvers) {
        resolve(status);
      }
      return status;
    }
    return performFirestoreBatchCommit(cleanUid, resolvedProfile, workspace);
  }

  return new Promise<FirestoreSyncStatus>((resolve) => {
    const existing = pendingFirestoreSavesByUid.get(cleanUid);
    if (existing) {
      if (existing.timer !== null) {
        clearTimeout(existing.timer);
      }
      existing.resolvedProfile = resolvedProfile;
      existing.workspace = workspace;
      existing.resolvers.push(resolve);
      existing.timer = setTimeout(() => {
        void executeQueuedFirestoreSave(cleanUid);
      }, FIRESTORE_SAVE_DEBOUNCE_MS);
      return;
    }

    const entry: PendingFirestoreSave = {
      uid: cleanUid,
      resolvedProfile,
      workspace,
      timer: null,
      resolvers: [resolve],
    };
    entry.timer = setTimeout(() => {
      void executeQueuedFirestoreSave(cleanUid);
    }, FIRESTORE_SAVE_DEBOUNCE_MS);
    pendingFirestoreSavesByUid.set(cleanUid, entry);
  });
}

function getOrLoadPublicProfilesRawMap(): Record<string, unknown> {
  ensureLifecycleListeners();

  if (publicProfilesRawMapCache !== null && publicProfilesDirty) {
    return publicProfilesRawMapCache;
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    if (!publicProfilesRawMapCache) {
      publicProfilesRawMapCache = {};
    }
    return publicProfilesRawMapCache;
  }

  try {
    const raw = window.localStorage.getItem(PUBLIC_PROFILES_STORAGE_KEY);
    if (publicProfilesRawMapCache !== null && raw === publicProfilesLastRaw) {
      return publicProfilesRawMapCache;
    }
    publicProfilesLastRaw = raw;
    publicProfilesSanitizedCache = null;

    if (!raw) {
      publicProfilesRawMapCache = {};
      return publicProfilesRawMapCache;
    }

    metricsJsonParseCalls++;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      publicProfilesRawMapCache = { ...(parsed as Record<string, unknown>) };
      return publicProfilesRawMapCache;
    }
  } catch {
    // Fallback to empty object
  }

  publicProfilesRawMapCache = publicProfilesRawMapCache ?? {};
  return publicProfilesRawMapCache;
}

function schedulePublicProfilesWrite(immediate = false): void {
  publicProfilesDirty = true;
  publicProfilesSanitizedCache = null;

  if (immediate) {
    flushPublicProfilesToLocalStorage();
    return;
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    if (publicProfilesWriteTimer !== null) {
      clearTimeout(publicProfilesWriteTimer);
    }
    publicProfilesWriteTimer = setTimeout(() => {
      publicProfilesWriteTimer = null;
      flushPublicProfilesToLocalStorage();
    }, LOCAL_STORAGE_WRITE_DEBOUNCE_MS);
  }
}

/**
 * Writes a sanitized public projection of an authenticated user's profile so
 * other users can visit the profile without ever having read access to private
 * workspaces or private anime lists. When showAnimeList is false (or profile is
 * private), publicAnimes is stripped to [] at write time while numeric stats remain.
 */
export function syncPublicProfileProjection(
  profile: UserProfile,
  animes: AnimeItem[],
  updatedAtMs: number = Date.now(),
  options?: { immediate?: boolean }
): void {
  const cleanUid = profile.id.trim();
  if (!cleanUid || typeof window === 'undefined') return;

  const canExposeAnimeItems =
    !profile.isPrivate && profile.privacySettings?.showAnimeList !== false;

  const normalizedUpdatedAt = Math.max(0, Math.floor(updatedAtMs));
  const profileSig = [
    profile.username,
    profile.displayName,
    profile.avatarUrl,
    profile.bannerUrl,
    profile.bio,
    profile.followersCount,
    profile.followingCount,
    profile.isPrivate ? '1' : '0',
    profile.showCommentsOnProfile ? '1' : '0',
    profile.privacySettings?.showAnimeList !== false ? '1' : '0',
    profile.privacySettings?.showFavorites !== false ? '1' : '0',
    profile.privacySettings?.showActivity !== false ? '1' : '0',
    profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile ? '1' : '0',
  ].join('\u001f');

  const prevProj = lastProjectionSignatureByUid.get(cleanUid);
  if (
    prevProj &&
    prevProj.profileSig === profileSig &&
    prevProj.animesRef === animes &&
    prevProj.updatedAtMs === normalizedUpdatedAt
  ) {
    if (options?.immediate) {
      flushPublicProfilesToLocalStorage();
    }
    return;
  }

  lastProjectionSignatureByUid.set(cleanUid, {
    profileSig,
    animesRef: animes,
    updatedAtMs: normalizedUpdatedAt,
  });

  const projection: PublicProfileProjection = {
    profile: {
      id: cleanUid,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bannerUrl: profile.bannerUrl,
      bio: profile.bio,
      createdAt: profile.createdAt,
      createdAtTimestamp: profile.createdAtTimestamp,
      followersCount: profile.followersCount,
      followingCount: profile.followingCount,
      isPrivate: Boolean(profile.isPrivate),
      showCommentsOnProfile: Boolean(profile.showCommentsOnProfile),
      privacySettings: {
        showAnimeList: profile.privacySettings?.showAnimeList !== false,
        showFavorites: profile.privacySettings?.showFavorites !== false,
        showActivity: profile.privacySettings?.showActivity !== false,
        showCommentsOnProfile:
          profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile,
      },
      externalAccounts: {
        anilist: { connected: false },
        mal: { connected: false },
      },
    },
    animeStats: computeAnimeStats(animes),
    publicAnimes: canExposeAnimeItems ? animes.slice(0, 2000) : [],
    updatedAtMs: normalizedUpdatedAt,
  };

  const map = getOrLoadPublicProfilesRawMap();
  map[cleanUid] = projection;
  schedulePublicProfilesWrite(Boolean(options?.immediate));
}

/**
 * Updates followersCount on a cached public profile projection without repeating JSON.parse/stringify.
 */
export function adjustCachedPublicProfileFollowersCount(targetUid: string, delta: number): void {
  const cleanUid = targetUid.trim();
  if (!cleanUid || delta === 0 || typeof window === 'undefined') return;
  const map = getOrLoadPublicProfilesRawMap();
  const entry = map[cleanUid];
  if (entry && typeof entry === 'object' && entry !== null) {
    const rec = entry as Record<string, unknown>;
    if (rec.profile && typeof rec.profile === 'object' && rec.profile !== null) {
      const p = rec.profile as Record<string, unknown>;
      const prevCount =
        typeof p.followersCount === 'number' && Number.isFinite(p.followersCount)
          ? p.followersCount
          : delta < 0
          ? 1
          : 0;
      map[cleanUid] = {
        ...rec,
        profile: {
          ...p,
          followersCount: Math.max(0, prevCount + delta),
        },
      };
      schedulePublicProfilesWrite(false);
    }
  }
}

export function readPublicProfilesMap(
  excludeUid?: string
): Record<string, PublicProfileProjection> {
  if (typeof window === 'undefined') return {};

  const parsed = getOrLoadPublicProfilesRawMap();

  if (!publicProfilesSanitizedCache) {
    const built: Record<string, PublicProfileProjection> = {};
    for (const [uid, entry] of Object.entries(parsed)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.profile !== 'object' || rec.profile === null) continue;
      const p = rec.profile as Record<string, unknown>;
      if (typeof p.id !== 'string' || p.id !== uid || typeof p.username !== 'string') continue;

      const overrides = sanitizeOverrides(p);
      const showAnimeList = overrides.privacySettings?.showAnimeList !== false;
      const isPrivate = Boolean(p.isPrivate);
      const canExpose = !isPrivate && showAnimeList;

      const safeProfile: UserProfile = {
        id: uid,
        username: p.username,
        displayName: typeof p.displayName === 'string' ? p.displayName : p.username,
        avatarUrl: typeof p.avatarUrl === 'string' ? p.avatarUrl : '',
        bannerUrl: typeof p.bannerUrl === 'string' ? p.bannerUrl : '',
        bio: typeof p.bio === 'string' ? p.bio : '',
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
        createdAtTimestamp:
          typeof p.createdAtTimestamp === 'number' && Number.isFinite(p.createdAtTimestamp)
            ? p.createdAtTimestamp
            : 0,
        followersCount: overrides.followersCount ?? 0,
        followingCount: overrides.followingCount ?? 0,
        isPrivate,
        showCommentsOnProfile: overrides.showCommentsOnProfile ?? true,
        privacySettings: overrides.privacySettings ?? {
          showAnimeList: true,
          showFavorites: true,
          showActivity: true,
          showCommentsOnProfile: true,
        },
        externalAccounts: {
          anilist: { connected: false },
          mal: { connected: false },
        },
      };

      const rawPublicAnimes =
        canExpose && Array.isArray(rec.publicAnimes) ? (rec.publicAnimes as AnimeItem[]) : [];

      const safeStats =
        sanitizeAnimeStatsSummary(rec.animeStats) ??
        (rawPublicAnimes.length > 0 ? computeAnimeStats(rawPublicAnimes) : EMPTY_ANIME_STATS);

      built[uid] = {
        profile: safeProfile,
        animeStats: safeStats,
        publicAnimes: canExpose ? rawPublicAnimes : [],
        updatedAtMs:
          typeof rec.updatedAtMs === 'number' && Number.isFinite(rec.updatedAtMs)
            ? Math.max(0, Math.floor(rec.updatedAtMs))
            : 0,
      };
    }
    publicProfilesSanitizedCache = built;
  }

  if (!excludeUid) {
    return { ...publicProfilesSanitizedCache };
  }

  const filtered: Record<string, PublicProfileProjection> = {};
  for (const [uid, proj] of Object.entries(publicProfilesSanitizedCache)) {
    if (uid !== excludeUid) {
      filtered[uid] = proj;
    }
  }
  return filtered;
}

export async function loadPublicProfileFromFirestore(
  targetUid: string
): Promise<UserProfile | null> {
  const cleanUid = targetUid.trim();
  if (!cleanUid || !firebaseConfigStatus.isInitialized || !db) {
    return null;
  }

  const now = Date.now();
  const cached = remotePublicProfileCache.get(cleanUid);
  if (cached && now - cached.fetchedAtMs < PUBLIC_PROFILE_REMOTE_TTL_MS) {
    return cached.profile;
  }

  const inFlight = inFlightPublicProfileLoads.get(cleanUid);
  if (inFlight) {
    return inFlight;
  }

  const request = (async (): Promise<UserProfile | null> => {
    try {
      const profileRef = doc(db, 'users', cleanUid);
      metricsFirestoreGetDocCalls++;
      const snap = await getDoc(profileRef);
      if (!snap.exists()) {
        remotePublicProfileCache.set(cleanUid, { profile: null, fetchedAtMs: Date.now() });
        return null;
      }
      const data = snap.data();
      if (data.uid !== cleanUid || typeof data.username !== 'string') {
        remotePublicProfileCache.set(cleanUid, { profile: null, fetchedAtMs: Date.now() });
        return null;
      }

      const overrides = sanitizeOverrides(data);
      const createdAtTs = data.createdAt as Timestamp | undefined;
      const createdMs =
        createdAtTs && typeof createdAtTs.toMillis === 'function' ? createdAtTs.toMillis() : 0;
      const formattedCreatedAt =
        createdMs > 0
          ? new Date(createdMs).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })
          : '';

      const profile: UserProfile = {
        id: cleanUid,
        username: data.username,
        displayName:
          typeof data.displayName === 'string' && data.displayName.trim()
            ? data.displayName.trim()
            : data.username,
        avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
        bannerUrl: typeof data.bannerUrl === 'string' ? data.bannerUrl : '',
        bio: typeof data.bio === 'string' ? data.bio : '',
        createdAt: formattedCreatedAt,
        createdAtTimestamp: createdMs,
        followersCount: overrides.followersCount ?? 0,
        followingCount: overrides.followingCount ?? 0,
        isPrivate: Boolean(data.isPrivate),
        showCommentsOnProfile: overrides.showCommentsOnProfile ?? true,
        privacySettings: overrides.privacySettings ?? {
          showAnimeList: true,
          showFavorites: true,
          showActivity: true,
          showCommentsOnProfile: true,
        },
        externalAccounts: {
          anilist: { connected: false },
          mal: { connected: false },
        },
      };

      remotePublicProfileCache.set(cleanUid, { profile, fetchedAtMs: Date.now() });
      return profile;
    } catch {
      return null;
    } finally {
      inFlightPublicProfileLoads.delete(cleanUid);
    }
  })();

  inFlightPublicProfileLoads.set(cleanUid, request);
  return request;
}
