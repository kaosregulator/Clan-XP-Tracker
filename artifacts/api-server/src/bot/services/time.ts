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

/** The moment the current activity day began (the most recent reset). */
export function currentDayStart(clan: Pick<Clan, "timezone" | "resetTime">, from: Date = new Date()): Date {
  return dayjs(nextReset(clan, from)).subtract(1, "day").toDate();
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
