/**
 * Roblox Marketplace (avatar shop) — NOT Creator Store.
 * Public catalog.roblox.com search + bundle details. No cookies.
 */
import { getSearchItemsDetails } from "rozod/endpoints/catalogv2";
import {
  getBundlesBundleidDetails,
  getBundlesBundleidRecommendations,
  getFavoritesAssetsAssetidCount,
  getFavoritesBundlesBundleidCount,
} from "rozod/endpoints/catalogv1";
import { getAssets, getBundlesThumbnails } from "rozod/endpoints/thumbnailsv1";
import { rbxFetch, formatCount } from "./client";
import { robloxCache, TTL } from "./cache";
import { RobloxServiceError } from "./errors";

/* ------------------------------------------------------------------ types */

export type MarketItemType = "Asset" | "Bundle";

export type MarketCategory =
  | "all"
  | "clothing"
  | "accessories"
  | "bodies"
  | "animations"
  | "collectibles"
  | "gear"
  | "military";

export type MarketPriceFilter = "all" | "free" | "under50" | "under100" | "over100";

export type MarketSort =
  | "relevance"
  | "favorites"
  | "sales"
  | "updated"
  | "priceAsc"
  | "priceDesc";

export interface MarketSearchOpts {
  keyword?: string | null;
  category?: MarketCategory;
  price?: MarketPriceFilter;
  sort?: MarketSort;
  creatorType?: 1 | 2 | null;
  creatorTargetId?: number | null;
  creatorName?: string | null;
  cursor?: string | null;
  limit?: 10 | 28 | 30;
}

export interface MarketItem {
  id: number;
  itemType: MarketItemType;
  name: string;
  description: string;
  price: number | null;
  lowestPrice: number | null;
  lowestResalePrice: number | null;
  isFree: boolean;
  creatorName: string;
  creatorType: string;
  creatorTargetId: number;
  creatorVerified: boolean;
  assetType: number | null;
  bundleType: number | null;
  favoriteCount: number;
  itemRestrictions: string[];
  collectibleItemId: string | null;
  totalQuantity: number | null;
  unitsAvailable: number | null;
  hasResellers: boolean;
  createdUtc: string | null;
  iconUrl: string | null;
  productId: number | null;
}

export interface MarketPage {
  items: MarketItem[];
  nextCursor: string | null;
  previousCursor: string | null;
}

export interface MarketBundleDetail {
  id: number;
  name: string;
  description: string;
  bundleType: string;
  price: number | null;
  isFree: boolean;
  creatorName: string;
  creatorType: string;
  creatorId: number;
  items: Array<{ id: number; name: string; type: string }>;
  iconUrl: string | null;
  favoriteCount: number | null;
}

/* ------------------------------------------------------------- constants */

/** Classic + layered clothing asset types (avatar Marketplace only). */
export const CLOTHING_ASSET_TYPES = [2, 11, 12, 64, 65, 66, 67, 68, 69, 70, 71, 72];

/** Hats, hair, face/neck/shoulder/front/back/waist accessories. */
export const ACCESSORY_ASSET_TYPES = [8, 41, 42, 43, 44, 45, 46, 47, 73, 74];

/** Heads / faces / body parts. */
export const BODY_ASSET_TYPES = [17, 18, 27, 28, 29, 30, 31, 76];
export const BODY_BUNDLE_TYPES = [1, 3, 4]; // BodyParts, Shoes, DynamicHead

export const ANIMATION_ASSET_TYPES = [48, 49, 50, 51, 52, 53, 54, 55, 56, 61, 75];
export const ANIMATION_BUNDLE_TYPES = [2];

export const GEAR_ASSET_TYPES = [19];

