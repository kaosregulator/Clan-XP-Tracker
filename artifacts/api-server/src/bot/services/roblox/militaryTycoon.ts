/**
 * Military Tycoon / InfinityInteractive — what we can integrate publicly.
 *
 * Verified IDs:
 *   Community  11257245  (InfinityInteractive)
 *   Place      7180042682
 *   Universe   2788648141
 *
 * PUBLIC (available now in this bot):
 *   - Live players / visits / favorites / votes
 *   - Game icon + thumbnails + media asset ids
 *   - Public servers browser
 *   - Universe badges (+ ownership intersection for a player)
 *   - Full game-pass catalog (for-sale + retired) with store links
 *   - Per-player public game-pass ownership checks
 *   - InfinityInteractive group details, roles ladder, member rank
 *   - Group experiences list (MT + siblings like "Military Tycoon (r6)")
 *   - Presence: whether a user is currently in MT
 *   - Account created / isBanned / username history (public profile fields)
 *
 * NOT AVAILABLE without InfinityInteractive Open Cloud authorization:
 *   - In-game cash, XP, rebirths, vehicles, base level, country, clan tags
 *   - Private DataStores / MemoryStores / Messaging
 *   - Developer-product purchase ledgers
 *   - Private inventory when the user hides it
 *
 * CLAN XP TRACKING (this Discord bot):
 *   ClanXP already tracks weekly XP / roles / reminders for YOUR Discord clan.
 *   That is independent of MT's private player DataStores.
 *   Optional bridge today: store the member's Roblox username in `gameUsername`
 *   and use /military player + group rank + pass ownership as public context.
 *   A true in-game XP sync requires an API key issued by InfinityInteractive
 *   for universe 2788648141 (Open Cloud DataStore scopes).
 */
import {
  INFINITY_INTERACTIVE_GROUP_ID,
  MILITARY_TYCOON_PLACE_ID,
  MILITARY_TYCOON_UNIVERSE_ID,
  MILITARY_TYCOON_NAME,
  INFINITY_INTERACTIVE_NAME,
} from "./constants";
import { getUserById, resolveUsername } from "./users";
import { getUserPresence } from "./presence";
import { getUserThumbnails } from "./thumbnails";
import { getGroupMembership, getGroupDetails } from "./groups";
import { getGameByUniverseId, getPublicServers } from "./games";
import { getUniverseBadgesPage, getUserBadgesPage } from "./badges";
import { listUniverseGamePasses, withOwnership, type RichGamePass } from "./passes";
import { rbxFetch } from "./client";
import { getGroupsGroupidRoles } from "rozod/endpoints/groupsv1";
import { getGroupsGroupidGames } from "rozod/endpoints/gamesv2";
import { withFallback } from "./providers/fallback";
import { rbxianGroupRoles, rbxianUniverse } from "./providers/robloxian";
import { robloxCache, TTL } from "./cache";
import type {
  MilitaryPlayerData,
  PageResult,
  RobloxBadge,
  RobloxGame,
  RobloxServer,
} from "./types";

export interface GroupRoleLadderEntry {
  id: number;
  name: string;
  rank: number;
  memberCount: number;
}

export interface MtIntegrationSnapshot {
  game: RobloxGame;
  group: Awaited<ReturnType<typeof getGroupDetails>>;
  roles: GroupRoleLadderEntry[];
  experiences: Array<{ universeId: number; name: string; rootPlaceId: number; visits: number }>;
  passesForSale: number;
  passesTotalSample: number;
  badgeSampleCount: number;
  openCloudConfigured: boolean;
}

export async function getMilitaryGame(): Promise<RobloxGame> {
  return withFallback(
    "mtGame",
    () => getGameByUniverseId(MILITARY_TYCOON_UNIVERSE_ID),
    async () => {
      const u = await rbxianUniverse(MILITARY_TYCOON_UNIVERSE_ID);
      return {
        universeId: MILITARY_TYCOON_UNIVERSE_ID,
        rootPlaceId: Number(u?.rootPlaceId ?? MILITARY_TYCOON_PLACE_ID),
        name: String(u?.name ?? MILITARY_TYCOON_NAME),
        description: String(u?.description ?? ""),
        creator: {
          id: INFINITY_INTERACTIVE_GROUP_ID,
          name: INFINITY_INTERACTIVE_NAME,
          type: "Group",
          hasVerifiedBadge: false,
        },
        playing: Number(u?.playing ?? 0),
        visits: Number(u?.visits ?? 0),
        favoritedCount: Number(u?.favoritedCount ?? 0),
        maxPlayers: Number(u?.maxPlayers ?? 0),
        created: u?.created ?? null,
        updated: u?.updated ?? null,
        genre: null,
        iconUrl: null,
        thumbnailUrl: null,
        upVotes: null,
        downVotes: null,
      } satisfies RobloxGame;
    }
  );
}

export async function getInfinityGroup() {
  return getGroupDetails(INFINITY_INTERACTIVE_GROUP_ID);
}

export async function getInfinityRoleLadder(): Promise<GroupRoleLadderEntry[]> {
  const key = `ii:roles`;
  const cached = robloxCache.get<GroupRoleLadderEntry[]>(key);
  if (cached) return cached;

  return withFallback(
    "iiRoles",
    async () => {
      const result = await rbxFetch(getGroupsGroupidRoles, {
        groupId: INFINITY_INTERACTIVE_GROUP_ID,
      });
      const roles =
        (result as { roles?: Array<{ id: number; name: string; rank: number; memberCount?: number }> })
          .roles ?? [];
      const mapped = roles
        .filter((r) => r.rank > 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          rank: r.rank,
          memberCount: r.memberCount ?? 0,
        }))
        .sort((a, b) => b.rank - a.rank);
      return robloxCache.set(key, mapped, TTL.groups);
    },
    async () => {
      const roles = (await rbxianGroupRoles(INFINITY_INTERACTIVE_GROUP_ID)) as Array<{
        id: number;
        name: string;
        rank: number;
        memberCount?: number;
      }>;
      const mapped = (roles ?? [])
        .filter((r) => r.rank > 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          rank: r.rank,
          memberCount: r.memberCount ?? 0,
        }))
        .sort((a, b) => b.rank - a.rank);
      return robloxCache.set(key, mapped, TTL.groups);
    }
  );
}

