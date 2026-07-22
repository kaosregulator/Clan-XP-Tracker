import type { Client, TextBasedChannel } from "discord.js";
import type { Clan } from "@workspace/db";
import { logger } from "../lib/logger";
import { activeClans } from "./services/config";
import { localHm, minutesUntilReset } from "./services/time";
import { missingMembers, todaySnapshot } from "./services/stats";
import { pendingQueue } from "./services/submissions";
import { sendReminder, reminderSentToday } from "./services/reminders";
import { refreshDashboards } from "./features/dashboard";
import { refreshTracker } from "./features/tracker";

const TICK_MS = 60_000;
const MAX_DMS_PER_WINDOW = 40;
const REVIEW_AGE_MINUTES = 180; // ping staff when the oldest pending is older than this
const DASHBOARD_EVERY_MS = 5 * 60_000;

// In-memory de-dupe. The scheduler is single-process; on restart we may re-fire
// a window at most once, which is acceptable for friendly reminders.
const firedWindows = new Set<string>();
const staffNotified = new Map<string, number>();
let lastDashboardRun = 0;

function throttle(key: string, everyMs: number): boolean {
  const now = Date.now();
  const last = staffNotified.get(key) ?? 0;
  if (now - last < everyMs) return false;
  staffNotified.set(key, now);
  return true;
}

async function sendToChannel(client: Client, channelId: string | null, content: string) {
  if (!channelId) return;
  try {
    const channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
    if (channel && "send" in channel) await channel.send({ content, allowedMentions: { parse: ["roles"] } });
  } catch (err) {
    logger.warn({ err, channelId }, "Scheduler failed to send channel message");
  }
}

function staffMention(clan: Clan): string {
  return clan.staffRoleIds.map((r) => `<@&${r}>`).join(" ");
}

/** Fire auto reminder DMs to members still missing at a configured window. */
async function runReminderWindow(client: Client, clan: Clan, hhmm: string, dateKey: string) {
  const key = `${clan.guildId}:${dateKey}:${hhmm}`;
  if (firedWindows.has(key)) return;
  firedWindows.add(key);
  if (firedWindows.size > 5000) firedWindows.clear();

  const missing = await missingMembers(clan, MAX_DMS_PER_WINDOW);
  let sent = 0;
  for (const m of missing) {
    if (await reminderSentToday(clan, m.userId)) continue;
    const user = await client.users.fetch(m.userId).catch(() => null);
    if (!user) continue;
    await sendReminder({ clan, target: user, auto: true });
    sent++;
  }
  if (sent > 0) logger.info({ guild: clan.guildId, hhmm, sent }, "Auto reminders sent");
}

/** Notify staff when the review queue is aging or many members are missing near reset. */
async function runStaffMonitoring(client: Client, clan: Clan) {
  const staffChannel = clan.reviewChannelId ?? clan.staffDashboardChannelId ?? clan.logChannelId;
  if (!staffChannel) return;

  // Aging review queue
  const pending = await pendingQueue(clan.guildId, 1);
  const oldest = pending[0];
  if (oldest) {
    const ageMin = (Date.now() - oldest.submittedAt.getTime()) / 60000;
    if (ageMin >= REVIEW_AGE_MINUTES && throttle(`${clan.guildId}:queue`, 60 * 60_000)) {
      const snap = await todaySnapshot(clan);
      await sendToChannel(
        client,
        staffChannel,
        `${staffMention(clan)} ⏳ **${snap.pendingReviews}** submission(s) are waiting for review — the oldest is over ${Math.floor(ageMin / 60)}h old.`
      );
    }
  }

  // Many members still missing close to reset
  const minsLeft = minutesUntilReset(clan);
  if (minsLeft > 0 && minsLeft <= 60) {
    const snap = await todaySnapshot(clan);
    const threshold = Math.max(3, Math.ceil(snap.totalMembers * 0.25));
    if (snap.missing >= threshold && throttle(`${clan.guildId}:missing`, 3 * 60 * 60_000)) {
      await sendToChannel(
        client,
        staffChannel,
        `${staffMention(clan)} ⚠️ **${snap.missing}** member(s) still haven't submitted and reset is in ~${minsLeft}m.`
      );
    }
  }
}

async function tick(client: Client) {
  let clans: Clan[] = [];
  try {
    clans = await activeClans();
  } catch (err) {
    logger.error({ err }, "Scheduler failed to load clans");
    return;
  }

  const dueForDashboards = Date.now() - lastDashboardRun >= DASHBOARD_EVERY_MS;
  if (dueForDashboards) lastDashboardRun = Date.now();

  for (const clan of clans) {
    try {
      const hhmm = localHm(clan);
      const dateKey = new Date().toISOString().slice(0, 10);
      if (clan.reminderTimes.includes(hhmm)) {
        await runReminderWindow(client, clan, hhmm, dateKey);
      }
      await runStaffMonitoring(client, clan);
      if (dueForDashboards) {
        await refreshDashboards(client, clan).catch(() => {});
        await refreshTracker(client, clan).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, guild: clan.guildId }, "Scheduler tick failed for clan");
    }
  }
}

/** Start the periodic scheduler. Safe no-op if called without a client. */
export function startScheduler(client: Client) {
  logger.info("Activity scheduler started");
  // Kick off shortly after boot, then every minute.
  setTimeout(() => void tick(client), 10_000);
  setInterval(() => void tick(client), TICK_MS);
}
