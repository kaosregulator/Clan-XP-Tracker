import { db, warningsTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember, Warning } from "@workspace/db";
import { eq, and, isNull, desc, gte, lt, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { EmbedBuilder, AttachmentBuilder, type Client, type Guild, type User } from "discord.js";
import { logger } from "../../lib/logger";
import { ensureMember, identityFromUser, getMember } from "./config";
import { logAction, sendLog } from "./logging";
import { recordWeeklyWarning, isRequirementSatisfied, listTracked } from "./progress";
import {
  memberWarningBody,
  memberWarningDmContent,
  sanitizeMemberReason,
  periodLabel,
  periodAdjective,
  staffProgressDetail,
  DISPUTE_COMMAND,
} from "./tracking";
import { scheduleDashboardRefresh } from "./commandCenter";
import { createNotification, resolveRelated } from "./notifications";
import { renderOffThread } from "../canvas/render-pool";

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
  /**
   * Staff/audit reason — stored on the warning row and shown in staff logs.
   * May include progress fractions, reminder counts, etc.
   */
  reason: string;
  /**
   * Optional member-facing reason. When omitted, `reason` is sanitized (any
   * staff accounting is stripped) before it reaches the member.
   */
  memberReason?: string | null;
  deliver?: WarnDelivery;
}

export interface IssueWarningResult {
  warning: Warning;
  activeCount: number;
}

/**
 * Render the XP warning canvas card — member-safe, no count/threshold badge.
 * The card carries the warning number (its dispute ticket) and the reason so
 * the canvas and the embed are driven by the same data and cannot drift.
 */
async function renderWarningCardSafe(
  clan: Clan,
  target: User,
  memberReason: string,
  warningNumber: number | null
): Promise<Buffer | null> {
  try {
    return await renderOffThread("warningCard", {
      communityName: clan.clanName,
      memberName: target.username,
      avatarUrl: target.displayAvatarURL({ size: 256, extension: "png" }),
      reason: memberReason,
      warningNumber,
      disputeCommand: DISPUTE_COMMAND,
      // Intentionally omit count/threshold — those are staff-only.
    });
  } catch (err) {
    logger.warn({ err }, "Warning card render failed — falling back to embed");
    return null;
  }
}

/** A fresh attachment for each send — Buffers must not be shared across sends. */
function warningAttachment(card: Buffer): AttachmentBuilder {
  return new AttachmentBuilder(card, { name: "xp-warning.png" });
}

/**
 * Member-facing fallback embed — warning + reason + how to dispute. The warning
 * number is surfaced in the footer as the dispute ticket.
 */
