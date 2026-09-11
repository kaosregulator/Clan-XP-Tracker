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
  categoryEnforcementNoun,
  enforcementEmbedAuthor,
} from "./tracking";
import { scheduleDashboardRefresh } from "./commandCenter";
import { createNotification, resolveRelated } from "./notifications";
import { renderOffThread } from "../canvas/render-pool";

/** Live check: exempt flag OR configured exempt/leave roles on the Discord member. */
export async function isImmuneFromEnforcement(
  guild: Guild,
  clan: Clan,
  userId: string,
  member?: ClanMember | null
): Promise<{ immune: boolean; reason: string }> {
  if (member?.exempt) return { immune: true, reason: "marked exempt" };
  if (member?.onLeave) return { immune: true, reason: "on leave" };

  const needRoles = clan.exemptRoleIds.length > 0 || clan.leaveRoleIds.length > 0;
  if (!needRoles) return { immune: false, reason: "" };

  const gm = await guild.members.fetch(userId).catch(() => null);
  if (!gm) return { immune: false, reason: "" };

  if (clan.exemptRoleIds.some((id) => gm.roles.cache.has(id))) {
    // Keep the DB flag in sync so dashboards / filters stay honest.
    await db
      .update(clanMembersTable)
      .set({ exempt: true })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          eq(clanMembersTable.userId, userId),
          eq(clanMembersTable.exempt, false)
        )
      )
      .catch(() => {});
    return { immune: true, reason: "exempt role" };
  }
  if (clan.leaveRoleIds.some((id) => gm.roles.cache.has(id))) {
    await db
      .update(clanMembersTable)
      .set({ onLeave: true })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          eq(clanMembersTable.userId, userId),
          eq(clanMembersTable.onLeave, false)
        )
      )
      .catch(() => {});
    return { immune: true, reason: "leave role" };
  }
  return { immune: false, reason: "" };
}

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
  /** Activity category this warning is about (one warning system + selectable category). */
  categoryKey?: string | null;
  categoryLabel?: string | null;
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
  warningNumber: number | null,
  member?: ClanMember | null,
  categoryLabel?: string | null
): Promise<Buffer | null> {
  try {
    const discordUrl = target.displayAvatarURL({ size: 256, extension: "png" });
    const faces = cardAvatarPair(member ?? null, discordUrl);
    return await renderOffThread("warningCard", {
      communityName: clan.clanName,
      memberName: target.username,
      avatarUrl: faces.primaryAvatarUrl,
      discordAvatarUrl: faces.discordAvatarUrl,
      robloxAvatarUrl: faces.robloxAvatarUrl,
      robloxUsername: member?.gameUsername ?? null,
      reason: memberReason,
      warningNumber,
      disputeCommand: DISPUTE_COMMAND,
      categoryLabel: categoryLabel ?? null,
      // Intentionally omit count/threshold — those are staff-only.
    });
  } catch (err) {
    logger.warn({ err }, "Warning card render failed — falling back to embed");
    return null;
  }
}

/** A fresh attachment for each send — Buffers must not be shared across sends. */
function warningAttachment(card: Buffer): AttachmentBuilder {
  return new AttachmentBuilder(card, { name: "activity-warning.png" });
}

/**
 * Member-facing fallback embed — warning + reason + how to dispute. The warning
 * number is surfaced in the footer as the dispute ticket.
 * Discord embeds only support one thumbnail: Roblox face when linked, Discord
 * in the author icon so both identities still show.
 */
function memberWarningEmbed(
  guildName: string,
  target: User,
  memberReason: string,
  warningNumber: number | null,
  faces?: { discordAvatarUrl: string | null; robloxAvatarUrl: string | null },
  categoryLabel?: string | null
): EmbedBuilder {
  const discordUrl = faces?.discordAvatarUrl || target.displayAvatarURL({ size: 256, extension: "png" });
  const robloxUrl = faces?.robloxAvatarUrl || null;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor({
      name: enforcementEmbedAuthor("warning", categoryLabel, guildName),
      iconURL: discordUrl || undefined,
    })
    .setThumbnail(robloxUrl || discordUrl || null)
    .setDescription(memberWarningBody(memberReason, warningNumber, categoryLabel))
    .setTimestamp();
  if (warningNumber) embed.setFooter({ text: `Warning ticket #${warningNumber} · dispute with ${DISPUTE_COMMAND}` });
  return embed;
}

