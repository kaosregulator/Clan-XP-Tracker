import { db, clansTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { GuildMember, User } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

/**
 * Short-lived in-memory cache for clan rows. Keeps the first cold DB hit hot
 * for 30 s so that button handlers (which must look up the clan before they
 * know which action to dispatch) never burn through the 3-second Discord
 * interaction window on a cold Postgres connection.
 */
const clanCache = new Map<string, { clan: Clan; expiresAt: number }>();
const CLAN_CACHE_TTL_MS = 30_000;

export async function getClan(guildId: string): Promise<Clan | null> {
  const hit = clanCache.get(guildId);
  if (hit && hit.expiresAt > Date.now()) return hit.clan;

  const [clan] = await db.select().from(clansTable).where(eq(clansTable.guildId, guildId));
  if (clan) {
    clanCache.set(guildId, { clan, expiresAt: Date.now() + CLAN_CACHE_TTL_MS });
  } else {
    clanCache.delete(guildId);
  }
  return clan ?? null;
}

/** Drop the cached entry for a guild — call after any write to the clans row. */
export function invalidateClanCache(guildId: string): void {
  clanCache.delete(guildId);
}

/** All clans that have completed setup (used by the scheduler & dashboards). */
export async function activeClans(): Promise<Clan[]> {
  return db.select().from(clansTable).where(eq(clansTable.setupComplete, true));
}

/** Ensure a clan row exists for the guild, creating a default one if needed. */
export async function ensureClan(guildId: string, guildName: string): Promise<Clan> {
  const existing = await getClan(guildId);
  if (existing) return existing;
  const [created] = await db
    .insert(clansTable)
    .values({ guildId, guildName, clanName: guildName })
    .returning();
  const clan = created!;
  clanCache.set(guildId, { clan, expiresAt: Date.now() + CLAN_CACHE_TTL_MS });
  return clan;
}

/** Patch a clan's configuration and return the fresh row. */
export async function updateClan(
  guildId: string,
  patch: Partial<typeof clansTable.$inferInsert>
): Promise<Clan | null> {
  const [row] = await db
    .update(clansTable)
    .set(patch)
    .where(eq(clansTable.guildId, guildId))
    .returning();
  // Bust the cache so the next read reflects the new values immediately.
  if (row) clanCache.set(guildId, { clan: row, expiresAt: Date.now() + CLAN_CACHE_TTL_MS });
  else invalidateClanCache(guildId);
  return row ?? null;
}

/**
 * True when the member may manage XP — an officer role, an admin role, a
 * whitelisted user, or a guild manager. Officers run the weekly workflow
 * (update progress, remind, warn, review).
 */
export function isOfficer(member: GuildMember | null, clan: Clan | null): boolean {
  if (!member) return false;
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }
  if (!clan) return false;
  if (clan.adminUserIds.includes(member.id)) return true;
  return (
    clan.staffRoleIds.some((roleId) => member.roles.cache.has(roleId)) ||
    clan.adminRoleIds.some((roleId) => member.roles.cache.has(roleId))
  );
}

/**
 * True when the member may change configuration — a configured admin role, a
 * whitelisted user, or a guild manager. A stricter tier than isOfficer.
 */
export function isAdmin(member: GuildMember | null, clan: Clan | null): boolean {
  if (!member) return false;
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }
  if (!clan) return false;
  if (clan.adminUserIds.includes(member.id)) return true;
  return clan.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

/** Back-compat alias — existing call sites treat "staff" as officer-level. */
export const isStaff = isOfficer;

export interface MemberIdentity {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export function identityFromUser(user: User, displayName?: string): MemberIdentity {
  return {
    userId: user.id,
    username: user.username,
    displayName: displayName ?? user.displayName ?? user.username,
    avatarUrl: user.displayAvatarURL({ size: 256, extension: "png" }),
  };
}

/**
 * Ensure a clan_members row exists and reflects the member's current Discord
 * identity. Returns the up-to-date row.
 */
export async function ensureMember(guildId: string, id: MemberIdentity): Promise<ClanMember> {
  const [existing] = await db
    .select()
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, id.userId)));

  if (existing) {
    // Keep identity fresh without clobbering stats.
    if (
      existing.username !== id.username ||
      existing.displayName !== id.displayName ||
      existing.avatarUrl !== id.avatarUrl
    ) {
      const [updated] = await db
        .update(clanMembersTable)
        .set({ username: id.username, displayName: id.displayName, avatarUrl: id.avatarUrl })
        .where(eq(clanMembersTable.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [created] = await db
    .insert(clanMembersTable)
    .values({
      guildId,
      userId: id.userId,
      username: id.username,
      displayName: id.displayName,
      avatarUrl: id.avatarUrl,
    })
    .returning();
  return created!;
}

export async function getMember(guildId: string, userId: string): Promise<ClanMember | null> {
  const [member] = await db
    .select()
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));
  return member ?? null;
}
