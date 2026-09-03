/** Military Tycoon / InfinityInteractive constants (verified against Roblox). */
export const INFINITY_INTERACTIVE_GROUP_ID = 11257245;
export const MILITARY_TYCOON_PLACE_ID = 7180042682;
/** Verified via apis.roblox.com/universes/v1/places/7180042682/universe */
export const MILITARY_TYCOON_UNIVERSE_ID = 2788648141;
export const MILITARY_TYCOON_NAME = "Military Tycoon ®";
export const INFINITY_INTERACTIVE_NAME = "InfinityInteractive";

export const ROBLOX_PROFILE_URL = (userId: number) =>
  `https://www.roblox.com/users/${userId}/profile`;
export const ROBLOX_GAME_URL = (placeId: number) =>
  `https://www.roblox.com/games/${placeId}`;
export const ROBLOX_GROUP_URL = (groupId: number) =>
  `https://www.roblox.com/communities/${groupId}`;
