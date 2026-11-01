import React, { useState, useEffect } from 'react';
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

export default function App() {
  // Session & Profiles
  const [currentUser, setCurrentUser] = useState<UserProfile>(CURRENT_USER);
  const [otherProfiles, setOtherProfiles] = useState<Record<string, UserProfile>>(OTHER_USERS);
  const [activeProfileId, setActiveProfileId] = useState<string>(CURRENT_USER.id);

  // Tab State
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  // Social & Data State
  const [animes, setAnimes] = useState<AnimeItem[]>(INITIAL_ANIMES);
  const [comments, setComments] = useState<HikariComment[]>(INITIAL_COMMENTS);
  const [activities, setActivities] = useState<UserActivity[]>(INITIAL_ACTIVITIES);
  const [followers, setFollowers] = useState<FollowUser[]>(INITIAL_FOLLOWERS);
  const [following, setFollowing] = useState<FollowUser[]>(INITIAL_FOLLOWING);
  const [followRequests, setFollowRequests] = useState<FollowRequest[]>(INITIAL_FOLLOW_REQUESTS);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);

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
      const prevHtmlOverflow = document.documentElement.style.overflow;
      const prevBodyOverflow = document.body.style.overflow;
      const prevPaddingRight = document.body.style.paddingRight;

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }

      return () => {
        document.documentElement.style.overflow = prevHtmlOverflow;
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

  // Handler: Update episode progress
  const handleUpdateEpisode = (animeId: string, delta: number) => {
    setAnimes(prev => prev.map(anime => {
      if (anime.id === animeId) {
        const newEp = Math.min(anime.totalEpisodes, Math.max(0, anime.currentEpisode + delta));
        const newStatus = newEp === anime.totalEpisodes ? 'completed' : anime.status;
        return {
          ...anime,
          currentEpisode: newEp,
          status: newStatus
        };
      }
      return anime;
    }));
  };

  // Handler: Update anime status (with automatic episode maxing on completion)
  const handleUpdateStatus = (animeId: string, newStatus: AnimeItem['status']) => {
    setAnimes(prev => prev.map(anime => {
      if (anime.id === animeId) {
        const isCompleted = newStatus === 'completed';
        return {
          ...anime,
          status: newStatus,
          currentEpisode: isCompleted ? anime.totalEpisodes : anime.currentEpisode
        };
      }
      return anime;
    }));
  };

  // Handler: Save anime edit from modal (updates episode count, status and rating)
  const handleSaveAnimeEdit = (animeId: string, updates: { currentEpisode: number; status: AnimeItem['status']; rating: number }) => {
    setAnimes(prev => prev.map(anime => {
      if (anime.id === animeId) {
        return {
          ...anime,
          currentEpisode: Math.min(anime.totalEpisodes, Math.max(0, updates.currentEpisode)),
          status: updates.status,
          rating: updates.rating
        };
      }
      return anime;
    }));
  };

  // Handler: Toggle favorite
  const handleToggleFavorite = (animeId: string) => {
    setAnimes(prev => prev.map(anime => {
      if (anime.id === animeId) {
        return { ...anime, isFavorite: !anime.isFavorite };
      }
      return anime;
    }));
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
  const handleMarkNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handleMarkAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

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
