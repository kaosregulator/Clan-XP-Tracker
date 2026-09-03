/**
 * Roblox service types + capability map (RoZod 6.9.0 audit).
 *
 * Access legend:
 *   PUBLIC        — works without cookies / Open Cloud key
 *   AUTHENTICATED — requires .ROBLOSECURITY (we do NOT use cookies)
 *   OPEN_CLOUD    — requires ROBLOX_CLOUD_KEY (Open Cloud API key)
 *   NOT_AVAILABLE — no legitimate public/API path for our bot use-case
 *
 * Feature                         Access          RoZod / notes
 * ------------------------------  --------------  --------------------------------
 * Users by id                     PUBLIC          usersv1.getUsersUserid
 * Username lookup                 PUBLIC          usersv1.postUsernamesUsers
 * User search                     PUBLIC          usersv1.getUsersSearch
 * Username history                PUBLIC          usersv1.getUsersUseridUsernameHistory
 * Avatars (full/bust/head)        PUBLIC          thumbnailsv1.getUsersAvatar*
 * 3D avatar thumbnail             PUBLIC          thumbnailsv1.getUsersAvatar3d
 * Currently wearing               PUBLIC          avatarv1.getUsersUseridCurrentlyWearing
 * Outfits                         PUBLIC          avatarv1.getUsersUseridOutfits
 * Friends list / count            PUBLIC          friendsv1.getUsersUseridFriends*
 * Followers / following           PUBLIC          friendsv1.getUsersTargetuserid*
 * Presence                        PUBLIC          presencev1.postPresenceUsers
 * Groups / roles for user         PUBLIC          groupsv2.getUsersUseridGroupsRoles
 * Group details / roles           PUBLIC          groupsv1.getGroupsGroupid*
 * Group members (paged)           PUBLIC          groupsv1.getGroupsGroupidUsers
 * Group icons                     PUBLIC          thumbnailsv1.getGroupsIcons
 * Games by universe id            PUBLIC          gamesv1.getGames
 * Game icons / thumbnails         PUBLIC          thumbnailsv1.getGamesIcons / multiget
 * Public servers                  PUBLIC          gamesv1.getGamesPlaceidServersServertype
 * User experiences                PUBLIC          gamesv2.getUsersUseridGames
 * Votes (likes/dislikes)          PUBLIC          gamesv1.getGamesUniverseidVotes
 * Game passes                     PUBLIC          gamesv1.getGamesUniverseidGamePasses
 * Badges (user / universe)        PUBLIC          badgesv1 user + universe endpoints
 * Badge icons                     PUBLIC          thumbnailsv1.getBadgesIcons
 * Inventory visibility check      PUBLIC          inventoryv1.getUsersUseridCanViewInventory
 * Inventory / collectibles        PUBLIC*         only when canView is true
 * Catalog / Creator Store         PUBLIC          catalogv1 item details
 * Game name search                PUBLIC+         Not in RoZod — omni-search API
 * Place to universe               PUBLIC+         Not in RoZod — universes API
 * Open Cloud DataStores           OPEN_CLOUD      opencloud/v1/datastores
 * MemoryStores / Messaging        OPEN_CLOUD      opencloud messaging / v2
 * User restrictions               OPEN_CLOUD      (not used here)
 * Analytics                       OPEN_CLOUD      (not used here)
 * Private MT player stats         NOT_AVAILABLE   No public API
 * Cookie-auth inventory           AUTHENTICATED   Intentionally unused
 *
 * + Thin official HTTP wrappers in games.ts — preferred over scraping.
 * * Inventory endpoints only succeed when the target user has a public inventory.
 */

export type PresenceType = 0 | 1 | 2 | 3;

export const PRESENCE_LABEL: Record<PresenceType, string> = {
  0: "Offline",
  1: "Online",
  2: "In Game",
  3: "In Studio",
};

export const PRESENCE_EMOJI: Record<PresenceType, string> = {
  0: "🔴",
  1: "🟢",
  2: "🎮",
  3: "🛠️",
};

export interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
  description: string;
  created: string | null;
  isBanned: boolean;
  hasVerifiedBadge: boolean;
}

export interface RobloxUserSearchHit {
  id: number;
  name: string;
  displayName: string;
  hasVerifiedBadge: boolean;
  previousUsernames: string[];
}

export interface RobloxPresence {
  userId: number;
  userPresenceType: PresenceType;
  lastLocation: string | null;
  placeId: number | null;
  rootPlaceId: number | null;
  universeId: number | null;
  gameId: string | null;
}

export interface RobloxThumbnails {
  headshot: string | null;
  bust: string | null;
  fullBody: string | null;
  avatar3d: string | null;
}

export type AvatarView = "headshot" | "bust" | "fullBody";

export interface RobloxGroupRole {
  groupId: number;
  groupName: string;
  groupIconUrl: string | null;
  roleName: string;
  rank: number;
  memberCount: number | null;
  isPrimary?: boolean;
}

export interface RobloxFriend {
  id: number;
  name: string;
  displayName: string;
  hasVerifiedBadge: boolean;
  headshotUrl: string | null;
  presence?: RobloxPresence | null;
}

export interface RobloxBadge {
  id: number;
  name: string;
  description: string;
  displayName: string;
  enabled: boolean;
  iconUrl: string | null;
  awardedDate: string | null;
  awarder?: { id: number; type: number } | null;
  statistics?: {
    awardedCount: number;
    winRatePercentage: number;
  } | null;
}

export interface RobloxGame {
  universeId: number;
  rootPlaceId: number;
  name: string;
  description: string;
  creator: {
    id: number;
    name: string;
    type: string;
    hasVerifiedBadge: boolean;
  };
  playing: number;
  visits: number;
  favoritedCount: number;
  maxPlayers: number;
  created: string | null;
  updated: string | null;
  genre: string | null;
  iconUrl: string | null;
  thumbnailUrl: string | null;
  upVotes: number | null;
  downVotes: number | null;
}

export interface RobloxServer {
  id: string;
  maxPlayers: number;
  playing: number;
  fps: number | null;
  ping: number | null;
}

export interface RobloxGamePass {
  id: number;
  name: string;
  displayName: string;
  productId: number | null;
  price: number | null;
  iconUrl: string | null;
}

export interface RobloxInventoryItem {
  assetId: number;
  name: string;
  assetType: string | null;
  recentAveragePrice: number | null;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

export interface PlayerCardData {
  user: RobloxUser;
  thumbs: RobloxThumbnails;
  presence: RobloxPresence | null;
  currentGameName: string | null;
  friendCount: number | null;
  followerCount: number | null;
  followingCount: number | null;
  groupCount: number | null;
  badgeCount: number | null;
}

export interface MilitaryPlayerData {
  user: RobloxUser;
  thumbs: RobloxThumbnails;
  presence: RobloxPresence | null;
  currentGameName: string | null;
  isPlayingMilitaryTycoon: boolean;
  groupMembership: RobloxGroupRole | null;
  game: RobloxGame | null;
}

export type HubView =
  | "home"
  | "player"
  | "profile"
  | "avatar"
  | "groups"
  | "badges"
  | "friends"
  | "followers"
  | "following"
  | "games"
  | "game"
  | "servers"
  | "history"
  | "inventory"
  | "status"
  | "military"
  | "militaryPlayer"
  | "militaryRank"
  | "militaryBadges"
  | "militaryItems"
  | "search";
