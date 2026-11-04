import { auth } from '../lib/firebase';
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
} from '../types';
import type { AnimeStatsSummary } from '../utils/animeStats';

export interface AuthorizedPublicProfilePayload {
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

export interface OwnerSocialNotificationsState {
  notifications: NotificationItem[];
  unreadCount: number;
  followers: FollowUser[];
  following: FollowUser[];
  followRequests: FollowRequest[];
  followingIds: string[];
  requestedIds: string[];
  followersCount: number;
  followingCount: number;
}

export type FetchAuthorizedProfileResult =
  | { status: 'ok'; data: AuthorizedPublicProfilePayload }
  | { status: 'private_blocked'; profileStub: UserProfile | null; message: string }
  | { status: 'not_found' }
  | { status: 'error' };

let socialServiceTestTokenOverride: string | null = null;
let socialServiceBaseUrlOverride = '';

export function configureSocialServiceForTests(options: {
  token?: string | null;
  baseUrl?: string;
}): void {
  if (options.token !== undefined) {
    socialServiceTestTokenOverride = options.token;
  }
  if (options.baseUrl !== undefined) {
    socialServiceBaseUrlOverride = options.baseUrl.replace(/\/+$/, '');
  }
}

async function buildAuthorizedHeaders(includeJsonContentType = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  if (socialServiceTestTokenOverride) {
    headers.Authorization = `Bearer ${socialServiceTestTokenOverride}`;
    return headers;
  }

  if (auth?.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }
    } catch {
      // Fallback without header if token fetch transiently fails
    }
  }

  return headers;
}

function buildApiUrl(pathname: string): string {
  return `${socialServiceBaseUrlOverride}${pathname}`;
}

/**
 * Synchronizes the authenticated owner's profile, privacy settings, anime list, favorites,
 * and activities with the backend social store and returns authoritative follower/notification state.
 */
export async function syncOwnerSocialWorkspace(
  uid: string,
  payload: {
    profile: UserProfile;
    animes?: AnimeItem[];
    animesComplete?: boolean;
    favoriteCharacters?: FavoriteCharacter[];
    favoriteCompanies?: FavoriteCompany[];
    favoritePeople?: FavoritePerson[];
    activities?: UserActivity[];
    comments?: HikariComment[];
    blockedIds?: string[];
    notifications?: NotificationItem[];
    updatedAtMs?: number;
  }
): Promise<(OwnerSocialNotificationsState & { updatedAtMs: number }) | null> {
  const cleanUid = uid.trim();
  if (!cleanUid) return null;

  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return null;

    const res = await fetch(buildApiUrl(`/api/users/${encodeURIComponent(cleanUid)}/sync`), {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok) return null;
    return data as OwnerSocialNotificationsState & { updatedAtMs: number };
  } catch {
    return null;
  }
}

/**
 * Searches registered user profiles across sessions/tabs without exposing private content.
 */
export async function searchRemoteUserProfiles(
  queryText: string,
  limit = 10
): Promise<UserProfile[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  try {
    const params = new URLSearchParams({
      q: trimmed,
      limit: String(limit),
    });
    const headers = await buildAuthorizedHeaders(false);
    const res = await fetch(buildApiUrl(`/api/users/search?${params.toString()}`), {
      headers,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.profiles) ? (data.profiles as UserProfile[]) : [];
  } catch {
    return [];
  }
}

/**
 * Loads a profile (by UID or @username) and automatically paginates through 100% of authorized
 * anime pages so visitors always see the complete exported/imported anime list without truncation,
 * while strictly enforcing HTTP 403 blocking on private profiles.
 */
export async function fetchAuthorizedUserProfileComplete(
  idOrUsername: string
): Promise<FetchAuthorizedProfileResult> {
  const cleanTarget = idOrUsername.trim().replace(/^@+/, '');
  if (!cleanTarget) {
    return { status: 'not_found' };
  }

  try {
    const headers = await buildAuthorizedHeaders(false);
    const pageLimit = 1500;
    const initialRes = await fetch(
      buildApiUrl(
        `/api/users/${encodeURIComponent(cleanTarget)}/profile?offset=0&limit=${pageLimit}`
      ),
      { headers }
    );

    if (initialRes.status === 403) {
      const blockedBody = await initialRes.json().catch(() => ({}));
      return {
        status: 'private_blocked',
        profileStub:
          blockedBody && typeof blockedBody.profileStub === 'object'
            ? (blockedBody.profileStub as UserProfile)
            : null,
        message:
          typeof blockedBody?.error === 'string'
            ? blockedBody.error
            : 'Este perfil é privado.',
      };
    }

    if (initialRes.status === 404) {
      return { status: 'not_found' };
    }

    if (!initialRes.ok) {
      return { status: 'error' };
    }

    const firstPage = (await initialRes.json()) as AuthorizedPublicProfilePayload;
    const allAnimes: AnimeItem[] = Array.isArray(firstPage.animes) ? [...firstPage.animes] : [];
    let hasMore = Boolean(firstPage.hasMoreAnimes);
    let nextOffset = firstPage.nextAnimeOffset;
    const resolvedUid = firstPage.profile.id;
    let safetyPages = 0;

    while (hasMore && typeof nextOffset === 'number' && safetyPages < 50) {
      safetyPages++;
      const pageRes = await fetch(
        buildApiUrl(
          `/api/users/${encodeURIComponent(resolvedUid)}/animes?offset=${nextOffset}&limit=${pageLimit}`
        ),
        { headers }
      );
      if (!pageRes.ok) break;
      const pageData = (await pageRes.json()) as {
        animes?: AnimeItem[];
        hasMore?: boolean;
        nextOffset?: number | null;
      };
      if (Array.isArray(pageData.animes) && pageData.animes.length > 0) {
        allAnimes.push(...pageData.animes);
      } else {
        break;
      }
      hasMore = Boolean(pageData.hasMore);
      nextOffset = typeof pageData.nextOffset === 'number' ? pageData.nextOffset : null;
    }

    return {
      status: 'ok',
      data: {
        ...firstPage,
        animes: allAnimes,
        hasMoreAnimes: false,
        nextAnimeOffset: null,
      },
    };
  } catch {
    return { status: 'error' };
  }
}


export async function submitRemoteProfileReport(
  targetId: string,
  reason: string,
  details = ''
): Promise<{ ok: boolean; duplicate?: boolean; message?: string } | null> {
  const cleanTarget = targetId.trim();
  if (!cleanTarget) return null;
  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return { ok: false, message: 'Entre na sua conta para denunciar um perfil.' };
    const res = await fetch(buildApiUrl(`/api/users/${encodeURIComponent(cleanTarget)}/report`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason, details }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: typeof data?.message === 'string' ? data.message : 'Não foi possível enviar a denúncia.' };
    return { ok: Boolean(data?.ok), duplicate: Boolean(data?.duplicate), message: data?.message };
  } catch {
    return { ok: false, message: 'Falha de conexão ao enviar a denúncia.' };
  }
}

