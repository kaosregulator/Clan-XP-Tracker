/**
 * Cookie-less robloxian-api client used as a secondary public-API provider.
 * NEVER configures .ROBLOSECURITY — public endpoints only.
 */
import { createRequire } from "node:module";
import { logger } from "../../../../lib/logger";

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

let client: AnyClient | null = null;

export function getRobloxianClient(): AnyClient {
  if (client) return client;
  // CommonJS package
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("robloxian-api") as {
    RobloxClient: new (opts?: Record<string, unknown>) => AnyClient;
  };
  client = new mod.RobloxClient({
    // Intentionally NO cookie — public APIs only.
    useProxy: true,
    logLevel: "warn",
    timeout: 8_000,
    maxRetries: 2,
  });
  logger.info("robloxian-api secondary provider ready (no cookie)");
  return client;
}

export async function rbxianUserByName(username: string) {
  const c = getRobloxianClient();
  return c.fetchRobloxUser(username);
}

export async function rbxianUserDetails(userId: number) {
  const c = getRobloxianClient();
  return c.fetchUserDetails(userId);
}

export async function rbxianPresence(userIds: number[]) {
  const c = getRobloxianClient();
  return c.fetchUserPresence(userIds);
}

export async function rbxianUniverse(universeId: number) {
  const c = getRobloxianClient();
  return c.fetchUniverseInfo(universeId);
}

export async function rbxianServers(placeId: number) {
  const c = getRobloxianClient();
  return c.fetchGameServers(placeId, { limit: 10 });
}

export async function rbxianGroupRole(userId: number, groupId: number) {
  const c = getRobloxianClient();
  return c.fetchUserGroupRole(userId, groupId);
}

export async function rbxianGroupRoles(groupId: number) {
  const c = getRobloxianClient();
  return c.fetchGroupRoles(groupId);
}

export async function rbxianOwnsGamePass(userId: number, gamePassId: number) {
  const c = getRobloxianClient();
  return c.checkUserOwnsGamepass(userId, gamePassId);
}

export async function rbxianGamePassInfo(gamePassId: number) {
  const c = getRobloxianClient();
  return c.fetchGamepassInfo(gamePassId);
}

export async function rbxianOwnsBadge(userId: number, badgeId: number) {
  const c = getRobloxianClient();
  return c.checkUserOwnsBadge(userId, badgeId);
}

export async function rbxianAvatar(userId: number) {
  const c = getRobloxianClient();
  return c.fetchRobloxUserAvatar(userId);
}
