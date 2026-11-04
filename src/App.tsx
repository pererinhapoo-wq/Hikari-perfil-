import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { ENABLE_PRIVATE_MESSAGES } from './config/features';
import { updateProfile } from 'firebase/auth';
import { Header } from './components/Header';
import { ProfileHeader } from './components/ProfileHeader';
import { TabsNavigation } from './components/TabsNavigation';
import { OverviewTab } from './components/tabs/OverviewTab';
import { PrivateProfileNotice } from './components/PrivateProfileNotice';
import {
  TabSectionFallback,
  ModalLoadingFallback,
  FullPageRouteFallback,
} from './components/common/LazyFallbacks';
import {
  syncUserPrivacyContext,
  subscribeToUnreadMessagesCount,
  canUserMessageRecipient,
  clearChatSessionMemoryCache,
  setActiveChatSessionUser,
  type UserCheckContext,
} from './services/chatService';
import {
  syncOwnerSocialWorkspace,
  fetchAuthorizedUserProfileComplete,
  followRemoteUser,
  unfollowRemoteUser,
  removeRemoteFollower,
  submitRemoteProfileReport,
  respondRemoteFollowRequest,
  fetchOwnerNotifications,
  markOwnerNotificationsRead,
  type AuthorizedPublicProfilePayload,
  type OwnerSocialNotificationsState,
} from './services/socialService';

const LazyAnimeListTab = lazy(() =>
  import('./components/tabs/AnimeListTab').then((m) => ({ default: m.AnimeListTab }))
);
const LazyActivityTab = lazy(() =>
  import('./components/tabs/ActivityTab').then((m) => ({ default: m.ActivityTab }))
);
const LazyCommentsTab = lazy(() =>
  import('./components/tabs/CommentsTab').then((m) => ({ default: m.CommentsTab }))
);
const LazyAboutTab = lazy(() =>
  import('./components/tabs/AboutTab').then((m) => ({ default: m.AboutTab }))
);
const LazyAdminPanel = lazy(() =>
  import('./components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel }))
);
const LazyAdminAccessDenied = lazy(() =>
  import('./components/admin/AdminAccessDenied').then((m) => ({ default: m.AdminAccessDenied }))
);
const LazyAuthScreen = lazy(() =>
  import('./components/auth/AuthScreen').then((m) => ({ default: m.AuthScreen }))
);
const LazySettingsModal = lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const LazyPrivateChatModal = lazy(() =>
  import('./components/chat/PrivateChatModal').then((m) => ({ default: m.PrivateChatModal }))
);
const LazyFollowersModal = lazy(() =>
  import('./components/modals/FollowersModal').then((m) => ({ default: m.FollowersModal }))
);
import { ProfileSearchModal } from './components/modals/ProfileSearchModal';
import { 
  UserProfile, 
  ProfileTab, 
  AnimeItem, 
  AnimeStatus,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
  HikariComment, 
  UserActivity, 
  FollowUser, 
  FollowRequest, 
  NotificationItem,
  AUTHORIZED_ADMIN_UID,
} from './types';
import { 
  CURRENT_USER, 
  OTHER_USERS, 
  INITIAL_ANIMES, 
  AETHER_ANIMES,
  FAVORITE_CHARACTERS,
  FAVORITE_COMPANIES,
  FAVORITE_PEOPLE,
  INITIAL_COMMENTS, 
  INITIAL_ACTIVITIES, 
  INITIAL_FOLLOWERS, 
  INITIAL_FOLLOWING, 
  INITIAL_FOLLOW_REQUESTS, 
  INITIAL_NOTIFICATIONS 
} from './data/mockData';
import { inferOffsetMsFromLabel } from './utils/relativeTime';
import { computeAnimeStats, EMPTY_ANIME_STATS, updateSingleAnimeById } from './utils/animeStats';
import {
  getLastFetchedAniListCharacters,
  getLastFetchedAniListCompanies,
  getLastFetchedAniListPeople,
  clearLastFetchedAniListFavorites,
  mergeFavoriteCharacters,
  mergeFavoriteCompanies,
  mergeFavoritePeople,
  pruneAniListFavoritesOnDisconnect,
  isGenericOrMissingPoster,
  normalizeTitle,
} from './utils/animeSyncHelpers';
import { useAuth } from './contexts/AuthContext';
import { uploadProfileMedia } from './services/profileMediaService';
import {
  PUBLIC_PROFILES_STORAGE_KEY,
  adjustCachedPublicProfileFollowersCount,
  buildProfileFromFirebaseUser,
  createEmptyUserWorkspace,
  flushPendingWorkspaceWrites,
  getUserWorkspaceStorageKey,
  loadFullPublicProfileFromFirestore,
  loadUserWorkspaceFromFirestore,
  purgeCachedPublicProfileProjection,
  readLocalUserWorkspace,
  readPublicProfilesMap,
  saveUserWorkspaceToFirestore,
  syncPublicProfileProjection,
  writeLocalUserWorkspace,
  hydrateWorkspaceFromIndexedDb,
  clearSessionWorkspaceCaches,
  type FirestoreSyncStatus,
  type UserPersonalWorkspace,
  type UserProfileOverrides,
} from './lib/userWorkspaceStorage';
import {
  clearAllMemoryCache,
  invalidateAnimeStatusChange,
  invalidateAnimeCategory,
  invalidateAllAnimeCategories,
  invalidateActivitiesCache,
  updateCachedAnimeLocally,
} from './lib/profileCacheManager';
import {
  migrateAnimeListProvenance,
  markAnimeLocallyModified,
} from './utils/animeProvenance';
import {
  pruneAnimesOnDisconnect,
  type DisconnectPruneResult,
} from './utils/animeDisconnection';
import {
  saveAllAnimesToChunkedFirestore,
  clearChunkedStorageMemoryCache,
} from './lib/chunkedAnimeStorage';
import { saveAnimesToIndexedDb } from './lib/indexedDbStorage';

const DEMO_PROFILE_STORAGE_KEY = 'hikari_profile_user_data_v1';

interface PersistedDemoProfileData {
  profileOverrides?: UserProfileOverrides;
  animes: AnimeItem[];
  favoriteCharacters?: FavoriteCharacter[];
  favoriteCompanies?: FavoriteCompany[];
  favoritePeople?: FavoritePerson[];
  comments: HikariComment[];
  activities: UserActivity[];
  notifications: NotificationItem[];
  followingIds?: string[];
  requestedIds?: string[];
  blockedIds?: string[];
  following?: FollowUser[];
  followers?: FollowUser[];
  followRequests?: FollowRequest[];
  otherProfiles?: Record<string, UserProfile>;
}

interface AuthSessionState {
  uid: string;
  workspace: UserPersonalWorkspace;
  firestoreStatus: FirestoreSyncStatus;
}

interface AdminVerificationState {
  uid: string | null;
  authorized: boolean;
  token: string | null;
  status: 'idle' | 'verifying' | 'resolved';
}

const NEUTRAL_LOADING_PROFILE: UserProfile = {
  id: '',
  username: 'usuario',
  displayName: 'Usuário',
  avatarUrl: '',
  bannerUrl: '',
  bio: '',
  createdAt: '',
  createdAtTimestamp: 0,
  followersCount: 0,
  followingCount: 0,
  isPrivate: false,
  showCommentsOnProfile: true,
  privacySettings: {
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

const STATUS_ACTIVITY_LABEL: Record<AnimeItem['status'], string> = {
  watching: 'Assistindo',
  completed: 'Concluído',
  on_hold: 'Em espera',
  dropped: 'Abandonado',
  planned: 'Planejados'
};

function buildProfileFromFollowUser(followUser: FollowUser): UserProfile {
  const base = OTHER_USERS[followUser.id];
  return {
    id: followUser.id,
    username: followUser.username,
    displayName: followUser.displayName,
    avatarUrl: followUser.avatarUrl,
    bannerUrl: base?.bannerUrl ?? '',
    bio: followUser.bio || base?.bio || '',
    createdAt: followUser.createdAt || base?.createdAt || '',
    createdAtTimestamp: base?.createdAtTimestamp ?? 0,
    followersCount: base ? base.followersCount : (followUser.isFollowing ? 1 : 0),
    followingCount: base ? base.followingCount : (followUser.isFollower ? 1 : 0),
    isPrivate: base?.isPrivate ?? false,
    showCommentsOnProfile: base?.showCommentsOnProfile ?? true,
    privacySettings: base?.privacySettings ?? {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true,
    },
    externalAccounts: base?.externalAccounts ?? {
      anilist: { connected: false },
      mal: { connected: false },
    },
  };
}

function buildInitialDemoProfilesMap(): Record<string, UserProfile> {
  const map: Record<string, UserProfile> = {
    ...OTHER_USERS,
    [CURRENT_USER.id]: CURRENT_USER,
  };

  const knownDemoUsers: FollowUser[] = [
    ...INITIAL_FOLLOWERS,
    ...INITIAL_FOLLOWING,
    ...INITIAL_FOLLOW_REQUESTS.map((req) => req.user),
  ];

  for (const connUser of knownDemoUsers) {
    if (!map[connUser.id]) {
      map[connUser.id] = buildProfileFromFollowUser(connUser);
    }
  }

  return map;
}

function mergeNotificationsWithSeed(
  persisted: NotificationItem[] | undefined,
  seed: NotificationItem[]
): NotificationItem[] {
  if (!Array.isArray(persisted)) {
    return seed;
  }
  const persistedIds = new Set(persisted.map((n) => n.id));
  const newFromSeed = seed.filter((n) => !persistedIds.has(n.id));
  return [...newFromSeed, ...persisted];
}

function readTargetProfileFromBrowserUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const pathname = window.location.pathname || '/';
    if (pathname.startsWith('/admin')) return null;

    const pathMatch = pathname.match(/^\/(?:u|perfil|profile)\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
      const decoded = decodeURIComponent(pathMatch[1]).trim().replace(/^@+/, '');
      if (decoded) return decoded;
    }

    const params = new URLSearchParams(window.location.search);
    const queryTarget = (params.get('profile') || params.get('user') || '').trim().replace(/^@+/, '');
    return queryTarget || null;
  } catch {
    return null;
  }
}

function mergeServerSocialIntoWorkspace(
  prev: UserPersonalWorkspace,
  social: OwnerSocialNotificationsState
): { nextWorkspace: UserPersonalWorkspace; changed: boolean } {
  const prevNotifById = new Map(prev.notifications.map((n) => [n.id, n]));
  const mergedNotifs: NotificationItem[] = [];
  const seenIds = new Set<string>();

  for (const incoming of social.notifications) {
    if (!incoming || !incoming.id || seenIds.has(incoming.id)) continue;
    seenIds.add(incoming.id);
    const localExisting = prevNotifById.get(incoming.id);
    mergedNotifs.push({
      ...incoming,
      isRead: Boolean(localExisting?.isRead || incoming.isRead),
      ...(localExisting?.handled || incoming.handled
        ? { handled: localExisting?.handled || incoming.handled }
        : {}),
    });
  }
  for (const localOnly of prev.notifications) {
    if (localOnly && localOnly.id && !seenIds.has(localOnly.id)) {
      seenIds.add(localOnly.id);
      mergedNotifs.push(localOnly);
    }
  }

  const nextFollowers = Array.isArray(social.followers) ? social.followers : prev.followers;
  const nextFollowing = Array.isArray(social.following) ? social.following : prev.following;
  const nextFollowRequests = Array.isArray(social.followRequests)
    ? social.followRequests
    : prev.followRequests;
  const nextFollowingIds = Array.isArray(social.followingIds)
    ? social.followingIds
    : prev.followingIds;
  const nextRequestedIds = Array.isArray(social.requestedIds)
    ? social.requestedIds
    : prev.requestedIds;

  const nextFollowersCount =
    typeof social.followersCount === 'number'
      ? Math.max(social.followersCount, nextFollowers.length)
      : nextFollowers.length;
  const nextFollowingCount =
    typeof social.followingCount === 'number'
      ? Math.max(social.followingCount, nextFollowingIds.length)
      : nextFollowingIds.length;

  const prevNotifSig = prev.notifications
    .map((n) => `${n.id}:${n.isRead ? 1 : 0}:${n.handled || ''}`)
    .join('|');
  const nextNotifSig = mergedNotifs
    .map((n) => `${n.id}:${n.isRead ? 1 : 0}:${n.handled || ''}`)
    .join('|');

  const countsChanged =
    (prev.profileOverrides.followersCount ?? 0) !== nextFollowersCount ||
    (prev.profileOverrides.followingCount ?? 0) !== nextFollowingCount ||
    prev.followRequests.length !== nextFollowRequests.length ||
    prev.followers.length !== nextFollowers.length ||
    prev.followingIds.join(',') !== nextFollowingIds.join(',') ||
    prev.requestedIds.join(',') !== nextRequestedIds.join(',');

  if (prevNotifSig === nextNotifSig && !countsChanged) {
    return { nextWorkspace: prev, changed: false };
  }

  return {
    changed: true,
    nextWorkspace: {
      ...prev,
      notifications: mergedNotifs,
      followers: nextFollowers,
      following: nextFollowing,
      followRequests: nextFollowRequests,
      followingIds: nextFollowingIds,
      requestedIds: nextRequestedIds,
      profileOverrides: {
        ...prev.profileOverrides,
        followersCount: nextFollowersCount,
        followingCount: nextFollowingCount,
      },
    },
  };
}

function loadInitialDemoProfileData(): PersistedDemoProfileData {
  try {
    const raw = window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedDemoProfileData>;
      if (
        Array.isArray(parsed.animes) &&
        Array.isArray(parsed.comments) &&
        Array.isArray(parsed.activities)
      ) {
        const mergedNotifications = mergeNotificationsWithSeed(
          parsed.notifications,
          INITIAL_NOTIFICATIONS
        );

        // Sanitização de animes e personagens carregados do cache do navegador:
        // Se continham capas genéricas antigas do Unsplash, atualiza para as capas e retratos oficiais verificados.
        // Imagens personalizadas do usuário (Data URLs, outros servidores) e capas oficiais são 100% preservadas.
        const officialAnimeMap = new Map(INITIAL_ANIMES.map((a) => [a.id, a.posterUrl]));
        const officialAnimeTitleMap = new Map(INITIAL_ANIMES.map((a) => [normalizeTitle(a.title), a.posterUrl]));
        const sanitizedAnimes = parsed.animes.map((a) => {
          if (isGenericOrMissingPoster(a.posterUrl)) {
            const officialUrl = officialAnimeMap.get(a.id) || officialAnimeTitleMap.get(normalizeTitle(a.title));
            if (officialUrl) return { ...a, posterUrl: officialUrl };
          }
          return a;
        });

        const officialCharMap = new Map(FAVORITE_CHARACTERS.map((c) => [c.id, c.imageUrl]));
        const officialCharNameMap = new Map(FAVORITE_CHARACTERS.map((c) => [normalizeTitle(c.name), c.imageUrl]));
        const sanitizedCharacters = Array.isArray(parsed.favoriteCharacters)
          ? parsed.favoriteCharacters.map((c) => {
              if (isGenericOrMissingPoster(c.imageUrl)) {
                const officialUrl = officialCharMap.get(c.id) || officialCharNameMap.get(normalizeTitle(c.name));
                if (officialUrl) return { ...c, imageUrl: officialUrl };
              }
              return c;
            })
          : undefined;

        const sanitizedCompanies = Array.isArray(parsed.favoriteCompanies)
          ? parsed.favoriteCompanies
          : undefined;

        const sanitizedPeople = Array.isArray(parsed.favoritePeople)
          ? parsed.favoritePeople
          : undefined;

        return {
          profileOverrides:
            parsed.profileOverrides && typeof parsed.profileOverrides === 'object'
              ? parsed.profileOverrides
              : undefined,
          animes: migrateAnimeListProvenance(sanitizedAnimes).list,
          favoriteCharacters: sanitizedCharacters,
          favoriteCompanies: sanitizedCompanies,
          favoritePeople: sanitizedPeople,
          comments: parsed.comments,
          activities: parsed.activities,
          notifications: mergedNotifications,
          followingIds: Array.isArray(parsed.followingIds) ? parsed.followingIds : undefined,
          requestedIds: Array.isArray(parsed.requestedIds) ? parsed.requestedIds : undefined,
          blockedIds: Array.isArray(parsed.blockedIds) ? parsed.blockedIds : undefined,
          following: Array.isArray(parsed.following) ? parsed.following : undefined,
          followers: Array.isArray(parsed.followers) ? parsed.followers : undefined,
          followRequests: Array.isArray(parsed.followRequests) ? parsed.followRequests : undefined,
          otherProfiles:
            parsed.otherProfiles && typeof parsed.otherProfiles === 'object'
              ? (parsed.otherProfiles as Record<string, UserProfile>)
              : undefined,
        };
      }
    }
  } catch {
    // Fallback to initial demo seed in memory if localStorage is inaccessible or corrupted
  }

  const seedTimestamp = Date.now();
  const seededComments: HikariComment[] = INITIAL_COMMENTS.map((comm, idx) => ({
    ...comm,
    createdAtTimestamp:
      comm.createdAtTimestamp ?? seedTimestamp - inferOffsetMsFromLabel(comm.createdAt) - idx * 1000
  }));

  const seededActivities: UserActivity[] = INITIAL_ACTIVITIES.map((act, idx) => ({
    ...act,
    createdAtTimestamp:
      act.createdAtTimestamp ?? seedTimestamp - inferOffsetMsFromLabel(act.timestamp) - idx * 1000
  }));

  return {
    animes: migrateAnimeListProvenance(INITIAL_ANIMES).list,
    favoriteCharacters: FAVORITE_CHARACTERS,
    favoriteCompanies: FAVORITE_COMPANIES,
    favoritePeople: FAVORITE_PEOPLE,
    comments: seededComments,
    activities: seededActivities,
    notifications: INITIAL_NOTIFICATIONS
  };
}