export async function followRemoteUser(
  targetId: string,
  followerSummary?: Partial<Pick<UserProfile, 'username' | 'displayName' | 'avatarUrl'>>,
  targetSummary?: Partial<Pick<UserProfile, 'username' | 'displayName' | 'avatarUrl' | 'isPrivate'>>
): Promise<{
  ok: boolean;
  status: 'following' | 'requested' | 'already_following' | 'already_requested';
  isFollowBack: boolean;
  targetFollowersCount: number;
  deliveredNotificationId: string | null;
  callerSocialState: OwnerSocialNotificationsState;
} | null> {
  const cleanTarget = targetId.trim();
  if (!cleanTarget) return null;

  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return null;

    const res = await fetch(buildApiUrl(`/api/users/${encodeURIComponent(cleanTarget)}/follow`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ followerSummary, targetSummary }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function unfollowRemoteUser(targetId: string): Promise<{
  ok: boolean;
  targetFollowersCount: number;
  callerSocialState: OwnerSocialNotificationsState;
} | null> {
  const cleanTarget = targetId.trim();
  if (!cleanTarget) return null;

  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return null;

    const res = await fetch(buildApiUrl(`/api/users/${encodeURIComponent(cleanTarget)}/unfollow`), {
      method: 'POST',
      headers,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function removeRemoteFollower(followerId: string): Promise<{
  ok: boolean;
  callerSocialState: OwnerSocialNotificationsState;
} | null> {
  const cleanFollower = followerId.trim();
  if (!cleanFollower) return null;

  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return null;

    const res = await fetch(
      buildApiUrl(`/api/users/${encodeURIComponent(cleanFollower)}/remove-follower`),
      {
        method: 'POST',
        headers,
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function respondRemoteFollowRequest(
  requestId: string,
  action: 'accept' | 'reject'
): Promise<(OwnerSocialNotificationsState & { ok: boolean }) | null> {
  const cleanId = requestId.trim();
  if (!cleanId) return null;

  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return null;

    const res = await fetch(
      buildApiUrl(`/api/users/follow-requests/${encodeURIComponent(cleanId)}/respond`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action }),
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchOwnerNotifications(
  uid: string
): Promise<OwnerSocialNotificationsState | null> {
  const cleanUid = uid.trim();
  if (!cleanUid) return null;

  try {
    const headers = await buildAuthorizedHeaders(false);
    if (!headers.Authorization) return null;

    const res = await fetch(
      buildApiUrl(`/api/users/${encodeURIComponent(cleanUid)}/notifications`),
      { headers }
    );
    if (!res.ok) return null;
    return (await res.json()) as OwnerSocialNotificationsState;
  } catch {
    return null;
  }
}

export async function markOwnerNotificationsRead(
  uid: string,
  options: { notificationId?: string; notificationIds?: string[]; markAll?: boolean }
): Promise<{ notifications: NotificationItem[]; unreadCount: number } | null> {
  const cleanUid = uid.trim();
  if (!cleanUid) return null;

  try {
    const headers = await buildAuthorizedHeaders(true);
    if (!headers.Authorization) return null;

    const res = await fetch(
      buildApiUrl(`/api/users/${encodeURIComponent(cleanUid)}/notifications/read`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(options),
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
