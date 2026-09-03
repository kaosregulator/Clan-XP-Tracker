/**
 * Game Pass browser — uses the current public Game Passes API
 * (apis.roblox.com/game-passes/v1/universes/{id}/game-passes)
 * because RoZod's older games.roblox.com listing is unreliable.
 */
import { rbxHttp, formatCount } from "./client";
import { robloxCache, TTL } from "./cache";
import { getGamePassIcons } from "./thumbnails";
import { withFallback } from "./providers/fallback";
import { rbxianOwnsGamePass, rbxianGamePassInfo } from "./providers/robloxian";
import type { PageResult, RobloxGamePass } from "./types";

export interface RichGamePass extends RobloxGamePass {
  description: string | null;
  isForSale: boolean | null;
  iconAssetId: number | null;
  created: string | null;
  updated: string | null;
  url: string;
  owned?: boolean | null;
}

export function gamePassUrl(id: number): string {
  return `https://www.roblox.com/game-pass/${id}`;
}

interface ApiPass {
  id: number;
  productId?: number;
  name?: string;
  displayName?: string;
  displayDescription?: string | null;
  isForSale?: boolean;
  displayIconImageAssetId?: number;
  created?: string;
  updated?: string;
  priceInRobux?: number | null;
}

function mapPass(p: ApiPass, iconUrl: string | null): RichGamePass {
  return {
    id: p.id,
    name: p.name ?? p.displayName ?? `Pass ${p.id}`,
    displayName: p.displayName ?? p.name ?? `Pass ${p.id}`,
    productId: p.productId ?? null,
    price: p.priceInRobux ?? null,
    iconUrl,
    description: p.displayDescription ?? null,
    isForSale: p.isForSale ?? null,
    iconAssetId: p.displayIconImageAssetId ?? null,
    created: p.created ?? null,
    updated: p.updated ?? null,
    url: gamePassUrl(p.id),
  };
}

/**
 * List universe game passes (paginated via pageToken).
 * filter: "all" | "onsale"
 */
export async function listUniverseGamePasses(
  universeId: number,
  opts: { pageToken?: string | null; count?: number; filter?: "all" | "onsale" } = {}
): Promise<PageResult<RichGamePass> & { nextPageToken: string | null }> {
  const count = opts.count ?? 25;
  const filter = opts.filter ?? "all";
  const cacheKey = `passes:${universeId}:${opts.pageToken ?? "start"}:${count}:${filter}`;
  const cached = robloxCache.get<PageResult<RichGamePass> & { nextPageToken: string | null }>(
    cacheKey
  );
  if (cached) return cached;

  const qs = new URLSearchParams({ count: String(Math.min(count, 100)) });
  if (opts.pageToken) qs.set("pageToken", opts.pageToken);

  const res = await rbxHttp<{ gamePasses?: ApiPass[]; nextPageToken?: string | null }>(
    `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?${qs}`
  );

  let raw = res.gamePasses ?? [];
  if (filter === "onsale") raw = raw.filter((p) => p.isForSale);

  const icons = await getGamePassIcons(raw.map((p) => p.id)).catch(
    () => new Map<number, string | null>()
  );

  // Enrich missing prices via product-info (best-effort, capped).
  const items: RichGamePass[] = [];
  for (const p of raw) {
    let pass = mapPass(p, icons.get(p.id) ?? null);
    if (pass.price == null && pass.isForSale) {
      try {
        const info = await withFallback(
          `passInfo:${p.id}`,
          async () => {
            const product = await rbxHttp<{
              priceInRobux?: number;
              PriceInRobux?: number;
              name?: string;
            }>(`https://apis.roblox.com/game-passes/v1/game-passes/${p.id}/product-info`);
            return {
              name: product.name ?? pass.name,
              price: product.priceInRobux ?? product.PriceInRobux ?? null,
            };
          },
          async () => {
            const info = await rbxianGamePassInfo(p.id);
            return { name: info?.name ?? pass.name, price: info?.price ?? null };
          }
        );
        pass = { ...pass, price: info.price, name: info.name || pass.name };
      } catch {
        /* keep without price */
      }
    }
    items.push(pass);
  }

  const pageResult = {
    items,
    page: 0,
    pageSize: count,
    total: items.length,
    hasMore: Boolean(res.nextPageToken),
    nextCursor: res.nextPageToken ?? null,
    nextPageToken: res.nextPageToken ?? null,
  };
  return robloxCache.set(cacheKey, pageResult, TTL.gamePasses);
}

/** Public ownership check (inventory is-owned). Soft-fails to null. */
export async function userOwnsGamePass(
  userId: number,
  gamePassId: number
): Promise<boolean | null> {
  const key = `owns:pass:${userId}:${gamePassId}`;
  const cached = robloxCache.get<boolean | null>(key);
  if (cached !== undefined) return cached;

  try {
    const owned = await withFallback(
      `ownsPass:${gamePassId}`,
      async () => {
        const res = await rbxHttp<boolean | { isOwned?: boolean }>(
          `https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gamePassId}/is-owned`
        );
        if (typeof res === "boolean") return res;
        return Boolean((res as { isOwned?: boolean }).isOwned);
      },
      async () => Boolean(await rbxianOwnsGamePass(userId, gamePassId))
    );
    return robloxCache.set(key, owned, TTL.inventory);
  } catch {
    return robloxCache.set(key, null, 30_000);
  }
}

/** Annotate a page of passes with ownership for a user (parallel, capped). */
export async function withOwnership(
  userId: number,
  passes: RichGamePass[]
): Promise<RichGamePass[]> {
  const slice = passes.slice(0, 25);
  const flags = await Promise.all(slice.map((p) => userOwnsGamePass(userId, p.id)));
  return slice.map((p, i) => ({ ...p, owned: flags[i] ?? null }));
}

export { formatCount };
