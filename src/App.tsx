import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { updateProfile } from 'firebase/auth';
import { Header } from './components/Header';
import { ProfileHeader } from './components/ProfileHeader';
import { TabsNavigation } from './components/TabsNavigation';
import { OverviewTab } from './components/tabs/OverviewTab';
import { AnimeListTab } from './components/tabs/AnimeListTab';
import { CommentsTab } from './components/tabs/CommentsTab';
import { AboutTab } from './components/tabs/AboutTab';
import { ActivityTab } from './components/tabs/ActivityTab';
import { PrivateProfileNotice } from './components/PrivateProfileNotice';
import { FollowersModal } from './components/modals/FollowersModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { AuthScreen } from './components/auth/AuthScreen';
import { 
  UserProfile, 
  ProfileTab, 
  AnimeItem, 
  AnimeStatus,
  HikariComment, 
  UserActivity, 
  FollowUser, 
  FollowRequest, 
  NotificationItem 
} from './types';
import { 
  CURRENT_USER, 
  OTHER_USERS, 
  INITIAL_ANIMES, 
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
import { computeAnimeStats, EMPTY_ANIME_STATS } from './utils/animeStats';
import { useAuth } from './contexts/AuthContext';
import {
  PUBLIC_PROFILES_STORAGE_KEY,
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
  type FirestoreSyncStatus,
  type UserPersonalWorkspace,
  type UserProfileOverrides,
} from './lib/userWorkspaceStorage';

const DEMO_PROFILE_STORAGE_KEY = 'hikari_profile_user_data_v1';

interface PersistedDemoProfileData {
  profileOverrides?: UserProfileOverrides;
  animes: AnimeItem[];
  comments: HikariComment[];
  activities: UserActivity[];
  notifications: NotificationItem[];
}

interface AuthSessionState {
  uid: string;
  workspace: UserPersonalWorkspace;
  firestoreStatus: FirestoreSyncStatus;
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
  return {
    id: followUser.id,
    username: followUser.username,
    displayName: followUser.displayName,
    avatarUrl: followUser.avatarUrl,
    bannerUrl: '',
    bio: followUser.bio,
    createdAt: followUser.createdAt,
    createdAtTimestamp: 0,
    followersCount: followUser.isFollowing ? 1 : 0,
    followingCount: followUser.isFollower ? 1 : 0,
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
        return {
          profileOverrides:
            parsed.profileOverrides && typeof parsed.profileOverrides === 'object'
              ? parsed.profileOverrides
              : undefined,
          animes: parsed.animes,
          comments: parsed.comments,
          activities: parsed.activities,
          notifications: mergedNotifications
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
    animes: INITIAL_ANIMES,
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
      privacySettings: {
        ...CURRENT_USER.privacySettings,
        ...(ov.privacySettings ?? {}),
      },
    };
  });
  const [demoAnimes, setDemoAnimes] = useState<AnimeItem[]>(initialDemoData.animes);
  const [demoComments, setDemoComments] = useState<HikariComment[]>(initialDemoData.comments);
  const [demoActivities, setDemoActivities] = useState<UserActivity[]>(initialDemoData.activities);
  const [demoFollowers, setDemoFollowers] = useState<FollowUser[]>(INITIAL_FOLLOWERS);
  const [demoFollowing, setDemoFollowing] = useState<FollowUser[]>(INITIAL_FOLLOWING);
  const [demoFollowRequests, setDemoFollowRequests] = useState<FollowRequest[]>(INITIAL_FOLLOW_REQUESTS);
  const [demoNotifications, setDemoNotifications] = useState<NotificationItem[]>(initialDemoData.notifications);
  const [demoFollowingIds, setDemoFollowingIds] = useState<Set<string>>(
    () => new Set(['usr_kuroha', 'usr_shinji'])
  );
  const [demoRequestedIds, setDemoRequestedIds] = useState<Set<string>>(() => new Set());
  const [demoBlockedIds, setDemoBlockedIds] = useState<Set<string>>(() => new Set());
  const [demoOtherProfiles, setDemoOtherProfiles] = useState<Record<string, UserProfile>>(
    () => buildInitialDemoProfilesMap()
  );

  // UID-isolated personal state for real Firebase accounts (keyed strictly by user.uid)
  const [authSession, setAuthSession] = useState<AuthSessionState | null>(null);
  const [publicProfilesRevision, setPublicProfilesRevision] = useState(0);
  const [remoteVisitedProfiles, setRemoteVisitedProfiles] = useState<Record<string, UserProfile>>({});

  const [activeProfileId, setActiveProfileId] = useState<string>(CURRENT_USER.id);

  // Tab & Anime List Filter / Detail Navigation State
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [selectedAnimeStatusFilter, setSelectedAnimeStatusFilter] = useState<AnimeStatus>('all');
  const [animeFilterSyncKey, setAnimeFilterSyncKey] = useState(0);
  const [selectedAnimeDetailId, setSelectedAnimeDetailId] = useState<string | null>(null);

  // Modal States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'profile' | 'privacy' | 'connected' | 'security'>('profile');
  const [isFollowersOpen, setIsFollowersOpen] = useState(false);
  const [followersInitialTab, setFollowersInitialTab] = useState<'followers' | 'following' | 'requests'>('followers');
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // Highlight state for direct notification navigation
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | undefined>(undefined);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | undefined>(undefined);
  const highlightCommentTimerRef = useRef<number | null>(null);
  const highlightActivityTimerRef = useRef<number | null>(null);

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
      setActiveProfileId(CURRENT_USER.id);
      setSelectedAnimeStatusFilter('all');
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
    setIsFollowersOpen(false);
    setIsNotifOpen(false);
    setSelectedAnimeStatusFilter('all');
    setSelectedAnimeDetailId(null);
    setActiveProfileId(targetUid);
    setActiveTab('overview');
    setAuthSession({
      uid: targetUid,
      workspace: localWorkspace,
      firestoreStatus: 'idle',
    });

    void loadUserWorkspaceFromFirestore(targetUid).then((remote) => {
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

  // Keep demo localStorage synchronized ONLY while actively inside Demo Mode
  useEffect(() => {
    if (isAuthenticated || !isDemoPreview) return;
    try {
      window.localStorage.setItem(
        DEMO_PROFILE_STORAGE_KEY,
        JSON.stringify({
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
          },
          animes: demoAnimes,
          comments: demoComments,
          activities: demoActivities,
          notifications: demoNotifications,
        })
      );
    } catch {
      // Ignore storage write errors gracefully
    }
  }, [
    isAuthenticated,
    isDemoPreview,
    demoProfile,
    demoAnimes,
    demoComments,
    demoActivities,
    demoNotifications,
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

  // Global background scroll lock for centered blocking modals only (never lock or shift page for notifications popover)
  useEffect(() => {
    const isAnyModalOpen = isViewingAppShell && (isSettingsOpen || isFollowersOpen);
    if (isAnyModalOpen) {
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      const prevBodyOverflow = document.body.style.overflow;
      const prevPaddingRight = document.body.style.paddingRight;

      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }

      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.body.style.paddingRight = prevPaddingRight;
      };
    }
  }, [isViewingAppShell, isSettingsOpen, isFollowersOpen]);

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

    for (const [uid, proj] of Object.entries(authPublicProfilesMap)) {
      if (uid && uid !== currentUser.id) {
        map[uid] = proj.profile;
      }
    }

    for (const [uid, remoteProf] of Object.entries(remoteVisitedProfiles)) {
      if (uid && uid !== currentUser.id && !map[uid]) {
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
    : demoOtherProfiles[activeProfileId] || demoProfile;

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
    if (isAuthenticated) {
      return authPublicProfilesMap[activeProfile.id]?.animeStats ?? EMPTY_ANIME_STATS;
    }
    return computeAnimeStats(demoAnimes);
  }, [isOwnProfile, isAuthenticated, animes, authPublicProfilesMap, activeProfile.id, demoAnimes]);

  // Raw anime entries are strictly withheld when !canAccessActiveProfileAnimeList
  const exposedAnimes = useMemo<AnimeItem[]>(() => {
    if (!canAccessActiveProfileAnimeList) {
      return [];
    }
    if (isOwnProfile) {
      return animes;
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

  const displayedFavoriteCharacters = isAuthenticated
    ? isOwnProfile
      ? activeAuthWorkspace?.favoriteCharacters ?? []
      : []
    : FAVORITE_CHARACTERS;
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
      setSelectedAnimeStatusFilter('all');
      setSelectedAnimeDetailId(null);
      if (isAuthenticated && user) {
        if (userId === user.uid || !authOtherProfilesMap[userId]) {
          setActiveProfileId(user.uid);
        } else {
          setActiveProfileId(userId);
        }
        setActiveTab('overview');
        return;
      }
      setActiveProfileId(userId);
      setActiveTab('overview');
    },
    [isAuthenticated, user, authOtherProfilesMap]
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

  // Handler: Navigate tabs (resets status filter when clicking Animes tab directly)
  const handleTabChange = useCallback((tab: ProfileTab) => {
    if (tab === 'animes') {
      setSelectedAnimeDetailId(null);
      setSelectedAnimeStatusFilter('all');
      setAnimeFilterSyncKey((prev) => prev + 1);
    }
    setActiveTab(tab);
  }, []);

  // Handler: Open specific anime detail view from Header search
  const handleSelectAnimeFromSearch = useCallback(
    (animeId: string) => {
      if (!canAccessActiveProfileAnimeList) return;
      setSelectedAnimeStatusFilter('all');
      setAnimeFilterSyncKey((prev) => prev + 1);
      setSelectedAnimeDetailId(animeId);
      setActiveTab('animes');
    },
    [canAccessActiveProfileAnimeList]
  );

  // Handler: Follow / Request toggle
  const handleFollowToggle = () => {
    if (isOwnProfile) return;

    if (isAuthenticated) {
      updateAuthWorkspace((prev) => {
        const followingSet = new Set(prev.followingIds);
        const requestedSet = new Set(prev.requestedIds);
        let nextFollowing = prev.following;
        let nextFollowers = prev.followers;
        let followingDelta = 0;

        if (followingSet.has(activeProfile.id)) {
          followingSet.delete(activeProfile.id);
          nextFollowing = prev.following.filter((u) => u.id !== activeProfile.id);
          nextFollowers = prev.followers.map((u) =>
            u.id === activeProfile.id ? { ...u, isFollowing: false } : u
          );
          followingDelta = -1;
        } else if (requestedSet.has(activeProfile.id)) {
          requestedSet.delete(activeProfile.id);
        } else if (activeProfile.isPrivate) {
          requestedSet.add(activeProfile.id);
        } else {
          followingSet.add(activeProfile.id);
          const alreadyListed = prev.following.some((u) => u.id === activeProfile.id);
          if (!alreadyListed) {
            nextFollowing = [
              {
                id: activeProfile.id,
                username: activeProfile.username,
                displayName: activeProfile.displayName,
                avatarUrl: activeProfile.avatarUrl,
                bio: activeProfile.bio,
                isFollowing: true,
                isRequested: false,
                isFollower: prev.followers.some((u) => u.id === activeProfile.id),
                isBlocked: false,
                createdAt: activeProfile.createdAt,
              },
              ...prev.following,
            ];
          }
          nextFollowers = prev.followers.map((u) =>
            u.id === activeProfile.id ? { ...u, isFollowing: true } : u
          );
          followingDelta = 1;
        }

        const currentFollowingCount = prev.profileOverrides.followingCount ?? 0;
        return {
          ...prev,
          followingIds: Array.from(followingSet),
          requestedIds: Array.from(requestedSet),
          following: nextFollowing,
          followers: nextFollowers,
          profileOverrides:
            followingDelta !== 0
              ? {
                  ...prev.profileOverrides,
                  followingCount: Math.max(0, currentFollowingCount + followingDelta),
                }
              : prev.profileOverrides,
        };
      });
      return;
    }

    if (isFollowingActive) {
      setDemoFollowingIds((prev) => {
        const next = new Set(prev);
        next.delete(activeProfile.id);
        return next;
      });
      setDemoOtherProfiles((prev) => {
        const existingTarget = prev[activeProfile.id] ?? activeProfile;
        return {
          ...prev,
          [activeProfile.id]: {
            ...existingTarget,
            followersCount: Math.max(0, existingTarget.followersCount - 1),
          },
        };
      });
      setDemoProfile((prev) => ({
        ...prev,
        followingCount: Math.max(0, prev.followingCount - 1),
      }));
      setDemoFollowing((prev) => prev.filter((u) => u.id !== activeProfile.id));
      setDemoFollowers((prev) =>
        prev.map((u) => (u.id === activeProfile.id ? { ...u, isFollowing: false } : u))
      );
    } else if (isRequestedActive) {
      setDemoRequestedIds((prev) => {
        const next = new Set(prev);
        next.delete(activeProfile.id);
        return next;
      });
    } else if (activeProfile.isPrivate) {
      setDemoRequestedIds((prev) => new Set(prev).add(activeProfile.id));
    } else {
      setDemoFollowingIds((prev) => new Set(prev).add(activeProfile.id));
      setDemoOtherProfiles((prev) => {
        const existingTarget = prev[activeProfile.id] ?? activeProfile;
        return {
          ...prev,
          [activeProfile.id]: {
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
        if (prev.some((u) => u.id === activeProfile.id)) return prev;
        return [
          {
            id: activeProfile.id,
            username: activeProfile.username,
            displayName: activeProfile.displayName,
            avatarUrl: activeProfile.avatarUrl,
            bio: activeProfile.bio,
            isFollowing: true,
            isRequested: false,
            isFollower: demoFollowers.some((u) => u.id === activeProfile.id),
            isBlocked: false,
            createdAt: activeProfile.createdAt,
          },
          ...prev,
        ];
      });
      setDemoFollowers((prev) =>
        prev.map((u) => (u.id === activeProfile.id ? { ...u, isFollowing: true } : u))
      );
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
          followingCount: Math.max(0, (prev.profileOverrides.followingCount ?? 0) - 1),
        },
      }));
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
  };

  const persistAndApply = (
    nextAnimes: AnimeItem[],
    newActivity: UserActivity | null,
    nextComments: HikariComment[] = comments
  ) => {
    if (isAuthenticated) {
      updateAuthWorkspace((prev) => ({
        ...prev,
        animes: nextAnimes,
        comments: nextComments !== comments ? nextComments : prev.comments,
        activities: newActivity ? [newActivity, ...prev.activities] : prev.activities,
      }));
      return;
    }

    const nextActivities = newActivity ? [newActivity, ...demoActivities] : demoActivities;
    if (isDemoPreview) {
      try {
        window.localStorage.setItem(
          DEMO_PROFILE_STORAGE_KEY,
          JSON.stringify({
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
            },
            animes: nextAnimes,
            comments: nextComments,
            activities: nextActivities,
            notifications: demoNotifications,
          })
        );
      } catch {
        // Fallback to state if browser storage is restricted
      }
    }
    setDemoAnimes(nextAnimes);
    if (nextComments !== demoComments) {
      setDemoComments(nextComments);
    }
    if (newActivity) {
      setDemoActivities(nextActivities);
    }
  };

  // Handler: Update episode progress
  const handleUpdateEpisode = (animeId: string, delta: number) => {
    const prevAnime = animes.find(a => a.id === animeId);
    if (!prevAnime) return;

    const newEp = Math.min(prevAnime.totalEpisodes, Math.max(0, prevAnime.currentEpisode + delta));
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

    if (newEp === prevAnime.currentEpisode && newStatus === prevAnime.status) return;

    const nextAnimes = animes.map(anime =>
      anime.id === animeId ? { ...anime, currentEpisode: newEp, status: newStatus } : anime
    );

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
          episode: newEp
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
          episode: newEp
        };

    persistAndApply(nextAnimes, activity);
  };

  // Handler: Update anime status (with automatic episode maxing on completion)
  const handleUpdateStatus = (animeId: string, newStatus: AnimeItem['status']) => {
    const prevAnime = animes.find(a => a.id === animeId);
    if (!prevAnime || prevAnime.status === newStatus) return;

    const isCompleted = newStatus === 'completed';
    const nextEp = isCompleted ? prevAnime.totalEpisodes : prevAnime.currentEpisode;

    const nextAnimes = animes.map(anime =>
      anime.id === animeId
        ? { ...anime, status: newStatus, currentEpisode: nextEp }
        : anime
    );

    const actionNow = Date.now();
    const activity: UserActivity = isCompleted
      ? {
          id: `act_${actionNow}_${animeId}`,
          type: 'completed_anime',
          title: `Marcou ${prevAnime.title} como concluído`,
          description: `${nextEp}/${prevAnime.totalEpisodes} episódios`,
          timestamp: 'Agora',
          createdAtTimestamp: actionNow,
          episode: nextEp
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
          episode: nextEp
        };

    persistAndApply(nextAnimes, activity);
  };

  // Handler: Save anime edit from modal (updates episode count, status and rating, recording 1 consolidated activity)
  const handleSaveAnimeEdit = (
    animeId: string,
    updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }
  ) => {
    const prevAnime = animes.find(a => a.id === animeId);
    if (!prevAnime) return;

    const nextEp = Math.min(prevAnime.totalEpisodes, Math.max(0, updates.currentEpisode));
    const nextStatus = updates.status;
    const nextRating = updates.rating;

    const statusChanged = nextStatus !== prevAnime.status;
    const epChanged = nextEp !== prevAnime.currentEpisode;
    const ratingChanged = nextRating !== prevAnime.rating;

    if (!statusChanged && !epChanged && !ratingChanged) {
      return;
    }

    const nextAnimes = animes.map(anime =>
      anime.id === animeId
        ? {
            ...anime,
            currentEpisode: nextEp,
            status: nextStatus,
            rating: nextRating
          }
        : anime
    );

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
        score: ratingChanged && nextRating > 0 ? nextRating : undefined
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
        score: ratingChanged && nextRating > 0 ? nextRating : undefined
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
        episode: epChanged ? nextEp : undefined
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
        episode: nextEp
      };
    }

    persistAndApply(nextAnimes, newActivity);
  };

  // Handler: Toggle favorite
  const handleToggleFavorite = (animeId: string) => {
    const prevAnime = animes.find(a => a.id === animeId);
    if (!prevAnime) return;

    const nextFav = !prevAnime.isFavorite;
    const nextAnimes = animes.map(anime =>
      anime.id === animeId ? { ...anime, isFavorite: nextFav } : anime
    );

    const actionNow = Date.now();
    const activity: UserActivity = {
      id: `act_${actionNow}_${animeId}`,
      type: 'added_favorite',
      title: nextFav
        ? `Adicionou ${prevAnime.title} aos favoritos`
        : `Removeu ${prevAnime.title} dos favoritos`,
      description: prevAnime.genres.slice(0, 2).join(' · '),
      timestamp: 'Agora',
      createdAtTimestamp: actionNow
    };

    persistAndApply(nextAnimes, activity);
  };

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
          return {
            ...prev,
            animes: mergedAnimes,
            profileOverrides: nextProfileOverrides,
            activities: [syncActivity, ...prev.activities],
          };
        });
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
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(mergedAnimes);
      setDemoActivities((prev) => [syncActivity, ...prev]);
      if (isDemoPreview) {
        try {
          window.localStorage.setItem(
            DEMO_PROFILE_STORAGE_KEY,
            JSON.stringify({
              profileOverrides: {
                ...nextDemoProfile,
              },
              animes: mergedAnimes,
              comments: demoComments,
              activities: [syncActivity, ...demoActivities],
              notifications: demoNotifications,
            })
          );
        } catch {
          // Fallback
        }
      }
    },
    [isAuthenticated, demoProfile, demoActivities, isDemoPreview, demoComments, demoNotifications]
  );

  // Handler: Sync imported anime list from MyAnimeList
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
            profileOverrides: nextProfileOverrides,
            activities: [syncActivity, ...prev.activities],
          };
        });
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
          mal: malPatch,
        },
      };
      setDemoProfile(nextDemoProfile);
      setDemoAnimes(mergedAnimes);
      setDemoActivities((prev) => [syncActivity, ...prev]);
      if (isDemoPreview) {
        try {
          window.localStorage.setItem(
            DEMO_PROFILE_STORAGE_KEY,
            JSON.stringify({
              profileOverrides: {
                ...nextDemoProfile,
              },
              animes: mergedAnimes,
              comments: demoComments,
              activities: [syncActivity, ...demoActivities],
              notifications: demoNotifications,
            })
          );
        } catch {
          // Fallback
        }
      }
    },
    [isAuthenticated, demoProfile, demoActivities, isDemoPreview, demoComments, demoNotifications]
  );

  // Real Logout handler: wipes personal memory immediately, terminates Firebase Auth session and returns to login screen
  const handleLogout = useCallback(async () => {
    setIsSettingsOpen(false);
    setIsFollowersOpen(false);
    setIsNotifOpen(false);
    setIsDemoPreview(false);
    setAuthInitialMode('login');
    setSelectedAnimeStatusFilter('all');
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
      <AuthScreen
        key={authInitialMode}
        initialMode={authInitialMode}
        onEnterDemoMode={() => {
          setActiveProfileId(CURRENT_USER.id);
          setActiveTab('overview');
          setIsDemoPreview(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0713] text-[#EDE8F5]">
      {/* Header with Search, Notifications and 7-Item Dropdown Menu */}
      <Header
        currentUser={currentUser}
        activeProfile={activeProfile}
        animes={exposedAnimes}
        searchableProfiles={isAuthenticated ? Object.values(authOtherProfilesMap) : undefined}
        notifications={notifications}
        isNotifOpen={isNotifOpen}
        onToggleNotif={setIsNotifOpen}
        onOpenSettings={(tab = 'profile') => {
          setSettingsInitialTab(tab);
          setIsSettingsOpen(true);
        }}
        onOpenFollowers={(tab = 'followers') => {
          setFollowersInitialTab(tab);
          setIsFollowersOpen(true);
        }}
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
        onOpenAuth={
          !isAuthenticated
            ? (mode = 'login') => {
                setAuthInitialMode(mode);
                setIsDemoPreview(false);
              }
            : undefined
        }
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
          onFollowToggle={handleFollowToggle}
          onBlockToggle={handleBlockToggle}
          onOpenSettings={(tab = 'profile') => {
            setSettingsInitialTab(tab);
            setIsSettingsOpen(true);
          }}
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
          favoritesCount={exposedAnimes.filter(a => a.isFavorite).length}
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
                  <AnimeListTab
                    animes={exposedAnimes}
                    isOwnProfile={isOwnProfile}
                    selectedStatusFilter={selectedAnimeStatusFilter}
                    filterSyncKey={animeFilterSyncKey}
                    selectedAnimeId={selectedAnimeDetailId}
                    onClearSelectedAnime={() => setSelectedAnimeDetailId(null)}
                    isListPrivateForVisitors={activeProfile.privacySettings?.showAnimeList === false}
                    onUpdateEpisode={handleUpdateEpisode}
                    onToggleFavorite={handleToggleFavorite}
                    onUpdateStatus={handleUpdateStatus}
                    onSaveAnimeEdit={handleSaveAnimeEdit}
                  />
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
                  <CommentsTab
                    comments={displayedComments}
                    showCommentsOnProfile={activeProfile.showCommentsOnProfile}
                    isOwnProfile={isOwnProfile}
                    userName={activeProfile.displayName}
                    highlightedCommentId={highlightedCommentId}
                  />
                )
              )}

              {activeTab === 'about' && (
                <AboutTab profile={activeProfile} />
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
                  <ActivityTab
                    activities={displayedActivities}
                    highlightedActivityId={highlightedActivityId}
                  />
                )
              )}
            </>
          )}
        </div>
      </main>

      {/* Social Followers & Following Modal */}
      <FollowersModal
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

      {/* Settings & Privacy Modal */}
      {isSettingsOpen && (
        <SettingsModal
          key={`${settingsInitialTab}-${isSettingsOpen}`}
          isOpen={isSettingsOpen}
          initialTab={settingsInitialTab}
          profile={currentUser}
          currentAnimes={animes}
          onSyncAniList={handleSyncAniList}
          onSyncMAL={handleSyncMAL}
          onClose={() => setIsSettingsOpen(false)}
          onSaveProfile={handleSaveProfile}
          onUpdateAvatar={handleUpdateAvatar}
          onUpdateBanner={handleUpdateBanner}
          onRemoveAvatar={handleRemoveAvatar}
          onRemoveBanner={handleRemoveBanner}
        />
      )}
    </div>
  );
}
