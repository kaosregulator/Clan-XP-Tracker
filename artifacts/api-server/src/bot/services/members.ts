import { db, clanMembersTable, xpSubmissionsTable } from "@workspace/db";
import type { Clan, ClanMember } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { activityDate, dayIndex } from "./time";

export interface MemberStats {
  currentStreak: number;
  longestStreak: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  submissionsCount: number;
  approvalRate: number; // 0..1 over reviewed submissions
  lastActivityDate: string | null;
  lastApprovedAt: Date | null;
}

/** Compute streaks/counts from the member's submission history (source of truth). */
export function computeStats(
  submissions: {
    status: string;
    activityDate: string;
    reviewedAt: Date | null;
  }[],
  todayActivityDate: string
): MemberStats {
  let approvedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;
  let lastApprovedAt: Date | null = null;

  const approvedDays = new Set<string>();
  for (const s of submissions) {
    if (s.status === "approved") {
      approvedCount++;
      approvedDays.add(s.activityDate);
      if (s.reviewedAt && (!lastApprovedAt || s.reviewedAt > lastApprovedAt)) {
        lastApprovedAt = s.reviewedAt;
      }
    } else if (s.status === "rejected") {
      rejectedCount++;
    } else {
      pendingCount++;
    }
  }

  const days = [...approvedDays].map(dayIndex).sort((a, b) => a - b);

  // Longest run of consecutive days.
  let longestStreak = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    run = prev !== null && d - prev === 1 ? run + 1 : 1;
    prev = d;
    if (run > longestStreak) longestStreak = run;
  }

  // Current streak: anchored to today if completed, else yesterday.
  const today = dayIndex(todayActivityDate);
  const dayset = new Set(days);
  let anchor: number | null = null;
  if (dayset.has(today)) anchor = today;
  else if (dayset.has(today - 1)) anchor = today - 1;

  let currentStreak = 0;
  if (anchor !== null) {
    let cursor = anchor;
    while (dayset.has(cursor)) {
      currentStreak++;
      cursor--;
    }
  }

  const reviewed = approvedCount + rejectedCount;
  const approvalRate = reviewed > 0 ? approvedCount / reviewed : 0;
  const lastActivityDate = days.length ? [...approvedDays].sort().at(-1)! : null;

  return {
    currentStreak,
    longestStreak,
    approvedCount,
    rejectedCount,
    pendingCount,
    submissionsCount: submissions.length,
    approvalRate,
    lastActivityDate,
    lastApprovedAt,
  };
}

/**
 * Recompute and persist a member's rolled-up stats from their submissions.
 * Call after any submission status change. Returns the fresh stats.
 */
export async function recomputeMemberStats(
  clan: Clan,
  userId: string
): Promise<MemberStats> {
  const rows = await db
    .select({
      status: xpSubmissionsTable.status,
      activityDate: xpSubmissionsTable.activityDate,
      reviewedAt: xpSubmissionsTable.reviewedAt,
    })
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.userId, userId),
        isNull(xpSubmissionsTable.deletedAt)
      )
    );

  const stats = computeStats(rows, activityDate(clan));

  await db
    .update(clanMembersTable)
    .set({
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      approvedCount: stats.approvedCount,
      rejectedCount: stats.rejectedCount,
      pendingCount: stats.pendingCount,
      submissionsCount: stats.submissionsCount,
      lastActivityDate: stats.lastActivityDate,
      lastApprovedAt: stats.lastApprovedAt,
    })
    .where(and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, userId)));

  return stats;
}

/** Whether the member has completed the current activity day. */
export function hasCompletedToday(member: ClanMember | null, todayActivityDate: string): boolean {
  return !!member && member.lastActivityDate === todayActivityDate;
}
