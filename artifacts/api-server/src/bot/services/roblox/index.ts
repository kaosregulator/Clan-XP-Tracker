import { getUserById, resolveUsername, getUsernameHistory, searchUsers } from "./users";
import { getUserPresence } from "./presence";
import { getUserThumbnails } from "./thumbnails";
import {
  getFriendCount,
  getFollowerCount,
  getFollowingCount,
  getFriendsPage,
  getFollowersPage,
  getFollowingPage,
} from "./friends";
import { getUserGroups, getUserGroupsPage, getGroupMembership, getGroupDetails } from "./groups";
import {
  getGameByUniverseId,
  getGameByPlaceId,
  resolveGame,
  searchGames,
  getUserGames,
  getPublicServers,
  getGamePasses,
  formatCount,
} from "./games";
import { getUserBadgesPage, getUniverseBadgesPage, estimateUserBadgeCount } from "./badges";
import { canViewInventory, getPublicInventoryPage } from "./inventory";
import {
  listUniverseGamePasses,
  userOwnsGamePass,
  withOwnership,
  gamePassUrl,
} from "./passes";
import * as military from "./militaryTycoon";
import { ensureRobloxClient, hasOpenCloudKey } from "./client";
import type { PlayerCardData } from "./types";
import { PRESENCE_EMOJI, PRESENCE_LABEL } from "./types";
import {
  INFINITY_INTERACTIVE_GROUP_ID,
  MILITARY_TYCOON_PLACE_ID,
  MILITARY_TYCOON_UNIVERSE_ID,
  MILITARY_TYCOON_NAME,
  INFINITY_INTERACTIVE_NAME,
  ROBLOX_PROFILE_URL,
  ROBLOX_GAME_URL,
  ROBLOX_GROUP_URL,
} from "./constants";

ensureRobloxClient();

export async function getPlayerCardData(userId: number): Promise<PlayerCardData> {
  const [user, thumbs, presence, friendCount, followerCount, followingCount, groups, badgeCount] =
    await Promise.all([
      getUserById(userId),
      getUserThumbnails(userId),
      getUserPresence(userId),
      getFriendCount(userId).catch(() => null),
      getFollowerCount(userId).catch(() => null),
      getFollowingCount(userId).catch(() => null),
      getUserGroups(userId).catch(() => null),
      estimateUserBadgeCount(userId).catch(() => null),
    ]);

  let currentGameName: string | null = null;
  if (presence?.userPresenceType === 2) {
    currentGameName = presence.lastLocation;
    if (presence.universeId) {
      try {
        const g = await getGameByUniverseId(presence.universeId);
        currentGameName = g.name;
      } catch {
        /* keep lastLocation */
      }
    }
  }

  return {
    user,
    thumbs,
    presence,
    currentGameName,
    friendCount,
    followerCount,
    followingCount,
    groupCount: groups?.length ?? null,
    badgeCount,
  };
}

export const RobloxService = {
  getUserById,
  resolveUsername,
  searchUsers,
  getUsernameHistory,
  getPlayerCardData,
  getUserPresence,
  getUserThumbnails,
  getFriendCount,
  getFollowerCount,
  getFollowingCount,
  getFriendsPage,
  getFollowersPage,
  getFollowingPage,
  getUserGroups,
  getUserGroupsPage,
  getGroupMembership,
  getGroupDetails,
  getGameByUniverseId,
  getGameByPlaceId,
  resolveGame,
  searchGames,
  getUserGames,
  getPublicServers,
  getGamePasses,
  formatCount,
  getUserBadgesPage,
  getUniverseBadgesPage,
  estimateUserBadgeCount,
  canViewInventory,
  getPublicInventoryPage,
  listUniverseGamePasses,
  userOwnsGamePass,
  withOwnership,
  gamePassUrl,
  military,
  hasOpenCloudKey,
  PRESENCE_EMOJI,
  PRESENCE_LABEL,
  INFINITY_INTERACTIVE_GROUP_ID,
  MILITARY_TYCOON_PLACE_ID,
  MILITARY_TYCOON_UNIVERSE_ID,
  MILITARY_TYCOON_NAME,
  INFINITY_INTERACTIVE_NAME,
  ROBLOX_PROFILE_URL,
  ROBLOX_GAME_URL,
  ROBLOX_GROUP_URL,
};

export type { PlayerCardData };
export type { RichGamePass } from "./passes";
export * from "./types";
export * from "./constants";
export { toUserError, RobloxServiceError, logRobloxError } from "./errors";
