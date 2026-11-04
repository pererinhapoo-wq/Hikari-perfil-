import fs from 'node:fs';
import path from 'node:path';
import type {
  AnimeItem,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson,
  FollowRequest,
  FollowUser,
  HikariComment,
  NotificationItem,
  UserActivity,
  UserProfile,
} from '../types/index.js';
import {
  computeAnimeStats,
  EMPTY_ANIME_STATS,
  type AnimeStatsSummary,
} from '../utils/animeStats.js';
import { filterActivitiesForViewer } from '../utils/activityPrivacy.js';

export interface StoredUserRecord {
  uid: string;
  profile: UserProfile;
  animes: AnimeItem[];
  favoriteCharacters: FavoriteCharacter[];
  favoriteCompanies: FavoriteCompany[];
  favoritePeople: FavoritePerson[];
  activities: UserActivity[];
  comments: HikariComment[];
  followers: FollowUser[];
  following: FollowUser[];
  followRequests: FollowRequest[];
  followingIds: string[];
  requestedIds: string[];
  blockedIds: string[];
  notifications: NotificationItem[];
  updatedAtMs: number;
  workspaceHydrated?: boolean;
  socialMutated?: boolean;
}

export interface StoredProfileReport {
  id: string;
  targetType: 'profile';
  targetId: string;
  targetUsername?: string;
  targetDisplayName?: string;
  reporterUid: string;
  reporterUsername?: string;
  reporterDisplayName?: string;
  reason: string;
  details: string;
  status: 'pending' | 'in_review' | 'resolved' | 'dismissed';
  createdAt: string;
  createdAtMs: number;
  updatedAtMs?: number;
}

export interface SyncUserPayload {
  profile: UserProfile;
  animes?: AnimeItem[];
  animesComplete?: boolean;
  favoriteCharacters?: FavoriteCharacter[];
  favoriteCompanies?: FavoriteCompany[];
  favoritePeople?: FavoritePerson[];
  activities?: UserActivity[];
  comments?: HikariComment[];
  followers?: FollowUser[];
  following?: FollowUser[];
  followRequests?: FollowRequest[];
  followingIds?: string[];
  requestedIds?: string[];
  blockedIds?: string[];
  notifications?: NotificationItem[];
  updatedAtMs?: number;
}

export interface PublicProfileResponsePayload {
  isOwner: boolean;
  isPrivateBlocked: false;
  profile: UserProfile;
  animeStats: AnimeStatsSummary;
  totalAnimes: number;
  animes: AnimeItem[];
  hasMoreAnimes: boolean;
  nextAnimeOffset: number | null;
  favoriteCharacters: FavoriteCharacter[];
  favoriteCompanies: FavoriteCompany[];
  favoritePeople: FavoritePerson[];
  activities: UserActivity[];
  comments: HikariComment[];
  followers: FollowUser[];
  following: FollowUser[];
  updatedAtMs: number;
}

export interface PrivateBlockedProfilePayload {
  isOwner: false;
  isPrivateBlocked: true;
  error: string;
  code: 'PRIVATE_PROFILE';
  profileStub: UserProfile;
}

function sanitizePublicAnimeEntry(item: AnimeItem, allowFavoriteFlag: boolean): AnimeItem {
  return {
    id: String(item.id || ''),
    title: String(item.title || ''),
    ...(item.titleRomaji ? { titleRomaji: String(item.titleRomaji) } : {}),
    posterUrl: String(item.posterUrl || ''),
    status: item.status,
    currentEpisode: Math.max(0, Number(item.currentEpisode) || 0),
    totalEpisodes: Math.max(0, Number(item.totalEpisodes) || 0),
    rating: Math.max(0, Math.min(10, Number(item.rating) || 0)),
    isFavorite: allowFavoriteFlag ? Boolean(item.isFavorite) : false,
    year: Number(item.year) || 0,
    genres: Array.isArray(item.genres) ? item.genres.slice(0, 15).map(String) : [],
    ...(typeof item.episodeDurationMinutes === 'number'
      ? { episodeDurationMinutes: item.episodeDurationMinutes }
      : {}),
    ...(typeof item.rewatchCount === 'number' ? { rewatchCount: item.rewatchCount } : {}),
    ...(typeof item.anilistId === 'number' ? { anilistId: item.anilistId } : {}),
    ...(typeof item.malId === 'number' ? { malId: item.malId } : {}),
  };
}

function buildPublicProfileStubForPrivateUser(profile: UserProfile): UserProfile {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl || '',
    bannerUrl: '',
    bio: '',
    createdAt: profile.createdAt || '',
    createdAtTimestamp: profile.createdAtTimestamp,
    followersCount: Math.max(0, Number(profile.followersCount) || 0),
    followingCount: Math.max(0, Number(profile.followingCount) || 0),
    isPrivate: true,
    showCommentsOnProfile: false,
    privacySettings: {
      showAnimeList: false,
      showFavorites: false,
      showActivity: false,
      showCommentsOnProfile: false,
      allowDirectMessages: profile.privacySettings?.allowDirectMessages ?? true,
      directMessagesFrom: profile.privacySettings?.directMessagesFrom ?? 'everyone',
      showOnlineStatus: false,
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false },
    },
  };
}

