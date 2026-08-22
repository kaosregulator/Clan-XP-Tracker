import type { Client, TextBasedChannel } from "discord.js";
import type { Clan } from "@workspace/db";
import dayjs from "dayjs";
import { logger } from "../lib/logger";
import { activeClans } from "./services/config";
import { localHm, weekKey } from "./services/time";
import {
  listTracked,
  snapshotFrom,
  reminderTargets,
  warningTargets,
  rollWeek,
  getTrackingPeriod,
  periodKey,
} from "./services/progress";
import { periodAdjective, periodLabel } from "./services/tracking";
import { sendBulkReminders } from "./services/reminders";
import {
  autoExpireWarnings,
  clearWarningRolesForSatisfiedMembers,
} from "./services/warnings";
import { refreshDashboardNow } from "./services/commandCenter";

const TICK_MS = 60_000;

// In-memory de-dupe of fired windows. The scheduler is single-process; on
// restart a window may re-fire at most once, which the per-member 20-hour
// reminder guard absorbs.
const firedWindows = new Set<string>();

function fireOnce(key: string): boolean {
  if (firedWindows.has(key)) return false;
  firedWindows.add(key);
  if (firedWindows.size > 5000) firedWindows.clear();
  return true;
}

async function sendToChannel(client: Client, channelId: string | null, content: string) {
  if (!channelId) return;
  try {
    const channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
    if (channel && "send" in channel) {
      await channel.send({ content, allowedMentions: { parse: ["roles"] } });
    }
  } catch (err) {
    logger.warn({ err, channelId }, "Scheduler failed to send channel message");
  }
}

function officerMention(clan: Clan): string {
  return [...clan.staffRoleIds, ...clan.adminRoleIds].map((r) => `<@&${r}>`).join(" ");
}

/** Scheduled reminders to everyone still short of the configured requirement. */
async function runReminderWindow(client: Client, clan: Clan) {
  const members = await listTracked(clan);
  const targets = reminderTargets(clan, members);
  if (!targets.length) return;

  const res = await sendBulkReminders({
    client,
    clan,
    targets,
    auto: true,
    skipIfRemindedToday: true,
  });
  if (res.sent > 0) {
    logger.info(
      { guild: clan.guildId, sent: res.sent, period: periodAdjective(clan) },
      `Auto ${periodAdjective(clan)} reminders sent`
    );
  }
}

/**
 * Close the tracking period: post the final summary to the officers, then
 * archive and reset. Runs at the period boundary when autoWeeklyReset is on
 * (daily → every day at resetTime; weekly → week-start day at resetTime).
 */
async function runPeriodReset(client: Client, clan: Clan) {
  const members = await listTracked(clan);
  const snap = snapshotFrom(clan, members);
  const channel = clan.warningChannelId ?? clan.logChannelId ?? clan.reminderChannelId;
  const label = periodLabel(clan);

  if (channel) {
    const pct = Math.round(snap.completionRate * 100);
    await sendToChannel(
      client,
      channel,
      `${officerMention(clan)} 📅 **${label} period closed** — ${snap.completed}/${snap.active} members hit the ${clan.activityName} goal (**${pct}%**). ` +
        `${snap.notStarted} never started · ${snap.warningsThisWeek} warning(s) issued this ${periodAdjective(clan)}.\n` +
        `Run \`/xp review\` for the full breakdown — progress has been archived and reset.`
    );
  }

  const res = await rollWeek(clan);
  logger.info(
    { guild: clan.guildId, archived: res.archived, period: periodAdjective(clan) },
    `${label} reset completed`
  );
}

/** Back-compat alias used by tests / manual triggers. */
const runWeeklyReset = runPeriodReset;

/** Nudge officers when many members are behind (staff-only channel). */
async function runOfficerMonitoring(client: Client, clan: Clan, dateKey: string) {
  const channel = clan.warningChannelId ?? clan.logChannelId;
  if (!channel) return;

  const members = await listTracked(clan);
  const snap = snapshotFrom(clan, members);
  const warnable = warningTargets(clan, members).length;
  if (!warnable) return;

  if (!fireOnce(`${clan.guildId}:${dateKey}:escalation`)) return;
  await sendToChannel(
    client,
    channel,
    `${officerMention(clan)} ⚠️ **${warnable}** member(s) are warning-eligible ` +
      `(${clan.warningThreshold}+ reminders, still short of the ${clan.activityName} ${periodAdjective(clan)} goal). ` +
      `${snap.completed}/${snap.active} complete. Run \`/xp review\` to issue warnings in bulk.`
  );
}

async function tick(client: Client) {
  let clans: Clan[] = [];
  try {
    clans = await activeClans();
  } catch (err) {
    logger.error({ err }, "Scheduler failed to load clans");
    return;
  }

  for (const clan of clans) {
    try {
      const hhmm = localHm(clan);
      const dateKey = new Date().toISOString().slice(0, 10);
      const nowDay = dayjs().tz(clan.timezone || "UTC").day();
      const period = getTrackingPeriod(clan);

      // Period reset fires first: at reset time, close the previous period
      // before any reminder for the new period goes out.
      //   daily  → every day at resetTime
      //   weekly → only on weekStartDay at resetTime
      const resetDue =
        clan.autoWeeklyReset &&
        hhmm === clan.resetTime &&
        (period === "daily" || nowDay === clan.weekStartDay) &&
        fireOnce(`${clan.guildId}:${dateKey}:reset:${periodKey(clan)}`);

      if (resetDue) {
        await runPeriodReset(client, clan);
        continue;
      }

      const reminderTime = clan.reminderTimes[0];
      // Daily period: fire on every configured reminder day (typically all 7).
      // Weekly period: same reminderDays gate as before.
      if (
        clan.remindersEnabled &&
        reminderTime === hhmm &&
        clan.reminderDays.includes(nowDay) &&
        fireOnce(`${clan.guildId}:${dateKey}:${hhmm}:remind`)
      ) {
        await runReminderWindow(client, clan);
      }

      // Once a day, an hour after the reminder window, flag escalations.
      if (reminderTime && hhmm === bumpHour(reminderTime)) {
        await runOfficerMonitoring(client, clan, dateKey);
      }

      // Timer-based warning expiration (owner-configured hours). Independent
      // of requirement satisfaction.
      if (clan.warningRemovalHours > 0 && new Date().getMinutes() % 10 === 0) {
        await autoExpireWarnings(client, clan).catch(() => {});
      }

      // Requirement-based warning-role clearance: only when the configured
      // activity requirement is met — never because an XP row merely exists.
      if (new Date().getMinutes() % 10 === 0) {
        await clearWarningRolesForSatisfiedMembers(client, clan).catch(() => {});
      }

      // Keep the persistent command center honest on a slow cadence.
      if (new Date().getMinutes() % 10 === 0) {
        await refreshDashboardNow(clan.guildId).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, guild: clan.guildId }, "Scheduler tick failed for clan");
    }
  }
}

/** "18:00" -> "19:00" (wraps at midnight). */
function bumpHour(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = (parseInt(h, 10) + 1) % 24;
  return `${String(hour).padStart(2, "0")}:${m}`;
}

/** Start the periodic scheduler. */
export function startScheduler(client: Client) {
  logger.info("XP tracking scheduler started");
  setTimeout(() => void tick(client), 10_000);
  setInterval(() => void tick(client), TICK_MS);
}

/** Exposed for tests / manual triggers. */
export { runWeeklyReset, runPeriodReset, runReminderWindow };

// weekKey is re-exported so callers logging scheduler state share one source.
export { weekKey };
