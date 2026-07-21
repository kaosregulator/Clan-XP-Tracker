import { db, clansTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { GuildMember, User } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

export async function getClan(guildId: string): Promise<Clan | null> {
  const [clan] = await db.select().from(clansTable).where(eq(clansTable.guildId, guildId));
  return clan ?? null;
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
  return created!;
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
  return row ?? null;
}

/** True when the member is clan staff — configured staff role, or a guild manager. */
export function isStaff(member: GuildMember | null, clan: Clan | null): boolean {
  if (!member) return false;
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }
  if (!clan) return false;
  return clan.staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

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
