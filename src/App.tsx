import React, { useState, useEffect, useCallback } from 'react';
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
import { 
  UserProfile, 
  ProfileTab, 
  AnimeItem, 
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
  INITIAL_COMMENTS, 
  INITIAL_ACTIVITIES, 
  INITIAL_FOLLOWERS, 
  INITIAL_FOLLOWING, 
  INITIAL_FOLLOW_REQUESTS, 
  INITIAL_NOTIFICATIONS 
} from './data/mockData';
import { inferOffsetMsFromLabel } from './utils/relativeTime';

const PROFILE_STORAGE_KEY = 'hikari_profile_user_data_v1';

interface PersistedProfileData {
  animes: AnimeItem[];
  comments: HikariComment[];
  activities: UserActivity[];
  notifications: NotificationItem[];
}

const STATUS_ACTIVITY_LABEL: Record<AnimeItem['status'], string> = {
  watching: 'Assistindo',
  completed: 'Concluído',
  on_hold: 'Em espera',
  dropped: 'Abandonado',
  planned: 'Planejados'
};

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

function loadInitialProfileData(): PersistedProfileData {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedProfileData>;
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
          animes: parsed.animes,
          comments: parsed.comments,
          activities: parsed.activities,
          notifications: mergedNotifications
        };
      }
    }
  } catch {
    // Fallback to initial seed if localStorage is inaccessible or corrupted
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

  const seeded: PersistedProfileData = {
    animes: INITIAL_ANIMES,
    comments: seededComments,
    activities: seededActivities,
    notifications: INITIAL_NOTIFICATIONS
  };

  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // Ignore storage write errors in restricted contexts
  }

  return seeded;
}

