import {
  getUsersUseridFriends,
  getUsersUseridFriendsCount,
  getUsersTargetuseridFollowers,
  getUsersTargetuseridFollowersCount,
  getUsersTargetuseridFollowings,
  getUsersTargetuseridFollowingsCount,
} from "rozod/endpoints/friendsv1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import { getHeadshots } from "./thumbnails";
import { getUsersByIds } from "./users";
import { RobloxServiceError, logRobloxError } from "./errors";
import type { PageResult, RobloxFriend } from "./types";

interface FriendRaw {
  id: number;
  name: string;
  displayName: string;
  hasVerifiedBadge?: boolean;
}

function assertUserId(userId: number): void {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new RobloxServiceError("invalid", `bad friends userId ${userId}`);
  }
}

async function friendCountCached(
  key: string,
  fetchCount: () => Promise<number>
): Promise<number> {
  const cached = robloxCache.get<number>(key);
  if (cached !== undefined) return cached;
  const count = await fetchCount();
  return robloxCache.set(key, count, TTL.friendCount);
}

export async function getFriendCount(userId: number): Promise<number> {
  assertUserId(userId);
  return friendCountCached(`fc:${userId}`, async () => {
    const r = await rbxFetch(getUsersUseridFriendsCount, { userId });
    return (r as { count: number }).count;
  });
}

export async function getFollowerCount(userId: number): Promise<number> {
  assertUserId(userId);
  return friendCountCached(`foc:${userId}`, async () => {
    const r = await rbxFetch(getUsersTargetuseridFollowersCount, { targetUserId: userId });
    return (r as { count: number }).count;
  });
}

export async function getFollowingCount(userId: number): Promise<number> {
  assertUserId(userId);
  return friendCountCached(`fic:${userId}`, async () => {
    const r = await rbxFetch(getUsersTargetuseridFollowingsCount, { targetUserId: userId });
    return (r as { count: number }).count;
  });
}

function toFriendItems(slice: FriendRaw[], heads: Map<number, string | null>): RobloxFriend[] {
  return slice.map((f) => ({
    id: f.id,
    name: f.name || `User ${f.id}`,
    displayName: f.displayName || f.name || `User ${f.id}`,
    hasVerifiedBadge: Boolean(f.hasVerifiedBadge),
    headshotUrl: heads.get(f.id) ?? null,
  }));
}

/**
 * Roblox privacy change: GET /v1/users/{id}/friends still returns friend ids,
 * but `name` / `displayName` are empty strings. Enrich via POST /v1/users.
 */
async function enrichFriendNames(rows: FriendRaw[]): Promise<FriendRaw[]> {
  const need = rows.filter((f) => !f.name?.trim() || !f.displayName?.trim()).map((f) => f.id);
  if (need.length === 0) return rows;
  const profiles = await getUsersByIds(need);
  return rows.map((f) => {
    const p = profiles.get(f.id);
    if (!p) return f;
    return {
      ...f,
      name: p.name || f.name,
      displayName: p.displayName || f.displayName || p.name,
      hasVerifiedBadge: p.hasVerifiedBadge || Boolean(f.hasVerifiedBadge),
    };
  });
}

/** Friends API returns the full list (not cursor-paged). We cache + slice. */
export async function getFriendsPage(
  userId: number,
  page = 0,
  pageSize = 8
): Promise<PageResult<RobloxFriend>> {
  assertUserId(userId);
  const key = `friends:${userId}`;
  let all = robloxCache.get<FriendRaw[]>(key);
  if (!all) {
    const result = await rbxFetch(getUsersUseridFriends, { userId, userSort: 2 });
    const data = (result as { data?: FriendRaw[] } | null)?.data;
    all = (Array.isArray(data) ? data : [])
      .filter((f) => f && Number.isFinite(f.id) && f.id > 0)
      .slice(0, 500);
    all = await enrichFriendNames(all);
    robloxCache.set(key, all, TTL.friends);
  } else if (all.some((f) => !f.name?.trim())) {
    // Migrate pre-enrichment cache entries (empty names from Roblox privacy change).
    all = await enrichFriendNames(all);
    robloxCache.set(key, all, TTL.friends);
  }

  const start = Math.max(0, page) * pageSize;
  const slice = all.slice(start, start + pageSize);
  const heads = await getHeadshots(slice.map((f) => f.id));
  const items = toFriendItems(slice, heads);

  return {
    items,
    page,
    pageSize,
    total: all.length,
    hasMore: start + pageSize < all.length,
  };
}

async function pagedFollow(
  kind: "followers" | "following",
  userId: number,
  page: number,
  pageSize: 10 | 25 | 50 | 100,
  cursor?: string | null
): Promise<PageResult<RobloxFriend>> {
  assertUserId(userId);
  const endpoint =
    kind === "followers"
      ? getUsersTargetuseridFollowers
      : getUsersTargetuseridFollowings;

  let result;
  try {
    result = await rbxFetch(endpoint, {
      targetUserId: userId,
      limit: pageSize,
      cursor: cursor ?? undefined,
      sortOrder: "Desc",
    });
  } catch (err) {
    // Roblox now requires auth for follower/following *lists* (counts stay public).
    // Surface as auth_required — not a generic "temporarily unavailable".
    if (err instanceof RobloxServiceError && err.kind === "auth_required") {
      throw err;
    }
    logRobloxError(`pagedFollow.${kind}`, err);
    throw err;
  }

  const data = ((result as { data?: FriendRaw[] }).data ?? []).filter(
    (f) => f && Number.isFinite(f.id) && f.id > 0
  );
  const enriched = await enrichFriendNames(data);
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  const heads = await getHeadshots(enriched.map((f) => f.id));
  const items = toFriendItems(enriched, heads);
  return {
    items,
    page,
    pageSize,
    total: items.length + page * pageSize + (next ? pageSize : 0),
    hasMore: Boolean(next),
    nextCursor: next,
  };
}

export function getFollowersPage(
  userId: number,
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxFriend>> {
  return pagedFollow("followers", userId, page, 10, cursor);
}

export function getFollowingPage(
  userId: number,
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxFriend>> {
  return pagedFollow("following", userId, page, 10, cursor);
}
