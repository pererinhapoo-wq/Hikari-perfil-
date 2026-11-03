export type DirectMessagesPrivacy = 'everyone' | 'followers' | 'mutual';

export interface PrivacySettings {
  showAnimeList: boolean;
  showFavorites: boolean;
  showActivity: boolean;
  showCommentsOnProfile: boolean;
  allowDirectMessages?: boolean;
  directMessagesFrom?: DirectMessagesPrivacy;
  showOnlineStatus?: boolean; // Se verdadeiro (padrão), exibe o ponto verde de status online
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
    anilist: { connected: boolean; username?: string; avatarUrl?: string; lastSync?: string; accountCreatedAt?: string };
    mal: { connected: boolean; username?: string; avatarUrl?: string; lastSync?: string; accountCreatedAt?: string };
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

export type AnimeOriginProvider = 'anilist' | 'mal' | 'manual' | 'legacy_unknown';

export interface AnimeProvenance {
  originProvider: AnimeOriginProvider;
  accountIdentifier?: string; // Nome de usuário ou ID da conta externa responsável pela importação
  importedAtMs?: number;      // Timestamp da importação original
  linkedProviders: ('anilist' | 'mal')[]; // Provedores vinculados (pode conter ambos simultaneamente)
  anilistUsername?: string;   // Conta AniList associada se houver vínculo
  malUsername?: string;       // Conta MAL associada se houver vínculo
  hasUserModifications: boolean; // Se o usuário realizou alterações manuais no Hikari Perfil
  lastModifiedLocallyAtMs?: number; // Timestamp da última edição manual realizada no Hikari Perfil
}

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
  provenance?: AnimeProvenance;
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
  animeId?: string;
  animeTitle?: string;
  posterUrl?: string;
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

export type MessageType = 'text' | 'image' | 'gif' | 'link';

export interface HikariLinkPreview {
  url: string;
  type: 'anime' | 'profile' | 'comment' | 'external';
  title: string;
  description?: string;
  imageUrl?: string;
  badge?: string;
  extraInfo?: {
    rating?: number;
    status?: string;
    episodes?: string;
    year?: number;
    genres?: string[];
  };
}

export interface PrivateMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderUsername?: string;
  senderAvatarUrl: string;
  recipientId: string;
  text: string;
  type: MessageType;
  mediaUrl?: string;
  mediaMetadata?: {
    width?: number;
    height?: number;
    sizeBytes?: number;
    mimeType?: string;
  };
  linkPreview?: HikariLinkPreview;
  reactions?: Record<string, string[]>; // emoji -> array of user IDs
  isRead: boolean;
  createdAt: number;
  status?: 'sending' | 'sent' | 'failed';
}

export interface ParticipantSummary {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

export interface PrivateConversation {
  id: string;
  participants: string[];
  participantDetails: Record<string, ParticipantSummary>;
  lastMessage?: {
    id: string;
    text: string;
    senderId: string;
    senderName: string;
    type: MessageType;
    createdAt: number;
    isRead: boolean;
  };
  unreadCounts: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Identificador imutável da conta administradora proprietária do Hikari Perfil
 */
export const AUTHORIZED_ADMIN_UID = 'TLJx2QuEv4QQYoduGqn0LDJxxRW2' as const;

export interface AdminStatusResponse {
  isAdmin: boolean;
  authenticated: boolean;
  role?: 'owner' | 'user';
}
