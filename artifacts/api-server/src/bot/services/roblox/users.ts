import {
  getUsersUserid,
  getUsersSearch,
  getUsersUseridUsernameHistory,
  postUsernamesUsers,
} from "rozod/endpoints/usersv1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import { RobloxServiceError } from "./errors";
import { withFallback } from "./providers/fallback";
import { rbxianUserByName, rbxianUserDetails } from "./providers/robloxian";
import type { RobloxUser, RobloxUserSearchHit } from "./types";

function mapUser(raw: {
  id: number;
  name: string;
  displayName: string;
  description?: string | null;
  created?: string | null;
  isBanned?: boolean;
  hasVerifiedBadge?: boolean;
}): RobloxUser {
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.displayName || raw.name,
    description: raw.description ?? "",
    created: raw.created ?? null,
    isBanned: Boolean(raw.isBanned),
    hasVerifiedBadge: Boolean(raw.hasVerifiedBadge),
  };
}

export async function getUserById(userId: number): Promise<RobloxUser> {
  const key = `user:${userId}`;
  const cached = robloxCache.get<RobloxUser>(key);
  if (cached) return cached;

  const user = await withFallback(
    `user:${userId}`,
    async () => {
      const raw = await rbxFetch(getUsersUserid, { userId });
      return mapUser(raw as Parameters<typeof mapUser>[0]);
    },
    async () => {
      const d = await rbxianUserDetails(userId);
      if (!d?.id) throw new RobloxServiceError("not_found", `user ${userId}`);
      return mapUser({
        id: Number(d.id),
        name: String(d.name ?? d.username ?? userId),
        displayName: String(d.displayName ?? d.name ?? d.username ?? userId),
        description: d.description ?? "",
        created: d.created ?? d.joinDate ?? null,
        isBanned: Boolean(d.isBanned ?? d.IsBanned),
        hasVerifiedBadge: Boolean(d.hasVerifiedBadge),
      });
    }
  );
  return robloxCache.set(key, user, TTL.user);
}

export async function resolveUsername(username: string): Promise<RobloxUser> {
  const cleaned = username.trim().replace(/^@/, "");
  if (!cleaned) throw new RobloxServiceError("invalid", "empty username");

  if (/^\d+$/.test(cleaned)) {
    return getUserById(Number(cleaned));
  }

  const key = `username:${cleaned.toLowerCase()}`;
  const cachedId = robloxCache.get<number>(key);
  if (cachedId) return getUserById(cachedId);

  const hit = await withFallback(
    `resolve:${cleaned}`,
    async () => {
      const result = await rbxFetch(postUsernamesUsers, {
        body: { usernames: [cleaned], excludeBannedUsers: false },
      });
      const data = (result as { data?: Array<{ id: number; name: string }> }).data ?? [];
      const row = data[0];
      if (!row?.id) throw new RobloxServiceError("not_found", `username ${cleaned}`);
      return row.id as number;
    },
    async () => {
      const u = await rbxianUserByName(cleaned);
      if (!u?.id) throw new RobloxServiceError("not_found", `username ${cleaned}`);
      return Number(u.id);
    }
  );

  robloxCache.set(key, hit, TTL.userId);
  return getUserById(hit);
}

export async function searchUsers(
  keyword: string,
  limit: 10 | 25 = 10
): Promise<RobloxUserSearchHit[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];

  const key = `search:${q.toLowerCase()}:${limit}`;
  const cached = robloxCache.get<RobloxUserSearchHit[]>(key);
  if (cached) return cached;

  try {
    const result = await rbxFetch(getUsersSearch, { keyword: q, limit });
    const data =
      (result as {
        data?: Array<{
          id: number;
          name: string;
          displayName: string;
          hasVerifiedBadge?: boolean;
          previousUsernames?: string[];
        }>;
      }).data ?? [];

    const hits: RobloxUserSearchHit[] = data.map((u) => ({
      id: u.id,
      name: u.name,
      displayName: u.displayName || u.name,
      hasVerifiedBadge: Boolean(u.hasVerifiedBadge),
      previousUsernames: u.previousUsernames ?? [],
    }));
    return robloxCache.set(key, hits, TTL.search);
  } catch {
    return robloxCache.get<RobloxUserSearchHit[]>(key) ?? [];
  }
}

export async function getUsernameHistory(
  userId: number,
  limit: 10 | 25 | 50 = 25
): Promise<string[]> {
  const key = `history:${userId}:${limit}`;
  const cached = robloxCache.get<string[]>(key);
  if (cached) return cached;

  const result = await rbxFetch(getUsersUseridUsernameHistory, {
    userId,
    limit,
    sortOrder: "Desc",
  });
  const names =
    (result as { data?: Array<{ name: string }> }).data?.map((x) => x.name) ?? [];
  return robloxCache.set(key, names, TTL.history);
}