function sanitizePublicProfileHeader(profile: UserProfile): UserProfile {
  if (profile.isPrivate) {
    return buildPublicProfileStubForPrivateUser(profile);
  }
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl || '',
    bannerUrl: profile.bannerUrl || '',
    bio: profile.bio || '',
    createdAt: profile.createdAt || '',
    createdAtTimestamp: profile.createdAtTimestamp,
    followersCount: Math.max(0, Number(profile.followersCount) || 0),
    followingCount: Math.max(0, Number(profile.followingCount) || 0),
    isPrivate: false,
    showCommentsOnProfile: Boolean(
      profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile
    ),
    privacySettings: {
      showAnimeList: profile.privacySettings?.showAnimeList !== false,
      showFavorites: profile.privacySettings?.showFavorites !== false,
      showActivity: profile.privacySettings?.showActivity !== false,
      showCommentsOnProfile:
        profile.privacySettings?.showCommentsOnProfile ?? profile.showCommentsOnProfile,
      allowDirectMessages: profile.privacySettings?.allowDirectMessages ?? true,
      directMessagesFrom: profile.privacySettings?.directMessagesFrom ?? 'everyone',
      showOnlineStatus: profile.privacySettings?.showOnlineStatus !== false,
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false },
    },
  };
}

function normalizeSearchTerm(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function createMinimalUserRecord(
  uid: string,
  summary?: Partial<Pick<UserProfile, 'username' | 'displayName' | 'avatarUrl' | 'isPrivate'>>
): StoredUserRecord {
  const safeUsername =
    (summary?.username || `user_${uid.slice(0, 8)}`)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 32) || `user_${uid.slice(0, 8)}`;
  const safeDisplayName = (summary?.displayName || safeUsername).slice(0, 60);

  return {
    uid,
    profile: {
      id: uid,
      username: safeUsername,
      displayName: safeDisplayName,
      avatarUrl: summary?.avatarUrl || '',
      bannerUrl: '',
      bio: '',
      createdAt: new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
      createdAtTimestamp: Date.now(),
      followersCount: 0,
      followingCount: 0,
      isPrivate: Boolean(summary?.isPrivate),
      showCommentsOnProfile: true,
      privacySettings: {
        showAnimeList: true,
        showFavorites: true,
        showActivity: true,
        showCommentsOnProfile: true,
        allowDirectMessages: true,
        directMessagesFrom: 'everyone',
        showOnlineStatus: true,
      },
      externalAccounts: {
        anilist: { connected: false },
        mal: { connected: false },
      },
    },
    animes: [],
    favoriteCharacters: [],
    favoriteCompanies: [],
    favoritePeople: [],
    activities: [],
    comments: [],
    followers: [],
    following: [],
    followRequests: [],
    followingIds: [],
    requestedIds: [],
    blockedIds: [],
    notifications: [],
    updatedAtMs: Date.now(),
  };
}

export class SocialStore {
  private users = new Map<string, StoredUserRecord>();
  private usernameIndex = new Map<string, string>();
  private reports: StoredProfileReport[] = [];
  private storageFilePath: string;
  private persistDisabled: boolean;

  constructor(options?: { storageFilePath?: string; ephemeral?: boolean }) {
    this.storageFilePath =
      options?.storageFilePath ?? path.resolve(process.cwd(), '.data', 'social-store.json');
    this.persistDisabled =
      options?.ephemeral !== undefined
        ? Boolean(options.ephemeral)
        : process.env.HIKARI_EPHEMERAL_TEST_STORE === '1';

    if (!this.persistDisabled) {
      this.loadFromDisk();
    }
  }

  public resetForTests(ephemeral = true): void {
    this.persistDisabled = ephemeral;
    this.users.clear();
    this.usernameIndex.clear();
    this.reports = [];
  }

  private rebuildUsernameIndex(): void {
    this.usernameIndex.clear();
    for (const [uid, record] of this.users.entries()) {
      if (record.profile.username) {
        this.usernameIndex.set(record.profile.username.toLowerCase(), uid);
      }
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storageFilePath)) return;
      const raw = fs.readFileSync(this.storageFilePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as {
        users?: Record<string, StoredUserRecord>;
        reports?: StoredProfileReport[];
      };
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.users && typeof parsed.users === 'object') {
        for (const [uid, rec] of Object.entries(parsed.users)) {
          if (!rec || typeof rec !== 'object' || rec.uid !== uid || !rec.profile) continue;
          this.users.set(uid, {
            ...rec,
            animes: Array.isArray(rec.animes) ? rec.animes : [],
            favoriteCharacters: Array.isArray(rec.favoriteCharacters) ? rec.favoriteCharacters : [],
            favoriteCompanies: Array.isArray(rec.favoriteCompanies) ? rec.favoriteCompanies : [],
            favoritePeople: Array.isArray(rec.favoritePeople) ? rec.favoritePeople : [],
            activities: Array.isArray(rec.activities) ? rec.activities : [],
            comments: Array.isArray(rec.comments) ? rec.comments : [],
            followers: Array.isArray(rec.followers) ? rec.followers : [],
            following: Array.isArray(rec.following) ? rec.following : [],
            followRequests: Array.isArray(rec.followRequests) ? rec.followRequests : [],
            followingIds: Array.isArray(rec.followingIds) ? rec.followingIds : [],
            requestedIds: Array.isArray(rec.requestedIds) ? rec.requestedIds : [],
            blockedIds: Array.isArray(rec.blockedIds) ? rec.blockedIds : [],
            notifications: Array.isArray(rec.notifications) ? rec.notifications : [],
            updatedAtMs: typeof rec.updatedAtMs === 'number' ? rec.updatedAtMs : Date.now(),
          });
        }
      }

      if (Array.isArray(parsed.reports)) {
        this.reports = parsed.reports.filter(
          (r): r is StoredProfileReport =>
            Boolean(r && typeof r === 'object' && typeof r.id === 'string' && r.targetId)
        );
      }