export async function getInfinityExperiences(): Promise<
  Array<{ universeId: number; name: string; rootPlaceId: number; visits: number }>
> {
  const key = `ii:exps`;
  const cached = robloxCache.get<
    Array<{ universeId: number; name: string; rootPlaceId: number; visits: number }>
  >(key);
  if (cached) return cached;

  const result = await rbxFetch(getGroupsGroupidGames, {
    groupId: INFINITY_INTERACTIVE_GROUP_ID,
    accessFilter: 2,
    limit: 10,
    sortOrder: "Desc",
  });
  const data =
    (result as {
      data?: Array<{
        id: number;
        name: string;
        rootPlace?: { id: number };
        placeVisits?: number;
      }>;
    }).data ?? [];
  const mapped = data.map((g) => ({
    universeId: g.id,
    name: g.name,
    rootPlaceId: g.rootPlace?.id ?? 0,
    visits: g.placeVisits ?? 0,
  }));
  return robloxCache.set(key, mapped, TTL.game);
}

export async function getMilitaryPlayer(
  usernameOrId: string | number
): Promise<MilitaryPlayerData> {
  const user =
    typeof usernameOrId === "number"
      ? await getUserById(usernameOrId)
      : await resolveUsername(String(usernameOrId));

  const [thumbs, presence, membership, game] = await Promise.all([
    getUserThumbnails(user.id),
    getUserPresence(user.id),
    getGroupMembership(user.id, INFINITY_INTERACTIVE_GROUP_ID),
    getMilitaryGame().catch(() => null),
  ]);

  const isPlaying =
    presence?.userPresenceType === 2 &&
    (presence.universeId === MILITARY_TYCOON_UNIVERSE_ID ||
      presence.rootPlaceId === MILITARY_TYCOON_PLACE_ID ||
      presence.placeId === MILITARY_TYCOON_PLACE_ID);

  let currentGameName: string | null = null;
  if (presence?.userPresenceType === 2) {
    currentGameName =
      presence.lastLocation || (isPlaying ? game?.name ?? MILITARY_TYCOON_NAME : null);
  }

  return {
    user,
    thumbs,
    presence,
    currentGameName,
    isPlayingMilitaryTycoon: Boolean(isPlaying),
    groupMembership: membership,
    game,
  };
}

export async function getMilitaryServers(
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxServer>> {
  return getPublicServers(MILITARY_TYCOON_PLACE_ID, page, cursor);
}

export async function getMilitaryGamePasses(
  pageToken?: string | null,
  filter: "all" | "onsale" = "all"
): Promise<PageResult<RichGamePass> & { nextPageToken: string | null }> {
  return listUniverseGamePasses(MILITARY_TYCOON_UNIVERSE_ID, {
    pageToken,
    count: 12,
    filter,
  });
}

export async function getMilitaryPassesForUser(
  userId: number,
  pageToken?: string | null
): Promise<PageResult<RichGamePass> & { nextPageToken: string | null }> {
  const page = await getMilitaryGamePasses(pageToken, "all");
  const withOwned = await withOwnership(userId, page.items);
  return { ...page, items: withOwned };
}

export async function getMilitaryUniverseBadges(
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxBadge>> {
  return getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, page, cursor);
}

export async function getMilitaryBadgesForUser(userId: number): Promise<RobloxBadge[]> {
  const [userPage, mtPage] = await Promise.all([
    getUserBadgesPage(userId, 0),
    getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, 0),
  ]);
  let mtBadges = [...mtPage.items];
  let cursor = mtPage.nextCursor;
  for (let i = 0; i < 4 && cursor; i++) {
    const next = await getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, i + 1, cursor);
    mtBadges = mtBadges.concat(next.items);
    cursor = next.nextCursor ?? null;
  }
  const mtIds = new Set(mtBadges.map((b) => b.id));

  let owned = [...userPage.items];
  let uCursor = userPage.nextCursor;
  for (let i = 0; i < 3 && uCursor; i++) {
    const next = await getUserBadgesPage(userId, i + 1, uCursor);
    owned = owned.concat(next.items);
    uCursor = next.nextCursor ?? null;
  }

  return owned.filter((b) => mtIds.has(b.id) || b.awarder?.id === MILITARY_TYCOON_UNIVERSE_ID);
}

/** Dashboard of everything we can integrate without owning the game. */
export async function getMtIntegrationSnapshot(): Promise<MtIntegrationSnapshot> {
  const [game, group, roles, experiences, passes, badges] = await Promise.all([
    getMilitaryGame(),
    getInfinityGroup(),
    getInfinityRoleLadder(),
    getInfinityExperiences(),
    listUniverseGamePasses(MILITARY_TYCOON_UNIVERSE_ID, { count: 50, filter: "all" }),
    getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, 0),
  ]);
  return {
    game,
    group,
    roles,
    experiences,
    passesForSale: passes.items.filter((p) => p.isForSale).length,
    passesTotalSample: passes.items.length + (passes.hasMore ? 1 : 0),
    badgeSampleCount: badges.items.length + (badges.hasMore ? 1 : 0),
    openCloudConfigured: Boolean(process.env.ROBLOX_CLOUD_KEY?.trim()),
  };
}