export default function App() {
  // Hydrate persisted profile records once on mount
  const [initialData] = useState<PersistedProfileData>(() => loadInitialProfileData());

  // Session & Profiles
  const [currentUser, setCurrentUser] = useState<UserProfile>(CURRENT_USER);
  const [otherProfiles, setOtherProfiles] = useState<Record<string, UserProfile>>(OTHER_USERS);
  const [activeProfileId, setActiveProfileId] = useState<string>(CURRENT_USER.id);

  // Tab State
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  // Persisted Social & Data State
  const [animes, setAnimes] = useState<AnimeItem[]>(initialData.animes);
  const [comments, setComments] = useState<HikariComment[]>(initialData.comments);
  const [activities, setActivities] = useState<UserActivity[]>(initialData.activities);
  const [followers, setFollowers] = useState<FollowUser[]>(INITIAL_FOLLOWERS);
  const [following, setFollowing] = useState<FollowUser[]>(INITIAL_FOLLOWING);
  const [followRequests, setFollowRequests] = useState<FollowRequest[]>(INITIAL_FOLLOW_REQUESTS);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialData.notifications);

  // Keep localStorage synchronized whenever animes, comments, activities, or notifications change
  useEffect(() => {
    try {
      window.localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify({ animes, comments, activities, notifications })
      );
    } catch {
      // Ignore storage write errors gracefully
    }
  }, [animes, comments, activities, notifications]);

  // Synchronize notifications if updated from another tab or external Hikari event in the same storage
  useEffect(() => {
    function handleStorageSync(event: StorageEvent) {
      if (event.key !== PROFILE_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as Partial<PersistedProfileData>;
        if (Array.isArray(parsed.notifications)) {
          setNotifications(parsed.notifications);
        }
      } catch {
        // Ignore malformed external storage payloads
      }
    }
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  // Relational follow state for other users
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set(['usr_kuroha', 'usr_shinji']));
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  // Modal States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'profile' | 'privacy' | 'connected' | 'security'>('profile');
  const [isFollowersOpen, setIsFollowersOpen] = useState(false);
  const [followersInitialTab, setFollowersInitialTab] = useState<'followers' | 'following' | 'requests'>('followers');
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // Highlight state for direct notification navigation
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | undefined>(undefined);

  // Global background scroll lock for all open modals (preserves exact page position, zero jumping, no position:fixed hack, no scrollTo)
  useEffect(() => {
    const isAnyModalOpen = isSettingsOpen || isFollowersOpen || isNotifOpen;
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
  }, [isSettingsOpen, isFollowersOpen, isNotifOpen]);

  // Current active profile
  const isOwnProfile = activeProfileId === currentUser.id;
  const activeProfile = isOwnProfile ? currentUser : otherProfiles[activeProfileId] || currentUser;

  const isFollowingActive = followingIds.has(activeProfile.id);
  const isRequestedActive = requestedIds.has(activeProfile.id);
  const isBlockedActive = blockedIds.has(activeProfile.id);

  // Check if active profile is private and locked for viewer
  const isPrivateLocked = !isOwnProfile && activeProfile.isPrivate && !isFollowingActive;

  // Handler: Select Profile (switch view)
  const handleSelectProfile = (userId: string) => {
    setActiveProfileId(userId);
    setActiveTab('overview');
  };

  // Handler: Follow / Request toggle
  const handleFollowToggle = () => {
    if (isOwnProfile) return;

    if (isFollowingActive) {
      // Unfollow
      setFollowingIds(prev => {
        const next = new Set(prev);
        next.delete(activeProfile.id);
        return next;
      });
      // Decrement counts
      setOtherProfiles(prev => ({
        ...prev,
        [activeProfile.id]: {
          ...prev[activeProfile.id],
          followersCount: Math.max(0, prev[activeProfile.id].followersCount - 1)
        }
      }));
      setCurrentUser(prev => ({
        ...prev,
        followingCount: Math.max(0, prev.followingCount - 1)
      }));
      setFollowing(prev => prev.filter(u => u.id !== activeProfile.id));
    } else if (isRequestedActive) {
      // Cancel request
      setRequestedIds(prev => {
        const next = new Set(prev);
        next.delete(activeProfile.id);
        return next;
      });
    } else {
      // If target profile is private, send request
      if (activeProfile.isPrivate) {
        setRequestedIds(prev => new Set(prev).add(activeProfile.id));
      } else {
        // Immediate follow
        setFollowingIds(prev => new Set(prev).add(activeProfile.id));
        setOtherProfiles(prev => ({
          ...prev,
          [activeProfile.id]: {
            ...prev[activeProfile.id],
            followersCount: prev[activeProfile.id].followersCount + 1
          }
        }));
        setCurrentUser(prev => ({
          ...prev,
          followingCount: prev.followingCount + 1
        }));
        // Add to following list
        setFollowing(prev => [
          {
            id: activeProfile.id,
            username: activeProfile.username,
            displayName: activeProfile.displayName,
            avatarUrl: activeProfile.avatarUrl,
            bio: activeProfile.bio,
            isFollowing: true,
            isRequested: false,
            isFollower: false,
            isBlocked: false,
            createdAt: activeProfile.createdAt
          },
          ...prev
        ]);
      }
    }
  };

  // Handler: Block toggle
  const handleBlockToggle = () => {
    if (isOwnProfile) return;
    setBlockedIds(prev => {
      const next = new Set(prev);
      if (next.has(activeProfile.id)) {
        next.delete(activeProfile.id);
      } else {
        next.add(activeProfile.id);
        // If blocking, remove from following
        setFollowingIds(f => {
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
    const req = followRequests.find(r => r.id === requestId);
    if (req) {
      setFollowRequests(prev => prev.filter(r => r.id !== requestId));
      setFollowers(prev => [req.user, ...prev]);
      setCurrentUser(prev => ({
        ...prev,
        followersCount: prev.followersCount + 1
      }));
    }

    setNotifications(prev => prev.map(n => {
      if (n.id === notifId || n.contextData?.requestId === requestId) {
        return {
          ...n,
          isRead: true,
          handled: 'accepted' as const,
          message: 'começou a seguir o seu perfil (solicitação aceita).'
        };
      }
      return n;
    }));
  };

  // Handler: Reject follow request
  const handleRejectRequest = (requestId: string, notifId?: string) => {
    setFollowRequests(prev => prev.filter(r => r.id !== requestId));
    setNotifications(prev => prev.map(n => {
      if (n.id === notifId || n.contextData?.requestId === requestId) {
        return {
          ...n,
          isRead: true,
          handled: 'rejected' as const,
          message: 'solicitação para seguir recusada.'
        };
      }
      return n;
    }));
  };

  // Handler: Remove follower
  const handleRemoveFollower = (userId: string) => {
    setFollowers(prev => prev.filter(u => u.id !== userId));
    setCurrentUser(prev => ({
      ...prev,
      followersCount: Math.max(0, prev.followersCount - 1)
    }));
  };

  // Handler: Unfollow from modal
  const handleUnfollowFromModal = (userId: string) => {
    setFollowing(prev => prev.filter(u => u.id !== userId));
    setFollowingIds(prev => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    setCurrentUser(prev => ({
      ...prev,
      followingCount: Math.max(0, prev.followingCount - 1)
    }));
  };

  const persistAndApply = (
    nextAnimes: AnimeItem[],
    newActivity: UserActivity | null,
    nextComments: HikariComment[] = comments
  ) => {
    const nextActivities = newActivity ? [newActivity, ...activities] : activities;
    try {
      window.localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify({
          animes: nextAnimes,
          comments: nextComments,
          activities: nextActivities,
          notifications
        })
      );
    } catch {
      // Fallback to state if browser storage is restricted
    }
    setAnimes(nextAnimes);
    if (nextComments !== comments) {
      setComments(nextComments);
    }
    if (newActivity) {
      setActivities(nextActivities);
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
    setCurrentUser(prev => ({ ...prev, avatarUrl: url }));
  };

  const handleUpdateBanner = (url: string) => {
    setCurrentUser(prev => ({ ...prev, bannerUrl: url }));
  };

  const handleRemoveAvatar = () => {
    setCurrentUser(prev => ({ ...prev, avatarUrl: '' }));
  };

  const handleRemoveBanner = () => {
    setCurrentUser(prev => ({ ...prev, bannerUrl: '' }));
  };

  // Profile save
  const handleSaveProfile = (updated: Partial<UserProfile>) => {
    setCurrentUser(prev => ({ ...prev, ...updated }));
  };

  // Notification handlers
  const handleMarkNotificationsAsRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setNotifications((prev) => {
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
  }, []);

  const handleMarkNotificationAsRead = useCallback((id: string) => {
    handleMarkNotificationsAsRead([id]);
  }, [handleMarkNotificationsAsRead]);

  const handleMarkAllNotificationsAsRead = useCallback(() => {
    setNotifications((prev) => {
      const hasUnread = prev.some((n) => !n.isRead);
      if (!hasUnread) return prev;
      return prev.map((n) => (n.isRead ? n : { ...n, isRead: true }));
    });
  }, []);

  // Notification navigation to relevant content
  const handleSelectNotification = (notif: NotificationItem) => {
    if (notif.contextData?.tab === 'comments') {
      setActiveProfileId(currentUser.id);
      setActiveTab('comments');
      if (notif.contextData.commentId) {
        setHighlightedCommentId(notif.contextData.commentId);
        setTimeout(() => {
          const el = document.getElementById(`hikari-comment-${notif.contextData?.commentId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 150);
        setTimeout(() => {
          setHighlightedCommentId(undefined);
        }, 4000);
      }
    } else if (notif.contextData?.modal === 'followers') {
      setFollowersInitialTab(notif.contextData.modalTab || 'followers');
      setIsFollowersOpen(true);
    } else if (notif.contextData?.userId) {
      setActiveProfileId(notif.contextData.userId);
      setActiveTab('overview');
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0713] text-[#EDE8F5]">
      {/* Header with Search, Notifications and 7-Item Dropdown Menu */}
      <Header
        currentUser={currentUser}
        activeProfile={activeProfile}
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
        onMarkNotificationAsRead={handleMarkNotificationAsRead}
        onMarkNotificationsAsRead={handleMarkNotificationsAsRead}
        onMarkAllNotificationsAsRead={handleMarkAllNotificationsAsRead}
        onSelectNotification={handleSelectNotification}
        onNavigateTab={(tab) => setActiveTab(tab)}
        onAcceptRequest={handleAcceptRequest}
        onRejectRequest={handleRejectRequest}
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
          onTabChange={setActiveTab}
          animeCount={animes.length}
          commentsCount={comments.length}
          favoritesCount={animes.filter(a => a.isFavorite).length}
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
                  animes={animes}
                  comments={comments}
                  activities={activities}
                  isOwnProfile={isOwnProfile}
                  onNavigateTab={setActiveTab}
                  onToggleFavorite={handleToggleFavorite}
                />
              )}

              {activeTab === 'animes' && (
                !isOwnProfile && activeProfile.privacySettings?.showAnimeList === false ? (
                  <div className="rounded-2xl border border-purple-900/30 bg-[#130E24] p-8 text-center space-y-2">
                    <p className="text-sm font-semibold text-white">Lista de Animes Privada</p>
                    <p className="text-xs text-purple-300/60 max-w-sm mx-auto">
                      O usuário optou por manter sua lista de animes oculta em suas preferências de privacidade.
                    </p>
                  </div>
                ) : (
                  <AnimeListTab
                    animes={animes}
                    isOwnProfile={isOwnProfile}
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
                    comments={comments}
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
                  <ActivityTab activities={activities} />
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
          setBlockedIds(prev => new Set(prev).add(userId));
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
