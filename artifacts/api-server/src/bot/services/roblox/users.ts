import {
  getUsersUserid,
  getUsersSearch,
  getUsersUseridUsernameHistory,
  postUsernamesUsers,
} from "rozod/endpoints/usersv1";
import { rbxFetch, rbxHttp } from "./client";
import { robloxCache, TTL } from "./cache";
import { RobloxServiceError, logRobloxError } from "./errors";
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

/** Roblox usernames: 3–20 chars, letters/numbers/underscore (legacy may have shorter). */
function looksLikeCompleteUsername(q: string): boolean {
  return /^[A-Za-z0-9_]{3,20}$/.test(q);
}

function rankSearchHits(hits: RobloxUserSearchHit[], q: string): RobloxUserSearchHit[] {
  const needle = q.toLowerCase();
  const scoreOf = (hit: RobloxUserSearchHit) => {
    const name = hit.name.toLowerCase();
    const display = hit.displayName.toLowerCase();
    if (name === needle) return 0;
    if (display === needle) return 1;
    if (hit.previousUsernames?.some((p) => p.toLowerCase() === needle)) return 1;
    if (name.startsWith(needle)) return 2;
    if (display.startsWith(needle)) return 3;
    if (name.includes(needle)) return 4;
    if (display.includes(needle)) return 5;
    return 6;
  };
  return [...hits].sort((a, b) => {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sa !== sb) return sa - sb;
    // Prefer the longer progressive match (arteum_kezuman over ArtLover) when both prefix-match.
    if (sa === 2) return b.name.length - a.name.length;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Progressive user search for autocomplete / hubs.
 * - Always refreshes from the current keyword (Art → arte → arteum…).
 * - When the query looks like a full username, also hit POST /v1/usernames/users
 *   so exact handles like arteum_kezuman win over fuzzy "Art…" prefixes.
 * - Falls back to the secondary provider when Roblox search fails.
 */
export async function searchUsers(
  keyword: string,
  limit: 10 | 25 = 10
): Promise<RobloxUserSearchHit[]> {
  const q = keyword.trim().replace(/^@/, "");
  if (q.length < 2) return [];

  // Don't cache aggressively on short prefixes — results should track typing.
  const cacheable = q.length >= 4;
  const key = `search:${q.toLowerCase()}:${limit}`;
  if (cacheable) {
    const cached = robloxCache.get<RobloxUserSearchHit[]>(key);
    if (cached) return cached;
  }

  const byId = new Map<number, RobloxUserSearchHit>();

  // Exact username resolution first when it looks complete.
  if (looksLikeCompleteUsername(q)) {
    try {
      const exact = await resolveUsername(q);
      byId.set(exact.id, {
        id: exact.id,
        name: exact.name,
        displayName: exact.displayName,
        hasVerifiedBadge: exact.hasVerifiedBadge,
        previousUsernames: [],
      });
    } catch {
      /* not an exact hit — keep searching */
    }
  }

  try {
    const result = await rbxFetch(getUsersSearch, {
      keyword: q,
      limit: Math.min(25, Math.max(limit, 10)) as 10 | 25,
    });
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

    for (const u of data) {
      if (byId.has(u.id)) continue;
      byId.set(u.id, {
        id: u.id,
        name: u.name,
        displayName: u.displayName || u.name,
        hasVerifiedBadge: Boolean(u.hasVerifiedBadge),
        previousUsernames: u.previousUsernames ?? [],
      });
    }
  } catch {
    // Secondary provider: try exact-ish name lookup when search is down.
    if (!byId.size) {
      try {
        const u = await rbxianUserByName(q);
        if (u?.id) {
          byId.set(Number(u.id), {
            id: Number(u.id),
            name: String(u.name ?? u.username ?? q),
            displayName: String(u.displayName ?? u.name ?? u.username ?? q),
            hasVerifiedBadge: Boolean(u.hasVerifiedBadge),
            previousUsernames: [],
          });
        }
      } catch {
        /* empty */
      }
    }
  }

  const ranked = rankSearchHits([...byId.values()], q).slice(0, limit);
  if (cacheable && ranked.length) robloxCache.set(key, ranked, TTL.search);
  return ranked;
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

/**
 * Batch-resolve usernames for friend / follower IDs.
 *
 * Roblox's public friends list now returns `{ id, name: "", displayName: "" }`
 * (privacy change). Names must be filled via POST https://users.roblox.com/v1/users
 * (max ~100 ids per call).
 */
export async function getUsersByIds(
  userIds: number[]
): Promise<Map<number, { name: string; displayName: string; hasVerifiedBadge: boolean }>> {
  const out = new Map<number, { name: string; displayName: string; hasVerifiedBadge: boolean }>();
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  const missing: number[] = [];

  for (const id of unique) {
    const cached = robloxCache.get<RobloxUser>(`user:${id}`);
    if (cached) {
      out.set(id, {
        name: cached.name,
        displayName: cached.displayName,
        hasVerifiedBadge: cached.hasVerifiedBadge,
      });
    } else {
      missing.push(id);
    }
  }

  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      // Prefer raw HTTP — same public endpoint RoZod wraps — so empty-name
      // friend rows don't depend on RoZod body typing quirks.
      const result = await rbxHttp<{
        data?: Array<{
          id: number;
          name: string;
          displayName?: string;
          hasVerifiedBadge?: boolean;
          isBanned?: boolean;
        }>;
      }>("https://users.roblox.com/v1/users", {
        method: "POST",
        body: { userIds: chunk, excludeBannedUsers: false },
      });
      for (const row of result.data ?? []) {
        const mapped = mapUser({
          id: row.id,
          name: row.name,
          displayName: row.displayName || row.name,
          isBanned: row.isBanned,
          hasVerifiedBadge: row.hasVerifiedBadge,
        });
        robloxCache.set(`user:${row.id}`, mapped, TTL.user);
        out.set(row.id, {
          name: mapped.name,
          displayName: mapped.displayName,
          hasVerifiedBadge: mapped.hasVerifiedBadge,
        });
      }
    } catch (err) {
      logRobloxError("getUsersByIds", err);
      // Fall through — callers still have ids; names stay placeholders.
    }
  }

  return out;
}
