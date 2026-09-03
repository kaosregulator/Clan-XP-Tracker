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
import type { PageResult, RobloxFriend } from "./types";

interface FriendRaw {
  id: number;
  name: string;
  displayName: string;
  hasVerifiedBadge?: boolean;
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
  return friendCountCached(`fc:${userId}`, async () => {
    const r = await rbxFetch(getUsersUseridFriendsCount, { userId });
    return (r as { count: number }).count;
  });
}

export async function getFollowerCount(userId: number): Promise<number> {
  return friendCountCached(`foc:${userId}`, async () => {
    const r = await rbxFetch(getUsersTargetuseridFollowersCount, { targetUserId: userId });
    return (r as { count: number }).count;
  });
}

export async function getFollowingCount(userId: number): Promise<number> {
  return friendCountCached(`fic:${userId}`, async () => {
    const r = await rbxFetch(getUsersTargetuseridFollowingsCount, { targetUserId: userId });
    return (r as { count: number }).count;
  });
}

/** Friends API returns the full list (not cursor-paged). We cache + slice. */
export async function getFriendsPage(
  userId: number,
  page = 0,
  pageSize = 8
): Promise<PageResult<RobloxFriend>> {
  const key = `friends:${userId}`;
  let all = robloxCache.get<FriendRaw[]>(key);
  if (!all) {
    const result = await rbxFetch(getUsersUseridFriends, { userId, userSort: 2 });
    all = ((result as { data?: FriendRaw[] }).data ?? []).slice(0, 500);
    robloxCache.set(key, all, TTL.friends);
  }

  const start = page * pageSize;
  const slice = all.slice(start, start + pageSize);
  const heads = await getHeadshots(slice.map((f) => f.id));
  const items: RobloxFriend[] = slice.map((f) => ({
    id: f.id,
    name: f.name,
    displayName: f.displayName || f.name,
    hasVerifiedBadge: Boolean(f.hasVerifiedBadge),
    headshotUrl: heads.get(f.id) ?? null,
  }));

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
  const data = (result as { data?: FriendRaw[]; nextPageCursor?: string | null }).data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  const heads = await getHeadshots(data.map((f) => f.id));
  const items: RobloxFriend[] = data.map((f) => ({
    id: f.id,
    name: f.name,
    displayName: f.displayName || f.name,
    hasVerifiedBadge: Boolean(f.hasVerifiedBadge),
    headshotUrl: heads.get(f.id) ?? null,
  }));
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
