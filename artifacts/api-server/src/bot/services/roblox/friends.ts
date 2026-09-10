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
import { RobloxServiceError } from "./errors";
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
    robloxCache.set(key, all, TTL.friends);
  }

  const start = Math.max(0, page) * pageSize;
  const slice = all.slice(start, start + pageSize);
  // Soft: never let thumbnails sink the friends list.
  const heads = await getHeadshots(slice.map((f) => f.id)).catch(
    () => new Map<number, string | null>()
  );
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

  const result = await rbxFetch(endpoint, {
    targetUserId: userId,
    limit: pageSize,
    cursor: cursor ?? undefined,
    sortOrder: "Desc",
  });
  const data = ((result as { data?: FriendRaw[] }).data ?? []).filter(
    (f) => f && Number.isFinite(f.id) && f.id > 0
  );
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  const heads = await getHeadshots(data.map((f) => f.id)).catch(
    () => new Map<number, string | null>()
  );
  const items = toFriendItems(data, heads);
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
