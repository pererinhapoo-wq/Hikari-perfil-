import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
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
  type UserCheckContext,
} from './services/chatService';

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
  mergeFavoriteCharacters,
  isGenericOrMissingPoster,
  normalizeTitle,
} from './utils/animeSyncHelpers';
import { useAuth } from './contexts/AuthContext';
import {
  PUBLIC_PROFILES_STORAGE_KEY,
  adjustCachedPublicProfileFollowersCount,
  buildProfileFromFirebaseUser,
  createEmptyUserWorkspace,
  getUserWorkspaceStorageKey,
  loadPublicProfileFromFirestore,
  loadUserWorkspaceFromFirestore,
  readLocalUserWorkspace,
  readPublicProfilesMap,
  saveUserWorkspaceToFirestore,
  syncPublicProfileProjection,
  writeLocalUserWorkspace,
  hydrateWorkspaceFromIndexedDb,
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

        return {
          profileOverrides:
            parsed.profileOverrides && typeof parsed.profileOverrides === 'object'
              ? parsed.profileOverrides
              : undefined,
          animes: migrateAnimeListProvenance(sanitizedAnimes).list,
          favoriteCharacters: sanitizedCharacters,
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

  // UID-isolated personal state for real Firebase accounts (keyed strictly by user.uid)
  const [authSession, setAuthSession] = useState<AuthSessionState | null>(null);
  const [publicProfilesRevision, setPublicProfilesRevision] = useState(0);
  const [remoteVisitedProfiles, setRemoteVisitedProfiles] = useState<Record<string, UserProfile>>({});

  const [activeProfileId, setActiveProfileId] = useState<string>(CURRENT_USER.id);

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

  // Sincronização da rota /admin com popstate do navegador
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
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

    if (!user?.uid) {
      setAuthSession(null);
      setRemoteVisitedProfiles({});
      setHasOpenedSettings(false);
      setActiveProfileId(CURRENT_USER.id);
      setSelectedAnimeStatusFilter(undefined);
      setSelectedAnimeDetailId(null);
      setActiveTab('overview');
      return () => {
        cancelled = true;
      };
    }

    const targetUid = user.uid;
    const localWorkspace =
      readLocalUserWorkspace(targetUid) ?? createEmptyUserWorkspace(targetUid);

    setIsDemoPreview(false);
    setIsSettingsOpen(false);
    setHasOpenedSettings(false);
    setIsFollowersOpen(false);
    setIsNotifOpen(false);
    setSelectedAnimeStatusFilter(undefined);
    setSelectedAnimeDetailId(null);
    setActiveProfileId(targetUid);
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

    void hydrateWorkspaceFromIndexedDb(targetUid).then((indexedWorkspace) => {
      if (cancelled || !indexedWorkspace) return;
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
    });

    void loadUserWorkspaceFromFirestore(targetUid, { loadAllAnimes: false }).then((remote) => {
      if (cancelled) return;
      setAuthSession((prev) => {
        if (!prev || prev.uid !== targetUid) return prev;
        if (
          remote.workspace &&
          remote.workspace.uid === targetUid &&
          remote.workspace.updatedAtMs >= prev.workspace.updatedAtMs
        ) {
          const persisted = writeLocalUserWorkspace(targetUid, remote.workspace);
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
    });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // On-demand chunk loading strictly when navigating to the 'animes' tab
  const hasLoadedFullAnimesRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'animes' && isAuthenticated && user?.uid && !hasLoadedFullAnimesRef.current) {
      hasLoadedFullAnimesRef.current = true;
      void loadUserWorkspaceFromFirestore(user.uid, { loadAllAnimes: true }).then((remote) => {
        if (remote.workspace && remote.workspace.animes.length > 0) {
          setAuthSession((prev) => {
            if (!prev || prev.uid !== user.uid) return prev;
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
    (updater: (prev: UserPersonalWorkspace) => UserPersonalWorkspace) => {
      if (!isAuthenticated || !user) return;
      const targetUid = user.uid;
      setAuthSession((prev) => {
        const baseWorkspace =
          prev && prev.uid === targetUid
            ? prev.workspace
            : readLocalUserWorkspace(targetUid) ?? createEmptyUserWorkspace(targetUid);
        const updated = updater(baseWorkspace);
        const stamped = writeLocalUserWorkspace(targetUid, {
          ...updated,
          uid: targetUid,
          updatedAtMs: Date.now(),
        });
        const resolvedProfile = buildProfileFromFirebaseUser(user, stamped.profileOverrides);
        syncPublicProfileProjection(resolvedProfile, stamped.animes, stamped.updatedAtMs);
        setPublicProfilesRevision((r) => r + 1);
        void saveUserWorkspaceToFirestore(targetUid, resolvedProfile, stamped).then(
          (syncStatus) => {
            setAuthSession((curr) =>
              curr && curr.uid === targetUid ? { ...curr, firestoreStatus: syncStatus } : curr
            );
          }
        );
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

  // Keep sanitized public projection synced whenever authenticated profile or anime list hydrates/changes
  useEffect(() => {
    if (!isAuthenticated || !authenticatedProfile || !activeAuthWorkspace) return;
    syncPublicProfileProjection(
      authenticatedProfile,
      activeAuthWorkspace.animes,
      activeAuthWorkspace.updatedAtMs || Date.now()
    );
  }, [isAuthenticated, authenticatedProfile, activeAuthWorkspace]);

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

    const ownConnections: FollowUser[] = [
      ...activeAuthWorkspace.followers,
      ...activeAuthWorkspace.following,
      ...activeAuthWorkspace.followRequests.map((req) => req.user),
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
    currentUser.id,
  ]);

  // Hydrate visited profile document from Firestore when not already cached locally
  useEffect(() => {
    if (!isAuthenticated || !user?.uid) return;
    if (!activeProfileId || activeProfileId === user.uid) return;
    if (authPublicProfilesMap[activeProfileId] || remoteVisitedProfiles[activeProfileId]) return;

    let cancelled = false;
    void loadPublicProfileFromFirestore(activeProfileId).then((loaded) => {
      if (cancelled || !loaded) return;
      setRemoteVisitedProfiles((prev) => ({
        ...prev,
        [loaded.id]: loaded,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.uid, activeProfileId, authPublicProfilesMap, remoteVisitedProfiles]);

  // Strictly separate authenticated user profile from Demo Mode profiles
  const isOwnProfile = isAuthenticated
    ? activeProfileId === currentUser.id || !authOtherProfilesMap[activeProfileId]
    : activeProfileId === CURRENT_USER.id;

  const activeProfile: UserProfile = isAuthenticated
    ? isOwnProfile
      ? currentUser
      : authOtherProfilesMap[activeProfileId] || currentUser
    : isOwnProfile
    ? demoProfile
    : demoOtherProfiles[activeProfileId] || OTHER_USERS[activeProfileId] || demoProfile;

  const isFollowingActive = followingIds.has(activeProfile.id);
  const isRequestedActive = requestedIds.has(activeProfile.id);
  const isBlockedActive = blockedIds.has(activeProfile.id);

  // Check if active profile is private and locked for viewer
  const isPrivateLocked = !isOwnProfile && activeProfile.isPrivate && !isFollowingActive;

  // Real data-level privacy gate for anime lists:
  // Owner always accesses own lists; visitors only access when profile is unlocked AND showAnimeList !== false
  const canAccessActiveProfileAnimeList =
    isOwnProfile || (!isPrivateLocked && activeProfile.privacySettings?.showAnimeList !== false);

  // Aggregated numeric stats remain visible even when anime lists are private
  const activeProfileAnimeStats = useMemo(() => {
    if (isOwnProfile) {
      return computeAnimeStats(animes);
    }
    if (activeProfile.id === AUTHORIZED_ADMIN_UID) {
      return computeAnimeStats(AETHER_ANIMES);
    }
    if (isAuthenticated) {
      return authPublicProfilesMap[activeProfile.id]?.animeStats ?? EMPTY_ANIME_STATS;
    }
    return computeAnimeStats(demoAnimes);
  }, [isOwnProfile, isAuthenticated, animes, authPublicProfilesMap, activeProfile.id, demoAnimes]);

  const activeProfileStatusCounts = useMemo<Record<AnimeStatus, number>>(() => ({
    all: activeProfileAnimeStats.totalEntries,
    watching: activeProfileAnimeStats.watchingCount,
    completed: activeProfileAnimeStats.completedCount,
    planned: activeProfileAnimeStats.plannedCount,
    on_hold: activeProfileAnimeStats.onHoldCount,
    dropped: activeProfileAnimeStats.droppedCount,
  }), [activeProfileAnimeStats]);

  // Raw anime entries are strictly withheld when !canAccessActiveProfileAnimeList
  const exposedAnimes = useMemo<AnimeItem[]>(() => {
    if (!canAccessActiveProfileAnimeList) {
      return [];
    }
    if (isOwnProfile) {
      return animes;
    }
    if (activeProfile.id === AUTHORIZED_ADMIN_UID) {
      return AETHER_ANIMES;
    }
    if (isAuthenticated) {
      return authPublicProfilesMap[activeProfile.id]?.publicAnimes ?? [];
    }
    return demoAnimes;
  }, [
    canAccessActiveProfileAnimeList,
    isOwnProfile,
    isAuthenticated,
    animes,
    authPublicProfilesMap,
    activeProfile.id,
    demoAnimes,
  ]);

  // Memoize favorites count to avoid O(N) array filtering directly inside the JSX render loop
  const exposedFavoritesCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < exposedAnimes.length; i++) {
      if (exposedAnimes[i].isFavorite) count++;
    }
    return count;
  }, [exposedAnimes]);

  const displayedFavoriteCharacters = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoriteCharacters ?? []
      : []
    : isOwnProfile
    ? demoFavoriteCharacters
    : [];
  const displayedFavoriteCompanies = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoriteCompanies ?? []
      : []
    : FAVORITE_COMPANIES;
  const displayedFavoritePeople = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoritePeople ?? []
      : []
    : FAVORITE_PEOPLE;
  const displayedComments = isAuthenticated && !isOwnProfile ? [] : comments;
  const displayedActivities = isAuthenticated && !isOwnProfile ? [] : activities;

  // Handler: Select Profile (switch view)
  const handleSelectProfile = useCallback(
    (userId: string) => {
      setSelectedAnimeStatusFilter(undefined);
      setSelectedAnimeDetailId(null);
      if (isAuthenticated && user) {
        if (userId === user.uid) {
          setActiveProfileId(user.uid);
        } else {
          setActiveProfileId(userId);
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
        }
      }

      setActiveProfileId(userId);
      setActiveTab('overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [isAuthenticated, user, demoOtherProfiles]
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
    if (!currentUser.id) return;
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

  // Subscribe passively to unread messages count without background polling while PrivateChatModal is closed
  useEffect(() => {
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

        updateAuthWorkspace((prev) => {
          const followingSet = new Set(prev.followingIds);
          const requestedSet = new Set(prev.requestedIds);
          let nextFollowing = prev.following;
          let nextFollowers = prev.followers;

          if (isFollowingTarget) {
            followingSet.delete(targetId);
            nextFollowing = prev.following.filter((u) => u.id !== targetId);
            nextFollowers = prev.followers.map((u) =>
              u.id === targetId ? { ...u, isFollowing: false } : u
            );
          } else if (isRequestedTarget) {
            requestedSet.delete(targetId);
          } else if (activeProfile.isPrivate) {
            requestedSet.add(targetId);
          } else {
            followingSet.add(targetId);
            const alreadyListed = prev.following.some((u) => u.id === targetId);
            if (!alreadyListed) {
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
        });

        if (delta !== 0) {
          setRemoteVisitedProfiles((prev) => {
            const currentTarget = prev[targetId] ?? authOtherProfilesMap[targetId] ?? activeProfile;
            return {
              ...prev,
              [targetId]: {
                ...currentTarget,
                followersCount: Math.max(0, currentTarget.followersCount + delta),
              },
            };
          });

          adjustCachedPublicProfileFollowersCount(targetId, delta);
          setPublicProfilesRevision((r) => r + 1);
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
      updateAuthWorkspace((prev) => ({
        ...prev,
        followers: prev.followers.filter((u) => u.id !== userId),
        profileOverrides: {
          ...prev.profileOverrides,
          followersCount: Math.max(0, (prev.profileOverrides.followersCount ?? 0) - 1),
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

  // Handler: Unfollow from modal
  const handleUnfollowFromModal = (userId: string) => {
    if (isAuthenticated) {
      updateAuthWorkspace((prev) => ({
        ...prev,
        following: prev.following.filter((u) => u.id !== userId),
        followingIds: prev.followingIds.filter((id) => id !== userId),
        profileOverrides: {
          ...prev.profileOverrides,
          followingCount: Math.max(0, (prev.profileOverrides.followingCount ?? prev.following.length) - 1),
        },
      }));

      setRemoteVisitedProfiles((prev) => {
        if (!prev[userId]) return prev;
        return {
          ...prev,
          [userId]: {
            ...prev[userId],
            followersCount: Math.max(0, prev[userId].followersCount - 1),
          },
        };
      });

      adjustCachedPublicProfileFollowersCount(userId, -1);
      setPublicProfilesRevision((r) => r + 1);
      return;
    }

    setDemoFollowing((prev) => prev.filter((u) => u.id !== userId));
    setDemoFollowingIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    setDemoProfile((prev) => ({
      ...prev,
      followingCount: Math.max(0, prev.followingCount - 1),
    }));
    setDemoOtherProfiles((prev) => {
      if (!prev[userId]) return prev;
      return {
        ...prev,
        [userId]: {
          ...prev[userId],
          followersCount: Math.max(0, prev[userId].followersCount - 1),
        },
      };
    });
  };

  // Ref to latest list state so anime mutation handlers remain referentially stable across renders
  const latestAnimeMutationStateRef = useRef({
    animes,
    comments,
    demoComments,
  });
  latestAnimeMutationStateRef.current = {
    animes,
    comments,
    demoComments,
  };

  const persistAndApply = useCallback(
    (
      nextAnimes: AnimeItem[],
      newActivity: UserActivity | null,
      nextComments?: HikariComment[]
    ) => {
      const { comments: currComments, demoComments: currDemoComments } =
        latestAnimeMutationStateRef.current;

      if (isAuthenticated) {
        updateAuthWorkspace((prev) => ({
          ...prev,
          animes: nextAnimes,
          comments:
            nextComments !== undefined && nextComments !== currComments
              ? nextComments
              : prev.comments,
          activities: newActivity ? [newActivity, ...prev.activities] : prev.activities,
        }));
        return;
      }

      setDemoAnimes(nextAnimes);
      if (nextComments !== undefined && nextComments !== currDemoComments) {
        setDemoComments(nextComments);
      }
      if (newActivity) {
        setDemoActivities((prev) => [newActivity, ...prev]);
      }
    },
    [isAuthenticated, updateAuthWorkspace]
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

  // Image updates
  const handleUpdateAvatar = (url: string) => {
    applyProfilePatch({ avatarUrl: url });
  };

  const handleUpdateBanner = (url: string) => {
    applyProfilePatch({ bannerUrl: url });
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

          return {
            ...prev,
            animes: mergedAnimes,
            favoriteCharacters: nextFavoriteCharacters,
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

      invalidateAllAnimeCategories(currentUser.id);
      invalidateActivitiesCache(currentUser.id);
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(mergedAnimes);
      setDemoFavoriteCharacters(nextDemoCharacters);
      setDemoActivities((prev) => [syncActivity, ...prev]);
    },
    [isAuthenticated, currentUser.id, demoProfile, demoFavoriteCharacters, updateAuthWorkspace]
  );

  // Handler: Sync imported anime list from MyAnimeList
  // Observação: Conforme verificação da API oficial v2 do MyAnimeList, a plataforma externa
  // não expõe favoritos de animes ou personagens. Todos os favoritos manuais existentes
  // no perfil são rigorosamente preservados sem qualquer alteração.
  const handleSyncMAL = useCallback(
    (
      mergedAnimes: AnimeItem[],
      malPatch: UserProfile['externalAccounts']['mal']
    ) => {
      const actionNow = Date.now();
      const syncActivity: UserActivity = {
        id: `act_${actionNow}_mal_sync`,
        type: 'added_anime',
        title: `Sincronizou a lista com o MyAnimeList (@${malPatch.username || ''})`,
        description: `Lista atualizada com ${mergedAnimes.length} animes no perfil`,
        timestamp: 'Agora',
        createdAtTimestamp: actionNow,
      };

      if (isAuthenticated) {
        updateAuthWorkspace((prev) => {
          const prevAccounts = prev.profileOverrides.externalAccounts ?? {
            anilist: { connected: false },
            mal: { connected: false },
          };
          const nextExternalAccounts: UserProfile['externalAccounts'] = {
            ...prevAccounts,
            mal: malPatch,
          };
          const nextProfileOverrides = {
            ...prev.profileOverrides,
            externalAccounts: nextExternalAccounts,
          };
          return {
            ...prev,
            animes: mergedAnimes,
            // Preserva 100% dos personagens favoritos já cadastrados no perfil do usuário
            favoriteCharacters: prev.favoriteCharacters,
            profileOverrides: nextProfileOverrides,
            activities: [syncActivity, ...prev.activities],
          };
        });
        invalidateAllAnimeCategories(currentUser.id);
        invalidateActivitiesCache(currentUser.id);
        return;
      }

      // Modo demonstração (persistido via debounce unificado)
      const prevDemoAccounts = demoProfile.externalAccounts ?? {
        anilist: { connected: false },
        mal: { connected: false },
      };
      const nextDemoProfile: UserProfile = {
        ...demoProfile,
        externalAccounts: {
          ...prevDemoAccounts,
          mal: malPatch,
        },
      };
      invalidateAllAnimeCategories(currentUser.id);
      invalidateActivitiesCache(currentUser.id);
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(mergedAnimes);
      setDemoActivities((prev) => [syncActivity, ...prev]);
    },
    [isAuthenticated, currentUser.id, demoProfile, updateAuthWorkspace]
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
      void saveAnimesToIndexedDb(CURRENT_USER.id, prunedAnimes);
      setDemoActivities((prev) => [disconnectActivity, ...prev]);
    },
    [isAuthenticated, user?.uid, demoProfile, currentUser.id, updateAuthWorkspace]
  );

  // Handler: Desconectar MyAnimeList e remover animes importados exclusivamente da conta
  const handleDisconnectMAL = useCallback(
    (prunedAnimes: AnimeItem[], audit: DisconnectPruneResult) => {
      const actionNow = Date.now();
      const disconnectActivity: UserActivity = {
        id: `act_${actionNow}_mal_disconnect`,
        type: 'status_changed',
        title: 'Desconectou a conta do MyAnimeList',
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
            mal: { connected: false },
          };
          return {
            ...prev,
            animes: prunedAnimes,
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
          mal: { connected: false },
        },
      };
      invalidateAllAnimeCategories(currentUser.id);
      invalidateActivitiesCache(currentUser.id);
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(prunedAnimes);
      void saveAnimesToIndexedDb(CURRENT_USER.id, prunedAnimes);
      setDemoActivities((prev) => [disconnectActivity, ...prev]);
    },
    [isAuthenticated, user?.uid, demoProfile, currentUser.id, updateAuthWorkspace]
  );

  // Real Logout handler: wipes personal memory immediately, terminates Firebase Auth session and returns to login screen
  const handleLogout = useCallback(async () => {
    pendingAdminReturnRef.current = false;
    hasLoadedFullAnimesRef.current = false;
    clearAllMemoryCache();
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
    setIsProfileSearchOpen(false);
    setIsDemoPreview(false);
    setAuthInitialMode('login');
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

      if (isAuthenticated) {
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
    [isAuthenticated, updateAuthWorkspace]
  );

  const handleMarkNotificationAsRead = useCallback(
    (id: string) => {
      handleMarkNotificationsAsRead([id]);
    },
    [handleMarkNotificationsAsRead]
  );

  const handleMarkAllNotificationsAsRead = useCallback(() => {
    if (isAuthenticated) {
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
  }, [isAuthenticated, updateAuthWorkspace]);

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
          if (explicitId === currentUser.id || authOtherProfilesMap[explicitId]) {
            return explicitId;
          }
        }
        if (normalizedUsername) {
          if (currentUser.username.toLowerCase() === normalizedUsername) {
            return currentUser.id;
          }
          const matchedAuthConn = Object.values(authOtherProfilesMap).find(
            (u) => u.username.toLowerCase() === normalizedUsername
          );
          if (matchedAuthConn) return matchedAuthConn.id;
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
          <span className="text-xl font-black tracking-tighter text-white">光</span>
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
        isAuthenticated={isAuthenticated}
        authenticatedEmail={isAuthenticated ? user?.email ?? null : null}
        onLogout={isAuthenticated ? handleLogout : undefined}
        onOpenMessages={handleOpenMessagesFromHeader}
        unreadMessagesCount={unreadMessagesCount}
        onOpenAdminPanel={handleNavigateToAdmin}
        onOpenAuth={!isAuthenticated ? handleOpenAuthFromHeader : undefined}
        onOpenProfileSearch={() => setIsProfileSearchOpen(true)}
      />

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Profile Hero Header */}
        <ProfileHeader
          profile={activeProfile}
          isOwnProfile={isOwnProfile}
          isFollowing={isFollowingActive}
          isRequested={isRequestedActive}
          isBlocked={isBlockedActive}
          isFollowPending={isFollowPending}
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
          {isPrivateLocked && activeTab !== 'about' ? (
            <PrivateProfileNotice
              profile={activeProfile}
              isRequested={isRequestedActive}
              onRequestFollow={handleFollowToggle}
            />
          ) : (
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
          )}
        </div>
      </main>

      {/* Social Followers & Following Modal — downloaded & mounted strictly when opened */}
      {isFollowersOpen && (
        <Suspense fallback={<ModalLoadingFallback label="Carregando seguidores..." />}>
          <LazyFollowersModal
            isOpen={isFollowersOpen}
            initialTab={followersInitialTab}
            followers={followers}
            following={following}
            requests={followRequests}
            isOwnProfile={isOwnProfile}
            onClose={() => setIsFollowersOpen(false)}
            onUnfollow={handleUnfollowFromModal}
            onRemoveFollower={handleRemoveFollower}
            onAcceptRequest={handleAcceptRequest}
            onRejectRequest={handleRejectRequest}
            onBlockUser={(userId) => {
              if (isAuthenticated) {
                updateAuthWorkspace((prev) => {
                  const nextBlocked = prev.blockedIds.includes(userId)
                    ? prev.blockedIds
                    : [...prev.blockedIds, userId];
                  return {
                    ...prev,
                    blockedIds: nextBlocked,
                    followers: prev.followers.filter((u) => u.id !== userId),
                    profileOverrides: {
                      ...prev.profileOverrides,
                      followersCount: Math.max(0, (prev.profileOverrides.followersCount ?? 0) - 1),
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
            onSyncMAL={handleSyncMAL}
            onDisconnectAniList={handleDisconnectAniList}
            onDisconnectMAL={handleDisconnectMAL}
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
      {isChatOpen && (
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
