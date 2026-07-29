import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import relativeTime from "dayjs/plugin/relativeTime.js";
import type { Clan } from "@workspace/db";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

/** Parse an "HH:mm" string into {hour, minute}, tolerant of bad input. */
export function parseHm(value: string | null | undefined): { hour: number; minute: number } {
  const [h, m] = (value ?? "00:00").split(":");
  const hour = Math.min(23, Math.max(0, parseInt(h ?? "0", 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(m ?? "0", 10) || 0));
  return { hour, minute };
}

function safeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    dayjs().tz(tz);
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * The current "activity day" for a clan as YYYY-MM-DD. The day boundary is the
 * configured reset time (not midnight), so a submission just after midnight but
 * before a 06:00 reset still counts for the previous day.
 */
export function activityDate(clan: Pick<Clan, "timezone" | "resetTime">, at: Date = new Date()): string {
  const tz = safeZone(clan.timezone);
  const { hour, minute } = parseHm(clan.resetTime);
  return dayjs(at).tz(tz).subtract(hour * 60 + minute, "minute").format("YYYY-MM-DD");
}

/** Turn a YYYY-MM-DD activity day into a comparable day index for streak math. */
export function dayIndex(date: string): number {
  return dayjs(date, "YYYY-MM-DD").valueOf() / 86_400_000;
}

/** The next reset moment (as a Date) after `from` for this clan. */
export function nextReset(clan: Pick<Clan, "timezone" | "resetTime">, from: Date = new Date()): Date {
  const tz = safeZone(clan.timezone);
  const { hour, minute } = parseHm(clan.resetTime);
  let reset = dayjs(from).tz(tz).hour(hour).minute(minute).second(0).millisecond(0);
  if (!reset.isAfter(dayjs(from).tz(tz))) reset = reset.add(1, "day");
  return reset.toDate();
}

/** Current wall-clock time in the clan timezone as "HH:mm". */
export function localHm(clan: Pick<Clan, "timezone">, at: Date = new Date()): string {
  return dayjs(at).tz(safeZone(clan.timezone)).format("HH:mm");
}

/** Minutes remaining until the next reset. */
export function minutesUntilReset(
  clan: Pick<Clan, "timezone" | "resetTime">,
  from: Date = new Date()
): number {
  return Math.round((nextReset(clan, from).getTime() - from.getTime()) / 60000);
}

/** The moment the current activity day began (the most recent reset). */
export function currentDayStart(clan: Pick<Clan, "timezone" | "resetTime">, from: Date = new Date()): Date {
  return dayjs(nextReset(clan, from)).subtract(1, "day").toDate();
}

/* ----------------------------------------------------------- weekly cycle */

type WeeklyClan = Pick<Clan, "timezone" | "resetTime" | "weekStartDay">;

/**
 * The current tracking week's key: the YYYY-MM-DD (clan timezone) the week
 * started on. The week boundary is weekStartDay at resetTime, so all weekly
 * progress/reset math shares one identifier.
 */
export function weekKey(clan: WeeklyClan, at: Date = new Date()): string {
  const tz = safeZone(clan.timezone);
  const { hour, minute } = parseHm(clan.resetTime);
  // Shift back by the reset offset so "before reset time" still counts as the
  // previous day, then walk back to the configured start day.
  let d = dayjs(at).tz(tz).subtract(hour * 60 + minute, "minute").startOf("day");
  const startDay = Math.min(6, Math.max(0, clan.weekStartDay ?? 1));
  while (d.day() !== startDay) d = d.subtract(1, "day");
  return d.format("YYYY-MM-DD");
}

/** The moment the next weekly reset fires. */
export function nextWeeklyReset(clan: WeeklyClan, from: Date = new Date()): Date {
  const tz = safeZone(clan.timezone);
  const { hour, minute } = parseHm(clan.resetTime);
  const startDay = Math.min(6, Math.max(0, clan.weekStartDay ?? 1));
  let d = dayjs(from).tz(tz).hour(hour).minute(minute).second(0).millisecond(0);
  while (d.day() !== startDay || !d.isAfter(dayjs(from).tz(tz))) d = d.add(1, "day");
  return d.toDate();
}

/** Human range label for a week key, e.g. "Jul 21 – Jul 27". */
export function weekRangeLabel(key: string): string {
  const start = dayjs(key, "YYYY-MM-DD");
  return `${start.format("MMM D")} – ${start.add(6, "day").format("MMM D")}`;
}

/** A Discord relative timestamp tag, e.g. <t:...:R>. */
export function discordRelative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/** Human "2 hours ago" style relative string in the clan timezone. */
export function relative(date: Date | null): string {
  if (!date) return "never";
  return dayjs(date).fromNow();
}

/** Format a Date in the clan timezone, e.g. "Jul 21, 18:04". */
export function formatInZone(date: Date, clan: Pick<Clan, "timezone">, fmt = "MMM D, HH:mm"): string {
  return dayjs(date).tz(safeZone(clan.timezone)).format(fmt);
}