export default function App() {
  const {
    user,
    userRevision,
    isLoading,
    isAuthenticated,
    signOutUser,
    refreshUserProfile,
  } = useAuth();

  // Explicit demo preview opt-in when unauthenticated (never treated as an authenticated session)
  const [isDemoPreview, setIsDemoPreview] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup'>('login');

  // Hydrate persisted demo profile records in memory without overwriting localStorage during real auth sessions
  const [initialDemoData] = useState<PersistedDemoProfileData>(() => loadInitialDemoProfileData());

  // Demo Mode State (strictly isolated to !isAuthenticated && isDemoPreview)
  const [demoProfile, setDemoProfile] = useState<UserProfile>(() => {
    const ov = initialDemoData.profileOverrides;
    if (!ov) return CURRENT_USER;
    return {
      ...CURRENT_USER,
      ...ov,
      followersCount:
        typeof ov.followersCount === 'number' ? ov.followersCount : CURRENT_USER.followersCount,
      followingCount:
        typeof ov.followingCount === 'number' ? ov.followingCount : CURRENT_USER.followingCount,
      privacySettings: {
        ...CURRENT_USER.privacySettings,
        ...(ov.privacySettings ?? {}),
      },
    };
  });
  const [demoAnimes, setDemoAnimes] = useState<AnimeItem[]>(initialDemoData.animes);
  const [demoFavoriteCharacters, setDemoFavoriteCharacters] = useState<FavoriteCharacter[]>(
    () => initialDemoData.favoriteCharacters ?? FAVORITE_CHARACTERS
  );
  const [demoFavoriteCompanies, setDemoFavoriteCompanies] = useState<FavoriteCompany[]>(
    () => initialDemoData.favoriteCompanies ?? FAVORITE_COMPANIES
  );
  const [demoFavoritePeople, setDemoFavoritePeople] = useState<FavoritePerson[]>(
    () => initialDemoData.favoritePeople ?? FAVORITE_PEOPLE
  );
  const [demoComments, setDemoComments] = useState<HikariComment[]>(initialDemoData.comments);
  const [demoActivities, setDemoActivities] = useState<UserActivity[]>(initialDemoData.activities);
  const [demoFollowers, setDemoFollowers] = useState<FollowUser[]>(
    () => initialDemoData.followers ?? INITIAL_FOLLOWERS
  );
  const [demoFollowing, setDemoFollowing] = useState<FollowUser[]>(
    () => initialDemoData.following ?? INITIAL_FOLLOWING
  );
  const [demoFollowRequests, setDemoFollowRequests] = useState<FollowRequest[]>(
    () => initialDemoData.followRequests ?? INITIAL_FOLLOW_REQUESTS
  );
  const [demoNotifications, setDemoNotifications] = useState<NotificationItem[]>(initialDemoData.notifications);
  const [demoFollowingIds, setDemoFollowingIds] = useState<Set<string>>(
    () => new Set(initialDemoData.followingIds ?? ['usr_kuroha', 'usr_shinji'])
  );
  const [demoRequestedIds, setDemoRequestedIds] = useState<Set<string>>(
    () => new Set(initialDemoData.requestedIds ?? [])
  );
  const [demoBlockedIds, setDemoBlockedIds] = useState<Set<string>>(
    () => new Set(initialDemoData.blockedIds ?? [])
  );
  const [demoOtherProfiles, setDemoOtherProfiles] = useState<Record<string, UserProfile>>(
    () => initialDemoData.otherProfiles ?? buildInitialDemoProfilesMap()
  );

  // Busy lock to prevent concurrent or duplicated follow/unfollow clicks
  const [isFollowPending, setIsFollowPending] = useState(false);
  const [pendingFollowTargetIds, setPendingFollowTargetIds] = useState<Set<string>>(
    () => new Set()
  );

  // UID-isolated personal state for real Firebase accounts (keyed strictly by user.uid)
  const [authSession, setAuthSession] = useState<AuthSessionState | null>(null);
  const [publicProfilesRevision, setPublicProfilesRevision] = useState(0);
  const [remoteVisitedProfiles, setRemoteVisitedProfiles] = useState<Record<string, UserProfile>>({});
  const [remoteVisitedDetails, setRemoteVisitedDetails] = useState<
    Record<string, AuthorizedPublicProfilePayload>
  >({});
  const [privateBlockedProfiles, setPrivateBlockedProfiles] = useState<Record<string, UserProfile>>(
    {}
  );
  const [visitingStatusByTarget, setVisitingStatusByTarget] = useState<
    Record<string, 'loading' | 'ready' | 'private_blocked' | 'not_found'>
  >({});

  const authEpochRef = useRef(0);
  const isHydratedFullAnimesRef = useRef(false);

  const [activeProfileId, setActiveProfileId] = useState<string>(
    () => readTargetProfileFromBrowserUrl() || CURRENT_USER.id
  );

  // Tab & Anime List Filter / Detail Navigation State
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [selectedAnimeStatusFilter, setSelectedAnimeStatusFilter] = useState<AnimeStatus | undefined>(undefined);
  const [animeFilterSyncKey, setAnimeFilterSyncKey] = useState(0);
  const [selectedAnimeDetailId, setSelectedAnimeDetailId] = useState<string | null>(null);

  // Modal States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'profile' | 'privacy' | 'connected' | 'security'>('profile');
  const [settingsOpenSyncKey, setSettingsOpenSyncKey] = useState(0);
  const [isFollowersOpen, setIsFollowersOpen] = useState(false);
  const [followersInitialTab, setFollowersInitialTab] = useState<'followers' | 'following' | 'requests'>('followers');
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatRecipientId, setChatRecipientId] = useState<string | null>(null);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [isProfileSearchOpen, setIsProfileSearchOpen] = useState(false);

  // Highlight state for direct notification navigation
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | undefined>(undefined);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | undefined>(undefined);
  const highlightCommentTimerRef = useRef<number | null>(null);
  const highlightActivityTimerRef = useRef<number | null>(null);

  // Admin Panel Navigation & UID-bound Server Verification State
  const [currentView, setCurrentView] = useState<'app' | 'admin'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      return 'admin';
    }
    return 'app';
  });
  const [adminVerification, setAdminVerification] = useState<AdminVerificationState>({
    uid: null,
    authorized: false,
    token: null,
    status: 'idle',
  });
  const pendingAdminReturnRef = useRef<boolean>(false);

  // Sincronização das rotas /admin e URL direta de perfil (/?profile=... ou /u/...) com popstate
  useEffect(() => {
    const handlePopState = () => {
      if (typeof window !== 'undefined') {
        if (window.location.pathname.startsWith('/admin')) {
          setAdminVerification((prev) => ({
            ...prev,
            status: 'idle',
          }));
          setCurrentView('admin');
        } else {
          setCurrentView('app');
          const urlTarget = readTargetProfileFromBrowserUrl();
          if (urlTarget) {
            setActiveProfileId(urlTarget);
          } else if (user?.uid) {
            setActiveProfileId(user.uid);
          }
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user?.uid]);

  const handleNavigateToAdmin = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/admin') {
      window.history.pushState(null, '', '/admin');
    }
    setAdminVerification({
      uid: user?.uid ?? null,
      authorized: false,
      token: null,
      status: isAuthenticated && user ? 'verifying' : 'idle',
    });
    setCurrentView('admin');
  }, [isAuthenticated, user]);

  const handleReturnFromAdmin = useCallback(() => {
    pendingAdminReturnRef.current = false;
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      window.history.pushState(null, '', '/');
    }
    setCurrentView('app');
  }, []);

  // Validação estrita no servidor ao acessar a visualização de administração
  useEffect(() => {
    let cancelled = false;
    if (currentView !== 'admin') {
      return;
    }

    // Se a autenticação ainda estiver carregando, aguarda a resolução do estado
    if (isLoading) {
      return;
    }

    // Se o cliente não está autenticado, bloqueia imediatamente sem expor dados
    if (!isAuthenticated || !user) {
      setAdminVerification({
        uid: null,
        authorized: false,
        token: null,
        status: 'resolved',
      });
      return;
    }

    const activeUid = user.uid;
    setAdminVerification((prev) =>
      prev.uid === activeUid && prev.status === 'verifying'
        ? prev
        : {
            uid: activeUid,
            authorized: false,
            token: null,
            status: 'verifying',
          }
    );

    async function checkServerAuthorization() {
      try {
        let tokenToVerify: string | null = null;
        try {
          // Renova o Firebase ID Token para garantir token válido e atualizado
          tokenToVerify = await user!.getIdToken(true);
        } catch {
          tokenToVerify = await user!.getIdToken(false);
        }

        if (!tokenToVerify) {
          if (!cancelled) {
            setAdminVerification({
              uid: activeUid,
              authorized: false,
              token: null,
              status: 'resolved',
            });
          }
          return;
        }

        const { verifyAdminAccess } = await import('./services/adminService');
        const verification = await verifyAdminAccess(tokenToVerify, activeUid);
        const isOwnerVerified =
          activeUid === AUTHORIZED_ADMIN_UID &&
          verification.authenticated === true &&
          verification.isAdmin === true &&
          Boolean(verification.token);

        if (!cancelled) {
          setAdminVerification({
            uid: activeUid,
            authorized: isOwnerVerified,
            token: isOwnerVerified ? verification.token : null,
            status: 'resolved',
          });
        }
      } catch {
        if (!cancelled) {
          setAdminVerification({
            uid: activeUid,
            authorized: false,
            token: null,
            status: 'resolved',
          });
        }
      }
    }

    void checkServerAuthorization();

    return () => {
      cancelled = true;
    };
  }, [currentView, user, isLoading, isAuthenticated]);

  useEffect(() => {
    return () => {
      if (highlightCommentTimerRef.current !== null) {
        window.clearTimeout(highlightCommentTimerRef.current);
      }
      if (highlightActivityTimerRef.current !== null) {
        window.clearTimeout(highlightActivityTimerRef.current);
      }
    };
  }, []);

  // Hydrate or wipe authenticated workspace strictly by Firebase UID on every auth change
  useEffect(() => {
    let cancelled = false;
    authEpochRef.current += 1;
    const currentEpoch = authEpochRef.current;

    if (!user?.uid) {
      hasLoadedFullAnimesRef.current = false;
      isHydratedFullAnimesRef.current = false;
      clearChatSessionMemoryCache();
      clearAllMemoryCache();
      clearChunkedStorageMemoryCache();
      clearLastFetchedAniListFavorites();
      clearSessionWorkspaceCaches();
      setAuthSession(null);
      setRemoteVisitedProfiles({});
      setRemoteVisitedDetails({});
      setPrivateBlockedProfiles({});
      setVisitingStatusByTarget({});
      setUnreadMessagesCount(0);
      setIsChatOpen(false);
      setChatRecipientId(null);
      setHasOpenedSettings(false);
      setActiveProfileId(readTargetProfileFromBrowserUrl() || CURRENT_USER.id);
      setSelectedAnimeStatusFilter(undefined);
      setSelectedAnimeDetailId(null);
      setActiveTab('overview');
      return () => {
        cancelled = true;
      };
    }

    const targetUid = user.uid;
    hasLoadedFullAnimesRef.current = true;
    isHydratedFullAnimesRef.current = false;
    clearChatSessionMemoryCache(targetUid);
    setActiveChatSessionUser(targetUid);
    clearAllMemoryCache();
    clearChunkedStorageMemoryCache();
    clearLastFetchedAniListFavorites();
    clearSessionWorkspaceCaches(targetUid);

    const localWorkspace =
      readLocalUserWorkspace(targetUid) ?? createEmptyUserWorkspace(targetUid);

    const initialUrlTarget = readTargetProfileFromBrowserUrl();

    setIsDemoPreview(false);
    setIsSettingsOpen(false);
    setHasOpenedSettings(false);
    setIsFollowersOpen(false);
    setIsNotifOpen(false);
    setIsChatOpen(false);
    setChatRecipientId(null);
    setRemoteVisitedProfiles({});
    setRemoteVisitedDetails({});
    setPrivateBlockedProfiles({});
    setVisitingStatusByTarget({});
    setSelectedAnimeStatusFilter(undefined);
    setSelectedAnimeDetailId(null);
    setActiveProfileId(initialUrlTarget || targetUid);
    setActiveTab('overview');
    setAuthSession({
      uid: targetUid,
      workspace: localWorkspace,
      firestoreStatus: 'idle',
    });

    if (pendingAdminReturnRef.current) {
      pendingAdminReturnRef.current = false;
      if (typeof window !== 'undefined' && window.location.pathname !== '/admin') {
        window.history.pushState(null, '', '/admin');
      }
      setAdminVerification({
        uid: targetUid,
        authorized: false,
        token: null,
        status: 'verifying',
      });
      setCurrentView('admin');
    }

    void (async () => {
      const indexedWorkspace = await hydrateWorkspaceFromIndexedDb(targetUid);
      if (cancelled || authEpochRef.current !== currentEpoch) return;

      if (indexedWorkspace) {
        setAuthSession((prev) => {
          if (!prev || prev.uid !== targetUid) return prev;
          if (indexedWorkspace.animes.length >= prev.workspace.animes.length) {
            return {
              ...prev,
              workspace: indexedWorkspace,
            };
          }
          return prev;
        });
      }

      const remote = await loadUserWorkspaceFromFirestore(targetUid, { loadAllAnimes: true });
      if (cancelled || authEpochRef.current !== currentEpoch) return;

      isHydratedFullAnimesRef.current = true;
      setAuthSession((prev) => {
        if (!prev || prev.uid !== targetUid) return prev;
        if (
          remote.workspace &&
          remote.workspace.uid === targetUid &&
          remote.workspace.updatedAtMs >= prev.workspace.updatedAtMs
        ) {
          // Never overwrite a fuller hydrated IndexedDB anime list if remote had an unmigrated partial slice
          const safeAnimes =
            remote.workspace.animes.length >= prev.workspace.animes.length ||
            remote.workspace.updatedAtMs > prev.workspace.updatedAtMs
              ? remote.workspace.animes
              : prev.workspace.animes;
          const persisted = writeLocalUserWorkspace(targetUid, {
            ...remote.workspace,
            animes: safeAnimes,
          });
          return {
            uid: targetUid,
            workspace: persisted,
            firestoreStatus: remote.status,
          };
        }
        return {
          ...prev,
          firestoreStatus: remote.status,
        };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Additional safeguard when opening 'animes' tab if full chunks were not yet hydrated
  const hasLoadedFullAnimesRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'animes' && isAuthenticated && user?.uid && !hasLoadedFullAnimesRef.current) {
      hasLoadedFullAnimesRef.current = true;
      const uidAtRequest = user.uid;
      const epochAtRequest = authEpochRef.current;
      void loadUserWorkspaceFromFirestore(uidAtRequest, { loadAllAnimes: true }).then((remote) => {
        if (authEpochRef.current !== epochAtRequest) return;
        if (remote.workspace && remote.workspace.animes.length > 0) {
          setAuthSession((prev) => {
            if (!prev || prev.uid !== uidAtRequest) return prev;
            if (remote.workspace!.animes.length < prev.workspace.animes.length) return prev;
            return {
              ...prev,
              workspace: {
                ...prev.workspace,
                animes: remote.workspace!.animes,
              },
            };
          });
        }
      });
    }
  }, [activeTab, isAuthenticated, user?.uid]);

  // Debounced Demo Mode persistence with synchronous flush on pagehide/beforeunload/visibilitychange
  const pendingDemoPayloadRef = useRef<PersistedDemoProfileData | null>(null);
  const demoWriteTimerRef = useRef<number | null>(null);

  const flushPendingDemoWrite = useCallback(() => {
    if (demoWriteTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(demoWriteTimerRef.current);
      demoWriteTimerRef.current = null;
    }
    const payload = pendingDemoPayloadRef.current;
    if (!payload || typeof window === 'undefined' || !window.localStorage) return;
    pendingDemoPayloadRef.current = null;
    try {
      window.localStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write errors gracefully
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingDemoWrite();
      }
    };
    window.addEventListener('pagehide', flushPendingDemoWrite);
    window.addEventListener('beforeunload', flushPendingDemoWrite);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      flushPendingDemoWrite();
      window.removeEventListener('pagehide', flushPendingDemoWrite);
      window.removeEventListener('beforeunload', flushPendingDemoWrite);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushPendingDemoWrite]);

  // Keep demo localStorage synchronized ONLY while actively inside Demo Mode (debounced 300ms)
  useEffect(() => {
    if (isAuthenticated || !isDemoPreview) {
      pendingDemoPayloadRef.current = null;
      if (demoWriteTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(demoWriteTimerRef.current);
        demoWriteTimerRef.current = null;
      }
      return;
    }

    pendingDemoPayloadRef.current = {
      profileOverrides: {
        displayName: demoProfile.displayName,
        username: demoProfile.username,
        avatarUrl: demoProfile.avatarUrl,
        bannerUrl: demoProfile.bannerUrl,
        bio: demoProfile.bio,
        isPrivate: demoProfile.isPrivate,
        showCommentsOnProfile: demoProfile.showCommentsOnProfile,
        privacySettings: demoProfile.privacySettings,
        externalAccounts: demoProfile.externalAccounts,
        followersCount: demoProfile.followersCount,
        followingCount: demoProfile.followingCount,
      },
      animes: demoAnimes,
      favoriteCharacters: demoFavoriteCharacters,
      favoriteCompanies: demoFavoriteCompanies,
      favoritePeople: demoFavoritePeople,
      comments: demoComments,
      activities: demoActivities,
      notifications: demoNotifications,
      followingIds: Array.from(demoFollowingIds),
      requestedIds: Array.from(demoRequestedIds),
      blockedIds: Array.from(demoBlockedIds),
      following: demoFollowing,
      followers: demoFollowers,
      followRequests: demoFollowRequests,
      otherProfiles: demoOtherProfiles,
    };

    if (demoWriteTimerRef.current !== null) {
      window.clearTimeout(demoWriteTimerRef.current);
    }
    demoWriteTimerRef.current = window.setTimeout(() => {
      demoWriteTimerRef.current = null;
      flushPendingDemoWrite();
    }, 300);
  }, [
    isAuthenticated,
    isDemoPreview,
    demoProfile,
    demoAnimes,
    demoFavoriteCharacters,
    demoFavoriteCompanies,
    demoFavoritePeople,
    demoComments,
    demoActivities,
    demoNotifications,
    demoFollowingIds,
    demoRequestedIds,
    demoBlockedIds,
    demoFollowing,
    demoFollowers,
    demoFollowRequests,
    demoOtherProfiles,
    flushPendingDemoWrite,
  ]);

  // Cross-tab storage synchronization strictly scoped to either current UID or Demo Mode
  useEffect(() => {
    function handleStorageSync(event: StorageEvent) {
      if (!event.newValue) return;

      if (event.key === PUBLIC_PROFILES_STORAGE_KEY) {
        setPublicProfilesRevision((r) => r + 1);
        return;
      }

      if (isAuthenticated && user?.uid) {
        const expectedKey = getUserWorkspaceStorageKey(user.uid);
        if (event.key !== expectedKey) return;
        const syncedWorkspace = readLocalUserWorkspace(user.uid);
        if (syncedWorkspace && syncedWorkspace.uid === user.uid) {
          setAuthSession((prev) =>
            prev && prev.uid === user.uid ? { ...prev, workspace: syncedWorkspace } : prev
          );
        }
        return;
      }

      if (!isAuthenticated && isDemoPreview && event.key === DEMO_PROFILE_STORAGE_KEY) {
        try {
          const parsed = JSON.parse(event.newValue) as Partial<PersistedDemoProfileData>;
          if (Array.isArray(parsed.notifications)) {
            setDemoNotifications(parsed.notifications);
          }
        } catch {
          // Ignore malformed external storage payloads
        }
      }
    }
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, [isAuthenticated, isDemoPreview, user?.uid]);

  const isAuthWorkspaceReady = Boolean(
    isAuthenticated && user && authSession !== null && authSession.uid === user.uid
  );

  const activeAuthWorkspace =
    isAuthWorkspaceReady && authSession ? authSession.workspace : null;

  const updateAuthWorkspace = useCallback(
    (
      updater: (prev: UserPersonalWorkspace) => UserPersonalWorkspace,
      options?: { immediate?: boolean }
    ) => {
      if (!isAuthenticated || !user) return;
      const targetUid = user.uid;
      setAuthSession((prev) => {
        const baseWorkspace =
          prev && prev.uid === targetUid
            ? prev.workspace
            : readLocalUserWorkspace(targetUid) ?? createEmptyUserWorkspace(targetUid);
        const updated = updater(baseWorkspace);
        const stamped = writeLocalUserWorkspace(
          targetUid,
          {
            ...updated,
            uid: targetUid,
            updatedAtMs: Date.now(),
          },
          { immediate: options?.immediate }
        );
        const resolvedProfile = buildProfileFromFirebaseUser(user, stamped.profileOverrides);
        syncPublicProfileProjection(resolvedProfile, stamped.animes, stamped.updatedAtMs, {
          favoriteCharacters: stamped.favoriteCharacters,
          favoriteCompanies: stamped.favoriteCompanies,
          favoritePeople: stamped.favoritePeople,
          activities: stamped.activities,
          comments: stamped.comments,
        });
        setPublicProfilesRevision((r) => r + 1);
        void saveUserWorkspaceToFirestore(targetUid, resolvedProfile, stamped, {
          immediate: options?.immediate,
        }).then((syncStatus) => {
          setAuthSession((curr) =>
            curr && curr.uid === targetUid ? { ...curr, firestoreStatus: syncStatus } : curr
          );
        });
        return {
          uid: targetUid,
          workspace: stamped,
          firestoreStatus: prev && prev.uid === targetUid ? prev.firestoreStatus : 'idle',
        };
      });
    },
    [isAuthenticated, user]
  );

  const authenticatedProfile = useMemo(() => {
    if (!isAuthenticated || !user || !activeAuthWorkspace) return null;
    void userRevision;
    return buildProfileFromFirebaseUser(user, activeAuthWorkspace.profileOverrides);
  }, [isAuthenticated, user, userRevision, activeAuthWorkspace]);

  // Keep sanitized public projection AND backend social store synced whenever authenticated profile or lists change
  useEffect(() => {
    if (!isAuthenticated || !user?.uid || !authenticatedProfile || !activeAuthWorkspace) return;
    const ownerUid = user.uid;
    const epoch = authEpochRef.current;

    syncPublicProfileProjection(
      authenticatedProfile,
      activeAuthWorkspace.animes,
      activeAuthWorkspace.updatedAtMs || Date.now(),
      {
        favoriteCharacters: activeAuthWorkspace.favoriteCharacters,
        favoriteCompanies: activeAuthWorkspace.favoriteCompanies,
        favoritePeople: activeAuthWorkspace.favoritePeople,
        activities: activeAuthWorkspace.activities,
        comments: activeAuthWorkspace.comments,
      }
    );

    const timer = window.setTimeout(() => {
      if (authEpochRef.current !== epoch) return;
      void syncOwnerSocialWorkspace(ownerUid, {
        profile: authenticatedProfile,
        animes: activeAuthWorkspace.animes,
        animesComplete: isHydratedFullAnimesRef.current,
        favoriteCharacters: activeAuthWorkspace.favoriteCharacters,
        favoriteCompanies: activeAuthWorkspace.favoriteCompanies,
        favoritePeople: activeAuthWorkspace.favoritePeople,
        activities: activeAuthWorkspace.activities,
        comments: activeAuthWorkspace.comments,
        followers: activeAuthWorkspace.followers,
        following: activeAuthWorkspace.following,
        followRequests: activeAuthWorkspace.followRequests,
        followingIds: activeAuthWorkspace.followingIds,
        requestedIds: activeAuthWorkspace.requestedIds,
        blockedIds: activeAuthWorkspace.blockedIds,
        notifications: activeAuthWorkspace.notifications,
        updatedAtMs: activeAuthWorkspace.updatedAtMs || Date.now(),
      }).then((serverSocial) => {
        if (!serverSocial || authEpochRef.current !== epoch) return;
        setAuthSession((prev) => {
          if (!prev || prev.uid !== ownerUid) return prev;
          const { nextWorkspace, changed } = mergeServerSocialIntoWorkspace(
            prev.workspace,
            serverSocial
          );
          if (!changed) return prev;
          const persisted = writeLocalUserWorkspace(ownerUid, nextWorkspace);
          return {
            ...prev,
            workspace: persisted,
          };
        });
      });
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isAuthenticated, user?.uid, authenticatedProfile, activeAuthWorkspace]);

  // Refresh authoritative incoming follower & follow-back notifications on bell/modal open or tab focus
  useEffect(() => {
    if (!isAuthenticated || !user?.uid) return;
    const ownerUid = user.uid;
    const epoch = authEpochRef.current;
    let lastRefreshAt = 0;

    const refreshNotificationsFromServer = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1500) return;
      lastRefreshAt = now;

      void fetchOwnerNotifications(ownerUid).then((serverSocial) => {
        if (!serverSocial || authEpochRef.current !== epoch) return;
        setAuthSession((prev) => {
          if (!prev || prev.uid !== ownerUid) return prev;
          const { nextWorkspace, changed } = mergeServerSocialIntoWorkspace(
            prev.workspace,
            serverSocial
          );
          if (!changed) return prev;
          const persisted = writeLocalUserWorkspace(ownerUid, nextWorkspace);
          return {
            ...prev,
            workspace: persisted,
          };
        });
      });
    };

    if (isNotifOpen || isFollowersOpen) {
      refreshNotificationsFromServer();
    }

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        refreshNotificationsFromServer();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [isAuthenticated, user?.uid, isNotifOpen, isFollowersOpen]);

  const authFollowingIds = useMemo(
    () => new Set(activeAuthWorkspace?.followingIds ?? []),
    [activeAuthWorkspace?.followingIds]
  );
  const authRequestedIds = useMemo(
    () => new Set(activeAuthWorkspace?.requestedIds ?? []),
    [activeAuthWorkspace?.requestedIds]
  );
  const authBlockedIds = useMemo(
    () => new Set(activeAuthWorkspace?.blockedIds ?? []),
    [activeAuthWorkspace?.blockedIds]
  );

  const currentUser: UserProfile = isAuthenticated
    ? authenticatedProfile ?? NEUTRAL_LOADING_PROFILE
    : demoProfile;
  const animes = isAuthenticated ? activeAuthWorkspace?.animes ?? [] : demoAnimes;
  const comments = isAuthenticated ? activeAuthWorkspace?.comments ?? [] : demoComments;
  const activities = isAuthenticated ? activeAuthWorkspace?.activities ?? [] : demoActivities;
  const followers = isAuthenticated ? activeAuthWorkspace?.followers ?? [] : demoFollowers;
  const following = isAuthenticated ? activeAuthWorkspace?.following ?? [] : demoFollowing;
  const followRequests = isAuthenticated
    ? activeAuthWorkspace?.followRequests ?? []
    : demoFollowRequests;
  const notifications = isAuthenticated
    ? activeAuthWorkspace?.notifications ?? []
    : demoNotifications;
  const followingIds = isAuthenticated ? authFollowingIds : demoFollowingIds;
  const requestedIds = isAuthenticated ? authRequestedIds : demoRequestedIds;
  const blockedIds = isAuthenticated ? authBlockedIds : demoBlockedIds;

  // Referência sincronizada para mutações rápidas de um item sem clonar listas antigas.
  const latestAnimeMutationStateRef = useRef({ animes });
  useEffect(() => {
    latestAnimeMutationStateRef.current = { animes };
  }, [animes]);

  const persistAndApply = useCallback(
    (nextAnimes: AnimeItem[], activity: UserActivity | null) => {
      latestAnimeMutationStateRef.current = { animes: nextAnimes };
      if (isAuthenticated && user?.uid) {
        const uid = user.uid;
        updateAuthWorkspace((prev) => ({
          ...prev,
          animes: nextAnimes,
          activities: activity ? [activity, ...prev.activities] : prev.activities,
        }));
        void saveAllAnimesToChunkedFirestore(uid, nextAnimes);
        void saveAnimesToIndexedDb(uid, nextAnimes);
      } else {
        setDemoAnimes(nextAnimes);
        if (activity) setDemoActivities((prev) => [activity, ...prev]);
      }
    },
    [isAuthenticated, user?.uid, updateAuthWorkspace]
  );

  const applyProfilePatch = useCallback(
    (patch: UserProfileOverrides) => {
      if (isAuthenticated) {
        updateAuthWorkspace((prev) => ({
          ...prev,
          profileOverrides: {
            ...prev.profileOverrides,
            ...patch,
          },
        }));
      } else {
        setDemoProfile((prev) => ({
          ...prev,
          ...patch,
        }));
      }
    },
    [isAuthenticated, updateAuthWorkspace]
  );

  const isViewingAppShell =
    !isLoading && ((isAuthenticated && isAuthWorkspaceReady) || (!isAuthenticated && isDemoPreview));

  const handleOpenSettings = useCallback(
    (tab: 'profile' | 'privacy' | 'connected' | 'security' = 'profile') => {
      setSettingsInitialTab(tab);
      setSettingsOpenSyncKey((prev) => prev + 1);
      setHasOpenedSettings(true);
      setIsSettingsOpen(true);
    },
    []
  );

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  // Global background scroll lock for FollowersModal (SettingsModal manages its own portal & scroll restoration)
  useEffect(() => {
    const isAnyModalOpen = isViewingAppShell && isFollowersOpen;
    if (isAnyModalOpen) {
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      const prevBodyOverflow = document.body.style.overflow;
      const prevPaddingRight = document.body.style.paddingRight;
      const savedScrollY = window.scrollY;

      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }

      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.body.style.paddingRight = prevPaddingRight;
        if (typeof window !== 'undefined' && Math.abs(window.scrollY - savedScrollY) > 2) {
          window.scrollTo({ top: savedScrollY, behavior: 'instant' as ScrollBehavior });
        }
      };
    }
  }, [isViewingAppShell, isFollowersOpen]);

  // Sanitized public projections of other registered profiles (private anime lists are stripped to [])
  const authPublicProfilesMap = useMemo(() => {
    void publicProfilesRevision;
    if (!isAuthenticated) return {};
    return readPublicProfilesMap(user?.uid);
  }, [isAuthenticated, user?.uid, publicProfilesRevision, activeAuthWorkspace?.updatedAtMs]);

  // Real profiles accessible to the authenticated user (zero demo profiles)
  const authOtherProfilesMap = useMemo<Record<string, UserProfile>>(() => {
    if (!isAuthenticated || !activeAuthWorkspace) return {};
    const map: Record<string, UserProfile> = {};

    for (const [uid, userProf] of Object.entries(OTHER_USERS)) {
      if (uid !== currentUser.id) {
        map[uid] = userProf;
      }
    }

    for (const [uid, proj] of Object.entries(authPublicProfilesMap)) {
      if (uid && uid !== currentUser.id) {
        map[uid] = proj.profile;
      }
    }

    for (const [uid, remoteProf] of Object.entries(remoteVisitedProfiles)) {
      if (uid && uid !== currentUser.id) {
        map[uid] = remoteProf;
      }
    }

    const visitedConnections: FollowUser[] = [];
    for (const detail of Object.values(remoteVisitedDetails)) {
      if (Array.isArray(detail.followers)) visitedConnections.push(...detail.followers);
      if (Array.isArray(detail.following)) visitedConnections.push(...detail.following);
    }

    const ownConnections: FollowUser[] = [
      ...activeAuthWorkspace.followers,
      ...activeAuthWorkspace.following,
      ...activeAuthWorkspace.followRequests.map((req) => req.user),
      ...visitedConnections,
    ];
    for (const connUser of ownConnections) {
      if (connUser.id && connUser.id !== currentUser.id && !map[connUser.id]) {
        map[connUser.id] = buildProfileFromFollowUser(connUser);
      }
    }
    return map;
  }, [
    isAuthenticated,
    activeAuthWorkspace,
    authPublicProfilesMap,
    remoteVisitedProfiles,
    remoteVisitedDetails,
    currentUser.id,
  ]);

  // Resolve target profile ID or @username cleanly without ever falling back a visitor view to the owner's account
  const resolvedActiveTargetId = useMemo(() => {
    if (!isAuthenticated || !user?.uid) return activeProfileId;
    const clean = activeProfileId.trim().replace(/^@+/, '').toLowerCase();
    if (
      activeProfileId === user.uid ||
      (authenticatedProfile?.username && authenticatedProfile.username.toLowerCase() === clean)
    ) {
      return user.uid;
    }
    for (const prof of Object.values(authOtherProfilesMap)) {
      if (prof.id === activeProfileId || prof.username.toLowerCase() === clean) {
        return prof.id;
      }
    }
    return activeProfileId;
  }, [
    isAuthenticated,
    user?.uid,
    activeProfileId,
    authenticatedProfile?.username,
    authOtherProfilesMap,
  ]);

  // Strict account isolation: isOwnProfile is TRUE if and only if resolvedActiveTargetId matches the authenticated user's UID
  const isOwnProfile = isAuthenticated
    ? Boolean(user?.uid && resolvedActiveTargetId === user.uid)
    : activeProfileId === CURRENT_USER.id;

  // Authoritative backend + Firestore hydration of visited profiles (full anime pagination + Zero-Trust privacy blocking)
  useEffect(() => {
    if (!isAuthenticated || !user?.uid || isOwnProfile) return;
    const targetRef = resolvedActiveTargetId.trim();
    if (!targetRef) return;

    let cancelled = false;
    const epoch = authEpochRef.current;

    setVisitingStatusByTarget((prev) => ({
      ...prev,
      [targetRef]: 'loading',
    }));

    void (async () => {
      const apiResult = await fetchAuthorizedUserProfileComplete(targetRef);
      if (cancelled || authEpochRef.current !== epoch) return;

      if (apiResult.status === 'private_blocked') {
        const stub =
          apiResult.profileStub ??
          authOtherProfilesMap[targetRef] ?? {
            ...NEUTRAL_LOADING_PROFILE,
            id: targetRef,
            username: targetRef.replace(/^@+/, ''),
            displayName: targetRef.replace(/^@+/, ''),
            isPrivate: true,
          };
        const lockedStub: UserProfile = {
          ...stub,
          isPrivate: true,
          bannerUrl: '',
          bio: '',
          showCommentsOnProfile: false,
          privacySettings: {
            showAnimeList: false,
            showFavorites: false,
            showActivity: false,
            showCommentsOnProfile: false,
          },
        };

        purgeCachedPublicProfileProjection(lockedStub.id, lockedStub);
        setPublicProfilesRevision((r) => r + 1);
        setRemoteVisitedDetails((prev) => {
          const next = { ...prev };
          delete next[targetRef];
          delete next[lockedStub.id];
          return next;
        });
        setPrivateBlockedProfiles((prev) => ({
          ...prev,
          [targetRef]: lockedStub,
          [lockedStub.id]: lockedStub,
        }));
        setRemoteVisitedProfiles((prev) => ({
          ...prev,
          [lockedStub.id]: lockedStub,
        }));
        setVisitingStatusByTarget((prev) => ({
          ...prev,
          [targetRef]: 'private_blocked',
          [lockedStub.id]: 'private_blocked',
        }));
        if (activeProfileId !== lockedStub.id) {
          setActiveProfileId(lockedStub.id);
        }
        return;
      }

      if (apiResult.status === 'ok') {
        const loaded = apiResult.data;
        const resolvedId = loaded.profile.id;
        setPrivateBlockedProfiles((prev) => {
          if (!prev[targetRef] && !prev[resolvedId]) return prev;
          const next = { ...prev };
          delete next[targetRef];
          delete next[resolvedId];
          return next;
        });
        setRemoteVisitedDetails((prev) => ({
          ...prev,
          [resolvedId]: loaded,
        }));
        setRemoteVisitedProfiles((prev) => ({
          ...prev,
          [resolvedId]: loaded.profile,
        }));
        setVisitingStatusByTarget((prev) => ({
          ...prev,
          [targetRef]: 'ready',
          [resolvedId]: 'ready',
        }));
        if (activeProfileId !== resolvedId) {
          setActiveProfileId(resolvedId);
        }
        return;
      }

      // Fallback to Firestore chunked public_projection if not yet in socialStore
      const firestoreProj = await loadFullPublicProfileFromFirestore(targetRef);
      if (cancelled || authEpochRef.current !== epoch) return;

      if (firestoreProj) {
        const resolvedId = firestoreProj.profile.id;
        setRemoteVisitedDetails((prev) => ({
          ...prev,
          [resolvedId]: {
            isOwner: false,
            isPrivateBlocked: false,
            profile: firestoreProj.profile,
            animeStats: firestoreProj.animeStats,
            totalAnimes: firestoreProj.publicAnimes.length,
            animes: firestoreProj.publicAnimes,
            hasMoreAnimes: false,
            nextAnimeOffset: null,
            favoriteCharacters: firestoreProj.favoriteCharacters ?? [],
            favoriteCompanies: firestoreProj.favoriteCompanies ?? [],
            favoritePeople: firestoreProj.favoritePeople ?? [],
            activities: firestoreProj.publicActivities ?? [],
            comments: firestoreProj.publicComments ?? [],
            followers: [],
            following: [],
            updatedAtMs: firestoreProj.updatedAtMs,
          },
        }));
        setRemoteVisitedProfiles((prev) => ({
          ...prev,
          [resolvedId]: firestoreProj.profile,
        }));
        setVisitingStatusByTarget((prev) => ({
          ...prev,
          [targetRef]: 'ready',
          [resolvedId]: 'ready',
        }));
      } else {
        setVisitingStatusByTarget((prev) => ({
          ...prev,
          [targetRef]: 'not_found',
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.uid, isOwnProfile, resolvedActiveTargetId]);

  const activeProfile: UserProfile = useMemo(() => {
    if (isAuthenticated) {
      if (isOwnProfile) {
        return currentUser;
      }
      if (privateBlockedProfiles[resolvedActiveTargetId]) {
        return privateBlockedProfiles[resolvedActiveTargetId];
      }
      if (remoteVisitedDetails[resolvedActiveTargetId]) {
        return remoteVisitedDetails[resolvedActiveTargetId].profile;
      }
      if (authOtherProfilesMap[resolvedActiveTargetId]) {
        return authOtherProfilesMap[resolvedActiveTargetId];
      }
      const cleanLabel = activeProfileId.trim().replace(/^@+/, '') || 'usuario';
      return {
        ...NEUTRAL_LOADING_PROFILE,
        id: resolvedActiveTargetId,
        username: cleanLabel,
        displayName: cleanLabel,
      };
    }

    return isOwnProfile
      ? demoProfile
      : demoOtherProfiles[activeProfileId] || OTHER_USERS[activeProfileId] || demoProfile;
  }, [
    isAuthenticated,
    isOwnProfile,
    currentUser,
    privateBlockedProfiles,
    resolvedActiveTargetId,
    remoteVisitedDetails,
    authOtherProfilesMap,
    activeProfileId,
    demoProfile,
    demoOtherProfiles,
  ]);

  const isFollowingActive = followingIds.has(activeProfile.id);
  const isRequestedActive = requestedIds.has(activeProfile.id);
  const isBlockedActive = blockedIds.has(activeProfile.id);
  const isFollowerActive = useMemo(() => {
    if (isOwnProfile) return false;
    const targetId = activeProfile.id;
    const targetUsername = activeProfile.username?.toLowerCase();
    if (
      followers.some(
        (f) => f.id === targetId || (targetUsername && f.username?.toLowerCase() === targetUsername)
      )
    ) {
      return true;
    }
    if (
      notifications.some(
        (n) =>
          n.type === 'new_follower' &&
          (n.actor?.id === targetId ||
            (targetUsername && n.actor?.username?.toLowerCase() === targetUsername))
      )
    ) {
      return true;
    }
    const visitedFollowing = remoteVisitedDetails[targetId]?.following;
    if (Array.isArray(visitedFollowing) && visitedFollowing.some((u) => u.id === currentUser.id)) {
      return true;
    }
    return false;
  }, [
    isOwnProfile,
    activeProfile.id,
    activeProfile.username,
    followers,
    notifications,
    remoteVisitedDetails,
    currentUser.id,
  ]);

  // Strict privacy gate: when a profile is private, ALL non-owners (including previous followers) are blocked
  const isPrivateLocked =
    !isOwnProfile &&
    (Boolean(activeProfile.isPrivate) ||
      Boolean(privateBlockedProfiles[activeProfile.id]) ||
      Boolean(privateBlockedProfiles[resolvedActiveTargetId]) ||
      visitingStatusByTarget[resolvedActiveTargetId] === 'private_blocked');

  // Real data-level privacy gate for anime lists:
  // Owner always accesses own lists; visitors only access when profile is unlocked AND showAnimeList !== false
  const canAccessActiveProfileAnimeList =
    isOwnProfile || (!isPrivateLocked && activeProfile.privacySettings?.showAnimeList !== false);

  const visitedAuthorizedPayload =
    !isOwnProfile && !isPrivateLocked ? remoteVisitedDetails[activeProfile.id] ?? null : null;
  const visitedCachedProjection =
    !isOwnProfile && !isPrivateLocked ? authPublicProfilesMap[activeProfile.id] ?? null : null;

  // Numeric stats are withheld completely when isPrivateLocked
  const activeProfileAnimeStats = useMemo(() => {
    if (isOwnProfile) {
      return computeAnimeStats(animes);
    }
    if (isPrivateLocked || activeProfile.privacySettings?.showAnimeList === false) {
      return EMPTY_ANIME_STATS;
    }
    if (isAuthenticated) {
      if (visitedAuthorizedPayload) {
        return visitedAuthorizedPayload.animeStats;
      }
      if (visitedCachedProjection) {
        return visitedCachedProjection.animeStats;
      }
      if (activeProfile.id === AUTHORIZED_ADMIN_UID) {
        return computeAnimeStats(AETHER_ANIMES);
      }
      return EMPTY_ANIME_STATS;
    }
    if (activeProfile.id === AUTHORIZED_ADMIN_UID) {
      return computeAnimeStats(AETHER_ANIMES);
    }
    return computeAnimeStats(demoAnimes);
  }, [
    isOwnProfile,
    isPrivateLocked,
    activeProfile.privacySettings?.showAnimeList,
    activeProfile.id,
    isAuthenticated,
    animes,
    visitedAuthorizedPayload,
    visitedCachedProjection,
    demoAnimes,
  ]);

  const activeProfileStatusCounts = useMemo<Record<AnimeStatus, number>>(
    () => ({
      all: activeProfileAnimeStats.totalEntries,
      watching: activeProfileAnimeStats.watchingCount,
      completed: activeProfileAnimeStats.completedCount,
      planned: activeProfileAnimeStats.plannedCount,
      on_hold: activeProfileAnimeStats.onHoldCount,
      dropped: activeProfileAnimeStats.droppedCount,
    }),
    [activeProfileAnimeStats]
  );

  // Raw anime entries are strictly withheld when !canAccessActiveProfileAnimeList
  const exposedAnimes = useMemo<AnimeItem[]>(() => {
    if (!canAccessActiveProfileAnimeList) {
      return [];
    }
    if (isOwnProfile) {
      return animes;
    }
    if (isAuthenticated) {
      if (visitedAuthorizedPayload) {
        return visitedAuthorizedPayload.animes;
      }
      if (visitedCachedProjection) {
        return visitedCachedProjection.publicAnimes;
      }
      if (activeProfile.id === AUTHORIZED_ADMIN_UID) {
        return AETHER_ANIMES;
      }
      return [];
    }
    if (activeProfile.id === AUTHORIZED_ADMIN_UID) {
      return AETHER_ANIMES;
    }
    return demoAnimes;
  }, [
    canAccessActiveProfileAnimeList,
    isOwnProfile,
    isAuthenticated,
    animes,
    visitedAuthorizedPayload,
    visitedCachedProjection,
    activeProfile.id,
    demoAnimes,
  ]);

  // Memoize favorites count to avoid O(N) array filtering directly inside the JSX render loop
  const exposedFavoritesCount = useMemo(() => {
    if (!isOwnProfile && (isPrivateLocked || activeProfile.privacySettings?.showFavorites === false)) {
      return 0;
    }
    let count = 0;
    for (let i = 0; i < exposedAnimes.length; i++) {
      if (exposedAnimes[i].isFavorite) count++;
    }
    return count;
  }, [exposedAnimes, isOwnProfile, isPrivateLocked, activeProfile.privacySettings?.showFavorites]);

  const canAccessVisitedFavorites =
    isOwnProfile || (!isPrivateLocked && activeProfile.privacySettings?.showFavorites !== false);
  const canAccessVisitedActivity =
    isOwnProfile || (!isPrivateLocked && activeProfile.privacySettings?.showActivity !== false);
  const canAccessVisitedComments =
    isOwnProfile ||
    (!isPrivateLocked &&
      (activeProfile.privacySettings?.showCommentsOnProfile ?? activeProfile.showCommentsOnProfile) !==
        false);

  const displayedFavoriteCharacters = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoriteCharacters ?? []
      : canAccessVisitedFavorites
      ? visitedAuthorizedPayload?.favoriteCharacters ??
        visitedCachedProjection?.favoriteCharacters ??
        []
      : []
    : isOwnProfile
    ? demoFavoriteCharacters
    : [];

  const displayedFavoriteCompanies = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoriteCompanies ?? []
      : canAccessVisitedFavorites
      ? visitedAuthorizedPayload?.favoriteCompanies ??
        visitedCachedProjection?.favoriteCompanies ??
        []
      : []
    : isOwnProfile
    ? demoFavoriteCompanies
    : [];

  const displayedFavoritePeople = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoritePeople ?? []
      : canAccessVisitedFavorites
      ? visitedAuthorizedPayload?.favoritePeople ?? visitedCachedProjection?.favoritePeople ?? []
      : []
    : isOwnProfile
    ? demoFavoritePeople
    : [];

  const displayedComments = isAuthenticated
    ? isOwnProfile
      ? comments
      : canAccessVisitedComments
      ? visitedAuthorizedPayload?.comments ?? visitedCachedProjection?.publicComments ?? []
      : []
    : isPrivateLocked
    ? []
    : comments;

  const displayedActivities = isAuthenticated
    ? isOwnProfile
      ? activities
      : canAccessVisitedActivity
      ? visitedAuthorizedPayload?.activities ?? visitedCachedProjection?.publicActivities ?? []
      : []
    : isPrivateLocked
    ? []
    : activities;

  const displayedModalFollowers = isOwnProfile
    ? followers
    : isPrivateLocked
    ? []
    : visitedAuthorizedPayload?.followers ?? [];

  const displayedModalFollowing = isOwnProfile
    ? following
    : isPrivateLocked
    ? []
    : visitedAuthorizedPayload?.following ?? [];

  // Handler: Select Profile (switch view + sync URL cleanly)
  const handleSelectProfile = useCallback(
    (userId: string) => {
      setSelectedAnimeStatusFilter(undefined);
      setSelectedAnimeDetailId(null);
      if (isAuthenticated && user) {
        if (userId === user.uid) {
          setActiveProfileId(user.uid);
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin')) {
            window.history.pushState(null, '', '/');
          }
        } else {
          setActiveProfileId(userId);
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin')) {
            const targetUsername = authOtherProfilesMap[userId]?.username || userId;
            window.history.pushState(
              null,
              '',
              `/?profile=${encodeURIComponent(targetUsername)}`
            );
          }
        }
        setActiveTab('overview');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (!isAuthenticated && userId !== CURRENT_USER.id && !demoOtherProfiles[userId]) {
        if (OTHER_USERS[userId]) {
          setDemoOtherProfiles((prev) => ({
            ...prev,
            [userId]: OTHER_USERS[userId],
          }));
        } else {
          const matchedConn = [
            ...demoFollowers,
            ...demoFollowing,
            ...demoFollowRequests.map((r) => r.user),
          ].find((u) => u.id === userId);
          if (matchedConn) {
            setDemoOtherProfiles((prev) => ({
              ...prev,
              [matchedConn.id]: buildProfileFromFollowUser(matchedConn),
            }));
          }
        }
      }

      setActiveProfileId(userId);
      setActiveTab('overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [
      isAuthenticated,
      user,
      authOtherProfilesMap,
      demoOtherProfiles,
      demoFollowers,
      demoFollowing,
      demoFollowRequests,
    ]
  );

  // Handler: Open filtered Anime List from clickable Anime Stats status rows
  const handleSelectAnimeStatus = useCallback(
    (status: AnimeStatus) => {
      if (!canAccessActiveProfileAnimeList) return;
      setSelectedAnimeDetailId(null);
      setSelectedAnimeStatusFilter(status);
      setAnimeFilterSyncKey((prev) => prev + 1);
      setActiveTab('animes');
    },
    [canAccessActiveProfileAnimeList]
  );

  // Handler: Navigate tabs (preserves user filter/search/scroll when returning to Animes tab)
  const handleTabChange = useCallback((tab: ProfileTab) => {
    if (tab === 'animes') {
      setSelectedAnimeDetailId(null);
      setSelectedAnimeStatusFilter(undefined);
    }
    setActiveTab(tab);
  }, []);

  // Handler: Open specific anime detail view from Header search
  const handleSelectAnimeFromSearch = useCallback(
    (animeId: string) => {
      if (!canAccessActiveProfileAnimeList) return;
      setSelectedAnimeStatusFilter(undefined);
      setSelectedAnimeDetailId(animeId);
      setActiveTab('animes');
    },
    [canAccessActiveProfileAnimeList]
  );

  const activeFollowersSource = isAuthenticated
    ? activeAuthWorkspace?.followers
    : demoFollowers;

  // Synchronize user context with server for authoritative privacy and block checks (deduplicated by payload signature)
  useEffect(() => {
    if (!ENABLE_PRIVATE_MESSAGES || !currentUser.id) return;
    const currentFollowerIds = (activeFollowersSource ?? []).map((f) => f.id);

    syncUserPrivacyContext({
      id: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.displayName,
      avatarUrl: currentUser.avatarUrl,
      allowDirectMessages: currentUser.privacySettings?.allowDirectMessages !== false,
      directMessagesFrom: currentUser.privacySettings?.directMessagesFrom || 'everyone',
      showOnlineStatus: currentUser.privacySettings?.showOnlineStatus !== false,
      followingIds: Array.from(followingIds),
      followerIds: currentFollowerIds,
      blockedIds: Array.from(blockedIds),
    });
  }, [
    currentUser.id,
    currentUser.username,
    currentUser.displayName,
    currentUser.avatarUrl,
    currentUser.privacySettings?.allowDirectMessages,
    currentUser.privacySettings?.directMessagesFrom,
    currentUser.privacySettings?.showOnlineStatus,
    followingIds,
    blockedIds,
    activeFollowersSource,
  ]);

  // Mensagens privadas desativadas temporariamente: não iniciar listeners nem polling.
  useEffect(() => {
    if (!ENABLE_PRIVATE_MESSAGES) {
      setUnreadMessagesCount(0);
      return;
    }
    if (!currentUser.id) {
      setUnreadMessagesCount(0);
      return;
    }
    return subscribeToUnreadMessagesCount(currentUser.id, setUnreadMessagesCount);
  }, [currentUser.id]);

  // Validate whether the current user is allowed to message the currently viewed profile
  const activeProfileDirectMessageCheck = useMemo(() => {
    if (isOwnProfile) return { allowed: true };

    const currentFollowerIds = (activeFollowersSource ?? []).map((f) => f.id);

    const senderCtx: UserCheckContext = {
      id: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.displayName,
      avatarUrl: currentUser.avatarUrl,
      allowDirectMessages: currentUser.privacySettings?.allowDirectMessages !== false,
      directMessagesFrom: currentUser.privacySettings?.directMessagesFrom || 'everyone',
      followingIds: Array.from(followingIds),
      followerIds: currentFollowerIds,
      blockedIds: Array.from(blockedIds),
    };

    const recipientCtx: UserCheckContext = {
      id: activeProfile.id,
      username: activeProfile.username,
      displayName: activeProfile.displayName,
      avatarUrl: activeProfile.avatarUrl,
      allowDirectMessages: activeProfile.privacySettings?.allowDirectMessages !== false,
      directMessagesFrom: activeProfile.privacySettings?.directMessagesFrom || 'everyone',
      followingIds: [],
      followerIds: followingIds.has(activeProfile.id) ? [currentUser.id] : [],
      blockedIds: blockedIds.has(activeProfile.id) ? [currentUser.id] : [],
    };

    return canUserMessageRecipient(senderCtx, recipientCtx);
  }, [isOwnProfile, currentUser, activeProfile, followingIds, blockedIds, activeFollowersSource]);

  // Handler: Open chat modal with optional preselected recipient
  const handleOpenChat = useCallback((targetRecipientId?: string) => {
    if (!ENABLE_PRIVATE_MESSAGES) return;
    setChatRecipientId(targetRecipientId || null);
    setIsChatOpen(true);
  }, []);

  // Handler: Follow / Request toggle
  const handleFollowToggle = async () => {
    if (isOwnProfile || isFollowPending) return;
    const targetId = activeProfile.id;
    if (!targetId || targetId === currentUser.id) return;

    setIsFollowPending(true);

    try {
      if (isAuthenticated) {
        const isFollowingTarget = followingIds.has(targetId);
        const isRequestedTarget = requestedIds.has(targetId);

        let delta = 0;
        if (isFollowingTarget) {
          delta = -1;
        } else if (!isRequestedTarget && !activeProfile.isPrivate) {
          delta = 1;
        }

        // Synchronize follow/unfollow/follow-back with backend so recipient receives deduplicated notification
        if (isFollowingTarget || isRequestedTarget) {
          const remoteRes = await unfollowRemoteUser(targetId);
          if (!remoteRes?.ok || !remoteRes.callerSocialState) {
            throw new Error('Não foi possível confirmar a remoção do vínculo no servidor. Tente novamente.');
          }

          // A resposta do backend pode conter arrays vazios legítimos. Não use merge que
          // restaure arrays antigos do cache: remova o alvo explicitamente após a confirmação.
          updateAuthWorkspace(
            (prev) => {
              const { nextWorkspace } = mergeServerSocialIntoWorkspace(
                prev,
                remoteRes.callerSocialState
              );
              const nextFollowingIds = nextWorkspace.followingIds.filter((id) => id !== targetId);
              const nextRequestedIds = nextWorkspace.requestedIds.filter((id) => id !== targetId);
              const nextFollowing = nextWorkspace.following.filter((u) => u.id !== targetId);
              return {
                ...nextWorkspace,
                followingIds: nextFollowingIds,
                requestedIds: nextRequestedIds,
                following: nextFollowing,
                followers: nextWorkspace.followers.map((u) =>
                  u.id === targetId ? { ...u, isFollowing: false } : u
                ),
                profileOverrides: {
                  ...nextWorkspace.profileOverrides,
                  followingCount: nextFollowingIds.length,
                },
              };
            },
            { immediate: true }
          );

          const updatedTargetFollowers =
            remoteRes?.targetFollowersCount ??
            Math.max(0, activeProfile.followersCount + delta);

          setRemoteVisitedProfiles((prev) => {
            const currentTarget = prev[targetId] ?? authOtherProfilesMap[targetId] ?? activeProfile;
            return {
              ...prev,
              [targetId]: {
                ...currentTarget,
                followersCount: updatedTargetFollowers,
              },
            };
          });
          setRemoteVisitedDetails((prev) => {
            if (!prev[targetId]) return prev;
            return {
              ...prev,
              [targetId]: {
                ...prev[targetId],
                profile: {
                  ...prev[targetId].profile,
                  followersCount: updatedTargetFollowers,
                },
              },
            };
          });
          if (delta !== 0) {
            adjustCachedPublicProfileFollowersCount(targetId, delta);
            setPublicProfilesRevision((r) => r + 1);
          }
          return;
        }

        const followRes = await followRemoteUser(
          targetId,
          {
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
          {
            username: activeProfile.username,
            displayName: activeProfile.displayName,
            avatarUrl: activeProfile.avatarUrl,
            isPrivate: activeProfile.isPrivate,
          }
        );

        if (followRes?.callerSocialState) {
          updateAuthWorkspace(
            (prev) => {
              const { nextWorkspace } = mergeServerSocialIntoWorkspace(
                prev,
                followRes.callerSocialState
              );
              return nextWorkspace;
            },
            { immediate: true }
          );
        } else {
          updateAuthWorkspace(
            (prev) => {
              const followingSet = new Set(prev.followingIds);
              const requestedSet = new Set(prev.requestedIds);
              let nextFollowing = prev.following;
              let nextFollowers = prev.followers;

              if (activeProfile.isPrivate) {
                requestedSet.add(targetId);
              } else {
                followingSet.add(targetId);
                if (!prev.following.some((u) => u.id === targetId)) {
                  nextFollowing = [
                    {
                      id: targetId,
                      username: activeProfile.username,
                      displayName: activeProfile.displayName,
                      avatarUrl: activeProfile.avatarUrl,
                      bio: activeProfile.bio,
                      isFollowing: true,
                      isRequested: false,
                      isFollower: prev.followers.some((u) => u.id === targetId),
                      isBlocked: false,
                      createdAt: activeProfile.createdAt,
                    },
                    ...prev.following,
                  ];
                }
                nextFollowers = prev.followers.map((u) =>
                  u.id === targetId ? { ...u, isFollowing: true } : u
                );
              }

              const currentFollowingCount =
                prev.profileOverrides.followingCount ?? prev.following.length;

              return {
                ...prev,
                followingIds: Array.from(followingSet),
                requestedIds: Array.from(requestedSet),
                following: nextFollowing,
                followers: nextFollowers,
                profileOverrides:
                  delta !== 0
                    ? {
                        ...prev.profileOverrides,
                        followingCount: Math.max(0, currentFollowingCount + delta),
                      }
                    : prev.profileOverrides,
              };
            },
            { immediate: true }
          );
        }

        if (delta !== 0 || followRes) {
          const nextFollowersCount =
            followRes?.targetFollowersCount ?? Math.max(0, activeProfile.followersCount + delta);
          setRemoteVisitedProfiles((prev) => {
            const currentTarget = prev[targetId] ?? authOtherProfilesMap[targetId] ?? activeProfile;
            return {
              ...prev,
              [targetId]: {
                ...currentTarget,
                followersCount: nextFollowersCount,
              },
            };
          });
          setRemoteVisitedDetails((prev) => {
            if (!prev[targetId]) return prev;
            return {
              ...prev,
              [targetId]: {
                ...prev[targetId],
                profile: {
                  ...prev[targetId].profile,
                  followersCount: nextFollowersCount,
                },
              },
            };
          });

          if (delta !== 0) {
            adjustCachedPublicProfileFollowersCount(targetId, delta);
            setPublicProfilesRevision((r) => r + 1);
          }
        }
        return;
      }

      // Demo Mode
      if (isFollowingActive) {
        setDemoFollowingIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        setDemoOtherProfiles((prev) => {
          const existingTarget = prev[targetId] ?? activeProfile;
          return {
            ...prev,
            [targetId]: {
              ...existingTarget,
              followersCount: Math.max(0, existingTarget.followersCount - 1),
            },
          };
        });
        setDemoProfile((prev) => ({
          ...prev,
          followingCount: Math.max(0, prev.followingCount - 1),
        }));
        setDemoFollowing((prev) => prev.filter((u) => u.id !== targetId));
        setDemoFollowers((prev) =>
          prev.map((u) => (u.id === targetId ? { ...u, isFollowing: false } : u))
        );
      } else if (isRequestedActive) {
        setDemoRequestedIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      } else if (activeProfile.isPrivate) {
        setDemoRequestedIds((prev) => new Set(prev).add(targetId));
      } else {
        setDemoFollowingIds((prev) => new Set(prev).add(targetId));
        setDemoOtherProfiles((prev) => {
          const existingTarget = prev[targetId] ?? activeProfile;
          return {
            ...prev,
            [targetId]: {
              ...existingTarget,
              followersCount: existingTarget.followersCount + 1,
            },
          };
        });
        setDemoProfile((prev) => ({
          ...prev,
          followingCount: prev.followingCount + 1,
        }));
        setDemoFollowing((prev) => {
          if (prev.some((u) => u.id === targetId)) return prev;
          return [
            {
              id: targetId,
              username: activeProfile.username,
              displayName: activeProfile.displayName,
              avatarUrl: activeProfile.avatarUrl,
              bio: activeProfile.bio,
              isFollowing: true,
              isRequested: false,
              isFollower: demoFollowers.some((u) => u.id === targetId),
              isBlocked: false,
              createdAt: activeProfile.createdAt,
            },
            ...prev,
          ];
        });
        setDemoFollowers((prev) =>
          prev.map((u) => (u.id === targetId ? { ...u, isFollowing: true } : u))
        );
      }
    } catch (err) {
      console.error('Falha ao alternar relação de seguidor:', err);
    } finally {
      setIsFollowPending(false);
    }
  };

  // Handler: Block toggle
  const handleBlockToggle = () => {
    if (isOwnProfile) return;
    if (isAuthenticated) {
      updateAuthWorkspace((prev) => {
        const blockedSet = new Set(prev.blockedIds);
        const followingSet = new Set(prev.followingIds);
        if (blockedSet.has(activeProfile.id)) {
          blockedSet.delete(activeProfile.id);
        } else {
          blockedSet.add(activeProfile.id);
          followingSet.delete(activeProfile.id);
        }
        return {
          ...prev,
          blockedIds: Array.from(blockedSet),
          followingIds: Array.from(followingSet),
        };
      });
      return;
    }

    setDemoBlockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(activeProfile.id)) {
        next.delete(activeProfile.id);
      } else {
        next.add(activeProfile.id);
        setDemoFollowingIds((f) => {
          const fNext = new Set(f);
          fNext.delete(activeProfile.id);
          return fNext;
        });
      }
      return next;
    });
  };

  // Handler: Accept follow request
  const handleAcceptRequest = (requestId: string, notifId?: string) => {
    if (isAuthenticated) {
      void respondRemoteFollowRequest(requestId, 'accept');
      updateAuthWorkspace((prev) => {
        const req = prev.followRequests.find((r) => r.id === requestId);
        const nextFollowRequests = prev.followRequests.filter((r) => r.id !== requestId);
        const nextFollowers = req ? [req.user, ...prev.followers] : prev.followers;
        const currentFollowersCount = prev.profileOverrides.followersCount ?? 0;
        const nextNotifications = prev.notifications.map((n) => {
          if (n.id === notifId || n.contextData?.requestId === requestId) {
            return {
              ...n,
              isRead: true,
              handled: 'accepted' as const,
              message: 'começou a seguir o seu perfil (solicitação aceita).',
            };
          }
          return n;
        });
        return {
          ...prev,
          followRequests: nextFollowRequests,
          followers: nextFollowers,
          notifications: nextNotifications,
          profileOverrides: req
            ? { ...prev.profileOverrides, followersCount: currentFollowersCount + 1 }
            : prev.profileOverrides,
        };
      });
      return;
    }

    const req = demoFollowRequests.find((r) => r.id === requestId);
    if (req) {
      setDemoFollowRequests((prev) => prev.filter((r) => r.id !== requestId));
      setDemoFollowers((prev) => [req.user, ...prev]);
      setDemoProfile((prev) => ({
        ...prev,
        followersCount: prev.followersCount + 1,
      }));
    }

    setDemoNotifications((prev) =>
      prev.map((n) => {
        if (n.id === notifId || n.contextData?.requestId === requestId) {
          return {
            ...n,
            isRead: true,
            handled: 'accepted' as const,
            message: 'começou a seguir o seu perfil (solicitação aceita).',
          };
        }
        return n;
      })
    );
  };

  // Handler: Reject follow request
  const handleRejectRequest = (requestId: string, notifId?: string) => {
    if (isAuthenticated) {
      void respondRemoteFollowRequest(requestId, 'reject');
      updateAuthWorkspace((prev) => ({
        ...prev,
        followRequests: prev.followRequests.filter((r) => r.id !== requestId),
        notifications: prev.notifications.map((n) => {
          if (n.id === notifId || n.contextData?.requestId === requestId) {
            return {
              ...n,
              isRead: true,
              handled: 'rejected' as const,
              message: 'solicitação para seguir recusada.',
            };
          }
          return n;
        }),
      }));
      return;
    }

    setDemoFollowRequests((prev) => prev.filter((r) => r.id !== requestId));
    setDemoNotifications((prev) =>
      prev.map((n) => {
        if (n.id === notifId || n.contextData?.requestId === requestId) {
          return {
            ...n,
            isRead: true,
            handled: 'rejected' as const,
            message: 'solicitação para seguir recusada.',
          };
        }
        return n;
      })
    );
  };

  // Handler: Remove follower
  const handleRemoveFollower = (userId: string) => {
    if (isAuthenticated) {
      void removeRemoteFollower(userId);
      updateAuthWorkspace((prev) => ({
        ...prev,
        followers: prev.followers.filter((u) => u.id !== userId),
        profileOverrides: {
          ...prev.profileOverrides,
          followersCount: Math.max(0, (prev.profileOverrides.followersCount ?? prev.followers.length) - 1),
        },
      }));
      return;
    }

    setDemoFollowers((prev) => prev.filter((u) => u.id !== userId));
    setDemoProfile((prev) => ({
      ...prev,
      followersCount: Math.max(0, prev.followersCount - 1),
    }));
  };

  // Handler: Unfollow from modal — só atualiza a interface após confirmação do servidor.
  const handleUnfollowFromModal = async (userId: string) => {
    if (isAuthenticated) {
      const remoteRes = await unfollowRemoteUser(userId);
      if (!remoteRes?.ok || !remoteRes.callerSocialState) return;
      updateAuthWorkspace(
        (prev) => {
          const { nextWorkspace } = mergeServerSocialIntoWorkspace(prev, remoteRes.callerSocialState);
          const nextFollowingIds = nextWorkspace.followingIds.filter((id) => id !== userId);
          return {
            ...nextWorkspace,
            following: nextWorkspace.following.filter((u) => u.id !== userId),
            followingIds: nextFollowingIds,
            requestedIds: nextWorkspace.requestedIds.filter((id) => id !== userId),
            followers: nextWorkspace.followers.map((u) =>
              u.id === userId ? { ...u, isFollowing: false } : u
            ),
            profileOverrides: {
              ...nextWorkspace.profileOverrides,
              followingCount: nextFollowingIds.length,
            },
          };
        },
        { immediate: true }
      );
      setRemoteVisitedProfiles((prev) => {
        if (!prev[userId]) return prev;
        return { ...prev, [userId]: { ...prev[userId], followersCount: remoteRes.targetFollowersCount } };
      });
      adjustCachedPublicProfileFollowersCount(userId, -1);
      setPublicProfilesRevision((r) => r + 1);
      return;
    }

    setDemoFollowing((prev) => prev.filter((u) => u.id !== userId));
    setDemoFollowers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, isFollowing: false } : u))
    );
    setDemoFollowingIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    setDemoProfile((prev) => ({ ...prev, followingCount: Math.max(0, prev.followingCount - 1) }));
    setDemoOtherProfiles((prev) => {
      if (!prev[userId]) return prev;
      return { ...prev, [userId]: { ...prev[userId], followersCount: Math.max(0, prev[userId].followersCount - 1) } };
    });
  };

  // Handler: Seguir de volta diretamente pela notificação de novo seguidor sem recarregar a página
  const handleFollowBackFromNotification = useCallback(
    async (actor: NotificationItem['actor'], notifId: string) => {
      const targetId = actor?.id?.trim();
      if (!targetId || targetId === currentUser.id) return;
      if (
        followingIds.has(targetId) ||
        requestedIds.has(targetId) ||
        blockedIds.has(targetId) ||
        pendingFollowTargetIds.has(targetId)
      ) {
        return;
      }

      handleMarkNotificationAsRead(notifId);
      setPendingFollowTargetIds((prev) => new Set(prev).add(targetId));

      try {
        if (isAuthenticated) {
          const targetProfile = authOtherProfilesMap[targetId];
          const followRes = await followRemoteUser(
            targetId,
            {
              username: currentUser.username,
              displayName: currentUser.displayName,
              avatarUrl: currentUser.avatarUrl,
            },
            {
              username: targetProfile?.username || actor.username,
              displayName: targetProfile?.displayName || actor.displayName,
              avatarUrl: targetProfile?.avatarUrl || actor.avatarUrl,
              isPrivate: Boolean(targetProfile?.isPrivate),
            }
          );

          if (followRes?.callerSocialState) {
            updateAuthWorkspace(
              (prev) => {
                const { nextWorkspace } = mergeServerSocialIntoWorkspace(
                  prev,
                  followRes.callerSocialState
                );
                return nextWorkspace;
              },
              { immediate: true }
            );
          } else {
            updateAuthWorkspace(
              (prev) => {
                const followingSet = new Set(prev.followingIds);
                const requestedSet = new Set(prev.requestedIds);
                let nextFollowing = prev.following;
                let nextFollowers = prev.followers;

                if (targetProfile?.isPrivate) {
                  requestedSet.add(targetId);
                } else {
                  followingSet.add(targetId);
                  if (!prev.following.some((u) => u.id === targetId)) {
                    nextFollowing = [
                      {
                        id: targetId,
                        username: targetProfile?.username || actor.username,
                        displayName: targetProfile?.displayName || actor.displayName,
                        avatarUrl: targetProfile?.avatarUrl || actor.avatarUrl,
                        bio: targetProfile?.bio || '',
                        isFollowing: true,
                        isRequested: false,
                        isFollower: true,
                        isBlocked: false,
                        createdAt: targetProfile?.createdAt || 'Agora',
                      },
                      ...prev.following,
                    ];
                  }
                  if (prev.followers.some((u) => u.id === targetId)) {
                    nextFollowers = prev.followers.map((u) =>
                      u.id === targetId ? { ...u, isFollowing: true } : u
                    );
                  } else {
                    nextFollowers = [
                      {
                        id: targetId,
                        username: targetProfile?.username || actor.username,
                        displayName: targetProfile?.displayName || actor.displayName,
                        avatarUrl: targetProfile?.avatarUrl || actor.avatarUrl,
                        bio: targetProfile?.bio || '',
                        isFollowing: true,
                        isRequested: false,
                        isFollower: true,
                        isBlocked: false,
                        createdAt: targetProfile?.createdAt || 'Agora',
                      },
                      ...prev.followers,
                    ];
                  }
                }

                const nextFollowingIds = Array.from(followingSet);
                return {
                  ...prev,
                  followingIds: nextFollowingIds,
                  requestedIds: Array.from(requestedSet),
                  following: nextFollowing,
                  followers: nextFollowers,
                  profileOverrides: {
                    ...prev.profileOverrides,
                    followingCount: nextFollowingIds.length,
                  },
                };
              },
              { immediate: true }
            );
          }

          if (!targetProfile?.isPrivate) {
            const nextFollowersCount =
              followRes?.targetFollowersCount ?? (targetProfile?.followersCount ?? 0) + 1;
            setRemoteVisitedProfiles((prev) => {
              const currentTarget = prev[targetId] ?? targetProfile;
              if (!currentTarget) return prev;
              return {
                ...prev,
                [targetId]: {
                  ...currentTarget,
                  followersCount: nextFollowersCount,
                },
              };
            });
            setRemoteVisitedDetails((prev) => {
              if (!prev[targetId]) return prev;
              return {
                ...prev,
                [targetId]: {
                  ...prev[targetId],
                  profile: {
                    ...prev[targetId].profile,
                    followersCount: nextFollowersCount,
                  },
                },
              };
            });
            adjustCachedPublicProfileFollowersCount(targetId, 1);
            setPublicProfilesRevision((r) => r + 1);
          }
          return;
        }

        // Demo Mode
        const targetDemoProfile = demoOtherProfiles[targetId] || OTHER_USERS[targetId];
        if (targetDemoProfile?.isPrivate) {
          setDemoRequestedIds((prev) => new Set(prev).add(targetId));
          return;
        }

        setDemoFollowingIds((prev) => new Set(prev).add(targetId));
        setDemoProfile((prev) => ({
          ...prev,
          followingCount: prev.followingCount + 1,
        }));
        setDemoOtherProfiles((prev) => {
          const existingTarget = prev[targetId] ??
            OTHER_USERS[targetId] ?? {
              ...NEUTRAL_LOADING_PROFILE,
              id: targetId,
              username: actor.username,
              displayName: actor.displayName,
              avatarUrl: actor.avatarUrl,
              followersCount: 0,
              followingCount: 1,
            };
          return {
            ...prev,
            [targetId]: {
              ...existingTarget,
              followersCount: existingTarget.followersCount + 1,
            },
          };
        });
        setDemoFollowing((prev) => {
          if (prev.some((u) => u.id === targetId)) return prev;
          return [
            {
              id: targetId,
              username: targetDemoProfile?.username || actor.username,
              displayName: targetDemoProfile?.displayName || actor.displayName,
              avatarUrl: targetDemoProfile?.avatarUrl || actor.avatarUrl,
              bio: targetDemoProfile?.bio || '',
              isFollowing: true,
              isRequested: false,
              isFollower: true,
              isBlocked: false,
              createdAt: targetDemoProfile?.createdAt || 'Agora',
            },
            ...prev,
          ];
        });
        setDemoFollowers((prev) =>
          prev.map((u) => (u.id === targetId ? { ...u, isFollowing: true } : u))
        );
      } catch (err) {
        console.error('Falha ao seguir de volta pela notificação:', err);
      } finally {
        setPendingFollowTargetIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }
    },
    [
      currentUser.id,
      currentUser.username,
      currentUser.displayName,
      currentUser.avatarUrl,
      followingIds,
      requestedIds,
      blockedIds,
      pendingFollowTargetIds,
      handleMarkNotificationAsRead,
      isAuthenticated,
      authOtherProfilesMap,
      updateAuthWorkspace,
      demoOtherProfiles,
    ]
  );

  // Handler: Update episode progress (single-slot update without full-list map cloning)
  const handleUpdateEpisode = useCallback(
    (animeId: string, delta: number) => {
      const currentAnimes = latestAnimeMutationStateRef.current.animes;
      const result = updateSingleAnimeById(currentAnimes, animeId, (prevAnime) => {
        const newEp = Math.min(
          prevAnime.totalEpisodes,
          Math.max(0, prevAnime.currentEpisode + delta)
        );
        const newStatus: AnimeItem['status'] =
          newEp === prevAnime.totalEpisodes && prevAnime.totalEpisodes > 0
            ? 'completed'
            : prevAnime.status === 'completed' && newEp < prevAnime.totalEpisodes
            ? newEp === 0
              ? 'planned'
              : 'watching'
            : prevAnime.status === 'planned' && newEp > 0
            ? 'watching'
            : prevAnime.status;

        if (newEp === prevAnime.currentEpisode && newStatus === prevAnime.status) {
          return null;
        }
        return markAnimeLocallyModified({ ...prevAnime, currentEpisode: newEp, status: newStatus });
      });

      if (!result) return;
      const { nextAnimes, previousAnime: prevAnime, updatedAnime } = result;
      const newEp = updatedAnime.currentEpisode;
      const newStatus = updatedAnime.status;

      const actionNow = Date.now();
      const completedNow = newStatus === 'completed' && prevAnime.status !== 'completed';
      const activity: UserActivity = completedNow
        ? {
            id: `act_${actionNow}_${animeId}`,
            type: 'completed_anime',
            title: `Marcou ${prevAnime.title} como concluído`,
            description: `${newEp}/${prevAnime.totalEpisodes} episódios`,
            timestamp: 'Agora',
            createdAtTimestamp: actionNow,
            episode: newEp,
          }
        : {
            id: `act_${actionNow}_${animeId}`,
            type: 'watched_ep',
            title:
              newEp > prevAnime.currentEpisode
                ? `Assistiu até o episódio ${newEp} de ${prevAnime.title}`
                : `Atualizou o progresso de ${prevAnime.title} para o episódio ${newEp}`,
            description: `Progresso: ${newEp}/${prevAnime.totalEpisodes} episódios`,
            timestamp: 'Agora',
            createdAtTimestamp: actionNow,
            episode: newEp,
          };

      if (completedNow) {
        invalidateAnimeStatusChange(currentUser.id, prevAnime.status, 'completed');
      } else {
        invalidateAnimeCategory(currentUser.id, updatedAnime.status);
      }
      updateCachedAnimeLocally(currentUser.id, updatedAnime, updatedAnime.status);
      invalidateActivitiesCache(currentUser.id);
      persistAndApply(nextAnimes, activity);
    },
    [currentUser.id, persistAndApply]
  );

  // Handler: Update anime status (single-slot update with automatic episode maxing on completion)
  const handleUpdateStatus = useCallback(
    (animeId: string, newStatus: AnimeItem['status']) => {
      const currentAnimes = latestAnimeMutationStateRef.current.animes;
      const result = updateSingleAnimeById(currentAnimes, animeId, (prevAnime) => {
        if (prevAnime.status === newStatus) return null;
        const nextEp =
          newStatus === 'completed' ? prevAnime.totalEpisodes : prevAnime.currentEpisode;
        return markAnimeLocallyModified({ ...prevAnime, status: newStatus, currentEpisode: nextEp });
      });

      if (!result) return;
      const { nextAnimes, previousAnime: prevAnime, updatedAnime } = result;
      const isCompleted = newStatus === 'completed';
      const nextEp = updatedAnime.currentEpisode;

      const actionNow = Date.now();
      const activity: UserActivity = isCompleted
        ? {
            id: `act_${actionNow}_${animeId}`,
            type: 'completed_anime',
            title: `Marcou ${prevAnime.title} como concluído`,
            description: `${nextEp}/${prevAnime.totalEpisodes} episódios`,
            timestamp: 'Agora',
            createdAtTimestamp: actionNow,
            episode: nextEp,
          }
        : {
            id: `act_${actionNow}_${animeId}`,
            type: 'status_changed',
            title:
              newStatus === 'on_hold'
                ? `Colocou ${prevAnime.title} em espera`
                : newStatus === 'dropped'
                ? `Marcou ${prevAnime.title} como abandonado`
                : `Moveu ${prevAnime.title} para ${STATUS_ACTIVITY_LABEL[newStatus]}`,
            description: `Progresso: ${nextEp}/${prevAnime.totalEpisodes} episódios`,
            timestamp: 'Agora',
            createdAtTimestamp: actionNow,
            episode: nextEp,
          };

      invalidateAnimeStatusChange(currentUser.id, prevAnime.status, newStatus);
      updateCachedAnimeLocally(currentUser.id, updatedAnime, newStatus);
      invalidateActivitiesCache(currentUser.id);
      persistAndApply(nextAnimes, activity);
    },
    [currentUser.id, persistAndApply]
  );

  // Handler: Save anime edit from modal (single-slot update, recording 1 consolidated activity)
  const handleSaveAnimeEdit = useCallback(
    (
      animeId: string,
      updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }
    ) => {
      const currentAnimes = latestAnimeMutationStateRef.current.animes;
      const result = updateSingleAnimeById(currentAnimes, animeId, (prevAnime) => {
        const nextEp = Math.min(prevAnime.totalEpisodes, Math.max(0, updates.currentEpisode));
        const nextStatus = updates.status;
        const nextRating = updates.rating;

        if (
          nextStatus === prevAnime.status &&
          nextEp === prevAnime.currentEpisode &&
          nextRating === prevAnime.rating
        ) {
          return null;
        }
        return markAnimeLocallyModified({
          ...prevAnime,
          currentEpisode: nextEp,
          status: nextStatus,
          rating: nextRating,
        });
      });

      if (!result) return;
      const { nextAnimes, previousAnime: prevAnime, updatedAnime } = result;
      const nextEp = updatedAnime.currentEpisode;
      const nextStatus = updatedAnime.status;
      const nextRating = updatedAnime.rating;

      const statusChanged = nextStatus !== prevAnime.status;
      const epChanged = nextEp !== prevAnime.currentEpisode;
      const ratingChanged = nextRating !== prevAnime.rating;

      const actionNow = Date.now();
      let newActivity: UserActivity | null = null;

      if (statusChanged && nextStatus === 'completed') {
        newActivity = {
          id: `act_${actionNow}_${animeId}`,
          type: 'completed_anime',
          title: `Marcou ${prevAnime.title} como concluído`,
          description: `${nextEp}/${prevAnime.totalEpisodes} episódios${ratingChanged && nextRating > 0 ? ` · Nota ${nextRating}/10` : ''}`,
          timestamp: 'Agora',
          createdAtTimestamp: actionNow,
          episode: nextEp,
          score: ratingChanged && nextRating > 0 ? nextRating : undefined,
        };
      } else if (statusChanged) {
        const statusTitle =
          nextStatus === 'on_hold'
            ? `Colocou ${prevAnime.title} em espera`
            : nextStatus === 'dropped'
            ? `Marcou ${prevAnime.title} como abandonado`
            : `Moveu ${prevAnime.title} para ${STATUS_ACTIVITY_LABEL[nextStatus]}`;

        newActivity = {
          id: `act_${actionNow}_${animeId}`,
          type: 'status_changed',
          title: statusTitle,
          description: `Progresso: ${nextEp}/${prevAnime.totalEpisodes} episódios${ratingChanged && nextRating > 0 ? ` · Nota ${nextRating}/10` : ''}`,
          timestamp: 'Agora',
          createdAtTimestamp: actionNow,
          episode: nextEp,
          score: ratingChanged && nextRating > 0 ? nextRating : undefined,
        };
      } else if (ratingChanged) {
        newActivity = {
          id: `act_${actionNow}_${animeId}`,
          type: 'rated',
          title:
            nextRating > 0
              ? `Avaliou ${prevAnime.title} com nota ${nextRating}`
              : `Removeu a avaliação de ${prevAnime.title}`,
          description: epChanged
            ? `Progresso atualizado para ${nextEp}/${prevAnime.totalEpisodes} episódios`
            : nextRating > 0
            ? `Avaliação atualizada (${nextRating}/10)`
            : 'Sem nota atribuída',
          timestamp: 'Agora',
          createdAtTimestamp: actionNow,
          score: nextRating > 0 ? nextRating : undefined,
          episode: epChanged ? nextEp : undefined,
        };
      } else if (epChanged) {
        newActivity = {
          id: `act_${actionNow}_${animeId}`,
          type: 'watched_ep',
          title:
            nextEp > prevAnime.currentEpisode
              ? `Assistiu até o episódio ${nextEp} de ${prevAnime.title}`
              : `Atualizou o progresso de ${prevAnime.title} para o episódio ${nextEp}`,
          description: `Progresso: ${nextEp}/${prevAnime.totalEpisodes} episódios`,
          timestamp: 'Agora',
          createdAtTimestamp: actionNow,
          episode: nextEp,
        };
      }

      if (statusChanged) {
        invalidateAnimeStatusChange(currentUser.id, prevAnime.status, nextStatus);
      } else {
        invalidateAnimeCategory(currentUser.id, nextStatus);
      }
      updateCachedAnimeLocally(currentUser.id, updatedAnime, nextStatus);
      if (newActivity) {
        invalidateActivitiesCache(currentUser.id);
      }
      persistAndApply(nextAnimes, newActivity);
    },
    [currentUser.id, persistAndApply]
  );

  // Handler: Toggle favorite (single-slot update without full-list map cloning)
  const handleToggleFavorite = useCallback(
    (animeId: string) => {
      const currentAnimes = latestAnimeMutationStateRef.current.animes;
      const result = updateSingleAnimeById(currentAnimes, animeId, (prevAnime) =>
        markAnimeLocallyModified({
          ...prevAnime,
          isFavorite: !prevAnime.isFavorite,
        })
      );
      if (!result) return;

      const { nextAnimes, previousAnime: prevAnime, updatedAnime } = result;
      const nextFav = updatedAnime.isFavorite;

      const actionNow = Date.now();
      const activity: UserActivity = {
        id: `act_${actionNow}_${animeId}`,
        type: 'added_favorite',
        title: nextFav
          ? `Adicionou ${prevAnime.title} aos favoritos`
          : `Removeu ${prevAnime.title} dos favoritos`,
        description: prevAnime.genres.slice(0, 2).join(' · '),
        timestamp: 'Agora',
        createdAtTimestamp: actionNow,
        animeId: prevAnime.id,
        animeTitle: prevAnime.title,
        posterUrl: prevAnime.posterUrl,
      };

      invalidateAnimeCategory(currentUser.id, updatedAnime.status);
      updateCachedAnimeLocally(currentUser.id, updatedAnime, updatedAnime.status);
      invalidateActivitiesCache(currentUser.id);
      persistAndApply(nextAnimes, activity);
    },
    [currentUser.id, persistAndApply]
  );

  // Image updates: arquivos locais precisam ir para o Blob persistente antes
  // de gravar a URL no workspace; Data URLs não sobrevivem de forma confiável
  // à sincronização/recarga e podem exceder os limites do Firestore.
  const handleUpdateAvatar = (url: string) => {
    if (!url.startsWith('data:image/')) {
      applyProfilePatch({ avatarUrl: url });
      return;
    }
    void uploadProfileMedia(url, 'avatar')
      .then((storedUrl) => applyProfilePatch({ avatarUrl: storedUrl }))
      .catch((error) => {
        console.error('[profile-media] Falha ao salvar avatar:', error);
        if (typeof window !== 'undefined') {
          window.alert(error instanceof Error ? error.message : 'Não foi possível salvar a foto do perfil.');
        }
      });
  };

  const handleUpdateBanner = (url: string) => {
    if (!url.startsWith('data:image/')) {
      applyProfilePatch({ bannerUrl: url });
      return;
    }
    void uploadProfileMedia(url, 'banner')
      .then((storedUrl) => applyProfilePatch({ bannerUrl: storedUrl }))
      .catch((error) => {
        console.error('[profile-media] Falha ao salvar banner:', error);
        if (typeof window !== 'undefined') {
          window.alert(error instanceof Error ? error.message : 'Não foi possível salvar o banner.');
        }
      });
  };

  const handleRemoveAvatar = () => {
    applyProfilePatch({ avatarUrl: '' });
  };

  const handleRemoveBanner = () => {
    applyProfilePatch({ bannerUrl: '' });
  };

  // Profile save
  const handleSaveProfile = (updated: Partial<UserProfile>) => {
    const patch: UserProfileOverrides = {};
    if (typeof updated.displayName === 'string') patch.displayName = updated.displayName;
    if (typeof updated.username === 'string') patch.username = updated.username;
    if (typeof updated.bio === 'string') patch.bio = updated.bio;
    if (typeof updated.avatarUrl === 'string') patch.avatarUrl = updated.avatarUrl;
    if (typeof updated.bannerUrl === 'string') patch.bannerUrl = updated.bannerUrl;
    if (typeof updated.isPrivate === 'boolean') patch.isPrivate = updated.isPrivate;
    if (typeof updated.showCommentsOnProfile === 'boolean') {
      patch.showCommentsOnProfile = updated.showCommentsOnProfile;
    }
    if (updated.privacySettings) {
      patch.privacySettings = updated.privacySettings;
    }
    if (updated.externalAccounts) {
      patch.externalAccounts = updated.externalAccounts;
    }

    applyProfilePatch(patch);

    if (isAuthenticated && user && typeof updated.displayName === 'string' && updated.displayName.trim()) {
      updateProfile(user, { displayName: updated.displayName.trim() })
        .then(() => refreshUserProfile())
        .catch(() => {
          // Per-UID persisted override remains active even if network sync fails
        });
    }
  };

  // Handler: Sync imported anime list from AniList
  const handleSyncAniList = useCallback(
    (
      mergedAnimes: AnimeItem[],
      anilistPatch: UserProfile['externalAccounts']['anilist']
    ) => {
      const actionNow = Date.now();
      const syncActivity: UserActivity = {
        id: `act_${actionNow}_anilist_sync`,
        type: 'added_anime',
        title: `Sincronizou a lista com o AniList (@${anilistPatch.username || ''})`,
        description: `Lista atualizada com ${mergedAnimes.length} animes no perfil`,
        timestamp: 'Agora',
        createdAtTimestamp: actionNow,
      };

      const fetchedCharacters = getLastFetchedAniListCharacters();
      const fetchedCompanies = getLastFetchedAniListCompanies();
      const fetchedPeople = getLastFetchedAniListPeople();

      if (isAuthenticated) {
        updateAuthWorkspace((prev) => {
          const prevAccounts = prev.profileOverrides.externalAccounts ?? {
            anilist: { connected: false },
            mal: { connected: false },
          };
          const nextExternalAccounts: UserProfile['externalAccounts'] = {
            ...prevAccounts,
            anilist: anilistPatch,
          };
          const nextProfileOverrides = {
            ...prev.profileOverrides,
            externalAccounts: nextExternalAccounts,
          };
          const nextFavoriteCharacters =
            fetchedCharacters.length > 0
              ? mergeFavoriteCharacters(prev.favoriteCharacters, fetchedCharacters)
              : prev.favoriteCharacters;
          const nextFavoriteCompanies =
            fetchedCompanies.length > 0
              ? mergeFavoriteCompanies(prev.favoriteCompanies, fetchedCompanies)
              : prev.favoriteCompanies;
          const nextFavoritePeople =
            fetchedPeople.length > 0
              ? mergeFavoritePeople(prev.favoritePeople, fetchedPeople)
              : prev.favoritePeople;

          return {
            ...prev,
            animes: mergedAnimes,
            favoriteCharacters: nextFavoriteCharacters,
            favoriteCompanies: nextFavoriteCompanies,
            favoritePeople: nextFavoritePeople,
            profileOverrides: nextProfileOverrides,
            activities: [syncActivity, ...prev.activities],
          };
        });
        invalidateAllAnimeCategories(currentUser.id);
        invalidateActivitiesCache(currentUser.id);
        return;
      }

      // Modo demonstração
      const prevDemoAccounts = demoProfile.externalAccounts ?? {
        anilist: { connected: false },
        mal: { connected: false },
      };
      const nextDemoProfile: UserProfile = {
        ...demoProfile,
        externalAccounts: {
          ...prevDemoAccounts,
          anilist: anilistPatch,
        },
      };

      const nextDemoCharacters =
        fetchedCharacters.length > 0
          ? mergeFavoriteCharacters(demoFavoriteCharacters, fetchedCharacters)
          : demoFavoriteCharacters;
      const nextDemoCompanies =
        fetchedCompanies.length > 0
          ? mergeFavoriteCompanies(demoFavoriteCompanies, fetchedCompanies)
          : demoFavoriteCompanies;
      const nextDemoPeople =
        fetchedPeople.length > 0
          ? mergeFavoritePeople(demoFavoritePeople, fetchedPeople)
          : demoFavoritePeople;

      invalidateAllAnimeCategories(currentUser.id);
      invalidateActivitiesCache(currentUser.id);
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(mergedAnimes);
      setDemoFavoriteCharacters(nextDemoCharacters);
      setDemoFavoriteCompanies(nextDemoCompanies);
      setDemoFavoritePeople(nextDemoPeople);
      setDemoActivities((prev) => [syncActivity, ...prev]);
    },
    [
      isAuthenticated,
      currentUser.id,
      demoProfile,
      demoFavoriteCharacters,
      demoFavoriteCompanies,
      demoFavoritePeople,
      updateAuthWorkspace,
    ]
  );

  // Handler: Desconectar AniList e remover animes importados exclusivamente da conta
  const handleDisconnectAniList = useCallback(
    (prunedAnimes: AnimeItem[], audit: DisconnectPruneResult) => {
      const actionNow = Date.now();
      const disconnectActivity: UserActivity = {
        id: `act_${actionNow}_anilist_disconnect`,
        type: 'status_changed',
        title: 'Desconectou a conta do AniList',
        description: `${audit.removedCount} animes importados foram removidos da coleção`,
        timestamp: 'Agora',
        createdAtTimestamp: actionNow,
      };

      if (isAuthenticated && user?.uid) {
        const uid = user.uid;
        updateAuthWorkspace((prev) => {
          const prevAccounts = prev.profileOverrides.externalAccounts ?? {
            anilist: { connected: false },
            mal: { connected: false },
          };
          const nextExternalAccounts: UserProfile['externalAccounts'] = {
            ...prevAccounts,
            anilist: { connected: false },
          };
          return {
            ...prev,
            animes: prunedAnimes,
            favoriteCharacters: pruneAniListFavoritesOnDisconnect(prev.favoriteCharacters, 'char_al_'),
            favoriteCompanies: pruneAniListFavoritesOnDisconnect(prev.favoriteCompanies, 'comp_al_'),
            favoritePeople: pruneAniListFavoritesOnDisconnect(prev.favoritePeople, 'person_al_'),
            profileOverrides: {
              ...prev.profileOverrides,
              externalAccounts: nextExternalAccounts,
            },
            activities: [disconnectActivity, ...prev.activities],
          };
        });
        void saveAllAnimesToChunkedFirestore(uid, prunedAnimes);
        void saveAnimesToIndexedDb(uid, prunedAnimes);
        clearChunkedStorageMemoryCache(uid);
        invalidateAllAnimeCategories(uid);
        invalidateActivitiesCache(uid);
        return;
      }

      // Modo demonstração
      const prevDemoAccounts = demoProfile.externalAccounts ?? {
        anilist: { connected: false },
        mal: { connected: false },
      };
      const nextDemoProfile: UserProfile = {
        ...demoProfile,
        externalAccounts: {
          ...prevDemoAccounts,
          anilist: { connected: false },
        },
      };
      invalidateAllAnimeCategories(currentUser.id);
      invalidateActivitiesCache(currentUser.id);
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(prunedAnimes);
      setDemoFavoriteCharacters((prev) => pruneAniListFavoritesOnDisconnect(prev, 'char_al_'));
      setDemoFavoriteCompanies((prev) => pruneAniListFavoritesOnDisconnect(prev, 'comp_al_'));
      setDemoFavoritePeople((prev) => pruneAniListFavoritesOnDisconnect(prev, 'person_al_'));
      void saveAnimesToIndexedDb(CURRENT_USER.id, prunedAnimes);
      setDemoActivities((prev) => [disconnectActivity, ...prev]);
    },
    [isAuthenticated, user?.uid, demoProfile, currentUser.id, updateAuthWorkspace]
  );

  // Real Logout handler: flushes pending legitimate writes, wipes volatile session memory, terminates Firebase Auth session and returns to login screen
  const handleLogout = useCallback(async () => {
    authEpochRef.current += 1;
    pendingAdminReturnRef.current = false;
    hasLoadedFullAnimesRef.current = false;
    isHydratedFullAnimesRef.current = false;

    try {
      await flushPendingWorkspaceWrites();
    } catch {
      // Best-effort flush before signOut
    }

    clearChatSessionMemoryCache();
    clearAllMemoryCache();
    clearChunkedStorageMemoryCache();
    clearLastFetchedAniListFavorites();
    clearSessionWorkspaceCaches();

    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin')) {
      window.history.pushState(null, '', '/');
    }

    setAdminVerification({
      uid: null,
      authorized: false,
      token: null,
      status: 'idle',
    });
    setIsSettingsOpen(false);
    setHasOpenedSettings(false);
    setIsFollowersOpen(false);
    setIsNotifOpen(false);
    setIsChatOpen(false);
    setChatRecipientId(null);
    setUnreadMessagesCount(0);
    setIsProfileSearchOpen(false);
    setIsDemoPreview(false);
    setAuthInitialMode('login');
    setRemoteVisitedProfiles({});
    setRemoteVisitedDetails({});
    setPrivateBlockedProfiles({});
    setVisitingStatusByTarget({});
    setSelectedAnimeStatusFilter(undefined);
    setSelectedAnimeDetailId(null);
    setActiveTab('overview');
    setAuthSession(null);
    await signOutUser();
  }, [signOutUser]);

  // Notification handlers
  const handleMarkNotificationsAsRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);

      if (isAuthenticated && user?.uid) {
        void markOwnerNotificationsRead(user.uid, { notificationIds: ids });
        updateAuthWorkspace((prev) => {
          let hasChanges = false;
          const next = prev.notifications.map((n) => {
            if (idSet.has(n.id) && !n.isRead) {
              hasChanges = true;
              return { ...n, isRead: true };
            }
            return n;
          });
          return hasChanges ? { ...prev, notifications: next } : prev;
        });
        return;
      }

      setDemoNotifications((prev) => {
        let hasChanges = false;
        const next = prev.map((n) => {
          if (idSet.has(n.id) && !n.isRead) {
            hasChanges = true;
            return { ...n, isRead: true };
          }
          return n;
        });
        return hasChanges ? next : prev;
      });
    },
    [isAuthenticated, user?.uid, updateAuthWorkspace]
  );

  const handleMarkNotificationAsRead = useCallback(
    (id: string) => {
      handleMarkNotificationsAsRead([id]);
    },
    [handleMarkNotificationsAsRead]
  );

  const handleMarkAllNotificationsAsRead = useCallback(() => {
    if (isAuthenticated && user?.uid) {
      void markOwnerNotificationsRead(user.uid, { markAll: true, notificationIds: notifications.map((notification) => notification.id) });
      updateAuthWorkspace((prev) => {
        const hasUnread = prev.notifications.some((n) => !n.isRead);
        if (!hasUnread) return prev;
        return {
          ...prev,
          notifications: prev.notifications.map((n) =>
            n.isRead ? n : { ...n, isRead: true }
          ),
        };
      });
      return;
    }

    setDemoNotifications((prev) => {
      const hasUnread = prev.some((n) => !n.isRead);
      if (!hasUnread) return prev;
      return prev.map((n) => (n.isRead ? n : { ...n, isRead: true }));
    });
  }, [isAuthenticated, user?.uid, updateAuthWorkspace, notifications]);

  // Resolve the real profile ID of a notification's actor without fabricating nonexistent users
  const resolveNotificationActorProfileId = useCallback(
    (notif: NotificationItem): string | null => {
      const normalizedUsername = notif.actor.username
        .trim()
        .replace(/^@/, '')
        .toLowerCase();

      if (isAuthenticated) {
        const explicitId = notif.actor.id || notif.contextData?.userId;
        if (explicitId) {
          return explicitId;
        }
        if (normalizedUsername) {
          if (currentUser.username.toLowerCase() === normalizedUsername) {
            return currentUser.id;
          }
          const matchedAuthConn = Object.values(authOtherProfilesMap).find(
            (u) => u.username.toLowerCase() === normalizedUsername
          );
          if (matchedAuthConn) return matchedAuthConn.id;
          return normalizedUsername;
        }
        return null;
      }

      const explicitId = notif.actor.id || notif.contextData?.userId;
      if (explicitId) {
        if (explicitId === CURRENT_USER.id || demoOtherProfiles[explicitId]) {
          return explicitId;
        }
        const matchedConn = [
          ...demoFollowers,
          ...demoFollowing,
          ...demoFollowRequests.map((r) => r.user),
        ].find((u) => u.id === explicitId);
        if (matchedConn) return matchedConn.id;
      }

      if (normalizedUsername) {
        if (demoProfile.username.toLowerCase() === normalizedUsername) {
          return CURRENT_USER.id;
        }
        const matchedFromMap = Object.values(demoOtherProfiles).find(
          (u) => u.username.toLowerCase() === normalizedUsername
        );
        if (matchedFromMap) return matchedFromMap.id;

        const matchedConn = [
          ...demoFollowers,
          ...demoFollowing,
          ...demoFollowRequests.map((r) => r.user),
        ].find((u) => u.username.toLowerCase() === normalizedUsername);
        if (matchedConn) return matchedConn.id;
      }

      return null;
    },
    [
      isAuthenticated,
      currentUser.id,
      currentUser.username,
      authOtherProfilesMap,
      demoOtherProfiles,
      demoFollowers,
      demoFollowing,
      demoFollowRequests,
      demoProfile.username,
    ]
  );

  // Navigate directly to a notification actor's real profile when available
  const handleSelectNotificationActor = useCallback(
    (notif: NotificationItem) => {
      const targetProfileId = resolveNotificationActorProfileId(notif);
      if (!targetProfileId) {
        if (notif.contextData?.modal === 'followers') {
          setFollowersInitialTab(notif.contextData.modalTab || 'followers');
          setIsFollowersOpen(true);
        }
        return;
      }

      if (!isAuthenticated && targetProfileId !== CURRENT_USER.id && !demoOtherProfiles[targetProfileId]) {
        const matchedConn = [
          ...demoFollowers,
          ...demoFollowing,
          ...demoFollowRequests.map((r) => r.user),
        ].find((u) => u.id === targetProfileId);
        if (matchedConn) {
          setDemoOtherProfiles((prev) => ({
            ...prev,
            [matchedConn.id]: buildProfileFromFollowUser(matchedConn),
          }));
        }
      }

      setActiveProfileId(targetProfileId);
      setActiveTab('overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [
      resolveNotificationActorProfileId,
      isAuthenticated,
      demoOtherProfiles,
      demoFollowers,
      demoFollowing,
      demoFollowRequests,
    ]
  );

  // Notification navigation to real destination (profile, liked/commented post, or activity)
  const handleSelectNotification = useCallback(
    (notif: NotificationItem) => {
      // 1. Follower & follow-request notifications open the related person's profile
      if (
        notif.type === 'new_follower' ||
        notif.type === 'follow_request' ||
        notif.type === 'request_accepted'
      ) {
        const targetProfileId = resolveNotificationActorProfileId(notif);
        if (targetProfileId) {
          handleSelectNotificationActor(notif);
          return;
        }
        if (notif.contextData?.modal === 'followers') {
          setFollowersInitialTab(notif.contextData.modalTab || 'followers');
          setIsFollowersOpen(true);
        }
        return;
      }

      // 2. Activity likes/interactions open the activity timeline and highlight the target activity
      if (
        !notif.contextData?.commentId &&
        (notif.contextData?.tab === 'activity' || Boolean(notif.contextData?.activityId))
      ) {
        setActiveProfileId(currentUser.id);
        setActiveTab('activity');
        const targetActivityId = notif.contextData?.activityId;
        if (targetActivityId && activities.some((a) => a.id === targetActivityId)) {
          if (highlightActivityTimerRef.current !== null) {
            window.clearTimeout(highlightActivityTimerRef.current);
          }
          setHighlightedActivityId(targetActivityId);
          window.setTimeout(() => {
            const el = document.getElementById(`hikari-activity-${targetActivityId}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 150);
          highlightActivityTimerRef.current = window.setTimeout(() => {
            setHighlightedActivityId(undefined);
            highlightActivityTimerRef.current = null;
          }, 4000);
        }
        return;
      }

      // 3. Comment likes & comment replies open the comment section and highlight the target comment
      if (
        notif.type === 'comment_like' ||
        notif.type === 'comment_reply' ||
        notif.contextData?.tab === 'comments' ||
        Boolean(notif.contextData?.commentId)
      ) {
        setActiveProfileId(currentUser.id);
        setActiveTab('comments');
        const targetCommentId = notif.contextData?.commentId;
        if (targetCommentId && comments.some((c) => c.id === targetCommentId)) {
          if (highlightCommentTimerRef.current !== null) {
            window.clearTimeout(highlightCommentTimerRef.current);
          }
          setHighlightedCommentId(targetCommentId);
          window.setTimeout(() => {
            const el = document.getElementById(`hikari-comment-${targetCommentId}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 150);
          highlightCommentTimerRef.current = window.setTimeout(() => {
            setHighlightedCommentId(undefined);
            highlightCommentTimerRef.current = null;
          }, 4000);
        }
        return;
      }

      // 4. Other explicit real tab destinations (e.g., anime list or favorites)
      if (notif.contextData?.tab) {
        setActiveProfileId(currentUser.id);
        setActiveTab(notif.contextData.tab);
        return;
      }

      // 5. Fallback to actor profile or followers modal only if supported by real contextData
      if (notif.contextData?.userId || notif.actor.id) {
        handleSelectNotificationActor(notif);
      } else if (notif.contextData?.modal === 'followers') {
        setFollowersInitialTab(notif.contextData.modalTab || 'followers');
        setIsFollowersOpen(true);
      }
    },
    [
      resolveNotificationActorProfileId,
      handleSelectNotificationActor,
      currentUser.id,
      comments,
      activities,
    ]
  );

  const searchableProfiles = useMemo(
    () => (isAuthenticated ? Object.values(authOtherProfilesMap) : undefined),
    [isAuthenticated, authOtherProfilesMap]
  );

  const blockedIdsList = useMemo(() => Array.from(blockedIds), [blockedIds]);

  const chatFollowersIdsSet = useMemo(
    () => new Set((activeFollowersSource ?? []).map((f) => f.id)),
    [activeFollowersSource]
  );

  const handleOpenFollowersModal = useCallback(
    (tab: 'followers' | 'following' | 'requests' = 'followers') => {
      setFollowersInitialTab(tab);
      setIsFollowersOpen(true);
    },
    []
  );

  const handleOpenMessagesFromHeader = useCallback(() => {
    handleOpenChat();
  }, [handleOpenChat]);

  const handleOpenAuthFromHeader = useCallback((mode: 'login' | 'signup' = 'login') => {
    setAuthInitialMode(mode);
    setIsDemoPreview(false);
  }, []);

  const handleClearSelectedAnime = useCallback(() => {
    setSelectedAnimeDetailId(null);
  }, []);

  // Rota privada de administração (/admin) com validação mandatória de servidor vinculada ao UID autenticado
  if (currentView === 'admin') {
    const isWaitingForAdminCheck =
      isLoading ||
      adminVerification.status === 'verifying' ||
      (isAuthenticated &&
        user !== null &&
        (adminVerification.uid !== user.uid || adminVerification.status !== 'resolved'));

    if (isWaitingForAdminCheck) {
      return (
        <div className="min-h-screen bg-[#0A0713] flex flex-col items-center justify-center p-4">
          <Loader2 className="h-8 w-8 text-purple-500 animate-spin mb-3" />
          <div className="text-sm font-medium text-purple-200">
            Verificando autorização com o servidor...
          </div>
        </div>
      );
    }

    const canRenderAdminPanel =
      isAuthenticated &&
      user !== null &&
      user.uid === AUTHORIZED_ADMIN_UID &&
      adminVerification.uid === user.uid &&
      adminVerification.status === 'resolved' &&
      adminVerification.authorized === true &&
      Boolean(adminVerification.token);

    if (canRenderAdminPanel && adminVerification.token) {
      return (
        <Suspense fallback={<FullPageRouteFallback label="Carregando painel administrativo..." />}>
          <LazyAdminPanel
            onReturnToApp={handleReturnFromAdmin}
            idToken={adminVerification.token}
          />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<FullPageRouteFallback label="Verificando acesso..." />}>
        <LazyAdminAccessDenied
          onReturnToApp={handleReturnFromAdmin}
          onOpenAuth={() => {
            pendingAdminReturnRef.current = true;
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
              window.history.pushState(null, '', '/');
            }
            setCurrentView('app');
            setIsDemoPreview(false);
            setAuthInitialMode('login');
          }}
          isAuthenticated={isAuthenticated}
        />
      </Suspense>
    );
  }

  // Synchronous render gate: never render a profile shell while auth is loading OR while authSession.uid hasn't matched user.uid
  if (isLoading || (isAuthenticated && (!user || !isAuthWorkspaceReady || !authenticatedProfile))) {
    return (
      <div
        data-testid="auth-loading-state"
        className="min-h-screen bg-[#0A0713] text-[#EDE8F5] flex flex-col items-center justify-center gap-4 px-4"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-700 via-purple-600 to-indigo-500 shadow-lg shadow-purple-950/60 ring-1 ring-purple-400/30">
          <span className="text-xl font-black tracking-tighter text-white">H</span>
        </div>
        <div className="flex items-center gap-2.5 text-sm font-medium text-purple-200">
          <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
          <span>Verificando sessão...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !isDemoPreview) {
    return (
      <Suspense fallback={<FullPageRouteFallback label="Carregando autenticação..." />}>
        <LazyAuthScreen
          key={authInitialMode}
          initialMode={authInitialMode}
          onEnterDemoMode={() => {
            setActiveProfileId(CURRENT_USER.id);
            setActiveTab('overview');
            setIsDemoPreview(true);
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0713] text-[#EDE8F5]">
      {/* Header with Search, Notifications and 7-Item Dropdown Menu */}
      <Header
        currentUser={currentUser}
        activeProfile={activeProfile}
        animes={exposedAnimes}
        searchableProfiles={searchableProfiles}
        notifications={notifications}
        isNotifOpen={isNotifOpen}
        onToggleNotif={setIsNotifOpen}
        onOpenSettings={handleOpenSettings}
        onOpenFollowers={handleOpenFollowersModal}
        onSelectProfile={handleSelectProfile}
        onSelectAnime={handleSelectAnimeFromSearch}
        onMarkNotificationAsRead={handleMarkNotificationAsRead}
        onMarkNotificationsAsRead={handleMarkNotificationsAsRead}
        onMarkAllNotificationsAsRead={handleMarkAllNotificationsAsRead}
        onSelectNotification={handleSelectNotification}
        onSelectNotificationActor={handleSelectNotificationActor}
        onNavigateTab={handleTabChange}
        onAcceptRequest={handleAcceptRequest}
        onRejectRequest={handleRejectRequest}
        followingIds={followingIds}
        requestedIds={requestedIds}
        blockedIds={blockedIds}
        pendingFollowTargetIds={pendingFollowTargetIds}
        onFollowBackNotification={handleFollowBackFromNotification}
        isAuthenticated={isAuthenticated}
        authenticatedEmail={isAuthenticated ? user?.email ?? null : null}
        onLogout={isAuthenticated ? handleLogout : undefined}
        onOpenMessages={ENABLE_PRIVATE_MESSAGES ? handleOpenMessagesFromHeader : undefined}
        unreadMessagesCount={ENABLE_PRIVATE_MESSAGES ? unreadMessagesCount : 0}
        onOpenAdminPanel={handleNavigateToAdmin}
        onOpenAuth={!isAuthenticated ? handleOpenAuthFromHeader : undefined}
        onOpenProfileSearch={() => setIsProfileSearchOpen(true)}
      />

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {isPrivateLocked ? (
          <PrivateProfileNotice />
        ) : (
          <>
        {/* Profile Hero Header */}
        <ProfileHeader
          profile={activeProfile}
          isOwnProfile={isOwnProfile}
          isFollowing={isFollowingActive}
          isFollower={isFollowerActive}
          isRequested={isRequestedActive}
          isBlocked={isBlockedActive}
          isFollowPending={isFollowPending}
          canReportProfile={isAuthenticated && !isOwnProfile}
          onSubmitProfileReport={(reason, details) =>
            submitRemoteProfileReport(activeProfile.id, reason, details, {
              targetUsername: activeProfile.username,
              targetDisplayName: activeProfile.displayName,
              reporterUsername: currentUser.username,
              reporterDisplayName: currentUser.displayName,
            })
          }
          canDirectMessage={activeProfileDirectMessageCheck.allowed}
          directMessageDisabledReason={activeProfileDirectMessageCheck.reason}
          onFollowToggle={handleFollowToggle}
          onBlockToggle={handleBlockToggle}
          onOpenDirectMessage={() => handleOpenChat(activeProfile.id)}
          onOpenSettings={(tab = 'profile') => handleOpenSettings(tab)}
          onOpenFollowers={(tab) => {
            setFollowersInitialTab(tab);
            setIsFollowersOpen(true);
          }}
          onUpdateAvatar={handleUpdateAvatar}
          onUpdateBanner={handleUpdateBanner}
          onRemoveAvatar={handleRemoveAvatar}
          onRemoveBanner={handleRemoveBanner}
        />

        {/* Navigation Tabs Bar */}
        <TabsNavigation
          activeTab={activeTab}
          onTabChange={handleTabChange}
          animeCount={activeProfileAnimeStats.totalEntries}
          commentsCount={displayedComments.length}
          favoritesCount={exposedFavoritesCount}
          isPrivateLocked={isPrivateLocked}
        />

        {/* Tab Content Display */}
        <div className="pt-2">
          <>
              {(activeTab === 'overview' || activeTab === 'favorites') && (
                <OverviewTab
                  profile={activeProfile}
                  animes={exposedAnimes}
                  animeStats={activeProfileAnimeStats}
                  canAccessAnimeLists={canAccessActiveProfileAnimeList}
                  favoriteCharacters={displayedFavoriteCharacters}
                  favoriteCompanies={displayedFavoriteCompanies}
                  favoritePeople={displayedFavoritePeople}
                  comments={displayedComments}
                  activities={displayedActivities}
                  isOwnProfile={isOwnProfile}
                  onNavigateTab={handleTabChange}
                  onSelectAnimeStatus={handleSelectAnimeStatus}
                  onToggleFavorite={handleToggleFavorite}
                />
              )}

              {activeTab === 'animes' && (
                !canAccessActiveProfileAnimeList ? (
                  <div
                    data-testid="private-anime-list-notice"
                    className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-8 text-center space-y-2"
                  >
                    <p className="text-sm font-semibold text-white">Lista de Animes Privada</p>
                    <p className="text-xs text-purple-300/60 max-w-sm mx-auto">
                      O usuário configurou suas listas de animes como privadas. As estatísticas numéricas continuam visíveis na visão geral, mas os animes das listas não podem ser abertos por visitantes.
                    </p>
                  </div>
                ) : (
                  <Suspense fallback={<TabSectionFallback label="Carregando lista de animes..." />}>
                    <LazyAnimeListTab
                      profileId={activeProfile.id}
                      animes={exposedAnimes}
                      statusCounts={activeProfileStatusCounts}
                      isOwnProfile={isOwnProfile}
                      selectedStatusFilter={selectedAnimeStatusFilter}
                      filterSyncKey={animeFilterSyncKey}
                      selectedAnimeId={selectedAnimeDetailId}
                      onClearSelectedAnime={handleClearSelectedAnime}
                      isListPrivateForVisitors={activeProfile.privacySettings?.showAnimeList === false}
                      onUpdateEpisode={handleUpdateEpisode}
                      onToggleFavorite={handleToggleFavorite}
                      onUpdateStatus={handleUpdateStatus}
                      onSaveAnimeEdit={handleSaveAnimeEdit}
                    />
                  </Suspense>
                )
              )}

              {activeTab === 'comments' && (
                !isOwnProfile && (!activeProfile.privacySettings?.showCommentsOnProfile || !activeProfile.showCommentsOnProfile) ? (
                  <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-8 text-center space-y-2">
                    <p className="text-sm font-semibold text-white">Comentários Ocultos</p>
                    <p className="text-xs text-purple-300/60 max-w-sm mx-auto">
                      O usuário optou por não exibir seu histórico de comentários do site principal em seu perfil social.
                    </p>
                  </div>
                ) : (
                  <Suspense fallback={<TabSectionFallback label="Carregando comentários..." />}>
                    <LazyCommentsTab
                      profileId={activeProfile.id}
                      comments={displayedComments}
                      showCommentsOnProfile={activeProfile.showCommentsOnProfile}
                      isOwnProfile={isOwnProfile}
                      userName={activeProfile.displayName}
                      highlightedCommentId={highlightedCommentId}
                    />
                  </Suspense>
                )
              )}

              {activeTab === 'about' && (
                <Suspense fallback={<TabSectionFallback label="Carregando informações..." />}>
                  <LazyAboutTab profile={activeProfile} />
                </Suspense>
              )}

              {activeTab === 'activity' && (
                !isOwnProfile && activeProfile.privacySettings?.showActivity === false ? (
                  <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-8 text-center space-y-2">
                    <p className="text-sm font-semibold text-white">Atividades Ocultas</p>
                    <p className="text-xs text-purple-300/60 max-w-sm mx-auto">
                      O usuário optou por manter suas atualizações e feed de atividades recentes privados.
                    </p>
                  </div>
                ) : (
                  <Suspense fallback={<TabSectionFallback label="Carregando atividades..." />}>
                    <LazyActivityTab
                      profileId={activeProfile.id}
                      activities={displayedActivities}
                      userAnimes={exposedAnimes}
                      highlightedActivityId={highlightedActivityId}
                    />
                  </Suspense>
                )
              )}
          </>
        </div>
          </>
        )}
      </main>

      {/* Social Followers & Following Modal — downloaded & mounted strictly when opened */}
      {isFollowersOpen && (
        <Suspense fallback={<ModalLoadingFallback label="Carregando seguidores..." />}>
          <LazyFollowersModal
            isOpen={isFollowersOpen}
            initialTab={followersInitialTab}
            followers={displayedModalFollowers}
            following={displayedModalFollowing}
            requests={isOwnProfile ? followRequests : []}
            isOwnProfile={isOwnProfile}
            onClose={() => setIsFollowersOpen(false)}
            onUnfollow={handleUnfollowFromModal}
            onRemoveFollower={handleRemoveFollower}
            onAcceptRequest={handleAcceptRequest}
            onRejectRequest={handleRejectRequest}
            onSelectProfile={handleSelectProfile}
            onBlockUser={(userId) => {
              if (isAuthenticated) {
                void removeRemoteFollower(userId);
                void unfollowRemoteUser(userId);
                updateAuthWorkspace((prev) => {
                  const nextBlocked = prev.blockedIds.includes(userId)
                    ? prev.blockedIds
                    : [...prev.blockedIds, userId];
                  const wasFollower = prev.followers.some((u) => u.id === userId);
                  const wasFollowing = prev.followingIds.includes(userId);
                  return {
                    ...prev,
                    blockedIds: nextBlocked,
                    followers: prev.followers.filter((u) => u.id !== userId),
                    following: prev.following.filter((u) => u.id !== userId),
                    followingIds: prev.followingIds.filter((id) => id !== userId),
                    requestedIds: prev.requestedIds.filter((id) => id !== userId),
                    profileOverrides: {
                      ...prev.profileOverrides,
                      followersCount: Math.max(
                        0,
                        (prev.profileOverrides.followersCount ?? prev.followers.length) - (wasFollower ? 1 : 0)
                      ),
                      followingCount: Math.max(
                        0,
                        (prev.profileOverrides.followingCount ?? prev.followingIds.length) - (wasFollowing ? 1 : 0)
                      ),
                    },
                  };
                });
                return;
              }
              setDemoBlockedIds((prev) => new Set(prev).add(userId));
              handleRemoveFollower(userId);
            }}
          />
        </Suspense>
      )}

      {/* Settings & Privacy Modal — downloaded only on first open; state preserved across close/reopen without destructive key */}
      {hasOpenedSettings && (
        <Suspense
          fallback={isSettingsOpen ? <ModalLoadingFallback label="Carregando configurações..." /> : null}
        >
          <LazySettingsModal
            isOpen={isSettingsOpen}
            initialTab={settingsInitialTab}
            openSyncKey={settingsOpenSyncKey}
            profile={currentUser}
            currentAnimes={animes}
            blockedIds={blockedIdsList}
            otherProfiles={authOtherProfilesMap}
            onUnblockUser={handleBlockToggle}
            onSyncAniList={handleSyncAniList}
            onDisconnectAniList={handleDisconnectAniList}
            onClose={handleCloseSettings}
            onSaveProfile={handleSaveProfile}
            onUpdateAvatar={handleUpdateAvatar}
            onUpdateBanner={handleUpdateBanner}
            onRemoveAvatar={handleRemoveAvatar}
            onRemoveBanner={handleRemoveBanner}
          />
        </Suspense>
      )}

      {/* Private Direct Messages Chat Drawer / Modal — downloaded & mounted strictly when opened */}
      {ENABLE_PRIVATE_MESSAGES && isChatOpen && (
        <Suspense fallback={<ModalLoadingFallback label="Carregando mensagens..." />}>
          <LazyPrivateChatModal
            isOpen={isChatOpen}
            currentUser={currentUser}
            otherProfiles={authOtherProfilesMap}
            initialRecipientId={chatRecipientId}
            userAnimes={animes}
            followingIds={followingIds}
            followersIds={chatFollowersIdsSet}
            blockedIds={blockedIds}
            onClose={() => {
              setIsChatOpen(false);
              setChatRecipientId(null);
            }}
            onNavigateToProfile={(userId) => {
              setIsChatOpen(false);
              handleSelectProfile(userId);
            }}
            onSelectAnime={handleSelectAnimeFromSearch}
            onToggleFollow={handleFollowToggle}
            onToggleBlock={handleBlockToggle}
          />
        </Suspense>
      )}

      {/* Exclusive Profile Search Modal */}
      <ProfileSearchModal
        isOpen={isProfileSearchOpen}
        onClose={() => setIsProfileSearchOpen(false)}
        onSelectProfile={(userId) => {
          setIsProfileSearchOpen(false);
          handleSelectProfile(userId);
        }}
        currentUser={currentUser}
        otherProfiles={isAuthenticated ? authOtherProfilesMap : demoOtherProfiles}
        searchableProfiles={searchableProfiles}
      />
    </div>
  );
}
