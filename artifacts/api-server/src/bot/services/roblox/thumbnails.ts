import {
  getUsersAvatar,
  getUsersAvatarBust,
  getUsersAvatarHeadshot,
  getUsersAvatar3d,
  getBadgesIcons,
  getGroupsIcons,
  getGamesIcons,
  getGamesMultigetThumbnails,
  getGamePasses,
} from "rozod/endpoints/thumbnailsv1";
import { getUsersUseridCurrentlyWearing } from "rozod/endpoints/avatarv1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import type { RobloxThumbnails } from "./types";

type ThumbRow = { targetId: number; state?: string; imageUrl?: string | null };

function pickUrl(rows: ThumbRow[] | undefined, id: number): string | null {
  const row = rows?.find((r) => r.targetId === id);
  if (!row || row.state === "Error" || !row.imageUrl) return null;
  return row.imageUrl;
}

export async function getUserThumbnails(userId: number): Promise<RobloxThumbnails> {
  const key = `thumbs:user:${userId}`;
  const cached = robloxCache.get<RobloxThumbnails>(key);
  if (cached) return cached;

  const [head, bust, full, a3d] = await Promise.all([
    rbxFetch(getUsersAvatarHeadshot, {
      userIds: [userId],
      size: "420x420",
      format: "Png",
      isCircular: false,
    }).catch(() => null),
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
    headshot: pickUrl((head as { data?: ThumbRow[] } | null)?.data, userId),
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
    const cached = robloxCache.get<string | null>(`head:${id}`);
    if (cached !== undefined) out.set(id, cached);
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const result = await rbxFetch(getUsersAvatarHeadshot, {
      userIds: chunk,
      size: "150x150",
      format: "Png",
      isCircular: false,
    });
    const data = (result as { data?: ThumbRow[] }).data ?? [];
    for (const id of chunk) {
      const url = pickUrl(data, id);
      robloxCache.set(`head:${id}`, url, TTL.thumbnails);
      out.set(id, url);
    }
  }
  return out;
}

export async function getGroupIcons(groupIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (groupIds.length === 0) return out;
  const result = await rbxFetch(getGroupsIcons, {
    groupIds,
    size: "150x150",
    format: "Png",
    isCircular: false,
  });
  const data = (result as { data?: ThumbRow[] }).data ?? [];
  for (const id of groupIds) {
    const url = pickUrl(data, id);
    out.set(id, url);
  }
  return out;
}

export async function getBadgeIcons(badgeIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (badgeIds.length === 0) return out;
  const result = await rbxFetch(getBadgesIcons, {
    badgeIds,
    size: "150x150",
    format: "Png",
  });
  const data = (result as { data?: ThumbRow[] }).data ?? [];
  for (const id of badgeIds) out.set(id, pickUrl(data, id));
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
    const result = await rbxFetch(getGamesIcons, {
      universeIds: chunk,
      size: "512x512",
      format: "Png",
    });
    const data = (result as { data?: ThumbRow[] }).data;
    for (const id of chunk) {
      const url = pickUrl(data, id);
      robloxCache.set(`gicon:${id}`, url, TTL.gameThumb);
      out.set(id, url);
    }
  }
  return out;
}

export async function getGameThumbnail(universeId: number): Promise<string | null> {
  const key = `gthumb:${universeId}`;
  const cached = robloxCache.get<string | null>(key);
  if (cached !== undefined) return cached;
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
  return robloxCache.set(key, url, TTL.gameThumb);
}

export async function getGamePassIcons(passIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (passIds.length === 0) return out;
  const result = await rbxFetch(getGamePasses, {
    gamePassIds: passIds,
    size: "150x150",
    format: "Png",
  });
  const data = (result as { data?: ThumbRow[] }).data ?? [];
  for (const id of passIds) out.set(id, pickUrl(data, id));
  return out;
}

export async function getCurrentlyWearing(userId: number): Promise<number[]> {
  const result = await rbxFetch(getUsersUseridCurrentlyWearing, { userId });
  return (result as { assetIds?: number[] }).assetIds ?? [];
}
