import {
  db,
  xpSubmissionsTable,
  clanMembersTable,
  auditLogsTable,
} from "@workspace/db";
import type { Clan, AuditLog } from "@workspace/db";
import { eq, and, gte, lt, ne, desc, isNull, or, sql } from "drizzle-orm";
import dayjs from "dayjs";
import { activityDate } from "./time";
import { contributionValue } from "./contributions";

export interface Contributor {
  userId: string;
  name: string;
  xp: number;
}

export interface ClanXpStats {
  /** XP one contribution is worth. */
  value: number;
  /** All-time clan XP (every non-rejected contribution × value). */
  totalXp: number;
  /** XP banked for the current activity day. */
  todayXp: number;
  /** XP banked over the last 7 activity days. */
  weekXp: number;
  /** All-time XP contributed by alt accounts. */
  altTotalXp: number;
  /** Alt XP banked today. */
  altTodayXp: number;
  /** Fraction (0..1) of total clan XP that came from alts. */
  altPct: number;
  /** Top 3 contributors all-time (main + alts combined). */
  topContributors: Contributor[];
  /** Top 3 alt contributors all-time. */
  topAltContributors: Contributor[];
  /** Members with at least one submission in the last 7 activity days. */
  activeMembers: number;
  /** Distinct (member, day) completions in the last 7 activity days. */
  memberDaysWeek: number;
}

/** The activity-day string N days before today (clan timezone / reset aware). */
function daysAgo(clan: Clan, n: number): string {
  return dayjs(activityDate(clan)).subtract(n, "day").format("YYYY-MM-DD");
}

/**
 * XP aggregates that power the clan and alt dashboards. XP is derived from the
 * contribution model (each submission carries `contributions` = 1 main + alts,
 * and `altAccountsCompleted` = the alt portion), valued at `contributionValue`.
 * Rejected and soft-deleted submissions never count.
 */
export async function clanXpStats(clan: Clan): Promise<ClanXpStats> {
  const value = contributionValue(clan);
  const today = activityDate(clan);
  const weekStart = daysAgo(clan, 6);

  const base = and(
    eq(xpSubmissionsTable.guildId, clan.guildId),
    ne(xpSubmissionsTable.status, "rejected"),
    isNull(xpSubmissionsTable.deletedAt),
  );

  const contribSum = sql<number>`coalesce(sum(${xpSubmissionsTable.contributions}), 0)::int`;
  const altSum = sql<number>`coalesce(sum(${xpSubmissionsTable.altAccountsCompleted}), 0)::int`;

  const [allTime, todayRow, weekRow, topContrib, topAlt, active, memberDays] =
    await Promise.all([
      db
        .select({ contrib: contribSum, alt: altSum })
        .from(xpSubmissionsTable)
        .where(base),
      db
        .select({ contrib: contribSum, alt: altSum })
        .from(xpSubmissionsTable)
        .where(and(base, eq(xpSubmissionsTable.activityDate, today))),
      db
        .select({ contrib: contribSum })
        .from(xpSubmissionsTable)
        .where(and(base, gte(xpSubmissionsTable.activityDate, weekStart))),
      db
        .select({
          userId: xpSubmissionsTable.userId,
          name: sql<string>`max(${xpSubmissionsTable.username})`,
          contrib: contribSum,
        })
        .from(xpSubmissionsTable)
        .where(base)
        .groupBy(xpSubmissionsTable.userId)
        .orderBy(desc(contribSum))
        .limit(3),
      db
        .select({
          userId: xpSubmissionsTable.userId,
          name: sql<string>`max(${xpSubmissionsTable.username})`,
          alt: altSum,
        })
        .from(xpSubmissionsTable)
        .where(base)
        .groupBy(xpSubmissionsTable.userId)
        .having(sql`sum(${xpSubmissionsTable.altAccountsCompleted}) > 0`)
        .orderBy(desc(altSum))
        .limit(3),
      db
        .select({
          count: sql<number>`count(distinct ${xpSubmissionsTable.userId})::int`,
        })
        .from(xpSubmissionsTable)
        .where(and(base, gte(xpSubmissionsTable.activityDate, weekStart))),
      db
        .select({
          count: sql<number>`count(distinct (${xpSubmissionsTable.userId}, ${xpSubmissionsTable.activityDate}))::int`,
        })
        .from(xpSubmissionsTable)
        .where(and(base, gte(xpSubmissionsTable.activityDate, weekStart))),
    ]);

  const totalContrib = allTime[0]?.contrib ?? 0;
  const totalAlt = allTime[0]?.alt ?? 0;
  const totalXp = totalContrib * value;
  const altTotalXp = totalAlt * value;

  return {
    value,
    totalXp,
    todayXp: (todayRow[0]?.contrib ?? 0) * value,
    weekXp: (weekRow[0]?.contrib ?? 0) * value,
    altTotalXp,
    altTodayXp: (todayRow[0]?.alt ?? 0) * value,
    altPct: totalXp > 0 ? altTotalXp / totalXp : 0,
    topContributors: topContrib.map((r) => ({
      userId: r.userId,
      name: r.name,
      xp: r.contrib * value,
    })),
    topAltContributors: topAlt.map((r) => ({
      userId: r.userId,
      name: r.name,
      xp: r.alt * value,
    })),
    activeMembers: active[0]?.count ?? 0,
    memberDaysWeek: memberDays[0]?.count ?? 0,
  };
}

/** Members with no completed activity day in the last `days` (or ever). */
export async function inactiveCount(clan: Clan, days = 7): Promise<number> {
  const cutoff = daysAgo(clan, days);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clanMembersTable)
    .where(
      and(
        eq(clanMembersTable.guildId, clan.guildId),
        or(
          isNull(clanMembersTable.lastActivityDate),
          lt(clanMembersTable.lastActivityDate, cutoff),
        ),
      ),
    );
  return row?.count ?? 0;
}

/** Pending submissions that carry a screenshot awaiting verification. */
export async function verificationQueueCount(clan: Clan): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.status, "pending"),
        isNull(xpSubmissionsTable.deletedAt),
        sql`array_length(${xpSubmissionsTable.proofImageUrls}, 1) > 0`,
      ),
    );
  return row?.count ?? 0;
}

/** The most recent audit-log entries for the recent-activity feed. */
export async function recentActivity(
  clan: Clan,
  limit = 6,
): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.guildId, clan.guildId))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);
}
