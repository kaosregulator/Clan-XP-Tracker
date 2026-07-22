import { db, remindersTable, clanMembersTable } from "@workspace/db";
import type { Clan } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { EmbedBuilder, type User } from "discord.js";
import { activityDate, nextReset, discordRelative } from "./time";
import { logAction, sendLog } from "./logging";

export interface SendReminderInput {
  clan: Clan;
  target: User;
  auto: boolean;
  moderatorId?: string | null;
  moderatorUsername?: string | null;
}

export interface SendReminderResult {
  delivered: boolean;
}

/**
 * Send a friendly, explicitly-not-a-warning reminder DM and record it. Records
 * the reminder even if the DM fails (member has DMs closed) so counts stay honest.
 */
export async function sendReminder(input: SendReminderInput): Promise<SendReminderResult> {
  const { clan, target } = input;
  const activity = clan.activityName || "XP";
  const resetLine = `Please submit before today's reset (${discordRelative(nextReset(clan))}).`;

  let delivered = true;
  try {
    await target.send(
      `👋 **Friendly reminder** from **${clan.clanName}**\n\n` +
        `You haven't submitted today's ${activity} yet. ` +
        `**This is only a reminder — it is not a warning.**\n${resetLine}`
    );
  } catch {
    delivered = false;
  }

  await db.insert(remindersTable).values({
    guildId: clan.guildId,
    userId: target.id,
    username: target.username,
    activityDate: activityDate(clan),
    auto: input.auto,
    sentBy: input.moderatorId ?? null,
    sentByUsername: input.moderatorUsername ?? null,
    channel: "dm",
    delivered,
  });

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
    details: { auto: input.auto, delivered },
  });

  await sendLog(
    target.client,
    clan,
    new EmbedBuilder()
      .setColor(0xfaa61a)
      .setAuthor({ name: `Reminder • ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(
        `<@${target.id}> was reminded${input.auto ? " automatically" : input.moderatorId ? ` by <@${input.moderatorId}>` : ""}.` +
          (delivered ? "" : " (DMs closed — not delivered)")
      )
      .setTimestamp()
  );

  return { delivered };
}

/** Whether a reminder was already sent to this user for the current activity day. */
export async function reminderSentToday(clan: Clan, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: remindersTable.id })
    .from(remindersTable)
    .where(
      and(
        eq(remindersTable.guildId, clan.guildId),
        eq(remindersTable.userId, userId),
        eq(remindersTable.activityDate, activityDate(clan))
      )
    )
    .limit(1);
  return !!row;
}