const ASSET_TYPE_LABELS: Record<number, string> = {
  2: "Classic T-Shirt",
  8: "Hat",
  11: "Classic Shirt",
  12: "Classic Pants",
  17: "Head",
  18: "Face",
  19: "Gear",
  27: "Torso",
  41: "Hair",
  42: "Face Acc.",
  43: "Neck",
  44: "Shoulder",
  45: "Front",
  46: "Back",
  47: "Waist",
  61: "Emote",
  64: "T-Shirt",
  65: "Shirt",
  66: "Pants",
  67: "Jacket",
  68: "Sweater",
  69: "Shorts",
  70: "Left Shoe",
  71: "Right Shoe",
  72: "Dress/Skirt",
  76: "Dynamic Head",
};

const BUNDLE_TYPE_LABELS: Record<number, string> = {
  1: "Body Bundle",
  2: "Animation Bundle",
  3: "Shoes Bundle",
  4: "Dynamic Head Bundle",
};

const SORT_TYPE: Record<MarketSort, number> = {
  relevance: 0,
  favorites: 1,
  sales: 2,
  updated: 3,
  priceAsc: 4,
  priceDesc: 5,
};

export const CATEGORY_LABELS: Record<MarketCategory, string> = {
  all: "All",
  clothing: "Clothing",
  accessories: "Accessories",
  bodies: "Bodies",
  animations: "Animations",
  collectibles: "Collectibles",
  gear: "Gear",
  military: "Military",
};

export const PRICE_LABELS: Record<MarketPriceFilter, string> = {
  all: "Any price",
  free: "Free",
  under50: "Under 50 R$",
  under100: "Under 100 R$",
  over100: "100+ R$",
};

export const SORT_LABELS: Record<MarketSort, string> = {
  relevance: "Relevance",
  favorites: "Favorites",
  sales: "Best selling",
  updated: "Newest",
  priceAsc: "Price ↑",
  priceDesc: "Price ↓",
};

/* --------------------------------------------------------------- helpers */

function mapRaw(raw: Record<string, unknown>): MarketItem {
  const price = typeof raw.price === "number" ? raw.price : null;
  const lowest = typeof raw.lowestPrice === "number" ? raw.lowestPrice : price;
  const restrictions = Array.isArray(raw.itemRestrictions)
    ? (raw.itemRestrictions as string[])
    : [];
  return {
    id: Number(raw.id),
    itemType: (raw.itemType === "Bundle" ? "Bundle" : "Asset") as MarketItemType,
    name: String(raw.name ?? "Item"),
    description: String(raw.description ?? ""),
    price,
    lowestPrice: lowest,
    lowestResalePrice:
      typeof raw.lowestResalePrice === "number" ? raw.lowestResalePrice : null,
    isFree: price === 0 || lowest === 0,
    creatorName: String(raw.creatorName ?? "Unknown"),
    creatorType: String(raw.creatorType ?? "User"),
    creatorTargetId: Number(raw.creatorTargetId ?? 0),
    creatorVerified: Boolean(raw.creatorHasVerifiedBadge),
    assetType: typeof raw.assetType === "number" ? raw.assetType : null,
    bundleType: typeof raw.bundleType === "number" ? raw.bundleType : null,
    favoriteCount: Number(raw.favoriteCount ?? 0),
    itemRestrictions: restrictions,
    collectibleItemId:
      typeof raw.collectibleItemId === "string" ? raw.collectibleItemId : null,
    totalQuantity: typeof raw.totalQuantity === "number" ? raw.totalQuantity : null,
    unitsAvailable:
      typeof raw.unitsAvailableForConsumption === "number"
        ? raw.unitsAvailableForConsumption
        : null,
    hasResellers: Boolean(raw.hasResellers),
    createdUtc: typeof raw.itemCreatedUtc === "string" ? raw.itemCreatedUtc : null,
    iconUrl: null,
    productId: typeof raw.productId === "number" ? raw.productId : null,
  };
}

export function itemTypeLabel(item: MarketItem): string {
  if (item.itemType === "Bundle") {
    return BUNDLE_TYPE_LABELS[item.bundleType ?? 0] ?? "Bundle";
  }
  return ASSET_TYPE_LABELS[item.assetType ?? 0] ?? "Asset";
}

