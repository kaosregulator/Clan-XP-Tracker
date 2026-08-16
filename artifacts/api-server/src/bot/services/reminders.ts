import { db, remindersTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { EmbedBuilder, AttachmentBuilder, type Client, type User } from "discord.js";
import { weekKey, nextWeeklyReset, discordRelative } from "./time";
import { logAction, sendLog } from "./logging";
import { recordWeeklyReminder, currentProgress, effectiveGoal } from "./progress";
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
  /** Optional officer note shown on the reminder card in place of the default copy. */
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
  note?: string | null
): Promise<Buffer | null> {
  try {
    return await renderOffThread("reminderCard", {
      communityName: clan.clanName,
      memberName: target.username,
      avatarUrl: target.displayAvatarURL({ size: 256, extension: "png" }),
      message: note ?? null,
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

/** A simple reminder card: the member's avatar and a "go do your XP" nudge. */
function reminderEmbed(clan: Clan, member: ClanMember | null, target: User): EmbedBuilder {
  const deadline = discordRelative(nextWeeklyReset(clan));
  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setAuthor({ name: `Reminder • ${clan.clanName}`, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL())
    .setDescription(
      `This is your reminder to get your ${clan.activityName} in for ${clan.gameName}. 💪\n\n` +
        `${remainingLine(clan, member)}` +
        `The week resets ${deadline}. Just a friendly nudge — not a warning.`
    )
    .setTimestamp();
}

/** Optional one-liner of context, phrased as "still to earn", not "incomplete". */
function remainingLine(clan: Clan, member: ClanMember | null): string {
  if (!member || clan.trackingMode === "complete") return "";
  const remaining = Math.max(0, effectiveGoal(clan, member) - currentProgress(clan, member));
  if (remaining <= 0) return "";
  return `You still have **${remaining.toLocaleString()}** ${clan.activityName} to earn this week.\n\n`;
}

/**
 * Send one weekly-progress reminder and record it. Delivery follows the
 * clan's settings: DM when dmReminders is on, falling back to (or configured
 * as) a post in the reminder channel with an optional ping. Recorded even
 * when nothing could be delivered so reminder counts — and therefore warning
 * eligibility — stay honest.
 */
export async function sendReminder(input: SendReminderInput): Promise<SendReminderResult> {
  const { client, clan, target, member } = input;
  let delivered = false;
  let channelUsed = "none";

  const embed = reminderEmbed(clan, member, target);
  // The canvas card is the primary visual (matches the warning card); the embed
  // stays as a fallback when a render fails so a reminder always gets through.
  // When the server picked the classic embed style, skip the card entirely.
  const card =
    clan.cardStyle === "embed" ? null : await renderReminderCardSafe(clan, target, input.note);

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

  await db.insert(remindersTable).values({
    guildId: clan.guildId,
    userId: target.id,
    username: target.username,
    // Weekly model: the activity period a reminder belongs to is the week key.
    activityDate: weekKey(clan),
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

  await logAction(clan.guildId, {
    action: "reminder_sent",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.moderatorId ?? null,
    moderatorUsername: input.moderatorUsername ?? null,
    details: { auto: input.auto, delivered, via: channelUsed },
  });

  const by = input.auto
    ? "automatically"
    : input.moderatorId
      ? `by <@${input.moderatorId}>`
      : "manually";

  // Full log embed → the dedicated log channel (separate from the public
  // reminder channel where the member is actually pinged).
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
      .addFields({ name: "Delivered via", value: delivered ? channelUsed : "not delivered", inline: true })
      .setFooter({
        text: input.auto
          ? "Automatic reminder"
          : `Moderator: ${input.moderatorUsername ?? "unknown"}${input.moderatorId ? ` · ${input.moderatorId}` : ""}`,
      })
      .setTimestamp()
  );

  // Verifiable structured log: who reminded whom, and how it was delivered.
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

/** How many reminders this user already received this tracking week. */
export async function remindersThisWeek(clan: Clan, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(remindersTable)
    .where(
      and(
        eq(remindersTable.guildId, clan.guildId),
        eq(remindersTable.userId, userId),
        eq(remindersTable.activityDate, weekKey(clan))
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
