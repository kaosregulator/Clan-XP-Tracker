import { db, remindersTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { EmbedBuilder, AttachmentBuilder, type Client, type User } from "discord.js";
import { discordRelative } from "./time";
import { logAction, sendLog } from "./logging";
import { recordWeeklyReminder, currentProgress, effectiveGoal, periodKey } from "./progress";
import {
  memberReminderBody,
  periodAdjective,
  periodLabel,
  nextPeriodReset,
  staffProgressDetail,
  containsStaffAccounting,
} from "./tracking";
import { scheduleDashboardRefresh } from "./commandCenter";
import { renderOffThread } from "../canvas/render-pool";
import { logger } from "../../lib/logger";

/**
 * Where a reminder is delivered. Both default to the clan settings when
 * omitted (DM when dmReminders is on, plus the reminder channel), so callers
 * that don't care keep the old behaviour. /xpreminder passes explicit flags.
 */
export interface ReminderDelivery {
  channel?: boolean;
  dm?: boolean;
}

export interface SendReminderInput {
  client: Client;
  clan: Clan;
  target: User;
  member: ClanMember | null;
  auto: boolean;
  moderatorId?: string | null;
  moderatorUsername?: string | null;
  /** Optional officer note shown on the reminder card — sanitized for members. */
  note?: string | null;
  /** Explicit channel/DM override; falls back to clan settings when omitted. */
  deliver?: ReminderDelivery;
}

export interface SendReminderResult {
  delivered: boolean;
}

/** Render the XP reminder canvas card with the member's avatar, best-effort. */
async function renderReminderCardSafe(
  clan: Clan,
  target: User,
  body: string
): Promise<Buffer | null> {
  try {
    return await renderOffThread("reminderCard", {
      communityName: clan.clanName,
      memberName: target.username,
      avatarUrl: target.displayAvatarURL({ size: 256, extension: "png" }),
      message: body,
      periodLabel: periodAdjective(clan),
    });
  } catch (err) {
    logger.warn({ err }, "Reminder card render failed — falling back to embed");
    return null;
  }
}

/** A fresh attachment for each send — Buffers must not be shared across sends. */
function reminderAttachment(card: Buffer): AttachmentBuilder {
  return new AttachmentBuilder(card, { name: "xp-reminder.png" });
}

/**
 * Member-facing reminder embed fallback. Period-aware, no progress fractions,
 * no remaining XP amounts, no reminder counts.
 */
function reminderEmbed(clan: Clan, target: User, body: string): EmbedBuilder {
  const deadline = discordRelative(nextPeriodReset(clan));
  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setAuthor({ name: `🔔 XP REMINDER • ${clan.clanName}`, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL())
    .setDescription(
      `${body}\n\nThe ${periodAdjective(clan)} period resets ${deadline}. Just a friendly nudge — not a warning.`
    )
    .setTimestamp();
}

/**
 * Send one period-progress reminder and record it. Delivery follows the
 * clan's settings: DM when dmReminders is on, falling back to (or configured
 * as) a post in the reminder channel with an optional ping. Recorded even
 * when nothing could be delivered so reminder counts — and therefore warning
 * eligibility — stay honest.
 *
 * Member surfaces never include staff accounting. Staff logs do.
 */
export async function sendReminder(input: SendReminderInput): Promise<SendReminderResult> {
  const { client, clan, target, member } = input;
  let delivered = false;
  let channelUsed = "none";

  const safeNote =
    input.note && !containsStaffAccounting(input.note) ? input.note : null;
  // Compute the reminder body ONCE (a custom note, or a random friendly nudge)
  // and share it across the embed and the canvas so the two can never drift.
  const body = memberReminderBody(clan, safeNote);
  const embed = reminderEmbed(clan, target, body);
  // The canvas card is the primary visual (matches the warning card); the embed
  // stays as a fallback when a render fails so a reminder always gets through.
  // When the server picked the classic embed style, skip the card entirely.
  const card =
    clan.cardStyle === "embed" ? null : await renderReminderCardSafe(clan, target, body);

  // Delivery targets: explicit override wins; otherwise the clan defaults
  // (DM when dmReminders is on, and the reminder channel when configured).
  const wantDm = input.deliver?.dm ?? clan.dmReminders;
  const wantChannel = input.deliver
    ? (input.deliver.channel ?? false)
    : !!clan.reminderChannelId;

  if (wantDm) {
    try {
      await target.send(card ? { files: [reminderAttachment(card)] } : { embeds: [embed] });
      delivered = true;
      channelUsed = "dm";
    } catch {
      // DMs closed — fall through to the channel if configured/allowed.
    }
  }

  const channelFallback = wantChannel || (!delivered && !!clan.reminderChannelId);
  if (clan.reminderChannelId && channelFallback) {
    try {
      const channel = await client.channels.fetch(clan.reminderChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        const mention = clan.pingReminders ? `<@${target.id}>` : `**${target.username}**`;
        await channel.send({
          content: `🔔 ${mention} — this is your XP reminder.`,
          ...(card ? { files: [reminderAttachment(card)] } : { embeds: [embed] }),
          allowedMentions: clan.pingReminders ? { users: [target.id] } : { parse: [] },
        });
        delivered = true;
        channelUsed = channelUsed === "dm" ? "dm+channel" : "channel";
      }
    } catch (err) {
      logger.warn({ err, channel: clan.reminderChannelId }, "Reminder channel post failed");
    }
  }

  const pk = periodKey(clan);
  await db.insert(remindersTable).values({
    guildId: clan.guildId,
    userId: target.id,
    username: target.username,
    // The activity period a reminder belongs to is the current period key.
    activityDate: pk,
    auto: input.auto,
    sentBy: input.moderatorId ?? null,
    sentByUsername: input.moderatorUsername ?? null,
    channel: channelUsed,
    delivered,
  });

  await recordWeeklyReminder(clan, target.id);

  await db
    .update(clanMembersTable)
    .set({ remindersCount: sql`${clanMembersTable.remindersCount} + 1` })
    .where(and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, target.id)));

  const staffDetail = member
    ? staffProgressDetail(clan, member)
    : null;

  await logAction(clan.guildId, {
    action: "reminder_sent",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.moderatorId ?? null,
    moderatorUsername: input.moderatorUsername ?? null,
    details: {
      auto: input.auto,
      delivered,
      via: channelUsed,
      period: periodAdjective(clan),
      periodKey: pk,
      progress: staffDetail?.progress ?? null,
      requirement: staffDetail?.requirement ?? null,
      missing: staffDetail?.missing ?? null,
    },
  });

  const by = input.auto
    ? "automatically"
    : input.moderatorId
      ? `by <@${input.moderatorId}>`
      : "manually";

  // Full staff log embed → the dedicated log channel (never shown to the member).
  const staffFields = [
    { name: "Delivered via", value: delivered ? channelUsed : "not delivered", inline: true },
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
        value: `${staffDetail.remindersThisPeriod + 1}`,
        inline: true,
      }
    );
  }

  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0xfaa61a)
      .setAuthor({ name: `Reminder • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(
        `<@${target.id}> was reminded ${by}.` +
          (delivered ? "" : " (not delivered — DMs closed & no reminder channel)")
      )
      .addFields(...staffFields)
      .setFooter({
        text: input.auto
          ? "Automatic reminder"
          : `Moderator: ${input.moderatorUsername ?? "unknown"}${input.moderatorId ? ` · ${input.moderatorId}` : ""}`,
      })
      .setTimestamp()
  );

  logger.info(
    {
      event: "reminder_sent",
      guildId: clan.guildId,
      targetId: target.id,
      targetUsername: target.username,
      auto: input.auto,
      moderatorId: input.moderatorId ?? null,
      moderatorUsername: input.moderatorUsername ?? null,
      channel: channelUsed,
      delivered,
      period: periodAdjective(clan),
      progress: staffDetail?.progress ?? null,
      requirement: staffDetail?.requirement ?? (member ? effectiveGoal(clan, member) : null),
      currentProgress: member ? currentProgress(clan, member) : null,
    },
    `Reminder ${delivered ? "delivered" : "recorded (undelivered)"} to ${target.username} ${input.auto ? "automatically" : `by ${input.moderatorUsername ?? "unknown"}`}`
  );

  scheduleDashboardRefresh(clan.guildId);

  return { delivered };
}

/**
 * The most recent reminder for a user within `windowMs`, or null. Lets the
 * single `/xp remind` command avoid re-pinging someone who was just reminded.
 */
export async function recentReminder(
  clan: Clan,
  userId: string,
  windowMs = 20 * 3600_000
): Promise<{ createdAt: Date; sentByUsername: string | null; auto: boolean } | null> {
  const cutoff = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({
      createdAt: remindersTable.createdAt,
      sentByUsername: remindersTable.sentByUsername,
      auto: remindersTable.auto,
    })
    .from(remindersTable)
    .where(
      and(
        eq(remindersTable.guildId, clan.guildId),
        eq(remindersTable.userId, userId),
        gte(remindersTable.createdAt, cutoff)
      )
    )
    .orderBy(desc(remindersTable.createdAt))
    .limit(1);
  return row ?? null;
}

export interface ReminderRecord {
  createdAt: Date;
  sentByUsername: string | null;
  auto: boolean;
  channel: string;
  delivered: boolean;
}

/** The most recent reminders for a member — powers the member hub's history. */
export async function listRecentReminders(
  guildId: string,
  userId: string,
  limit = 5
): Promise<ReminderRecord[]> {
  return db
    .select({
      createdAt: remindersTable.createdAt,
      sentByUsername: remindersTable.sentByUsername,
      auto: remindersTable.auto,
      channel: remindersTable.channel,
      delivered: remindersTable.delivered,
    })
    .from(remindersTable)
    .where(and(eq(remindersTable.guildId, guildId), eq(remindersTable.userId, userId)))
    .orderBy(desc(remindersTable.createdAt))
    .limit(limit);
}

/** How many reminders this user already received this tracking period. */
export async function remindersThisWeek(clan: Clan, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(remindersTable)
    .where(
      and(
        eq(remindersTable.guildId, clan.guildId),
        eq(remindersTable.userId, userId),
        eq(remindersTable.activityDate, periodKey(clan))
      )
    );
  return row?.count ?? 0;
}

/** Reminders sent guild-wide since `since` (used to de-dupe auto runs). */
export async function remindersSince(clan: Clan, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(remindersTable)
    .where(and(eq(remindersTable.guildId, clan.guildId), gte(remindersTable.createdAt, since)));
  return row?.count ?? 0;
}

export interface BulkRemindResult {
  sent: number;
  skipped: number;
}

/**
 * Remind many members with Discord-safe pacing (max 3 sends/second). When
 * `skipIfRemindedToday` is set, members already reminded in the last 20 hours
 * are skipped so stacked triggers can't double-ping anyone.
 */
export async function sendBulkReminders(opts: {
  client: Client;
  clan: Clan;
  targets: ClanMember[];
  auto: boolean;
  moderatorId?: string | null;
  moderatorUsername?: string | null;
  skipIfRemindedToday?: boolean;
}): Promise<BulkRemindResult> {
  const { client, clan, targets } = opts;
  const cutoff = new Date(Date.now() - 20 * 3600_000);
  const queue = new PQueue({ concurrency: 3, intervalCap: 3, interval: 1000 });
  let sent = 0;
  let skipped = 0;
  for (const member of targets) {
    queue.add(async () => {
      if (opts.skipIfRemindedToday) {
        const [recent] = await db
          .select({ id: remindersTable.id })
          .from(remindersTable)
          .where(
            and(
              eq(remindersTable.guildId, clan.guildId),
              eq(remindersTable.userId, member.userId),
              gte(remindersTable.createdAt, cutoff)
            )
          )
          .limit(1);
        if (recent) {
          skipped++;
          return;
        }
      }
      const user = await client.users.fetch(member.userId).catch(() => null);
      if (!user) return;
      await sendReminder({
        client,
        clan,
        target: user,
        member,
        auto: opts.auto,
        moderatorId: opts.moderatorId,
        moderatorUsername: opts.moderatorUsername,
      });
      sent++;
    });
  }
  await queue.onIdle();
  return { sent, skipped };
}
