import {
  db,
  clanMembersTable,
  xpSubmissionsTable,
  warningsTable,
  remindersTable,
} from "@workspace/db";
import type { Clan } from "@workspace/db";
import { eq, and, gte, desc, isNull, sql, ne } from "drizzle-orm";
import { activityDate, currentDayStart } from "./time";

export interface TodaySnapshot {
  totalMembers: number;
  completed: number;
  pending: number;
  missing: number;
  pendingReviews: number;
  warningsToday: number;
  remindersToday: number;
  topStreaks: { name: string; streak: number }[];
}

/** Aggregate the numbers behind the /xpadmin dashboard for the current day. */
export async function todaySnapshot(clan: Clan): Promise<TodaySnapshot> {
  const today = activityDate(clan);
  const dayStart = currentDayStart(clan);

  const [members, completedRow, pendingRow, reviewRow, warnRow, remindRow, streaks] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(clanMembersTable)
        .where(eq(clanMembersTable.guildId, clan.guildId)),
      // distinct members with an approved submission today
      db
        .select({ count: sql<number>`count(distinct ${xpSubmissionsTable.userId})::int` })
        .from(xpSubmissionsTable)
        .where(
          and(
            eq(xpSubmissionsTable.guildId, clan.guildId),
            eq(xpSubmissionsTable.activityDate, today),
            eq(xpSubmissionsTable.status, "approved")
          )
        ),
      // distinct members with a pending submission today (and no approval yet)
      db
        .select({ count: sql<number>`count(distinct ${xpSubmissionsTable.userId})::int` })
        .from(xpSubmissionsTable)
        .where(
          and(
            eq(xpSubmissionsTable.guildId, clan.guildId),
            eq(xpSubmissionsTable.activityDate, today),
            eq(xpSubmissionsTable.status, "pending")
          )
        ),
      // total pending submissions in the queue
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(xpSubmissionsTable)
        .where(
          and(
            eq(xpSubmissionsTable.guildId, clan.guildId),
            eq(xpSubmissionsTable.status, "pending"),
            isNull(xpSubmissionsTable.deletedAt)
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(warningsTable)
        .where(and(eq(warningsTable.guildId, clan.guildId), gte(warningsTable.issuedAt, dayStart))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(remindersTable)
        .where(and(eq(remindersTable.guildId, clan.guildId), eq(remindersTable.activityDate, today))),
      db
        .select({ name: clanMembersTable.displayName, streak: clanMembersTable.currentStreak })
        .from(clanMembersTable)
        .where(and(eq(clanMembersTable.guildId, clan.guildId), ne(clanMembersTable.currentStreak, 0)))
        .orderBy(desc(clanMembersTable.currentStreak))
        .limit(3),
    ]);

  const totalMembers = members[0]?.count ?? 0;
  const completed = completedRow[0]?.count ?? 0;

  return {
    totalMembers,
    completed,
    pending: pendingRow[0]?.count ?? 0,
    missing: Math.max(0, totalMembers - completed),
    pendingReviews: reviewRow[0]?.count ?? 0,
    warningsToday: warnRow[0]?.count ?? 0,
    remindersToday: remindRow[0]?.count ?? 0,
    topStreaks: streaks.map((s) => ({ name: s.name, streak: s.streak })),
  };
}

export interface LeaderRow {
  userId: string;
  displayName: string;
  currentStreak: number;
  longestStreak: number;
  approvedCount: number;
}

/** Members who have NOT completed the current activity day. */
export async function missingMembers(
  clan: Clan,
  limit = 40
): Promise<{ userId: string; displayName: string }[]> {
  const today = activityDate(clan);
  const rows = await db
    .select({ userId: clanMembersTable.userId, displayName: clanMembersTable.displayName })
    .from(clanMembersTable)
    .where(
      and(
        eq(clanMembersTable.guildId, clan.guildId),
        ne(clanMembersTable.lastActivityDate, today)
      )
    )
    .limit(limit);
  // ne() excludes NULLs in SQL, so also pull members who never completed.
  const nullRows = await db
    .select({ userId: clanMembersTable.userId, displayName: clanMembersTable.displayName })
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, clan.guildId), isNull(clanMembersTable.lastActivityDate)))
    .limit(limit);
  const seen = new Set(rows.map((r) => r.userId));
  return [...rows, ...nullRows.filter((r) => !seen.has(r.userId))].slice(0, limit);
}

export interface PeriodReport {
  days: number;
  submissions: number;
  approved: number;
  rejected: number;
  pending: number;
  approvalRate: number;
  activeMembers: number;
  reminders: number;
  warnings: number;
  top: { name: string; approved: number }[];
}

/** Aggregate activity over the last `days` for a weekly/monthly report card. */
export async function periodReport(clan: Clan, days: number): Promise<PeriodReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  const inPeriod = and(
    eq(xpSubmissionsTable.guildId, clan.guildId),
    gte(xpSubmissionsTable.submittedAt, since),
    isNull(xpSubmissionsTable.deletedAt)
  );

  const [agg, distinct, topRows, rem, warn] = await Promise.all([
    db
      .select({
        submissions: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${xpSubmissionsTable.status} = 'approved')::int`,
        rejected: sql<number>`count(*) filter (where ${xpSubmissionsTable.status} = 'rejected')::int`,
        pending: sql<number>`count(*) filter (where ${xpSubmissionsTable.status} = 'pending')::int`,
      })
      .from(xpSubmissionsTable)
      .where(inPeriod),
    db
      .select({ count: sql<number>`count(distinct ${xpSubmissionsTable.userId})::int` })
      .from(xpSubmissionsTable)
      .where(inPeriod),
    db
      .select({
        userId: xpSubmissionsTable.userId,
        username: xpSubmissionsTable.username,
        approved: sql<number>`count(*)::int`,
      })
      .from(xpSubmissionsTable)
      .where(and(inPeriod, eq(xpSubmissionsTable.status, "approved")))
      .groupBy(xpSubmissionsTable.userId, xpSubmissionsTable.username)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(remindersTable)
      .where(and(eq(remindersTable.guildId, clan.guildId), gte(remindersTable.createdAt, since))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(warningsTable)
      .where(and(eq(warningsTable.guildId, clan.guildId), gte(warningsTable.issuedAt, since))),
  ]);

  const a = agg[0] ?? { submissions: 0, approved: 0, rejected: 0, pending: 0 };
  const reviewed = a.approved + a.rejected;
  return {
    days,
    submissions: a.submissions,
    approved: a.approved,
    rejected: a.rejected,
    pending: a.pending,
    approvalRate: reviewed > 0 ? a.approved / reviewed : 0,
    activeMembers: distinct[0]?.count ?? 0,
    reminders: rem[0]?.count ?? 0,
    warnings: warn[0]?.count ?? 0,
    top: topRows.map((t) => ({ name: t.username, approved: t.approved })),
  };
}

export async function streakLeaderboard(guildId: string, limit = 10): Promise<LeaderRow[]> {
  return db
    .select({
      userId: clanMembersTable.userId,
      displayName: clanMembersTable.displayName,
      currentStreak: clanMembersTable.currentStreak,
      longestStreak: clanMembersTable.longestStreak,
      approvedCount: clanMembersTable.approvedCount,
    })
    .from(clanMembersTable)
    .where(eq(clanMembersTable.guildId, guildId))
    .orderBy(desc(clanMembersTable.currentStreak), desc(clanMembersTable.approvedCount))
    .limit(limit);
}
