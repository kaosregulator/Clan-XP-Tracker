import { db, warningsTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember, Warning } from "@workspace/db";
import { eq, and, isNull, desc, gte, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { EmbedBuilder, type Client, type Guild, type User } from "discord.js";
import { logger } from "../../lib/logger";
import { ensureMember, identityFromUser } from "./config";
import { logAction, sendLog } from "./logging";
import { recordWeeklyWarning } from "./progress";

/**
 * Where a warning is delivered. Both default to the clan settings when
 * omitted (channel post when a warn channel is set, DM when dmOnWarn is on),
 * so callers that don't care keep the old behaviour. A slash command can pass
 * explicit flags to let the officer pick channel, DM, or both.
 */
export interface WarnDelivery {
  channel?: boolean;
  dm?: boolean;
}

export interface IssueWarningInput {
  client: Client;
  clan: Clan;
  guild: Guild;
  target: User;
  moderatorId: string;
  moderatorUsername: string;
  reason: string;
  deliver?: WarnDelivery;
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

  // XP-enforcement bookkeeping: count this warning against the current week.
  await recordWeeklyWarning(clan, target.id);

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

  const deliverChannel = input.deliver?.channel ?? true;
  const deliverDm = input.deliver?.dm ?? clan.dmOnWarn;
  let channelPosted = false;
  let dmSent = false;

  // Post to the dedicated warning channel when one is configured. The post
  // pings the member and shows their avatar so it reads as a real callout.
  if (deliverChannel && clan.warningChannelId) {
    try {
      const channel = await client.channels.fetch(clan.warningChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        const embed = new EmbedBuilder()
          .setColor(0xed4245)
          .setAuthor({
            name: `XP Warning • ${target.username}`,
            iconURL: target.displayAvatarURL(),
          })
          .setThumbnail(target.displayAvatarURL())
          .setDescription(input.reason.slice(0, 4096))
          .addFields({
            name: "Active warnings",
            value: `${activeCount}`,
            inline: true,
          })
          .setFooter({ text: `Warned by ${input.moderatorUsername}` })
          .setTimestamp();
        await channel.send({
          content: `⚠️ <@${target.id}>`,
          embeds: [embed],
          allowedMentions: { users: [target.id] },
        });
        channelPosted = true;
      }
    } catch (err) {
      logger.warn({ err, channel: clan.warningChannelId }, "Warning channel post failed");
    }
  }

  if (deliverDm) {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `Warning • ${guild.name}`, iconURL: target.displayAvatarURL() })
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `You've received a warning.\n\n**Reason:** ${input.reason}\n\nYou now have **${activeCount}** active warning(s).`
      )
      .setTimestamp();
    dmSent = await target
      .send({ embeds: [dmEmbed] })
      .then(() => true)
      .catch(() => false);
  }

  // Describe how the member was actually notified, for the log trail.
  const delivery =
    [channelPosted ? "warn channel" : null, dmSent ? "DM" : null].filter(Boolean).join(" + ") ||
    (deliverChannel || deliverDm ? "not delivered" : "silent");

  // Audit row (DB) — the durable record of who warned whom.
  await logAction(guild.id, {
    action: "warning_issued",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.moderatorId,
    moderatorUsername: input.moderatorUsername,
    details: { reason: input.reason, warningId: warning?.id, activeCount, delivery },
  });

  // Full log embed → the dedicated log channel (separate from the public warn
  // channel where the member is actually pinged).
  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `Warning issued • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`<@${target.id}> was warned by <@${input.moderatorId}>.`)
      .addFields(
        { name: "Reason", value: input.reason.slice(0, 1024) },
        { name: "Active warnings", value: `${activeCount}`, inline: true },
        { name: "Delivered via", value: delivery, inline: true }
      )
      .setFooter({ text: `Moderator: ${input.moderatorUsername} · ${input.moderatorId}` })
      .setTimestamp()
  );

  // Verifiable structured log: who warned whom, and how it was delivered.
  logger.info(
    {
      event: "warning_issued",
      guildId: guild.id,
      warningId: warning?.id,
      targetId: target.id,
      targetUsername: target.username,
      moderatorId: input.moderatorId,
      moderatorUsername: input.moderatorUsername,
      activeCount,
      channelPosted,
      dmSent,
    },
    `Warning issued to ${target.username} by ${input.moderatorUsername} (active: ${activeCount})`
  );

  return { warning: warning!, activeCount };
}

/**
 * The most recent active warning for a member issued within `windowMs`, or
 * null. Used to stop the same member being warned (and pinged) twice in quick
 * succession by stacked commands or a slip of the finger.
 */
export async function recentWarning(
  guildId: string,
  userId: string,
  windowMs = 20 * 3600_000
): Promise<Warning | null> {
  const cutoff = new Date(Date.now() - windowMs);
  const [row] = await db
    .select()
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt),
        gte(warningsTable.issuedAt, cutoff)
      )
    )
    .orderBy(desc(warningsTable.issuedAt))
    .limit(1);
  return row ?? null;
}

export interface BulkWarnResult {
  issued: number;
  skipped: number;
  escalated: string[];
}

/**
 * Warn many members with Discord-safe pacing. Mirrors sendBulkReminders so a
 * role-wide `/xp role warn` behaves like the single-member `/xp warn`. Members
 * whose account can't be fetched are skipped. Anyone who crosses the clan's
 * escalation threshold is returned so the caller can flag them for leadership.
 * When `skipIfWarnedRecently` is set, members already warned in the last 20
 * hours are skipped so stacked commands can't double-ping anyone.
 */
export async function sendBulkWarnings(opts: {
  client: Client;
  clan: Clan;
  guild: Guild;
  targets: ClanMember[];
  moderatorId: string;
  moderatorUsername: string;
  reason: (member: ClanMember) => string;
  deliver?: WarnDelivery;
  skipIfWarnedRecently?: boolean;
}): Promise<BulkWarnResult> {
  const { client, clan, guild, targets } = opts;
  const queue = new PQueue({ concurrency: 2, intervalCap: 2, interval: 1000 });
  let issued = 0;
  let skipped = 0;
  const escalated: string[] = [];
  for (const member of targets) {
    queue.add(async () => {
      if (opts.skipIfWarnedRecently && (await recentWarning(clan.guildId, member.userId))) {
        skipped++;
        return;
      }
      const user = await client.users.fetch(member.userId).catch(() => null);
      if (!user) return;
      const { activeCount } = await issueWarning({
        client,
        clan,
        guild,
        target: user,
        moderatorId: opts.moderatorId,
        moderatorUsername: opts.moderatorUsername,
        reason: opts.reason(member),
        deliver: opts.deliver,
      });
      issued++;
      if (activeCount >= clan.escalationThreshold) {
        escalated.push(`<@${member.userId}> (${activeCount})`);
      }
    });
  }
  await queue.onIdle();
  return { issued, skipped, escalated };
}

/**
 * Post a single warning announcement that pings a whole role, without issuing
 * per-member warnings. Used by `/xp role warn` in "announce" mode when the
 * officer just wants one visible callout instead of a record against each
 * member. Returns whether the message was posted.
 */
export async function postWarningAnnouncement(opts: {
  client: Client;
  clan: Clan;
  roleId: string;
  reason: string;
  moderatorUsername: string;
}): Promise<boolean> {
  const { client, clan } = opts;
  if (!clan.warningChannelId) return false;
  try {
    const channel = await client.channels.fetch(clan.warningChannelId);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `XP Warning • ${clan.clanName}` })
      .setDescription(opts.reason.slice(0, 4096))
      .setFooter({ text: `Warned by ${opts.moderatorUsername}` })
      .setTimestamp();
    await channel.send({
      content: `⚠️ <@&${opts.roleId}>`,
      embeds: [embed],
      allowedMentions: { roles: [opts.roleId] },
    });
    return true;
  } catch (err) {
    logger.warn({ err, channel: clan.warningChannelId }, "Warning announcement post failed");
    return false;
  }
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