export function priceLabel(item: MarketItem): string {
  if (item.isFree || item.price === 0 || item.lowestPrice === 0) return "Free";
  const limited =
    item.itemRestrictions.includes("Limited") ||
    item.itemRestrictions.includes("LimitedUnique") ||
    item.itemRestrictions.includes("Collectible");
  if (limited && item.lowestResalePrice && item.lowestResalePrice > 0) {
    return `${formatCount(item.lowestResalePrice)} R$ resale`;
  }
  const p = item.lowestPrice ?? item.price;
  if (p == null) return "Offsale";
  return `${formatCount(p)} R$`;
}

export function marketItemUrl(item: Pick<MarketItem, "id" | "itemType" | "name">): string {
  const slug = encodeURIComponent(item.name.replace(/\s+/g, "-").slice(0, 60) || "item");
  if (item.itemType === "Bundle") return `https://www.roblox.com/bundles/${item.id}/${slug}`;
  return `https://www.roblox.com/catalog/${item.id}/${slug}`;
}

export function creatorUrl(creatorType: string, creatorTargetId: number): string {
  if (creatorType === "Group") {
    return `https://www.roblox.com/communities/${creatorTargetId}`;
  }
  return `https://www.roblox.com/users/${creatorTargetId}/profile`;
}

function priceParams(price: MarketPriceFilter): { MinPrice?: number; MaxPrice?: number } {
  switch (price) {
    case "free":
      return { MaxPrice: 0 };
    case "under50":
      return { MaxPrice: 50 };
    case "under100":
      return { MaxPrice: 100 };
    case "over100":
      return { MinPrice: 100 };
    default:
      return {};
  }
}

function categoryParams(category: MarketCategory): {
  AssetTypeIds?: number[];
  BundleTypeIds?: number[];
  SalesTypeFilter?: number;
  KeywordHint?: string;
} {
  switch (category) {
    case "clothing":
      return { AssetTypeIds: CLOTHING_ASSET_TYPES };
    case "accessories":
      return { AssetTypeIds: ACCESSORY_ASSET_TYPES };
    case "bodies":
      return { AssetTypeIds: BODY_ASSET_TYPES, BundleTypeIds: BODY_BUNDLE_TYPES };
    case "animations":
      return { AssetTypeIds: ANIMATION_ASSET_TYPES, BundleTypeIds: ANIMATION_BUNDLE_TYPES };
    case "collectibles":
      return { SalesTypeFilter: 2 };
    case "gear":
      return { AssetTypeIds: GEAR_ASSET_TYPES };
    case "military":
      return { KeywordHint: "military" };
    default:
      return {};
  }
}

/* -------------------------------------------------------------- thumbs */

export async function getAssetIcons(
  assetIds: number[],
  size: "150x150" | "420x420" = "150x150"
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (!assetIds.length) return out;
  for (let i = 0; i < assetIds.length; i += 100) {
    const chunk = assetIds.slice(i, i + 100);
    const result = await rbxFetch(getAssets, {
      assetIds: chunk,
      size,
      format: "Png",
      isCircular: false,
    }).catch(() => null);
    const data = (result as { data?: Array<{ targetId: number; state?: string; imageUrl?: string }> } | null)
      ?.data;
    for (const id of chunk) {
      const row = data?.find((r) => r.targetId === id);
      out.set(id, row?.state !== "Error" && row?.imageUrl ? row.imageUrl : null);
    }
  }
  return out;
}

export async function getBundleIcons(
  bundleIds: number[],
  size: "150x150" | "420x420" = "150x150"
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (!bundleIds.length) return out;
  for (let i = 0; i < bundleIds.length; i += 100) {
    const chunk = bundleIds.slice(i, i + 100);
    const result = await rbxFetch(getBundlesThumbnails, {
      bundleIds: chunk,
      size,
      format: "Png",
    }).catch(() => null);
    const data = (result as { data?: Array<{ targetId: number; state?: string; imageUrl?: string }> } | null)
      ?.data;
    for (const id of chunk) {
      const row = data?.find((r) => r.targetId === id);
      out.set(id, row?.state !== "Error" && row?.imageUrl ? row.imageUrl : null);
    }
  }
  return out;
}

