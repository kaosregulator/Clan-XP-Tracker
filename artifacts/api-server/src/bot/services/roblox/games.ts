import { getGames, getGamesPlaceidServersServertype, getGamesUniverseidVotes, getGamesUniverseidGamePasses } from "rozod/endpoints/gamesv1";
import { getUsersUseridGames } from "rozod/endpoints/gamesv2";
import { rbxFetch, rbxHttp, formatCount } from "./client";
import { robloxCache, TTL } from "./cache";
import { getGameIcon, getGameThumbnail, getGamePassIcons } from "./thumbnails";
import { RobloxServiceError } from "./errors";
import type { PageResult, RobloxGame, RobloxGamePass, RobloxServer } from "./types";

interface GameRaw {
  id: number;
  rootPlaceId: number;
  name: string;
  description?: string;
  creator?: { id: number; name: string; type: string; hasVerifiedBadge?: boolean };
  playing?: number;
  visits?: number;
  favoritedCount?: number;
  maxPlayers?: number;
  created?: string;
  updated?: string;
  genre?: string;
}

function mapGame(
  raw: GameRaw,
  extras: {
    iconUrl?: string | null;
    thumbnailUrl?: string | null;
    upVotes?: number | null;
    downVotes?: number | null;
  } = {}
): RobloxGame {
  return {
    universeId: raw.id,
    rootPlaceId: raw.rootPlaceId,
    name: raw.name,
    description: raw.description ?? "",
    creator: {
      id: raw.creator?.id ?? 0,
      name: raw.creator?.name ?? "Unknown",
      type: String(raw.creator?.type ?? "User"),
      hasVerifiedBadge: Boolean(raw.creator?.hasVerifiedBadge),
    },
    playing: raw.playing ?? 0,
    visits: raw.visits ?? 0,
    favoritedCount: raw.favoritedCount ?? 0,
    maxPlayers: raw.maxPlayers ?? 0,
    created: raw.created ?? null,
    updated: raw.updated ?? null,
    genre: raw.genre ?? null,
    iconUrl: extras.iconUrl ?? null,
    thumbnailUrl: extras.thumbnailUrl ?? null,
    upVotes: extras.upVotes ?? null,
    downVotes: extras.downVotes ?? null,
  };
}

export async function getGameByUniverseId(universeId: number): Promise<RobloxGame> {
  const key = `game:${universeId}`;
  const cached = robloxCache.get<RobloxGame>(key);
  if (cached) return cached;

  const result = await rbxFetch(getGames, { universeIds: [universeId] });
  const data = (result as { data?: GameRaw[] }).data ?? [];
  const raw = data[0];
  if (!raw) throw new RobloxServiceError("not_found", `universe ${universeId}`);

  const [iconUrl, thumbnailUrl, votes] = await Promise.all([
    getGameIcon(universeId),
    getGameThumbnail(universeId),
    rbxFetch(getGamesUniverseidVotes, { universeId }).catch(() => null),
  ]);

  const game = mapGame(raw, {
    iconUrl,
    thumbnailUrl,
    upVotes: (votes as { upVotes?: number } | null)?.upVotes ?? null,
    downVotes: (votes as { downVotes?: number } | null)?.downVotes ?? null,
  });
  return robloxCache.set(key, game, TTL.game);
}

/**
 * Place → universe via official Universes API (not currently in RoZod).
 * https://apis.roblox.com/universes/v1/places/{placeId}/universe
 */
