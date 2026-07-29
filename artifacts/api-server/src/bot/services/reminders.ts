import { db, remindersTable, clanMembersTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { EmbedBuilder, type Client, type User } from "discord.js";
import { weekKey, nextWeeklyReset, discordRelative } from "./time";
import { logAction, sendLog } from "./logging";
import { recordWeeklyReminder, currentProgress, effectiveGoal } from "./progress";
import { logger } from "../../lib/logger";

export interface SendReminderInput {
  client: Client;
  clan: Clan;
  target: User;
  member: ClanMember | null;
  auto: boolean;
  moderatorId?: string | null;
  moderatorUsername?: string | null;
}

export interface SendReminderResult {
  delivered: boolean;
}

/** What the member still needs, phrased for the server's tracking mode. */
function needLine(clan: Clan, member: ClanMember | null): string {
  if (!member) return `You still need to hit this week's ${clan.activityName} goal.`;
  const progress = currentProgress(clan, member);
  const goal = effectiveGoal(clan, member);
  if (clan.trackingMode === "complete") {
    return `Your weekly ${clan.activityName} is still marked **not completed**.`;
  }
  const remaining = Math.max(0, goal - progress);
  return (
    `You're at **${progress.toLocaleString()} / ${goal.toLocaleString()}** — ` +
    `**${remaining.toLocaleString()}** ${clan.activityName} to go.`
  );
}

function reminderText(clan: Clan, member: ClanMember | null): string {
  const deadline = discordRelative(nextWeeklyReset(clan));
  return (
    `👋 **Friendly reminder** from **${clan.clanName}**\n\n` +
    `${needLine(clan, member)}\n` +
    `The week closes ${deadline}. **This is only a reminder — it is not a warning.**\n\n` +
    `An officer will update your progress once they've verified it in ${clan.gameName}.`
  );
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

  if (clan.dmReminders) {
    try {
      await target.send({ content: reminderText(clan, member) });
      delivered = true;
      channelUsed = "dm";
    } catch {
      // DMs closed — fall through to the channel if configured.
    }
  }

  if (clan.reminderChannelId && (!delivered || !clan.dmReminders)) {
    try {
      const channel = await client.channels.fetch(clan.reminderChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        const mention = clan.pingReminders ? `<@${target.id}>` : `**${target.username}**`;
        await channel.send({
          content: `🔔 ${mention} — ${needLine(clan, member)} The week closes ${discordRelative(nextWeeklyReset(clan))}.`,
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

  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0xfaa61a)
      .setAuthor({ name: `Reminder • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(
        `<@${target.id}> was reminded${input.auto ? " automatically" : input.moderatorId ? ` by <@${input.moderatorId}>` : ""}.` +
          (delivered ? "" : " (not delivered — DMs closed & no reminder channel)")
      )
      .setTimestamp()
  );

  return { delivered };
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