async function enrichIcons(items: MarketItem[], size: "150x150" | "420x420" = "150x150"): Promise<MarketItem[]> {
  const assets = items.filter((i) => i.itemType === "Asset").map((i) => i.id);
  const bundles = items.filter((i) => i.itemType === "Bundle").map((i) => i.id);
  const [aMap, bMap] = await Promise.all([getAssetIcons(assets, size), getBundleIcons(bundles, size)]);
  return items.map((i) => ({
    ...i,
    iconUrl: (i.itemType === "Bundle" ? bMap.get(i.id) : aMap.get(i.id)) ?? null,
  }));
}

/* ---------------------------------------------------------------- search */

export async function searchMarketplace(opts: MarketSearchOpts = {}): Promise<MarketPage> {
  const category = opts.category ?? "all";
  const price = opts.price ?? "all";
  const sort = opts.sort ?? "relevance";
  const cat = categoryParams(category);
  const keyword =
    (opts.keyword?.trim() || cat.KeywordHint || undefined) ?? undefined;

  const params: Record<string, unknown> = {
    limit: opts.limit ?? 28,
    SortType: SORT_TYPE[sort],
    SortAggregation: sort === "favorites" || sort === "sales" ? 3 : undefined,
    ...priceParams(price),
  };
  if (keyword) params.Keyword = keyword;
  if (cat.AssetTypeIds) params.AssetTypeIds = cat.AssetTypeIds;
  if (cat.BundleTypeIds) params.BundleTypeIds = cat.BundleTypeIds;
  if (cat.SalesTypeFilter != null) params.SalesTypeFilter = cat.SalesTypeFilter;
  if (opts.cursor) params.cursor = opts.cursor;
  if (opts.creatorTargetId && opts.creatorType) {
    params.CreatorType = opts.creatorType;
    params.CreatorTargetId = opts.creatorTargetId;
  } else if (opts.creatorName?.trim()) {
    params.CreatorName = opts.creatorName.trim();
  }

  const cacheKey = `mkt:search:${JSON.stringify(params)}`;
  const cached = robloxCache.get<MarketPage>(cacheKey);
  if (cached) return cached;

  const result = await rbxFetch(getSearchItemsDetails, params);
  const data = (result as { data?: Array<Record<string, unknown>>; nextPageCursor?: string | null; previousPageCursor?: string | null });
  const rawItems = data.data ?? [];
  const items = await enrichIcons(rawItems.map(mapRaw));
  const page: MarketPage = {
    items,
    nextCursor: data.nextPageCursor ?? null,
    previousCursor: data.previousPageCursor ?? null,
  };
  return robloxCache.set(cacheKey, page, TTL.game);
}

/** Resolve one item from a search page or a fresh lookup by id. */
export async function getMarketItem(
  id: number,
  itemType: MarketItemType = "Asset"
): Promise<MarketItem> {
  if (itemType === "Bundle") {
    const detail = await getBundleDetail(id);
    return {
      id: detail.id,
      itemType: "Bundle",
      name: detail.name,
      description: detail.description,
      price: detail.price,
      lowestPrice: detail.price,
      lowestResalePrice: null,
      isFree: detail.isFree,
      creatorName: detail.creatorName,
      creatorType: detail.creatorType,
      creatorTargetId: detail.creatorId,
      creatorVerified: false,
      assetType: null,
      bundleType: null,
      favoriteCount: detail.favoriteCount ?? 0,
      itemRestrictions: [],
      collectibleItemId: null,
      totalQuantity: null,
      unitsAvailable: null,
      hasResellers: false,
      createdUtc: null,
      iconUrl: detail.iconUrl,
      productId: null,
    };
  }

  // Catalog has no public get-by-id without CSRF; keyword-search the id and match.
  const page = await searchMarketplace({ keyword: String(id), limit: 10 });
  const hit = page.items.find((i) => i.id === id && i.itemType === "Asset");
  if (hit) {
    const [rich] = await enrichIcons([hit], "420x420");
    const fav = await getAssetFavoriteCount(id);
    return { ...rich!, favoriteCount: fav ?? rich!.favoriteCount };
  }
  throw new RobloxServiceError("not_found", `catalog asset ${id}`);
}