/** Issue a warning: record it, bump the count, assign roles, log, optionally DM. */
export async function issueWarning(input: IssueWarningInput): Promise<IssueWarningResult> {
  const { client, clan, guild, target } = input;

  await ensureMember(guild.id, identityFromUser(target));
  const earlyMember = await getMember(guild.id, target.id);
  const immune = await isImmuneFromEnforcement(guild, clan, target.id, earlyMember);
  if (immune.immune) {
    throw new Error(
      `${target.username} is immune (${immune.reason}) — warning not issued.`
    );
  }

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
      categoryKey: input.categoryKey ?? null,
      categoryLabel: input.categoryLabel ?? null,
    })
    .returning();

  await db
    .update(clanMembersTable)
    .set({
      warningsCount: sql`${clanMembersTable.warningsCount} + 1`,
      // Lifetime never rolls back on remove — officers need the full history.
      lifetimeWarnings: sql`${clanMembersTable.lifetimeWarnings} + 1`,
      // A warning resets the clean-standing run.
      cleanPoints: 0,
    })
    .where(and(eq(clanMembersTable.guildId, guild.id), eq(clanMembersTable.userId, target.id)));

  // XP-enforcement bookkeeping: count this warning against the current period.
  await recordWeeklyWarning(clan, target.id);

  const activeCount = await countActive(guild.id, target.id);
  const memberRow = await getMember(guild.id, target.id);
  const staffDetail = memberRow ? staffProgressDetail(clan, memberRow) : null;
  const faces = cardAvatarPair(
    memberRow,
    target.displayAvatarURL({ size: 256, extension: "png" })
  );

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

  const categoryLabel = input.categoryLabel ?? null;

  // Member-facing card: no warning-count badge, no escalation threshold.
  const card =
    clan.cardStyle === "embed"
      ? null
      : await renderWarningCardSafe(
          clan,
          target,
          memberFacingReason,
          warningNumber,
          memberRow,
          categoryLabel
        );

  const noun = categoryEnforcementNoun(categoryLabel);

  // Post to the dedicated warning channel when one is configured. This is a
  // MEMBER-facing surface — never include staff accounting.
  if (deliverChannel && clan.warningChannelId) {
    try {
      const channel = await client.channels.fetch(clan.warningChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        const fallbackEmbed = memberWarningEmbed(
          guild.name,
          target,
          memberFacingReason,
          warningNumber,
          faces,
          categoryLabel
        );
        await channel.send({
          content:
            `⚠️ <@${target.id}> — you received a ${noun} Warning` +
            `${warningNumber ? ` (ticket **#${warningNumber}**)` : ""}. ` +
            `Dispute with \`${DISPUTE_COMMAND}\` — have your proof ready.`,
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
    const dmEmbed = memberWarningEmbed(
      guild.name,
      target,
      memberFacingReason,
      warningNumber,
      faces,
      categoryLabel
    );
    dmSent = await target
      .send(
        card
          ? {
              content: memberWarningDmContent(memberFacingReason, warningNumber, categoryLabel),
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
 *
 * When `categoryKey` is set, only warnings for that same activity category
 * count — switching from XP to Combat Support is a brand-new warning window.
 */
export async function recentWarning(
  guildId: string,
  userId: string,
  windowMs = 20 * 3600_000,
  categoryKey?: string | null
): Promise<Warning | null> {
  const cutoff = new Date(Date.now() - windowMs);
  const filters = [
    eq(warningsTable.guildId, guildId),
    eq(warningsTable.userId, userId),
    isNull(warningsTable.removedAt),
    gte(warningsTable.issuedAt, cutoff),
  ];
  if (categoryKey) {
    filters.push(eq(warningsTable.categoryKey, categoryKey));
  }
  const [row] = await db
    .select()
    .from(warningsTable)
    .where(and(...filters))
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
      .setAuthor({ name: `⚠️ WARNING • ${clan.clanName}` })
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

/** Lifetime warnings (active + removed) — the history officers review. */
export async function countLifetime(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.userId, userId)));
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

/** Full warning history for a member (newest first). Includes soft-removed rows. */

export interface WarningCategoryCount {
  key: string;
  label: string;
  count: number;
}

/** Active warnings grouped by activity category (for the player card). */
export async function warningBreakdownByCategory(
  guildId: string,
  userId: string
): Promise<WarningCategoryCount[]> {
  const rows = await db
    .select({
      categoryKey: warningsTable.categoryKey,
      categoryLabel: warningsTable.categoryLabel,
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
        isNull(warningsTable.removedAt)
      )
    )
    .groupBy(warningsTable.categoryKey, warningsTable.categoryLabel);

  return rows
    .map((r) => ({
      key: r.categoryKey || "activity",
      label: r.categoryLabel || "Activity",
      count: r.count,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function listHistory(
  guildId: string,
  userId: string,
  limit = 25
): Promise<Warning[]> {
  return db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.userId, userId)))
    .orderBy(desc(warningsTable.issuedAt))
    .limit(limit);
}

/** Prefer the linked Roblox avatar on member-facing cards when an officer assigned one. */
export function cardAvatarUrl(member: ClanMember | null | undefined, discordUrl: string | null): string | null {
  return member?.robloxAvatarUrl || discordUrl || member?.avatarUrl || null;
}

/** Discord + linked Roblox faces for dual-avatar cards (standing / warning / reminder / board). */
export function cardAvatarPair(
  member: ClanMember | null | undefined,
  discordUrl: string | null
): {
  discordAvatarUrl: string | null;
  robloxAvatarUrl: string | null;
  /** Primary face for single-avatar layouts: Roblox when linked, else Discord. */
  primaryAvatarUrl: string | null;
} {
  const discord = discordUrl || member?.avatarUrl || null;
  const roblox = member?.robloxAvatarUrl ?? null;
  return {
    discordAvatarUrl: discord,
    robloxAvatarUrl: roblox,
    primaryAvatarUrl: roblox || discord,
  };
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
 * Auto-remove the warning **role** on the schedule a server owner configured.
 *
 * When `clan.warningRemovalHours` is > 0, members whose oldest *active* warning
 * is older than that many hours lose the warning role. Warning rows are NOT
 * expired — history, disputes, and the leaderboard keep them until staff
 * explicitly removes a warning.
 */
export async function autoExpireWarnings(client: Client, clan: Clan): Promise<number> {
  if (!clan.warningRemovalHours || clan.warningRemovalHours <= 0) return 0;
  if (!clan.warningRoleIds.length) return 0;

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

  const userIds = [...new Set(stale.map((w) => w.userId))];
  let cleared = 0;
  for (const userId of userIds) {
    const gm = await guild.members.fetch(userId).catch(() => null);
    if (!gm) continue;
    if (!clan.warningRoleIds.some((id) => gm.roles.cache.has(id))) continue;
    await gm.roles.remove(clan.warningRoleIds).catch(() => {});
    cleared++;
  }

  if (cleared > 0) {
    logger.info(
      {
        event: "warning_roles_auto_cleared",
        guildId: clan.guildId,
        cleared,
        hours: clan.warningRemovalHours,
      },
      `Auto-cleared warning role(s) for ${cleared} member(s) (warnings kept for history/disputes)`
    );
  }
  return cleared;
}

/**
 * Clear warning roles for members who have **satisfied the configured
 * activity requirement** for the current tracking period.
 *
 * Roles only — warning records stay until an officer removes them. That keeps
 * dispute tickets and lifetime history intact.
 */
export async function clearWarningRolesForSatisfiedMembers(
  client: Client,
  clan: Clan
): Promise<number> {
  if (!clan.warningRoleIds.length) return 0;

  const guild = await client.guilds.fetch(clan.guildId).catch(() => null);
  if (!guild) return 0;

  const members = await listTracked(clan, guild);
  let cleared = 0;

  for (const member of members) {
    if (!isRequirementSatisfied(clan, member)) continue;
    if (member.exempt || member.onLeave) continue;

    const gm = await guild.members.fetch(member.userId).catch(() => null);
    if (!gm) continue;
    if (!clan.warningRoleIds.some((id) => gm.roles.cache.has(id))) continue;
    await gm.roles.remove(clan.warningRoleIds).catch(() => {});
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
      `Cleared warning role(s) for ${cleared} member(s) who met the ${periodAdjective(clan)} requirement (warnings kept)`
    );
  }
  return cleared;
}

/**
 * After a single member's progress is updated: if they just satisfied the
 * requirement, strip the warning **role** only. Warning rows stay for history
 * and disputes until staff removes them.
 */
export async function clearWarningRoleIfRequirementMet(
  guild: Guild,
  clan: Clan,
  userId: string
): Promise<boolean> {
  if (!clan.warningRoleIds.length) return false;
  const member = await getMember(clan.guildId, userId);
  if (!member || !isRequirementSatisfied(clan, member)) return false;

  const gm = await guild.members.fetch(userId).catch(() => null);
  if (!gm) return false;
  if (!clan.warningRoleIds.some((id) => gm.roles.cache.has(id))) return false;
  await gm.roles.remove(clan.warningRoleIds).catch(() => {});
  return true;
}
