import type { User as FirebaseUser } from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
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

export const USER_WORKSPACE_STORAGE_PREFIX = 'hikari_user_workspace_v1:';

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

  const resolvedUsername =
    typeof overrides.username === 'string' && overrides.username.trim().length > 0
      ? overrides.username.trim()
      : fallbackUsername;

  const resolvedDisplayName =
    typeof overrides.displayName === 'string' && overrides.displayName.trim().length > 0
      ? overrides.displayName.trim()
      : firebaseUser.displayName?.trim() || emailPrefix || 'Usuário Hikari';

  return {
    id: firebaseUser.uid,
    username: resolvedUsername,
    displayName: resolvedDisplayName,
    avatarUrl:
      overrides.avatarUrl !== undefined ? overrides.avatarUrl : firebaseUser.photoURL || '',
    bannerUrl: overrides.bannerUrl !== undefined ? overrides.bannerUrl : '',
    bio: overrides.bio !== undefined ? overrides.bio : '',
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
    if (
      typeof ps.showAnimeList === 'boolean' &&
      typeof ps.showFavorites === 'boolean' &&
      typeof ps.showActivity === 'boolean' &&
      typeof ps.showCommentsOnProfile === 'boolean'
    ) {
      overrides.privacySettings = {
        showAnimeList: ps.showAnimeList,
        showFavorites: ps.showFavorites,
        showActivity: ps.showActivity,
        showCommentsOnProfile: ps.showCommentsOnProfile,
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
      },
      mal: {
        connected: Boolean(malRaw.connected),
        ...(typeof malRaw.username === 'string' ? { username: malRaw.username } : {}),
        ...(typeof malRaw.avatarUrl === 'string' ? { avatarUrl: malRaw.avatarUrl } : {}),
        ...(typeof malRaw.lastSync === 'string' ? { lastSync: malRaw.lastSync } : {}),
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
    // Reject any payload that does not strictly match the authenticated Firebase UID
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
  if (!cleanUid || typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getUserWorkspaceStorageKey(cleanUid));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return sanitizeWorkspaceForUid(parsed, cleanUid);
  } catch {
    return null;
  }
}

export function writeLocalUserWorkspace(
  uid: string,
  workspace: UserPersonalWorkspace
): UserPersonalWorkspace {
  const cleanUid = uid.trim();
  if (!cleanUid) {
    throw new Error('UID inválido ao salvar espaço pessoal.');
  }

  const normalized: UserPersonalWorkspace = {
    ...workspace,
    version: 1,
    uid: cleanUid,
    updatedAtMs: workspace.updatedAtMs > 0 ? Math.floor(workspace.updatedAtMs) : Date.now(),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        getUserWorkspaceStorageKey(cleanUid),
        JSON.stringify(normalized)
      );
    } catch {
      // Keep in-memory workspace intact even if browser storage quota is exceeded
    }
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
    const personalSnap = await getDoc(personalRef);

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

    const profileRef = doc(db, 'users', cleanUid);
    const profileSnap = await getDoc(profileRef);
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

export async function saveUserWorkspaceToFirestore(
  uid: string,
  resolvedProfile: UserProfile,
  workspace: UserPersonalWorkspace
): Promise<FirestoreSyncStatus> {
  const cleanUid = uid.trim();
  if (!cleanUid || workspace.uid !== cleanUid || resolvedProfile.id !== cleanUid) {
    return 'error';
  }
  if (!firebaseConfigStatus.isInitialized || !db) {
    return 'unconfigured';
  }

  try {
    const userDocRef = doc(db, 'users', cleanUid);
    const existingProfileSnap = await getDoc(userDocRef);

    const safeUsername = sanitizeFirestoreUsername(resolvedProfile.username);
    const safeDisplayName = (resolvedProfile.displayName.trim() || 'Usuário Hikari').slice(0, 60);
    const safeAvatarUrl =
      resolvedProfile.avatarUrl.length <= 2048 ? resolvedProfile.avatarUrl : '';
    const safeBannerUrl =
      resolvedProfile.bannerUrl.length <= 2048 ? resolvedProfile.bannerUrl : '';
    const safeBio = resolvedProfile.bio.slice(0, 500);

    if (!existingProfileSnap.exists()) {
      await setDoc(userDocRef, {
        uid: cleanUid,
        username: safeUsername,
        displayName: safeDisplayName,
        avatarUrl: safeAvatarUrl,
        bannerUrl: safeBannerUrl,
        bio: safeBio,
        isPrivate: Boolean(resolvedProfile.isPrivate),
        showCommentsOnProfile: Boolean(resolvedProfile.showCommentsOnProfile),
        privacySettings: {
          showAnimeList: Boolean(resolvedProfile.privacySettings.showAnimeList),
          showFavorites: Boolean(resolvedProfile.privacySettings.showFavorites),
          showActivity: Boolean(resolvedProfile.privacySettings.showActivity),
          showCommentsOnProfile: Boolean(resolvedProfile.privacySettings.showCommentsOnProfile),
        },
        followersCount: 0,
        followingCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userDocRef, {
        username: safeUsername,
        displayName: safeDisplayName,
        avatarUrl: safeAvatarUrl,
        bannerUrl: safeBannerUrl,
        bio: safeBio,
        isPrivate: Boolean(resolvedProfile.isPrivate),
        showCommentsOnProfile: Boolean(resolvedProfile.showCommentsOnProfile),
        privacySettings: {
          showAnimeList: Boolean(resolvedProfile.privacySettings.showAnimeList),
          showFavorites: Boolean(resolvedProfile.privacySettings.showFavorites),
          showActivity: Boolean(resolvedProfile.privacySettings.showActivity),
          showCommentsOnProfile: Boolean(resolvedProfile.privacySettings.showCommentsOnProfile),
        },
        updatedAt: serverTimestamp(),
      });
    }

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

    const personalDocRef = doc(db, 'users', cleanUid, 'workspace', 'personal');
    const existingPersonalSnap = await getDoc(personalDocRef);

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

    if (!existingPersonalSnap.exists()) {
      await setDoc(personalDocRef, {
        uid: cleanUid,
        ...workspaceFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(personalDocRef, {
        ...workspaceFields,
        updatedAt: serverTimestamp(),
      });
    }

    return 'synced';
  } catch (err) {
    const code = getFirestoreErrorCode(err);
    if (code === 'permission-denied') {
      return 'permission_denied';
    }
    return 'error';
  }
}