export async function getBundleDetail(bundleId: number): Promise<MarketBundleDetail> {
  const key = `mkt:bundle:${bundleId}`;
  const cached = robloxCache.get<MarketBundleDetail>(key);
  if (cached) return cached;

  const [raw, icons, fav] = await Promise.all([
    rbxFetch(getBundlesBundleidDetails, { bundleId }),
    getBundleIcons([bundleId], "420x420"),
    rbxFetch(getFavoritesBundlesBundleidCount, { bundleId }).catch(() => null),
  ]);
  const b = raw as {
    id?: number;
    name?: string;
    description?: string;
    bundleType?: string;
    items?: Array<{ id: number; name: string; type: string }>;
    creator?: { id: number; name: string; type: string };
    product?: { priceInRobux?: number | null; isFree?: boolean };
  };
  if (!b?.id) throw new RobloxServiceError("not_found", `bundle ${bundleId}`);

  const detail: MarketBundleDetail = {
    id: b.id,
    name: b.name ?? `Bundle ${bundleId}`,
    description: b.description ?? "",
    bundleType: String(b.bundleType ?? "Bundle"),
    price: b.product?.priceInRobux ?? null,
    isFree: Boolean(b.product?.isFree) || b.product?.priceInRobux === 0,
    creatorName: b.creator?.name ?? "Unknown",
    creatorType: b.creator?.type ?? "User",
    creatorId: b.creator?.id ?? 0,
    items: (b.items ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      type: it.type,
    })),
    iconUrl: icons.get(bundleId) ?? null,
    favoriteCount: typeof fav === "number" ? fav : (fav as { favoritesCount?: number } | null)?.favoritesCount ?? null,
  };
  return robloxCache.set(key, detail, TTL.game);
}

export async function getBundleRecommendations(bundleId: number): Promise<MarketItem[]> {
  const raw = await rbxFetch(getBundlesBundleidRecommendations, { bundleId });
  const list = (raw as { data?: Array<Record<string, unknown>> })?.data
    ?? (Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []);
  const items = list.slice(0, 12).map((b) => {
    const product = b.product as { priceInRobux?: number | null; isFree?: boolean } | undefined;
    const creator = b.creator as { id?: number; name?: string; type?: string } | undefined;
    return mapRaw({
      id: b.id,
      itemType: "Bundle",
      name: b.name,
      description: b.description,
      price: product?.priceInRobux ?? null,
      lowestPrice: product?.priceInRobux ?? null,
      creatorName: creator?.name,
      creatorType: creator?.type,
      creatorTargetId: creator?.id,
      favoriteCount: 0,
      itemRestrictions: [],
      bundleType:
        b.bundleType === "BodyParts"
          ? 1
          : b.bundleType === "Animations"
            ? 2
            : b.bundleType === "Shoes"
              ? 3
              : b.bundleType === "DynamicHead"
                ? 4
                : undefined,
    });
  });
  return enrichIcons(items);
}

export async function getAssetFavoriteCount(assetId: number): Promise<number | null> {
  try {
    const r = await rbxFetch(getFavoritesAssetsAssetidCount, { assetId });
    if (typeof r === "number") return r;
    return (r as { favoritesCount?: number })?.favoritesCount ?? null;
  } catch {
    return null;
  }
}

export { formatCount };
