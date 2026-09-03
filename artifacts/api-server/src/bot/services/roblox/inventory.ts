import {
  getUsersUseridCanViewInventory,
  getUsersUseridAssetsCollectibles,
} from "rozod/endpoints/inventoryv1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import { RobloxServiceError } from "./errors";
import type { PageResult, RobloxInventoryItem } from "./types";

export async function canViewInventory(userId: number): Promise<boolean> {
  const key = `canview:${userId}`;
  const cached = robloxCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await rbxFetch(getUsersUseridCanViewInventory, { userId });
  return robloxCache.set(key, Boolean((result as { canView?: boolean }).canView), TTL.inventory);
}

/**
 * Public collectibles inventory only.
 * Returns a clear private error when the user hides inventory.
 * Never uses cookies / authenticated inventory endpoints.
 */
export async function getPublicInventoryPage(
  userId: number,
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxInventoryItem> & { public: true }> {
  const visible = await canViewInventory(userId);
  if (!visible) {
    throw new RobloxServiceError("private", `inventory private for user ${userId}`);
  }

  const result = await rbxFetch(getUsersUseridAssetsCollectibles, {
    userId,
    sortOrder: "Desc",
    limit: 25,
    cursor: cursor ?? undefined,
  });
  const data =
    (result as {
      data?: Array<{
        assetId: number;
        name?: string;
        assetType?: string | number;
        recentAveragePrice?: number | null;
      }>;
      nextPageCursor?: string | null;
    }).data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  return {
    public: true,
    items: data.map((i) => ({
      assetId: i.assetId,
      name: i.name ?? `Asset ${i.assetId}`,
      assetType: i.assetType != null ? String(i.assetType) : null,
      recentAveragePrice: i.recentAveragePrice ?? null,
    })),
    page,
    pageSize: 25,
    total: data.length + page * 25 + (next ? 25 : 0),
    hasMore: Boolean(next),
    nextCursor: next,
  };
}
