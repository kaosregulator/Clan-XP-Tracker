import {
  getUsersUseridBadges,
  getUniversesUniverseidBadges,
  getUsersUseridBadgesAwardedDates,
} from "rozod/endpoints/badgesv1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import { getBadgeIcons } from "./thumbnails";
import type { PageResult, RobloxBadge } from "./types";

interface BadgeRaw {
  id: number;
  name: string;
  description?: string;
  displayName?: string;
  enabled?: boolean;
  awarder?: { id: number; type: number } | null;
  statistics?: { awardedCount?: number; winRatePercentage?: number } | null;
}

function mapBadge(
  raw: BadgeRaw,
  iconUrl: string | null,
  awardedDate: string | null = null
): RobloxBadge {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? "",
    displayName: raw.displayName ?? raw.name,
    enabled: raw.enabled !== false,
    iconUrl,
    awardedDate,
    awarder: raw.awarder ?? null,
    statistics: raw.statistics
      ? {
          awardedCount: raw.statistics.awardedCount ?? 0,
          winRatePercentage: raw.statistics.winRatePercentage ?? 0,
        }
      : null,
  };
}

export async function getUserBadgesPage(
  userId: number,
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxBadge>> {
  const result = await rbxFetch(getUsersUseridBadges, {
    userId,
    limit: 10,
    sortOrder: "Desc",
    cursor: cursor ?? undefined,
  });
  const data = (result as { data?: BadgeRaw[]; nextPageCursor?: string | null }).data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  const icons = await getBadgeIcons(data.map((b) => b.id));

  let awarded = new Map<number, string>();
  try {
    const dates = await rbxFetch(getUsersUseridBadgesAwardedDates, {
      userId,
      badgeIds: data.map((b) => b.id),
    });
    for (const row of (dates as { data?: Array<{ badgeId: number; awardedDate: string }> }).data ??
      []) {
      awarded.set(row.badgeId, row.awardedDate);
    }
  } catch {
    awarded = new Map();
  }

  const items = data.map((b) => mapBadge(b, icons.get(b.id) ?? null, awarded.get(b.id) ?? null));
  return {
    items,
    page,
    pageSize: 10,
    total: items.length + page * 10 + (next ? 10 : 0),
    hasMore: Boolean(next),
    nextCursor: next,
  };
}

export async function getUniverseBadgesPage(
  universeId: number,
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxBadge>> {
  const key = `ubadges:${universeId}:${cursor ?? "start"}`;
  const cached = robloxCache.get<PageResult<RobloxBadge>>(key);
  if (cached) return { ...cached, page };

  const result = await rbxFetch(getUniversesUniverseidBadges, {
    universeId,
    limit: 10,
    sortOrder: "Asc",
    cursor: cursor ?? undefined,
  });
  const data = (result as { data?: BadgeRaw[]; nextPageCursor?: string | null }).data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  const icons = await getBadgeIcons(data.map((b) => b.id));
  const items = data.map((b) => mapBadge(b, icons.get(b.id) ?? null));
  const pageResult: PageResult<RobloxBadge> = {
    items,
    page,
    pageSize: 10,
    total: items.length + page * 10 + (next ? 10 : 0),
    hasMore: Boolean(next),
    nextCursor: next,
  };
  return robloxCache.set(key, pageResult, TTL.badges);
}

/** Approximate badge count from first page + cursor presence (cheap). */
export async function estimateUserBadgeCount(userId: number): Promise<number | null> {
  const key = `badgecount:${userId}`;
  const cached = robloxCache.get<number | null>(key);
  if (cached !== undefined) return cached;
  try {
    const page = await getUserBadgesPage(userId, 0);
    // We don't get an exact total from the API; show at least page size or "10+".
    const estimate = page.hasMore ? page.items.length + 1 : page.items.length;
    return robloxCache.set(key, estimate, TTL.badges);
  } catch {
    return robloxCache.set(key, null, TTL.badges);
  }
}
