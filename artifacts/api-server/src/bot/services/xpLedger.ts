import { db, xpEntriesTable, clanMembersTable, vacationsTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import dayjs from "dayjs";
import { activityDate, weekKey } from "./time";
import { effectiveGoal } from "./progress";
import { ensureMember, type MemberIdentity } from "./config";
import { logAction } from "./logging";
import { scheduleDashboardRefresh } from "./commandCenter";

/* ------------------------------------------------------------------ dates */

/** Add days to a YYYY-MM-DD string (pure date math, timezone-agnostic). */
function addDays(date: string, n: number): string {
  return dayjs(date, "YYYY-MM-DD").add(n, "day").format("YYYY-MM-DD");
}

/** [start, endExclusive) YYYY-MM-DD bounds of the clan's current tracking week. */
function weekBounds(clan: Clan): { start: string; end: string } {
  const start = weekKey(clan);
  return { start, end: addDays(start, 7) };
}

/* --------------------------------------------------------------- recording */

export type EntryMode = "add" | "set";

export interface RecordEntryResult {
  activityDate: string;
  dayTotal: number;
  weekTotal: number;
  inCurrentWeek: boolean;
}

/**
 * Record XP for a member on a day. `add` bumps that day's running total, `set`
 * overwrites it. Any past day can be backfilled by passing an explicit date.
 * When the day falls in the current tracking week the member's live
 * weeklyProgress is recomputed from the ledger so the goal/status engine stays
 * in sync with what was actually entered.
 */
export async function recordEntry(
  clan: Clan,
  identity: MemberIdentity,
  opts: { date: string; amount: number; mode: EntryMode; note?: string | null },
  officer: { id: string; username: string }
): Promise<RecordEntryResult> {
  await ensureMember(clan.guildId, identity);
  const { date, amount, mode } = opts;

  const amountExpr =
    mode === "set"
      ? sql`${Math.max(0, amount)}`
      : sql`greatest(${xpEntriesTable.amount} + ${amount}, 0)`;

  const [row] = await db
    .insert(xpEntriesTable)
    .values({
      guildId: clan.guildId,
      userId: identity.userId,
      username: identity.username,
      activityDate: date,
      amount: Math.max(0, amount),
      note: opts.note ?? null,
      enteredBy: officer.id,
      enteredByUsername: officer.username,
    })
    .onConflictDoUpdate({
      target: [xpEntriesTable.guildId, xpEntriesTable.userId, xpEntriesTable.activityDate],
      set: {
        amount: amountExpr,
        note: opts.note ?? sql`${xpEntriesTable.note}`,
        enteredBy: officer.id,
        enteredByUsername: officer.username,
        updatedAt: new Date(),
      },
    })
    .returning();

  const dayTotal = row?.amount ?? 0;

  // Recompute the current week's live progress from the ledger when this entry
  // touches it (a backfilled past week leaves the live fields alone).
  const { start, end } = weekBounds(clan);
  const inCurrentWeek = date >= start && date < end;
  let weekTotal = 0;
  if (inCurrentWeek) {
    const [agg] = await db
      .select({ total: sql<number>`coalesce(sum(${xpEntriesTable.amount}), 0)::int` })
      .from(xpEntriesTable)
      .where(
        and(
          eq(xpEntriesTable.guildId, clan.guildId),
          eq(xpEntriesTable.userId, identity.userId),
          gte(xpEntriesTable.activityDate, start),
          lt(xpEntriesTable.activityDate, end)
        )
      );
    weekTotal = agg?.total ?? 0;

    const member = await ensureMember(clan.guildId, identity);
    const goal = effectiveGoal(clan, member);
    await db
      .update(clanMembersTable)
      .set({
        weekKey: weekKey(clan),
        weeklyProgress: weekTotal,
        weeklyCompletedAt:
          weekTotal >= goal ? (member.weeklyCompletedAt ?? new Date()) : null,
        lastUpdatedBy: officer.id,
        lastUpdatedByUsername: officer.username,
        progressUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          eq(clanMembersTable.userId, identity.userId)
        )
      );
  }

  await logAction(clan.guildId, {
    action: "xp_entry",
    targetUserId: identity.userId,
    targetUsername: identity.username,
    moderatorId: officer.id,
    moderatorUsername: officer.username,
    details: { date, amount, mode, dayTotal, weekTotal, inCurrentWeek },
  });

  scheduleDashboardRefresh(clan.guildId);

  return { activityDate: date, dayTotal, weekTotal, inCurrentWeek };
}

/* ------------------------------------------------------------- aggregation */

/** Sum of a member's entries between [start, end) YYYY-MM-DD. */
async function sumBetween(
  clan: Clan,
  userId: string,
  start: string,
  end: string
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${xpEntriesTable.amount}), 0)::int` })
    .from(xpEntriesTable)
    .where(
      and(
        eq(xpEntriesTable.guildId, clan.guildId),
        eq(xpEntriesTable.userId, userId),
        gte(xpEntriesTable.activityDate, start),
        lt(xpEntriesTable.activityDate, end)
      )
    );
  return row?.total ?? 0;
}

export interface PeriodTotals {
  today: number;
  week: number;
  month: number;
  allTime: number;
}

/** Today / this-week / this-month / all-time totals from the ledger. */
export async function periodTotals(clan: Clan, userId: string): Promise<PeriodTotals> {
  const today = activityDate(clan);
  const { start: weekStart, end: weekEnd } = weekBounds(clan);
  const monthStart = dayjs(today, "YYYY-MM-DD").startOf("month").format("YYYY-MM-DD");
  const monthEnd = dayjs(today, "YYYY-MM-DD").add(1, "month").startOf("month").format("YYYY-MM-DD");

  const [today_, week, month, all] = await Promise.all([
    sumBetween(clan, userId, today, addDays(today, 1)),
    sumBetween(clan, userId, weekStart, weekEnd),
    sumBetween(clan, userId, monthStart, monthEnd),
    sumBetween(clan, userId, "0000-00-00", "9999-99-99"),
  ]);
  return { today: today_, week, month, allTime: all };
}

/* ----------------------------------------------------------------- calendar */

export type DayStatus = "done" | "missed" | "none" | "future" | "vacation" | "skip";

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  day: number; // 1..31
  amount: number;
  status: DayStatus;
}

export interface CalendarView {
  year: number;
  month: number; // 1..12
  monthLabel: string; // "August 2026"
  target: number;
  days: CalendarDay[];
  doneCount: number;
  missedCount: number;
  total: number;
}

/**
 * Build a month of calendar cells for a member: each day's entered amount and
 * whether it hit the daily target. Exempt / on-leave members are all "skip";
 * per-day vacations are marked; days after today are "future".
 */
export async function calendarFor(
  clan: Clan,
  member: ClanMember,
  year: number,
  month: number
): Promise<CalendarView> {
  const monthStart = dayjs(`${year}-${String(month).padStart(2, "0")}-01`, "YYYY-MM-DD");
  const monthEnd = monthStart.add(1, "month");
  const start = monthStart.format("YYYY-MM-DD");
  const end = monthEnd.format("YYYY-MM-DD");
  const today = activityDate(clan);
  const target = clan.dailyTarget;

  const rows = await db
    .select({ date: xpEntriesTable.activityDate, amount: xpEntriesTable.amount })
    .from(xpEntriesTable)
    .where(
      and(
        eq(xpEntriesTable.guildId, clan.guildId),
        eq(xpEntriesTable.userId, member.userId),
        gte(xpEntriesTable.activityDate, start),
        lt(xpEntriesTable.activityDate, end)
      )
    );
  const amounts = new Map(rows.map((r) => [r.date, r.amount]));

  const vacs = await db
    .select({ date: vacationsTable.activityDate })
    .from(vacationsTable)
    .where(
      and(
        eq(vacationsTable.guildId, clan.guildId),
        eq(vacationsTable.userId, member.userId),
        gte(vacationsTable.activityDate, start),
        lt(vacationsTable.activityDate, end)
      )
    );
  const vacDays = new Set(vacs.map((v) => v.date));

  const skipMember = member.exempt || member.onLeave;
  const daysInMonth = monthEnd.diff(monthStart, "day");
  const days: CalendarDay[] = [];
  let doneCount = 0;
  let missedCount = 0;
  let total = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = monthStart.date(d).format("YYYY-MM-DD");
    const amount = amounts.get(date) ?? 0;
    total += amount;
    let status: DayStatus;
    if (skipMember) status = "skip";
    else if (date > today) status = "future";
    else if (vacDays.has(date)) status = "vacation";
    else if (target > 0) {
      if (amount >= target) status = "done";
      else if (amount > 0) status = "missed";
      else status = "none";
    } else {
      status = amount > 0 ? "done" : "none";
    }
    if (status === "done") doneCount++;
    if (status === "missed" || status === "none") missedCount++;
    days.push({ date, day: d, amount, status });
  }

  return {
    year,
    month,
    monthLabel: monthStart.format("MMMM YYYY"),
    target,
    days,
    doneCount,
    missedCount,
    total,
  };
}

/* ------------------------------------------------------------- who's behind */

export interface MissingMember {
  member: ClanMember;
  todayAmount: number;
}

/**
 * Members who have not met today's target — i.e. still owe XP today. Skips
 * exempt / on-leave members and anyone on vacation today. When no daily target
 * is set, "missing" means simply no entry logged today.
 */
export async function membersMissingToday(
  clan: Clan,
  members: ClanMember[]
): Promise<MissingMember[]> {
  const today = activityDate(clan);
  const rows = await db
    .select({ userId: xpEntriesTable.userId, amount: xpEntriesTable.amount })
    .from(xpEntriesTable)
    .where(and(eq(xpEntriesTable.guildId, clan.guildId), eq(xpEntriesTable.activityDate, today)));
  const todayMap = new Map(rows.map((r) => [r.userId, r.amount]));

  const vacs = await db
    .select({ userId: vacationsTable.userId })
    .from(vacationsTable)
    .where(and(eq(vacationsTable.guildId, clan.guildId), eq(vacationsTable.activityDate, today)));
  const onVacation = new Set(vacs.map((v) => v.userId));

  const out: MissingMember[] = [];
  for (const m of members) {
    if (m.exempt || m.onLeave || onVacation.has(m.userId)) continue;
    const amount = todayMap.get(m.userId) ?? 0;
    const met = clan.dailyTarget > 0 ? amount >= clan.dailyTarget : amount > 0;
    if (!met) out.push({ member: m, todayAmount: amount });
  }
  return out;
}
