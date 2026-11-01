export interface PrivacySettings {
  showAnimeList: boolean;
  showFavorites: boolean;
  showActivity: boolean;
  showCommentsOnProfile: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bannerUrl: string;
  bio: string;
  createdAt: string; // Real formatted date, e.g. "18 de agosto de 2023"
  createdAtTimestamp: number;
  followersCount: number;
  followingCount: number;
  isPrivate: boolean;
  showCommentsOnProfile: boolean;
  privacySettings: PrivacySettings;
  externalAccounts: {
    anilist: { connected: boolean; username?: string; avatarUrl?: string; lastSync?: string };
    mal: { connected: boolean; username?: string; avatarUrl?: string; lastSync?: string };
  };
}

export interface FavoriteCharacter {
  id: string;
  name: string;
  originalName?: string;
  animeName: string;
  role: string;
  imageUrl: string;
}

export interface FavoriteCompany {
  id: string;
  name: string;
  type: string;
  notableWorks: string;
  logoUrl: string;
}

export interface FavoritePerson {
  id: string;
  name: string;
  role: string;
  notableWork: string;
  imageUrl: string;
}

export type AnimeStatus = 'all' | 'watching' | 'completed' | 'planned' | 'on_hold' | 'dropped';

export interface AnimeItem {
  id: string;
  title: string;
  titleRomaji?: string;
  posterUrl: string;
  status: 'watching' | 'completed' | 'planned' | 'on_hold' | 'dropped';
  currentEpisode: number;
  totalEpisodes: number;
  rating: number; // 0 to 10
  isFavorite: boolean;
  year: number;
  genres: string[];
  episodeDurationMinutes?: number;
  rewatchCount?: number;
  anilistId?: number;
  malId?: number;
}

export interface HikariComment {
  id: string;
  animeId: string;
  animeTitle: string;
  episodeNumber?: number;
  discussionTopic?: string;
  content: string;
  createdAt: string;
  createdAtTimestamp?: number;
  likesCount: number;
  repliesCount: number;
  originUrl: string;
}

export interface UserActivity {
  id: string;
  type: 'watched_ep' | 'completed_anime' | 'rated' | 'commented' | 'added_favorite' | 'status_changed' | 'added_anime';
  title: string;
  description: string;
  timestamp: string;
  createdAtTimestamp?: number;
  score?: number;
  episode?: number;
}

export interface FollowUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  isFollowing: boolean;
  isRequested: boolean;
  isFollower: boolean;
  isBlocked: boolean;
  createdAt: string;
}

export interface FollowRequest {
  id: string;
  user: FollowUser;
  requestedAt: string;
}

export interface NotificationItem {
  id: string;
  type: 'new_follower' | 'follow_request' | 'request_accepted' | 'comment_like' | 'comment_reply';
  actor: {
    id?: string;
    displayName: string;
    username: string;
    avatarUrl: string;
  };
  message: string;
  createdAt: string;
  isRead: boolean;
  handled?: 'accepted' | 'rejected';
  targetLink?: string;
  contextData?: {
    tab?: ProfileTab;
    commentId?: string;
    activityId?: string;
    animeId?: string;
    requestId?: string;
    modal?: 'followers';
    modalTab?: 'followers' | 'following' | 'requests';
    userId?: string;
  };
}

export type ProfileTab = 'overview' | 'animes' | 'comments' | 'about' | 'activity' | 'favorites';
