import {
  INFINITY_INTERACTIVE_GROUP_ID,
  MILITARY_TYCOON_PLACE_ID,
  MILITARY_TYCOON_UNIVERSE_ID,
} from "./constants";
import { getUserById, resolveUsername } from "./users";
import { getUserPresence } from "./presence";
import { getUserThumbnails } from "./thumbnails";
import { getGroupMembership, getGroupDetails } from "./groups";
import { getGameByUniverseId, getPublicServers, getGamePasses } from "./games";
import { getUniverseBadgesPage, getUserBadgesPage } from "./badges";
import type { MilitaryPlayerData, RobloxBadge, RobloxGame, RobloxGamePass, RobloxServer, PageResult } from "./types";

export async function getMilitaryGame(): Promise<RobloxGame> {
  return getGameByUniverseId(MILITARY_TYCOON_UNIVERSE_ID);
}

export async function getInfinityGroup() {
  return getGroupDetails(INFINITY_INTERACTIVE_GROUP_ID);
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
      presence.lastLocation ||
      (isPlaying ? game?.name ?? "Military Tycoon ®" : null);
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
  cursor?: string | null
): Promise<PageResult<RobloxGamePass>> {
  return getGamePasses(MILITARY_TYCOON_UNIVERSE_ID, cursor);
}

export async function getMilitaryUniverseBadges(
  page = 0,
  cursor?: string | null
): Promise<PageResult<RobloxBadge>> {
  return getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, page, cursor);
}

/**
 * Badges the user owns that belong to Military Tycoon (best-effort filter).
 * Roblox does not expose a direct "user badges for universe" public endpoint,
 * so we intersect user badges with MT universe badges (first pages).
 */
export async function getMilitaryBadgesForUser(
  userId: number
): Promise<RobloxBadge[]> {
  const [userPage, mtPage] = await Promise.all([
    getUserBadgesPage(userId, 0),
    getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, 0),
  ]);
  // Pull a couple more MT badge pages for a better intersection set.
  let mtBadges = [...mtPage.items];
  let cursor = mtPage.nextCursor;
  for (let i = 0; i < 4 && cursor; i++) {
    const next = await getUniverseBadgesPage(MILITARY_TYCOON_UNIVERSE_ID, i + 1, cursor);
    mtBadges = mtBadges.concat(next.items);
    cursor = next.nextCursor ?? null;
  }
  const mtIds = new Set(mtBadges.map((b) => b.id));

  // Also scan a few user badge pages.
  let owned = [...userPage.items];
  let uCursor = userPage.nextCursor;
  for (let i = 0; i < 3 && uCursor; i++) {
    const next = await getUserBadgesPage(userId, i + 1, uCursor);
    owned = owned.concat(next.items);
    uCursor = next.nextCursor ?? null;
  }

  return owned.filter((b) => mtIds.has(b.id) || b.awarder?.id === MILITARY_TYCOON_UNIVERSE_ID);
}