export async function universeIdFromPlace(placeId: number): Promise<number> {
  const key = `place2uni:${placeId}`;
  const cached = robloxCache.get<number>(key);
  if (cached) return cached;
  const res = await rbxHttp<{ universeId: number }>(
    `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
  );
  if (!res.universeId) throw new RobloxServiceError("not_found", `place ${placeId}`);
  return robloxCache.set(key, res.universeId, TTL.userId);
}

export async function getGameByPlaceId(placeId: number): Promise<RobloxGame> {
  const universeId = await universeIdFromPlace(placeId);
  return getGameByUniverseId(universeId);
}

/**
 * Resolve a game query: universe id, place id, or name search.
 * Name search uses Roblox omni-search (official web API; not in RoZod yet).
 */
export async function resolveGame(query: string): Promise<RobloxGame> {
  const q = query.trim();
  if (!q) throw new RobloxServiceError("invalid", "empty game query");

  if (/^\d+$/.test(q)) {
    const id = Number(q);
    // Try as universe first, then place.
    try {
      return await getGameByUniverseId(id);
    } catch {
      return getGameByPlaceId(id);
    }
  }

  const hits = await searchGames(q, 5);
  const first = hits[0];
  if (!first) throw new RobloxServiceError("not_found", `game ${q}`);
  return getGameByUniverseId(first.universeId);
}

export async function searchGames(
  keyword: string,
  limit = 8
): Promise<Array<{ universeId: number; name: string; playerCount: number; rootPlaceId?: number }>> {
  const q = keyword.trim();
  if (q.length < 2) return [];
  const key = `gsearch:${q.toLowerCase()}`;
  const cached = robloxCache.get<Array<{ universeId: number; name: string; playerCount: number }>>(key);
  if (cached) return cached.slice(0, limit);

  // Official omni-search used by Roblox.com — documented gap vs RoZod.
  const sessionId = "clanxp-hub";
  const url =
    `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}` +
    `&sessionId=${sessionId}&pageType=all`;
  const res = await rbxHttp<{
    searchResults?: Array<{
      contentGroupType?: string;
      contents?: Array<{
        universeId?: number;
        name?: string;
        playerCount?: number;
        rootPlaceId?: number;
      }>;
    }>;
  }>(url);

  const hits: Array<{ universeId: number; name: string; playerCount: number; rootPlaceId?: number }> =
    [];
  for (const group of res.searchResults ?? []) {
    if (group.contentGroupType && group.contentGroupType !== "Game") continue;
    for (const c of group.contents ?? []) {
      if (!c.universeId || !c.name) continue;
      hits.push({
        universeId: c.universeId,
        name: c.name,
        playerCount: c.playerCount ?? 0,
        rootPlaceId: c.rootPlaceId,
      });
    }
  }
  robloxCache.set(key, hits, TTL.search);
  return hits.slice(0, limit);
}

export async function getUserGames(
  userId: number,
  page = 0,
  pageSize: 10 | 25 | 50 = 10
): Promise<PageResult<RobloxGame>> {
  const result = await rbxFetch(getUsersUseridGames, {
    userId,
    limit: pageSize,
    sortOrder: "Desc",
  });
  const data =
    (result as { data?: Array<{ id: number; name: string; rootPlace?: { id: number }; placeVisits?: number }> })
      .data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;

  // Enrich with live details where cheap.
  const universeIds = data.map((d) => d.id).filter(Boolean);
  const details =
    universeIds.length > 0
      ? ((await rbxFetch(getGames, { universeIds }).catch(() => ({ data: [] }))) as {
          data?: GameRaw[];
        })
      : { data: [] };
  const byId = new Map((details.data ?? []).map((g) => [g.id, g]));

  const items: RobloxGame[] = [];
  for (const d of data) {
    const raw = byId.get(d.id);
    if (raw) {
      const iconUrl = await getGameIcon(d.id).catch(() => null);
      items.push(mapGame(raw, { iconUrl }));
    } else {
      items.push({
        universeId: d.id,
        rootPlaceId: d.rootPlace?.id ?? 0,
        name: d.name,
        description: "",
        creator: { id: userId, name: "", type: "User", hasVerifiedBadge: false },
        playing: 0,
        visits: d.placeVisits ?? 0,
        favoritedCount: 0,
        maxPlayers: 0,
        created: null,
        updated: null,
        genre: null,
        iconUrl: null,
        thumbnailUrl: null,
        upVotes: null,
        downVotes: null,
      });
    }
  }

  return {
    items,
    page,
    pageSize,
    total: items.length + page * pageSize + (next ? pageSize : 0),
    hasMore: Boolean(next),
    nextCursor: next,
  };
}

export async function getPublicServers(
  placeId: number,
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxServer>> {
  const result = await rbxFetch(getGamesPlaceidServersServertype, {
    placeId,
    serverType: 0, // Public
    sortOrder: 2, // Desc by players
    excludeFullGames: false,
    limit: 10,
    cursor: cursor ?? undefined,
  });
  const data =
    (result as {
      data?: Array<{
        id: string;
        maxPlayers: number;
        playing: number;
        fps?: number;
        ping?: number;
      }>;
      nextPageCursor?: string | null;
    }).data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;

  const items: RobloxServer[] = data.map((s) => ({
    id: s.id,
    maxPlayers: s.maxPlayers,
    playing: s.playing,
    fps: s.fps ?? null,
    ping: s.ping ?? null,
  }));

  return {
    items,
    page,
    pageSize: 10,
    total: items.length + page * 10 + (next ? 10 : 0),
    hasMore: Boolean(next),
    nextCursor: next,
  };
}

export async function getGamePasses(
  universeId: number,
  cursor?: string | null
): Promise<PageResult<RobloxGamePass>> {
  const result = await rbxFetch(getGamesUniverseidGamePasses, {
    universeId,
    limit: 25,
    sortOrder: 1,
    cursor: cursor ?? undefined,
  });
  const data =
    (result as {
      data?: Array<{
        id: number;
        name?: string;
        displayName?: string;
        productId?: number;
        price?: number | null;
      }>;
      nextPageCursor?: string | null;
    }).data ?? [];
  const next = (result as { nextPageCursor?: string | null }).nextPageCursor ?? null;
  const icons = await getGamePassIcons(data.map((p) => p.id));
  const items: RobloxGamePass[] = data.map((p) => ({
    id: p.id,
    name: p.name ?? p.displayName ?? `Pass ${p.id}`,
    displayName: p.displayName ?? p.name ?? `Pass ${p.id}`,
    productId: p.productId ?? null,
    price: p.price ?? null,
    iconUrl: icons.get(p.id) ?? null,
  }));
  return {
    items,
    page: 0,
    pageSize: 25,
    total: items.length,
    hasMore: Boolean(next),
    nextCursor: next,
  };
}

export { formatCount };