function memberWarningEmbed(
  guildName: string,
  target: User,
  memberReason: string,
  warningNumber: number | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor({ name: `⚠️ XP WARNING • ${guildName}`, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL())
    .setDescription(memberWarningBody(memberReason, warningNumber))
    .setTimestamp();
  if (warningNumber) embed.setFooter({ text: `Warning ticket #${warningNumber} · dispute with ${DISPUTE_COMMAND}` });
  return embed;
}

/** Issue a warning: record it, bump the count, assign roles, log, optionally DM. */
export async function issueWarning(input: IssueWarningInput): Promise<IssueWarningResult> {
  const { client, clan, guild, target } = input;

  await ensureMember(guild.id, identityFromUser(target));

  const memberFacingReason = sanitizeMemberReason(input.memberReason ?? input.reason);
  // Persist the staff reason (full accounting) on the row for audits / officer views.
  const staffReason = input.reason.trim() || memberFacingReason;

  const [warning] = await db
    .insert(warningsTable)
    .values({
      guildId: guild.id,
      userId: target.id,
      username: target.username,
      avatarUrl: target.displayAvatarURL(),
      issuedBy: input.moderatorId,
      issuedByUsername: input.moderatorUsername,
      reason: staffReason,
    })
    .returning();

  await db
    .update(clanMembersTable)
    .set({ warningsCount: sql`${clanMembersTable.warningsCount} + 1` })
    .where(and(eq(clanMembersTable.guildId, guild.id), eq(clanMembersTable.userId, target.id)));

  // XP-enforcement bookkeeping: count this warning against the current period.
  await recordWeeklyWarning(clan, target.id);

  const activeCount = await countActive(guild.id, target.id);
  const memberRow = await getMember(guild.id, target.id);
  const staffDetail = memberRow ? staffProgressDetail(clan, memberRow) : null;

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

  const warningNumber = warning?.id ?? null;

  // Member-facing card: no warning-count badge, no escalation threshold.
  const card =
    clan.cardStyle === "embed"
      ? null
      : await renderWarningCardSafe(clan, target, memberFacingReason, warningNumber);

  // Post to the dedicated warning channel when one is configured. This is a
  // MEMBER-facing surface — never include staff accounting.
  if (deliverChannel && clan.warningChannelId) {
    try {
      const channel = await client.channels.fetch(clan.warningChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        const fallbackEmbed = memberWarningEmbed(guild.name, target, memberFacingReason, warningNumber);
        await channel.send({
          content:
            `⚠️ <@${target.id}> — you received an XP Warning` +
            `${warningNumber ? ` (ticket **#${warningNumber}**)` : ""}. ` +
            `Dispute with \`${DISPUTE_COMMAND}\` — have your XP proof ready.`,
          ...(card ? { files: [warningAttachment(card)] } : { embeds: [fallbackEmbed] }),
          allowedMentions: { users: [target.id] },
        });
        channelPosted = true;
      }
    } catch (err) {
      logger.warn({ err, channel: clan.warningChannelId }, "Warning channel post failed");
    }
  }

  if (deliverDm) {
    const dmEmbed = memberWarningEmbed(guild.name, target, memberFacingReason, warningNumber);
    dmSent = await target
      .send(
        card
          ? {
              content: memberWarningDmContent(memberFacingReason, warningNumber),
              files: [warningAttachment(card)],
            }
          : { embeds: [dmEmbed] }
      )
      .then(() => true)
      .catch(() => false);
  }

  const delivery =
    [channelPosted ? "warn channel" : null, dmSent ? "DM" : null].filter(Boolean).join(" + ") ||
    (deliverChannel || deliverDm ? "not delivered" : "silent");

  // Audit row (DB) — durable staff record of who warned whom, with accounting.
  await logAction(guild.id, {
    action: "warning_issued",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.moderatorId,
    moderatorUsername: input.moderatorUsername,
    details: {
      reason: staffReason,
      memberReason: memberFacingReason,
      warningId: warning?.id,
      activeCount,
      delivery,
      period: periodAdjective(clan),
      progress: staffDetail?.progress ?? null,
      requirement: staffDetail?.requirement ?? null,
      missing: staffDetail?.missing ?? null,
      remindersThisPeriod: staffDetail?.remindersThisPeriod ?? null,
      escalationThreshold: clan.escalationThreshold,
    },
  });

  // Full staff log embed — CAN include progress / accounting.
  const staffFields = [
    { name: "Reason (staff)", value: staffReason.slice(0, 1024) },
    { name: "Active warnings", value: `${activeCount}`, inline: true },
    { name: "Delivered via", value: delivery, inline: true },
    { name: "Tracking period", value: periodLabel(clan), inline: true },
  ];
  if (staffDetail) {
    staffFields.push(
      {
        name: "Progress",
        value: `${staffDetail.progress.toLocaleString()}/${staffDetail.requirement.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Missing",
        value: `${staffDetail.missing.toLocaleString()}`,
        inline: true,
      },
      {
        name: "Reminders this period",
        value: `${staffDetail.remindersThisPeriod}`,
        inline: true,
      }
    );
  }

  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: `Warning issued • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`<@${target.id}> was warned by <@${input.moderatorId}>.`)
      .addFields(...staffFields)
      .setFooter({ text: `Moderator: ${input.moderatorUsername} · ${input.moderatorId}` })
      .setTimestamp()
  );

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
      period: periodAdjective(clan),
      progress: staffDetail?.progress ?? null,
      requirement: staffDetail?.requirement ?? null,
    },
    `Warning issued to ${target.username} by ${input.moderatorUsername} (active: ${activeCount})`
  );

  scheduleDashboardRefresh(guild.id);

  await createNotification({
    guildId: guild.id,
    type: "warning",
    title: `Warning issued — ${target.username}`,
    body: `${staffReason.slice(0, 300)} (now ${activeCount} active)`,
    targetUserId: target.id,
    targetUsername: target.username,
    relatedId: warning?.id ?? null,
    createdBy: input.moderatorId,
    createdByUsername: input.moderatorUsername,
  });
  if (activeCount >= clan.escalationThreshold) {
    await createNotification({
      guildId: guild.id,
      type: "escalation",
      title: `Escalation — ${target.username}`,
      body: `${target.username} is at ${activeCount} active warnings (threshold ${clan.escalationThreshold}). Flag for leadership review.`,
      targetUserId: target.id,
      targetUsername: target.username,
      relatedId: warning?.id ?? null,
      createdBy: input.moderatorId,
      createdByUsername: input.moderatorUsername,
    });
  }

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
  /** Staff/audit reason builder — may include accounting. */
  reason: (member: ClanMember) => string;
  /** Optional member-facing reason builder — sanitized if omitted. */
  memberReason?: (member: ClanMember) => string;
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
        memberReason: opts.memberReason?.(member) ?? null,
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
 * per-member warnings. Used by `/xp role warn` in "announce" mode. Member-
 * facing — reason is sanitized before posting.
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
      .setAuthor({ name: `⚠️ XP WARNING • ${clan.clanName}` })
      .setDescription(memberWarningBody(opts.reason))
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

  scheduleDashboardRefresh(guild.id);
  await resolveRelated(guild.id, "warning", warningId);
  await resolveRelated(guild.id, "escalation", warningId);

  return warning;
}

/**
 * Auto-remove the warning role on the schedule a server owner configured.
 *
 * When `clan.warningRemovalHours` is > 0, every active warning older than that
 * many hours is expired (marked removed), which decrements the member's count
 * and — via removeWarning — strips the warning role once they have no active
 * warnings left. This is the timer counterpart to requirement-based clearance.
 *
 * Best-effort and idempotent: safe to call every scheduler tick. Returns how
 * many warnings were expired so the caller can log a summary.
 */
export async function autoExpireWarnings(client: Client, clan: Clan): Promise<number> {
  if (!clan.warningRemovalHours || clan.warningRemovalHours <= 0) return 0;

  const cutoff = new Date(Date.now() - clan.warningRemovalHours * 3600_000);
  const stale = await db
    .select()
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, clan.guildId),
        isNull(warningsTable.removedAt),
        lt(warningsTable.issuedAt, cutoff)
      )
    );
  if (!stale.length) return 0;

  const guild = await client.guilds.fetch(clan.guildId).catch(() => null);
  if (!guild) return 0;

  let removed = 0;
  for (const w of stale) {
    const res = await removeWarning({
      guild,
      clan,
      warningId: w.id,
      moderatorId: "system",
      moderatorUsername: "Auto-removal",
    });
    if (res) removed++;
  }

  if (removed > 0) {
    logger.info(
      { event: "warnings_auto_expired", guildId: clan.guildId, removed, hours: clan.warningRemovalHours },
      `Auto-expired ${removed} warning(s) older than ${clan.warningRemovalHours}h`
    );
  }
  return removed;
}

