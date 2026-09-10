import {
  getUsersAvatar,
  getUsersAvatarBust,
  getUsersAvatar3d,
  getBadgesIcons,
  getGroupsIcons,
  getGamesIcons,
  getGamesMultigetThumbnails,
  getGamePasses,
} from "rozod/endpoints/thumbnailsv1";
import { getUsersUseridCurrentlyWearing } from "rozod/endpoints/avatarv1";
import { rbxFetch, rbxHttp } from "./client";
import { robloxCache, TTL } from "./cache";
import { logRobloxError } from "./errors";
import { rbxianAvatar } from "./providers/robloxian";
import type { RobloxThumbnails } from "./types";

type ThumbRow = { targetId: number; state?: string; imageUrl?: string | null };

/** Short TTL for misses so a transient Pending/Error can recover quickly. */
const MISS_TTL = 30_000;

function pickUrl(rows: ThumbRow[] | undefined, id: number): string | null {
  const row = rows?.find((r) => r.targetId === id);
  if (!row || row.state === "Error" || row.state === "Blocked" || !row.imageUrl) return null;
  return row.imageUrl;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Official headshot multiget via raw HTTP.
 *
 * RoZod's ThumbnailResponse requires `imageUrl: z.string()` and `version: z.string()`.
 * When any row is Pending/Error with null imageUrl, RoZod rejects the *entire* batch.
 * Raw HTTP keeps Completed rows even if siblings are Pending.
 */
async function fetchHeadshotsHttp(userIds: number[]): Promise<ThumbRow[]> {
  if (userIds.length === 0) return [];
  const qs = new URLSearchParams({
    userIds: userIds.join(","),
    size: "150x150",
    format: "Png",
    isCircular: "false",
  });
  const result = await rbxHttp<{ data?: ThumbRow[] }>(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?${qs.toString()}`
  );
  return result.data ?? [];
}

async function fetchOneHeadshot(userId: number): Promise<string | null> {
  try {
    const rows = await fetchHeadshotsHttp([userId]);
    const url = pickUrl(rows, userId);
    if (url) return url;
    const state = rows.find((r) => r.targetId === userId)?.state;
    if (state === "Pending" || state === "TemporarilyUnavailable") {
      await sleep(350);
      const retry = await fetchHeadshotsHttp([userId]);
      const again = pickUrl(retry, userId);
      if (again) return again;
    }
  } catch (err) {
    logRobloxError(`headshot.official.${userId}`, err);
  }

  // Secondary provider hits the same public thumbnails host — useful when the
  // primary batch path flaps, still cookie-less.
  try {
    const url = await rbxianAvatar(userId);
    if (typeof url === "string" && url.startsWith("http")) return url;
  } catch (err) {
    logRobloxError(`headshot.rbxian.${userId}`, err);
  }
  return null;
}

export async function getUserThumbnails(userId: number): Promise<RobloxThumbnails> {
  const key = `thumbs:user:${userId}`;
  const cached = robloxCache.get<RobloxThumbnails>(key);
  if (cached) return cached;

  const [headUrl, bust, full, a3d] = await Promise.all([
    fetchOneHeadshot(userId),
    rbxFetch(getUsersAvatarBust, {
      userIds: [userId],
      size: "420x420",
      format: "Png",
      isCircular: false,
    }).catch(() => null),
    rbxFetch(getUsersAvatar, {
      userIds: [userId],
      size: "720x720",
      format: "Png",
      isCircular: false,
    }).catch(() => null),
    rbxFetch(getUsersAvatar3d, { userId }).catch(() => null),
  ]);

  const thumbs: RobloxThumbnails = {
    headshot: headUrl,
    bust: pickUrl((bust as { data?: ThumbRow[] } | null)?.data, userId),
    fullBody: pickUrl((full as { data?: ThumbRow[] } | null)?.data, userId),
    avatar3d:
      (a3d as { imageUrl?: string | null } | null)?.imageUrl ??
      pickUrl([(a3d as ThumbRow) ?? { targetId: userId }], userId),
  };
  return robloxCache.set(key, thumbs, TTL.thumbnails);
}

export async function getHeadshots(userIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  const missing: number[] = [];
  for (const id of userIds) {
    if (!Number.isFinite(id) || id <= 0) {
      out.set(id, null);
      continue;
    }
    const cached = robloxCache.get<string | null>(`head:${id}`);
    if (cached !== undefined) out.set(id, cached);
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    let data: ThumbRow[] = [];
    let batchOk = false;
    try {
      data = await fetchHeadshotsHttp(chunk);
      batchOk = true;
    } catch (err) {
      logRobloxError("getHeadshots.batch", err);
    }

    const pending: number[] = [];
    const failed: number[] = [];

    if (batchOk) {
      for (const id of chunk) {
        const row = data.find((r) => r.targetId === id);
        const url = pickUrl(data, id);
        if (url) {
          robloxCache.set(`head:${id}`, url, TTL.thumbnails);
          out.set(id, url);
          continue;
        }
        if (row?.state === "Pending" || row?.state === "TemporarilyUnavailable") {
          pending.push(id);
        } else {
          failed.push(id);
        }
      }
    } else {
      failed.push(...chunk);
    }

    // Pending: brief wait, then one more batch for those ids only.
    if (pending.length) {
      await sleep(350);
      try {
        const again = await fetchHeadshotsHttp(pending);
        for (const id of pending) {
          const url = pickUrl(again, id);
          if (url) {
            robloxCache.set(`head:${id}`, url, TTL.thumbnails);
            out.set(id, url);
          } else {
            failed.push(id);
          }
        }
      } catch (err) {
        logRobloxError("getHeadshots.pendingRetry", err);
        failed.push(...pending.filter((id) => !out.has(id)));
      }
    }

    // Per-avatar recovery — never silently discard the whole page of faces.
    for (const id of failed) {
      if (out.has(id)) continue;
      const url = await fetchOneHeadshot(id);
      robloxCache.set(`head:${id}`, url, url ? TTL.thumbnails : MISS_TTL);
      out.set(id, url);
    }
  }
  return out;
}

async function fetchIconBatchHttp(
  kind: "groups" | "badges" | "games" | "gamepasses",
  ids: number[],
  size: string
): Promise<ThumbRow[]> {
  if (ids.length === 0) return [];
  const param =
    kind === "groups"
      ? "groupIds"
      : kind === "badges"
        ? "badgeIds"
        : kind === "games"
          ? "universeIds"
          : "gamePassIds";
  const path =
    kind === "groups"
      ? "/v1/groups/icons"
      : kind === "badges"
        ? "/v1/badges/icons"
        : kind === "games"
          ? "/v1/games/icons"
          : "/v1/game-passes";
  const qs = new URLSearchParams({
    [param]: ids.join(","),
    size,
    format: "Png",
  });
  if (kind === "groups") qs.set("isCircular", "false");
  const result = await rbxHttp<{ data?: ThumbRow[] }>(
    `https://thumbnails.roblox.com${path}?${qs.toString()}`
  );
  return result.data ?? [];
}

export async function getGroupIcons(groupIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (groupIds.length === 0) return out;
  for (let i = 0; i < groupIds.length; i += 100) {
    const chunk = groupIds.slice(i, i + 100);
    try {
      const data = await fetchIconBatchHttp("groups", chunk, "150x150");
      for (const id of chunk) out.set(id, pickUrl(data, id));
    } catch (err) {
      logRobloxError("getGroupIcons", err);
      // Fall back to RoZod only if raw HTTP failed entirely.
      try {
        const result = await rbxFetch(getGroupsIcons, {
          groupIds: chunk,
          size: "150x150",
          format: "Png",
          isCircular: false,
        });
        const data = (result as { data?: ThumbRow[] }).data ?? [];
        for (const id of chunk) out.set(id, pickUrl(data, id));
      } catch {
        for (const id of chunk) out.set(id, null);
      }
    }
  }
  return out;
}

export async function getBadgeIcons(badgeIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (badgeIds.length === 0) return out;
  for (let i = 0; i < badgeIds.length; i += 100) {
    const chunk = badgeIds.slice(i, i + 100);
    try {
      const data = await fetchIconBatchHttp("badges", chunk, "150x150");
      for (const id of chunk) out.set(id, pickUrl(data, id));
    } catch (err) {
      logRobloxError("getBadgeIcons", err);
      try {
        const result = await rbxFetch(getBadgesIcons, {
          badgeIds: chunk,
          size: "150x150",
          format: "Png",
        });
        const data = (result as { data?: ThumbRow[] }).data ?? [];
        for (const id of chunk) out.set(id, pickUrl(data, id));
      } catch {
        for (const id of chunk) out.set(id, null);
      }
    }
  }
  return out;
}

export async function getGameIcon(universeId: number): Promise<string | null> {
  const map = await getGameIcons([universeId]);
  return map.get(universeId) ?? null;
}

/**
 * Batched game-icon lookup. Serves cached ids without a request and fetches the
 * rest in chunks of 100 (Roblox's per-call limit), so a page of games costs one
 * request instead of one per game.
 */
export async function getGameIcons(universeIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  const missing: number[] = [];
  for (const id of universeIds) {
    if (out.has(id)) continue;
    const cached = robloxCache.get<string | null>(`gicon:${id}`);
    if (cached !== undefined) out.set(id, cached);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const data = await fetchIconBatchHttp("games", chunk, "512x512");
      for (const id of chunk) {
        const url = pickUrl(data, id);
        robloxCache.set(`gicon:${id}`, url, url ? TTL.gameThumb : MISS_TTL);
        out.set(id, url);
      }
    } catch (err) {
      logRobloxError("getGameIcons", err);
      try {
        const result = await rbxFetch(getGamesIcons, {
          universeIds: chunk,
          size: "512x512",
          format: "Png",
        });
        const data = (result as { data?: ThumbRow[] }).data;
        for (const id of chunk) {
          const url = pickUrl(data, id);
          robloxCache.set(`gicon:${id}`, url, url ? TTL.gameThumb : MISS_TTL);
          out.set(id, url);
        }
      } catch {
        for (const id of chunk) out.set(id, null);
      }
    }
  }
  return out;
}