      this.rebuildUsernameIndex();
    } catch {
      // Ignore corrupted disk cache gracefully
    }
  }

  private saveToDisk(): void {
    if (this.persistDisabled) return;
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serializedUsers: Record<string, StoredUserRecord> = {};
      for (const [uid, rec] of this.users.entries()) {
        serializedUsers[uid] = rec;
      }
      const tmpPath = `${this.storageFilePath}.${process.pid}.tmp`;
      fs.writeFileSync(
        tmpPath,
        JSON.stringify({ version: 1, users: serializedUsers, reports: this.reports }),
        'utf8'
      );
      fs.renameSync(tmpPath, this.storageFilePath);
    } catch {
      // Safe fallback in read-only serverless filesystems
    }
  }

  public getUserRecord(idOrUsername: string): StoredUserRecord | null {
    const clean = idOrUsername.trim().replace(/^@+/, '');
    if (!clean) return null;
    const direct = this.users.get(clean);
    if (direct) return direct;
    const mappedUid = this.usernameIndex.get(clean.toLowerCase());
    if (mappedUid) {
      return this.users.get(mappedUid) ?? null;
    }
    return null;
  }

  /**
   * Synchronizes an authenticated owner's profile, privacy settings, anime catalog,
   * favorites, and activities while preserving authoritative server-side follower
   * relationships and notifications so incoming notifications are never lost.
   */
  public syncOwnerWorkspace(uid: string, payload: SyncUserPayload): StoredUserRecord {
    const existing = this.users.get(uid) ?? createMinimalUserRecord(uid, payload.profile);
    const prevUsername = existing.profile.username?.toLowerCase();

    const incomingProfile = payload.profile;
    const isPrivate = Boolean(incomingProfile.isPrivate);
    const privacySettings = {
      showAnimeList: incomingProfile.privacySettings?.showAnimeList !== false,
      showFavorites: incomingProfile.privacySettings?.showFavorites !== false,
      showActivity: incomingProfile.privacySettings?.showActivity !== false,
      showCommentsOnProfile:
        incomingProfile.privacySettings?.showCommentsOnProfile ??
        incomingProfile.showCommentsOnProfile ??
        true,
      allowDirectMessages: incomingProfile.privacySettings?.allowDirectMessages ?? true,
      directMessagesFrom: incomingProfile.privacySettings?.directMessagesFrom ?? 'everyone',
      showOnlineStatus: incomingProfile.privacySettings?.showOnlineStatus !== false,
    };

    // Never overwrite a full anime list with a partial initial snapshot unless explicitly complete or larger/edited
    let nextAnimes = existing.animes;
    if (Array.isArray(payload.animes)) {
      if (payload.animesComplete !== false || payload.animes.length >= existing.animes.length) {
        nextAnimes = payload.animes;
      }
    }

    let nextFollowers = existing.followers;
    let nextFollowing = existing.following;
    let nextFollowRequests = existing.followRequests;
    let nextFollowingIds = existing.followingIds;
    let nextRequestedIds = existing.requestedIds;

    // On initial owner workspace hydration (before any server-side social mutation),
    // merge persisted follower/following relationships from the owner's Firestore workspace.
    if (!existing.workspaceHydrated && !existing.socialMutated) {
      if (Array.isArray(payload.followers) && payload.followers.length > 0) {
        const byId = new Map<string, FollowUser>();
        for (const f of [...existing.followers, ...payload.followers]) {
          if (f && f.id && !byId.has(f.id)) {
            byId.set(f.id, f);
          }
        }
        nextFollowers = [...byId.values()];
      }
      if (Array.isArray(payload.following) && payload.following.length > 0) {
        const byId = new Map<string, FollowUser>();
        for (const f of [...existing.following, ...payload.following]) {
          if (f && f.id && !byId.has(f.id)) {
            byId.set(f.id, f);
          }
        }
        nextFollowing = [...byId.values()];
      }
      if (Array.isArray(payload.followingIds) && payload.followingIds.length > 0) {
        nextFollowingIds = Array.from(
          new Set([...existing.followingIds, ...payload.followingIds.filter(Boolean)])
        );
      } else if (nextFollowing.length > 0 && nextFollowingIds.length === 0) {
        nextFollowingIds = nextFollowing.map((u) => u.id);
      }
      if (Array.isArray(payload.requestedIds) && payload.requestedIds.length > 0) {
        nextRequestedIds = Array.from(
          new Set([...existing.requestedIds, ...payload.requestedIds.filter(Boolean)])
        );
      }
      if (Array.isArray(payload.followRequests) && payload.followRequests.length > 0) {
        const byId = new Map<string, FollowRequest>();
        for (const r of [...existing.followRequests, ...payload.followRequests]) {
          if (r && r.id && !byId.has(r.id)) {
            byId.set(r.id, r);
          }
        }
        nextFollowRequests = [...byId.values()];
      }
    }

    const hasExplicitSocialArrays =
      Boolean(existing.socialMutated) ||
      Boolean(existing.workspaceHydrated) ||
      Array.isArray(payload.followers) ||
      Array.isArray(payload.following) ||
      Array.isArray(payload.followingIds);

    const authoritativeFollowersCount =
      hasExplicitSocialArrays || nextFollowers.length > 0
        ? nextFollowers.length
        : Math.max(0, Number(incomingProfile.followersCount) || 0);
    const authoritativeFollowingCount =
      hasExplicitSocialArrays || nextFollowingIds.length > 0
        ? nextFollowingIds.length
        : Math.max(0, Number(incomingProfile.followingCount) || 0);

    const updatedProfile: UserProfile = {
      ...existing.profile,
      ...incomingProfile,
      id: uid,
      isPrivate,
      showCommentsOnProfile: Boolean(privacySettings.showCommentsOnProfile),
      privacySettings,
      followersCount: authoritativeFollowersCount,
      followingCount: authoritativeFollowingCount,
    };

    let nextNotifications = existing.notifications;
    if (Array.isArray(payload.notifications) && payload.notifications.length > 0) {
      const clientById = new Map<string, NotificationItem>();
      for (const n of payload.notifications) {
        if (n && typeof n.id === 'string' && n.id) {
          clientById.set(n.id, n);
        }
      }
      if (!existing.workspaceHydrated && existing.notifications.length === 0) {
        nextNotifications = payload.notifications.filter((n) => Boolean(n && n.id));
      } else {
        nextNotifications = existing.notifications.map((serverNotif) => {
          const clientNotif = clientById.get(serverNotif.id);
          if (!clientNotif) return serverNotif;
          return {
            ...serverNotif,
            isRead: Boolean(serverNotif.isRead || clientNotif.isRead),
            ...(serverNotif.handled || clientNotif.handled
              ? { handled: serverNotif.handled || clientNotif.handled }
              : {}),
          };
        });
      }
    }

    const nextRecord: StoredUserRecord = {
      ...existing,
      uid,
      profile: updatedProfile,
      animes: nextAnimes,
      favoriteCharacters: Array.isArray(payload.favoriteCharacters)
        ? payload.favoriteCharacters
        : existing.favoriteCharacters,
      favoriteCompanies: Array.isArray(payload.favoriteCompanies)
        ? payload.favoriteCompanies
        : existing.favoriteCompanies,
      favoritePeople: Array.isArray(payload.favoritePeople)
        ? payload.favoritePeople
        : existing.favoritePeople,
      activities: Array.isArray(payload.activities) ? payload.activities : existing.activities,
      comments: Array.isArray(payload.comments) ? payload.comments : existing.comments,
      followers: nextFollowers,
      following: nextFollowing,
      followRequests: nextFollowRequests,
      followingIds: nextFollowingIds,
      requestedIds: nextRequestedIds,
      blockedIds: Array.isArray(payload.blockedIds) ? payload.blockedIds : existing.blockedIds,
      notifications: nextNotifications,
      updatedAtMs: Math.max(existing.updatedAtMs, Number(payload.updatedAtMs) || Date.now()),
      workspaceHydrated: true,
    };

    if (prevUsername && prevUsername !== updatedProfile.username.toLowerCase()) {
      if (this.usernameIndex.get(prevUsername) === uid) {
        this.usernameIndex.delete(prevUsername);
      }
    }
    if (updatedProfile.username) {
      this.usernameIndex.set(updatedProfile.username.toLowerCase(), uid);
    }

    this.users.set(uid, nextRecord);
    this.saveToDisk();
    return nextRecord;
  }

  /**
   * Resolves a profile view enforcing strict backend Zero-Trust privacy:
   * - Owner (`callerUid === target.uid`) always accesses 100% of their own data.
   * - Private profile (`target.profile.isPrivate === true`) blocks ALL other users (`callerUid !== target.uid`).
   * - Public profile (`target.profile.isPrivate === false`) exposes ONLY the sections authorized by `privacySettings`.
   */
  public getAuthorizedProfileView(
    idOrUsername: string,
    callerUid: string | null,
    pagination?: { offset?: number; limit?: number }
  ): PublicProfileResponsePayload | PrivateBlockedProfilePayload | null {
    const record = this.getUserRecord(idOrUsername);
    if (!record) return null;

    const isOwner = Boolean(callerUid && callerUid === record.uid);
    const offset = Math.max(0, Math.floor(pagination?.offset ?? 0));
    const limit = Math.min(2500, Math.max(1, Math.floor(pagination?.limit ?? 1000)));

    if (isOwner) {
      const slice = record.animes.slice(offset, offset + limit);
      const hasMore = offset + slice.length < record.animes.length;
      return {
        isOwner: true,
        isPrivateBlocked: false,
        profile: record.profile,
        animeStats: computeAnimeStats(record.animes),
        totalAnimes: record.animes.length,
        animes: slice,
        hasMoreAnimes: hasMore,
        nextAnimeOffset: hasMore ? offset + slice.length : null,
        favoriteCharacters: record.favoriteCharacters,
        favoriteCompanies: record.favoriteCompanies,
        favoritePeople: record.favoritePeople,
        activities: record.activities,
        comments: record.comments,
        followers: record.followers,
        following: record.following,
        updatedAtMs: record.updatedAtMs,
      };
    }

    // Strict backend block for private profiles (applies to direct URLs, API queries, and previous followers)
    if (record.profile.isPrivate) {
      return {
        isOwner: false,
        isPrivateBlocked: true,
        error: 'Este perfil é privado. O acesso aos dados e listas está bloqueado.',
        code: 'PRIVATE_PROFILE',
        profileStub: buildPublicProfileStubForPrivateUser(record.profile),
      };
    }

    const safeHeader = sanitizePublicProfileHeader(record.profile);
    const showAnimeList = safeHeader.privacySettings?.showAnimeList !== false;
    const showFavorites = safeHeader.privacySettings?.showFavorites !== false;
    const showActivity = safeHeader.privacySettings?.showActivity !== false;
    const showComments = safeHeader.privacySettings?.showCommentsOnProfile !== false;

    const authorizedAnimes = showAnimeList
      ? record.animes.map((a) => sanitizePublicAnimeEntry(a, showFavorites))
      : [];
    const slice = authorizedAnimes.slice(offset, offset + limit);
    const hasMore = offset + slice.length < authorizedAnimes.length;

    return {
      isOwner: false,
      isPrivateBlocked: false,
      profile: safeHeader,
      animeStats: showAnimeList ? computeAnimeStats(authorizedAnimes) : EMPTY_ANIME_STATS,
      totalAnimes: authorizedAnimes.length,
      animes: slice,
      hasMoreAnimes: hasMore,
      nextAnimeOffset: hasMore ? offset + slice.length : null,
      favoriteCharacters: showFavorites ? record.favoriteCharacters : [],
      favoriteCompanies: showFavorites ? record.favoriteCompanies : [],
      favoritePeople: showFavorites ? record.favoritePeople : [],
      activities: showActivity
        ? filterActivitiesForViewer(record.activities, false, {
            isPrivate: false,
            showActivity: true,
          })
        : [],
      comments: showComments ? record.comments : [],
      followers: record.followers.map((f) => ({
        ...f,
        isBlocked: false,
      })),
      following: record.following.map((f) => ({
        ...f,
        isBlocked: false,
      })),
      updatedAtMs: record.updatedAtMs,
    };
  }

  /**
   * Searches discoverable user profiles by username or displayName.
   * Private profiles only expose minimal identity stubs (never bio, banner, or content).
   */
  public searchProfiles(queryText: string, limit = 10): UserProfile[] {
    const cleanTerm = normalizeSearchTerm(queryText);
    if (!cleanTerm) return [];

    const scored: Array<{ profile: UserProfile; score: number }> = [];
    for (const record of this.users.values()) {
      const p = record.profile;
      const normUser = normalizeSearchTerm(p.username || '');
      const normName = normalizeSearchTerm(p.displayName || '');

      let score = 0;
      if (normUser === cleanTerm) score += 200;
      else if (normUser.startsWith(cleanTerm)) score += 100;
      else if (normUser.includes(cleanTerm)) score += 50;

      if (normName === cleanTerm) score += 150;
      else if (normName.startsWith(cleanTerm)) score += 80;
      else if (normName.includes(cleanTerm)) score += 40;

      if (score > 0) {
        scored.push({
          profile: sanitizePublicProfileHeader(p),
          score,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(20, Math.max(1, limit))).map((s) => s.profile);
  }

  /**
   * Executes an idempotent follow or follow-request from `followerUid` to `targetUid`,
   * delivering deduplicated `new_follower` (including follow-back!) or `follow_request` notifications.
   */
  public followUser(
    followerUid: string,
    targetIdOrUsername: string,
    followerSummary?: Partial<Pick<UserProfile, 'username' | 'displayName' | 'avatarUrl'>>,
    targetSummary?: Partial<Pick<UserProfile, 'username' | 'displayName' | 'avatarUrl' | 'isPrivate'>>
  ): {
    status: 'following' | 'requested' | 'already_following' | 'already_requested';
    isFollowBack: boolean;
    followerRecord: StoredUserRecord;
    targetFollowersCount: number;
    deliveredNotification: NotificationItem | null;
  } {
    const existingTarget = this.getUserRecord(targetIdOrUsername);
    const targetUid = existingTarget ? existingTarget.uid : targetIdOrUsername.trim();
    if (!targetUid || followerUid === targetUid) {
      throw new Error('Operação de seguir inválida.');
    }

    const follower = this.users.get(followerUid) ?? createMinimalUserRecord(followerUid, followerSummary);
    if (followerSummary?.username && follower.profile.username.startsWith('user_')) {
      follower.profile.username = followerSummary.username;
    }
    if (followerSummary?.displayName && follower.profile.displayName.startsWith('user_')) {
      follower.profile.displayName = followerSummary.displayName;
    }
    if (followerSummary?.avatarUrl && !follower.profile.avatarUrl) {
      follower.profile.avatarUrl = followerSummary.avatarUrl;
    }
    this.users.set(followerUid, follower);
    if (follower.profile.username) {
      this.usernameIndex.set(follower.profile.username.toLowerCase(), followerUid);
    }

    const target = existingTarget ?? createMinimalUserRecord(targetUid, targetSummary);
    this.users.set(targetUid, target);
    if (target.profile.username) {
      this.usernameIndex.set(target.profile.username.toLowerCase(), targetUid);
    }

    if (target.blockedIds.includes(followerUid) || follower.blockedIds.includes(targetUid)) {
      throw new Error('Não é possível seguir este usuário.');
    }

    const nowMs = Date.now();

    // Already following -> strictly idempotent, zero duplicate notifications
    if (follower.followingIds.includes(targetUid) || target.followers.some((f) => f.id === followerUid)) {
      if (!follower.followingIds.includes(targetUid)) {
        follower.followingIds.push(targetUid);
      }
      return {
        status: 'already_following',
        isFollowBack: target.followingIds.includes(followerUid),
        followerRecord: follower,
        targetFollowersCount: target.profile.followersCount,
        deliveredNotification: null,
      };
    }

    // Private profile -> create deduplicated follow request + follow_request notification
    if (target.profile.isPrivate) {
      const requestId = `req_${followerUid}_${targetUid}`;
      const alreadyRequested =
        follower.requestedIds.includes(targetUid) ||
        target.followRequests.some((r) => r.user.id === followerUid);

      if (alreadyRequested) {
        if (!follower.requestedIds.includes(targetUid)) {
          follower.requestedIds.push(targetUid);
        }
        return {
          status: 'already_requested',
          isFollowBack: false,
          followerRecord: follower,
          targetFollowersCount: target.profile.followersCount,
          deliveredNotification: null,
        };
      }

      follower.requestedIds = [targetUid, ...follower.requestedIds.filter((id) => id !== targetUid)];
      const reqUser: FollowUser = {
        id: followerUid,
        username: follower.profile.username,
        displayName: follower.profile.displayName,
        avatarUrl: follower.profile.avatarUrl || '',
        bio: follower.profile.bio || '',
        isFollowing: target.followingIds.includes(followerUid),
        isRequested: false,
        isFollower: false,
        isBlocked: false,
        createdAt: follower.profile.createdAt,
      };
      target.followRequests = [
        {
          id: requestId,
          user: reqUser,
          requestedAt: 'Agora',
        },
        ...target.followRequests.filter((r) => r.user.id !== followerUid),
      ];

      const notifId = `notif_req_${followerUid}_${targetUid}`;
      const existingNotifIdx = target.notifications.findIndex((n) => n.id === notifId);
      let delivered: NotificationItem | null = null;
      if (existingNotifIdx === -1 || Boolean(target.notifications[existingNotifIdx]?.handled)) {
        const createdNotif: NotificationItem = {
          id: notifId,
          type: 'follow_request',
          actor: {
            id: followerUid,
            username: follower.profile.username,
            displayName: follower.profile.displayName,
            avatarUrl: follower.profile.avatarUrl || '',
          },
          message: 'enviou uma solicitação para seguir seu perfil privado.',
          createdAt: 'Agora',
          isRead: false,
          contextData: { requestId },
        };
        delivered = createdNotif;
        target.notifications = [
          createdNotif,
          ...target.notifications.filter((n) => n.id !== notifId),
        ];
      }

      follower.socialMutated = true;
      target.socialMutated = true;
      follower.updatedAtMs = nowMs;
      target.updatedAtMs = nowMs;
      this.saveToDisk();

      return {
        status: 'requested',
        isFollowBack: false,
        followerRecord: follower,
        targetFollowersCount: target.profile.followersCount,
        deliveredNotification: delivered,
      };
    }

    // Public profile -> establish follow immediately
    const isFollowBack =
      target.followingIds.includes(followerUid) ||
      follower.followers.some((f) => f.id === targetUid);

    follower.followingIds = [targetUid, ...follower.followingIds.filter((id) => id !== targetUid)];
    follower.requestedIds = follower.requestedIds.filter((id) => id !== targetUid);

    const targetAsFollowUser: FollowUser = {
      id: targetUid,
      username: target.profile.username,
      displayName: target.profile.displayName,
      avatarUrl: target.profile.avatarUrl || '',
      bio: target.profile.isPrivate ? '' : target.profile.bio || '',
      isFollowing: true,
      isRequested: false,
      isFollower: isFollowBack,
      isBlocked: false,
      createdAt: target.profile.createdAt,
    };
    follower.following = [
      targetAsFollowUser,
      ...follower.following.filter((u) => u.id !== targetUid),
    ];
    follower.profile.followingCount = follower.followingIds.length;

    // Update mutual flag in follower's followers list if target already followed follower
    follower.followers = follower.followers.map((f) =>
      f.id === targetUid ? { ...f, isFollowing: true } : f
    );

    const followerAsFollowUser: FollowUser = {
      id: followerUid,
      username: follower.profile.username,
      displayName: follower.profile.displayName,
      avatarUrl: follower.profile.avatarUrl || '',
      bio: follower.profile.isPrivate ? '' : follower.profile.bio || '',
      isFollowing: isFollowBack,
      isRequested: false,
      isFollower: true,
      isBlocked: false,
      createdAt: follower.profile.createdAt,
    };
    target.followers = [
      followerAsFollowUser,
      ...target.followers.filter((u) => u.id !== followerUid),
    ];
    target.following = target.following.map((u) =>
      u.id === followerUid ? { ...u, isFollower: true } : u
    );
    target.profile.followersCount = target.followers.length;

    // Deterministic notification ID prevents duplicate notifications for the same relationship
    const notifId = isFollowBack
      ? `notif_follow_back_${followerUid}_${targetUid}`
      : `notif_follow_${followerUid}_${targetUid}`;
    const notifMessage = isFollowBack
      ? 'seguiu você de volta.'
      : 'começou a seguir você.';

    let delivered: NotificationItem | null = null;
    const alreadyHasNotif = target.notifications.some((n) => n.id === notifId);
    if (!alreadyHasNotif) {
      const createdNotif: NotificationItem = {
        id: notifId,
        type: 'new_follower',
        actor: {
          id: followerUid,
          username: follower.profile.username,
          displayName: follower.profile.displayName,
          avatarUrl: follower.profile.avatarUrl || '',
        },
        message: notifMessage,
        createdAt: 'Agora',
        isRead: false,
      };
      delivered = createdNotif;
      target.notifications = [createdNotif, ...target.notifications];
    }

    follower.socialMutated = true;
    target.socialMutated = true;
    follower.updatedAtMs = nowMs;
    target.updatedAtMs = nowMs;
    this.saveToDisk();

    return {
      status: 'following',
      isFollowBack,
      followerRecord: follower,
      targetFollowersCount: target.profile.followersCount,
      deliveredNotification: delivered,
    };
  }

  public unfollowUser(
    followerUid: string,
    targetIdOrUsername: string
  ): {
    followerRecord: StoredUserRecord | null;
    targetFollowersCount: number;
  } {
    const follower = this.users.get(followerUid) ?? null;
    const target = this.getUserRecord(targetIdOrUsername);
    const targetUid = target ? target.uid : targetIdOrUsername.trim();
    const nowMs = Date.now();

    if (follower) {
      follower.followingIds = follower.followingIds.filter((id) => id !== targetUid);
      follower.requestedIds = follower.requestedIds.filter((id) => id !== targetUid);
      follower.following = follower.following.filter((u) => u.id !== targetUid);
      follower.followers = follower.followers.map((f) =>
        f.id === targetUid ? { ...f, isFollowing: false } : f
      );
      follower.profile.followingCount = follower.followingIds.length;
      follower.socialMutated = true;
      follower.updatedAtMs = nowMs;
    }

    let targetFollowersCount = 0;
    if (target) {
      target.followers = target.followers.filter((u) => u.id !== followerUid);
      target.followRequests = target.followRequests.filter((r) => r.user.id !== followerUid);
      target.following = target.following.map((u) =>
        u.id === followerUid ? { ...u, isFollower: false } : u
      );
      target.profile.followersCount = target.followers.length;
      target.socialMutated = true;
      target.updatedAtMs = nowMs;
      targetFollowersCount = target.profile.followersCount;
    }

    this.saveToDisk();
    return {
      followerRecord: follower,
      targetFollowersCount,
    };
  }

  public removeFollower(
    ownerUid: string,
    followerIdOrUsername: string
  ): {
    ownerRecord: StoredUserRecord | null;
    ownerFollowersCount: number;
  } {
    const followerRec = this.getUserRecord(followerIdOrUsername);
    const followerUid = followerRec ? followerRec.uid : followerIdOrUsername.trim();
    const res = this.unfollowUser(followerUid, ownerUid);
    return {
      ownerRecord: this.users.get(ownerUid) ?? null,
      ownerFollowersCount: res.targetFollowersCount,
    };
  }

  public respondToFollowRequest(
    ownerUid: string,
    requestId: string,
    action: 'accept' | 'reject'
  ): { ownerRecord: StoredUserRecord } {
    const owner = this.users.get(ownerUid);
    if (!owner) {
      throw new Error('Perfil não encontrado.');
    }

    const reqItem = owner.followRequests.find((r) => r.id === requestId);
    const nowMs = Date.now();

    owner.followRequests = owner.followRequests.filter((r) => r.id !== requestId);
    owner.notifications = owner.notifications.map((n) =>
      n.contextData?.requestId === requestId
        ? { ...n, isRead: true, handled: action === 'accept' ? 'accepted' : 'rejected' }
        : n
    );

    if (reqItem) {
      const requesterUid = reqItem.user.id;
      const requester = this.users.get(requesterUid) ?? createMinimalUserRecord(requesterUid, reqItem.user);
      requester.requestedIds = requester.requestedIds.filter((id) => id !== ownerUid);

      if (action === 'accept') {
        const isMutual = owner.followingIds.includes(requesterUid);
        const acceptedFollower: FollowUser = {
          ...reqItem.user,
          isFollowing: isMutual,
          isFollower: true,
          isRequested: false,
        };
        owner.followers = [
          acceptedFollower,
          ...owner.followers.filter((u) => u.id !== requesterUid),
        ];
        owner.profile.followersCount = owner.followers.length;

        requester.followingIds = [
          ownerUid,
          ...requester.followingIds.filter((id) => id !== ownerUid),
        ];
        requester.following = [
          {
            id: ownerUid,
            username: owner.profile.username,
            displayName: owner.profile.displayName,
            avatarUrl: owner.profile.avatarUrl || '',
            bio: '',
            isFollowing: true,
            isRequested: false,
            isFollower: isMutual,
            isBlocked: false,
            createdAt: owner.profile.createdAt,
          },
          ...requester.following.filter((u) => u.id !== ownerUid),
        ];
        requester.profile.followingCount = requester.followingIds.length;

        const acceptedNotifId = `notif_accepted_${ownerUid}_${requesterUid}`;
        if (!requester.notifications.some((n) => n.id === acceptedNotifId)) {
          requester.notifications = [
            {
              id: acceptedNotifId,
              type: 'request_accepted',
              actor: {
                id: ownerUid,
                username: owner.profile.username,
                displayName: owner.profile.displayName,
                avatarUrl: owner.profile.avatarUrl || '',
              },
              message: 'aceitou sua solicitação para seguir.',
              createdAt: 'Agora',
              isRead: false,
            },
            ...requester.notifications,
          ];
        }
      }

      requester.updatedAtMs = nowMs;
      this.users.set(requesterUid, requester);
    }

    owner.updatedAtMs = nowMs;
    this.saveToDisk();
    return { ownerRecord: owner };
  }

  public getNotificationsState(ownerUid: string): {
    notifications: NotificationItem[];
    unreadCount: number;
    followers: FollowUser[];
    following: FollowUser[];
    followRequests: FollowRequest[];
    followingIds: string[];
    requestedIds: string[];
    followersCount: number;
    followingCount: number;
  } {
    const rec = this.users.get(ownerUid);
    if (!rec) {
      return {
        notifications: [],
        unreadCount: 0,
        followers: [],
        following: [],
        followRequests: [],
        followingIds: [],
        requestedIds: [],
        followersCount: 0,
        followingCount: 0,
      };
    }
    let unreadCount = 0;
    for (const n of rec.notifications) {
      if (!n.isRead) unreadCount++;
    }
    return {
      notifications: rec.notifications,
      unreadCount,
      followers: rec.followers,
      following: rec.following,
      followRequests: rec.followRequests,
      followingIds: rec.followingIds,
      requestedIds: rec.requestedIds,
      followersCount: rec.profile.followersCount,
      followingCount: rec.profile.followingCount,
    };
  }

  public markNotificationsRead(
    ownerUid: string,
    options: { notificationId?: string; notificationIds?: string[]; markAll?: boolean }
  ): { notifications: NotificationItem[]; unreadCount: number } {
    const rec = this.users.get(ownerUid);
    if (!rec) {
      return { notifications: [], unreadCount: 0 };
    }

    if (options.markAll) {
      rec.notifications = rec.notifications.map((n) => (n.isRead ? n : { ...n, isRead: true }));
    } else if (Array.isArray(options.notificationIds) && options.notificationIds.length > 0) {
      const idSet = new Set(options.notificationIds);
      rec.notifications = rec.notifications.map((n) =>
        idSet.has(n.id) ? { ...n, isRead: true } : n
      );
    } else if (options.notificationId) {
      rec.notifications = rec.notifications.map((n) =>
        n.id === options.notificationId ? { ...n, isRead: true } : n
      );
    }

    rec.updatedAtMs = Date.now();
    this.saveToDisk();

    let unreadCount = 0;
    for (const n of rec.notifications) {
      if (!n.isRead) unreadCount++;
    }
    return { notifications: rec.notifications, unreadCount };
  }

  public mergeExternalNotifications(
    ownerUid: string,
    external: NotificationItem[]
  ): NotificationItem[] {
    const rec = this.users.get(ownerUid);
    if (!Array.isArray(external) || external.length === 0) {
      return rec ? rec.notifications : [];
    }
    const byId = new Map<string, NotificationItem>();
    const currentList = rec ? rec.notifications : [];
    for (const item of [...currentList, ...external]) {
      if (!item || !item.id) continue;
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, item);
      } else {
        byId.set(item.id, {
          ...existing,
          ...item,
          isRead: Boolean(existing.isRead || item.isRead),
          ...(existing.handled || item.handled
            ? { handled: existing.handled || item.handled }
            : {}),
        });
      }
    }
    const merged = [...byId.values()];
    if (rec) {
      rec.notifications = merged;
      this.saveToDisk();
    }
    return merged;
  }

  public submitProfileReport(input: {
    id?: string;
    targetId: string;
    targetUsername?: string;
    targetDisplayName?: string;
    reporterUid: string;
    reporterUsername?: string;
    reporterDisplayName?: string;
    reason: string;
    details?: string;
  }): StoredProfileReport {
    const cleanTargetId = String(input.targetId || '').trim();
    const cleanReporterUid = String(input.reporterUid || '').trim();
    if (!cleanTargetId || !cleanReporterUid || cleanTargetId === cleanReporterUid) {
      throw new Error('Operação de denúncia inválida.');
    }

    const targetRec = this.getUserRecord(cleanTargetId);
    const reporterRec = this.getUserRecord(cleanReporterUid);
    const resolvedTargetId = targetRec ? targetRec.uid : cleanTargetId;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const report: StoredProfileReport = {
      id:
        input.id && input.id.trim()
          ? input.id.trim()
          : `rep_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
      targetType: 'profile',
      targetId: resolvedTargetId,
      targetUsername:
        input.targetUsername ||
        targetRec?.profile.username ||
        undefined,
      targetDisplayName:
        input.targetDisplayName ||
        targetRec?.profile.displayName ||
        undefined,
      reporterUid: cleanReporterUid,
      reporterUsername:
        input.reporterUsername ||
        reporterRec?.profile.username ||
        undefined,
      reporterDisplayName:
        input.reporterDisplayName ||
        reporterRec?.profile.displayName ||
        undefined,
      reason: String(input.reason || '').trim().slice(0, 80),
      details: String(input.details || '').trim().slice(0, 1000),
      status: 'pending',
      createdAt: nowIso,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };

    this.reports = [report, ...this.reports.filter((r) => r.id !== report.id)].slice(0, 500);
    this.saveToDisk();
    return report;
  }

  public mergeExternalProfileReports(external: StoredProfileReport[]): StoredProfileReport[] {
    if (!Array.isArray(external) || external.length === 0) {
      return this.getProfileReports();
    }
    const byId = new Map<string, StoredProfileReport>();
    for (const item of [...this.reports, ...external]) {
      if (!item || !item.id || !item.targetId) continue;
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, item);
      } else {
        const existingUpdated = existing.updatedAtMs ?? existing.createdAtMs ?? 0;
        const incomingUpdated = item.updatedAtMs ?? item.createdAtMs ?? 0;
        byId.set(
          item.id,
          incomingUpdated >= existingUpdated ? { ...existing, ...item } : { ...item, ...existing }
        );
      }
    }
    this.reports = [...byId.values()].sort(
      (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
    );
    this.saveToDisk();
    return this.reports;
  }

  public getProfileReports(limit = 100): StoredProfileReport[] {
    return [...this.reports]
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .slice(0, Math.max(1, limit));
  }

  public updateProfileReportStatus(
    reportId: string,
    status: 'pending' | 'in_review' | 'resolved' | 'dismissed'
  ): StoredProfileReport | null {
    const cleanId = String(reportId || '').trim();
    if (!cleanId) return null;
    const idx = this.reports.findIndex((r) => r.id === cleanId);
    if (idx === -1) return null;
    const updated: StoredProfileReport = {
      ...this.reports[idx],
      status,
      updatedAtMs: Date.now(),
    };
    this.reports[idx] = updated;
    this.saveToDisk();
    return updated;
  }
}

export const socialStore = new SocialStore();