/**
 * Clear warning roles for members who have **satisfied the configured
 * activity requirement** for the current tracking period.
 *
 * Eligibility is driven ONLY by requirement satisfaction
 * (`isRequirementSatisfied`), never by "an XP ledger row exists" or "XP was
 * sent". Completing the requirement expires active warnings (which strips the
 * role once none remain). Incomplete members keep the role.
 *
 * Safe to call after progress writes and on the scheduler cadence.
 */
export async function clearWarningRolesForSatisfiedMembers(
  client: Client,
  clan: Clan
): Promise<number> {
  if (!clan.warningRoleIds.length) return 0;

  const guild = await client.guilds.fetch(clan.guildId).catch(() => null);
  if (!guild) return 0;

  const members = await listTracked(clan);
  let cleared = 0;

  for (const member of members) {
    // XP bookkeeping alone is not enough — the configured requirement must be met.
    if (!isRequirementSatisfied(clan, member)) continue;
    if (member.exempt || member.onLeave) continue;

    const active = await listActive(clan.guildId, member.userId);
    if (!active.length) {
      // Role may linger with zero active warnings — strip it if present.
      const gm = await guild.members.fetch(member.userId).catch(() => null);
      if (gm && clan.warningRoleIds.some((id) => gm.roles.cache.has(id))) {
        await gm.roles.remove(clan.warningRoleIds).catch(() => {});
        cleared++;
      }
      continue;
    }

    for (const w of active) {
      await removeWarning({
        guild,
        clan,
        warningId: w.id,
        moderatorId: "system",
        moderatorUsername: "Auto-removal (requirement met)",
      });
    }
    cleared++;
  }

  if (cleared > 0) {
    logger.info(
      {
        event: "warning_roles_cleared_on_requirement",
        guildId: clan.guildId,
        cleared,
        period: periodAdjective(clan),
      },
      `Cleared warning role(s) for ${cleared} member(s) who met the ${periodAdjective(clan)} requirement`
    );
  }
  return cleared;
}

/**
 * After a single member's progress is updated: if they just satisfied the
 * requirement, expire their active warnings / strip the warning role.
 * No-ops when the member is still short of the goal — including the case
 * where an XP ledger entry exists but does not meet the requirement.
 */
export async function clearWarningRoleIfRequirementMet(
  guild: Guild,
  clan: Clan,
  userId: string
): Promise<boolean> {
  if (!clan.warningRoleIds.length) return false;
  const member = await getMember(clan.guildId, userId);
  if (!member || !isRequirementSatisfied(clan, member)) return false;

  const active = await listActive(clan.guildId, userId);
  if (!active.length) {
    const gm = await guild.members.fetch(userId).catch(() => null);
    if (gm && clan.warningRoleIds.some((id) => gm.roles.cache.has(id))) {
      await gm.roles.remove(clan.warningRoleIds).catch(() => {});
      return true;
    }
    return false;
  }

  for (const w of active) {
    await removeWarning({
      guild,
      clan,
      warningId: w.id,
      moderatorId: "system",
      moderatorUsername: "Auto-removal (requirement met)",
    });
  }
  return true;
}
