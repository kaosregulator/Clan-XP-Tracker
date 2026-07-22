import { db, warningsTable, clanMembersTable } from "@workspace/db";
import type { Clan, Warning } from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { EmbedBuilder, type Client, type Guild, type User } from "discord.js";
import { logger } from "../../lib/logger";
import { ensureMember, identityFromUser } from "./config";
import { logAction, sendLog } from "./logging";

export interface IssueWarningInput {
  client: Client;
  clan: Clan;
  guild: Guild;
  target: User;
  moderatorId: string;
  moderatorUsername: string;
  reason: string;
}

export interface IssueWarningResult {
  warning: Warning;
  activeCount: number;
}

/** Issue a warning: record it, bump the count, assign roles, log, optionally DM. */
export async function issueWarning(input: IssueWarningInput): Promise<IssueWarningResult> {
  const { client, clan, guild, target } = input;

  await ensureMember(guild.id, identityFromUser(target));

  const [warning] = await db
    .insert(warningsTable)
    .values({
      guildId: guild.id,
      userId: target.id,
      username: target.username,
      avatarUrl: target.displayAvatarURL(),
      issuedBy: input.moderatorId,
      issuedByUsername: input.moderatorUsername,
      reason: input.reason,
    })
    .returning();

  await db
    .update(clanMembersTable)
    .set({ warningsCount: sql`${clanMembersTable.warningsCount} + 1` })
    .where(and(eq(clanMembersTable.guildId, guild.id), eq(clanMembersTable.userId, target.id)));

  const activeCount = await countActive(guild.id, target.id);

  // Assign configured warning roles (best-effort).
  if (clan.warningRoleIds.length) {
    try {
      const gm = await guild.members.fetch(target.id).catch(() => null);
      if (gm) await gm.roles.add(clan.warningRoleIds).catch(() => {});
    } catch (err) {
      logger.warn({ err }, "Failed to assign warning roles");
    }
  }

  await logAction(guild.id, {
    action: "warning_issued",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.moderatorId,
    moderatorUsername: input.moderatorUsername,
    details: { reason: input.reason, warningId: warning?.id, activeCount },
  });

  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `Warning issued • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`<@${target.id}> was warned by <@${input.moderatorId}>.`)
      .addFields(
        { name: "Reason", value: input.reason.slice(0, 1024) },
        { name: "Active warnings", value: `${activeCount}`, inline: true }
      )
      .setTimestamp()
  );

  if (clan.dmOnWarn) {
    await target
      .send(
        `⚠️ You've received a warning in **${guild.name}**.\n> ${input.reason}\n\nYou now have **${activeCount}** active warning(s).`
      )
      .catch(() => {});
  }

  return { warning: warning!, activeCount };
}

export async function countActive(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt)
      )
    );
  return row?.count ?? 0;
}

export async function listActive(guildId: string, userId: string): Promise<Warning[]> {
  return db
    .select()
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt)
      )
    )
    .orderBy(desc(warningsTable.issuedAt));
}

export interface RemoveWarningInput {
  guild: Guild;
  clan: Clan;
  warningId: number;
  moderatorId: string;
  moderatorUsername: string;
}

export async function removeWarning(input: RemoveWarningInput): Promise<Warning | null> {
  const { guild, clan, warningId } = input;
  const [warning] = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.id, warningId), eq(warningsTable.guildId, guild.id)));
  if (!warning || warning.removedAt) return null;

  await db
    .update(warningsTable)
    .set({ removedAt: new Date(), removedBy: input.moderatorId })
    .where(eq(warningsTable.id, warningId));

  await db
    .update(clanMembersTable)
    .set({ warningsCount: sql`greatest(${clanMembersTable.warningsCount} - 1, 0)` })
    .where(and(eq(clanMembersTable.guildId, guild.id), eq(clanMembersTable.userId, warning.userId)));

  const activeCount = await countActive(guild.id, warning.userId);

  // Clear warning roles once no active warnings remain.
  if (activeCount === 0 && clan.warningRoleIds.length) {
    const gm = await guild.members.fetch(warning.userId).catch(() => null);
    if (gm) await gm.roles.remove(clan.warningRoleIds).catch(() => {});
  }

  await logAction(guild.id, {
    action: "warning_removed",
    targetUserId: warning.userId,
    targetUsername: warning.username,
    moderatorId: input.moderatorId,
    moderatorUsername: input.moderatorUsername,
    details: { warningId, activeCount },
  });

  return warning;
}