export async function getGameThumbnail(universeId: number): Promise<string | null> {
  const key = `gthumb:${universeId}`;
  const cached = robloxCache.get<string | null>(key);
  if (cached !== undefined) return cached;
  try {
    const result = await rbxFetch(getGamesMultigetThumbnails, {
      universeIds: [universeId],
      size: "768x432",
      format: "Png",
      countPerUniverse: 1,
    });
    const data = (result as { data?: Array<{ universeId: number; thumbnails?: ThumbRow[] }> })
      .data ?? [];
    const entry = data.find((d) => d.universeId === universeId);
    const url = entry?.thumbnails?.[0]?.imageUrl ?? null;
    return robloxCache.set(key, url, url ? TTL.gameThumb : MISS_TTL);
  } catch {
    return robloxCache.set(key, null, MISS_TTL);
  }
}

export async function getGamePassIcons(passIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (passIds.length === 0) return out;
  for (let i = 0; i < passIds.length; i += 100) {
    const chunk = passIds.slice(i, i + 100);
    try {
      const data = await fetchIconBatchHttp("gamepasses", chunk, "150x150");
      for (const id of chunk) out.set(id, pickUrl(data, id));
    } catch (err) {
      logRobloxError("getGamePassIcons", err);
      try {
        const result = await rbxFetch(getGamePasses, {
          gamePassIds: chunk,
          size: "150x150",
          format: "Png",
        });
        const data = (result as { data?: ThumbRow[] }).data ?? [];
        for (const id of chunk) out.set(id, pickUrl(data, id));
      } catch {
        for (const id of chunk) out.set(id, null);
      }
    }
  }
  return out;
}

export async function getCurrentlyWearing(userId: number): Promise<number[]> {
  try {
    const result = await rbxFetch(getUsersUseridCurrentlyWearing, { userId });
    return (result as { assetIds?: number[] }).assetIds ?? [];
  } catch {
    return [];
  }
}
