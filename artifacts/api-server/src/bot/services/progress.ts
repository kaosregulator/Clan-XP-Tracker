import {
  db,
  clanMembersTable,
  xpWeekHistoryTable,
  type Clan,
  type ClanMember,
  type XpWeekHistory,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { weekKey } from "./time";
import { logAction } from "./logging";
import { ensureMember, type MemberIdentity } from "./config";

/**
 * The progress engine. Every surface — /xp commands, the weekly review, the
 * warning dashboard, the scheduler — reads and writes weekly progress through
 * this module so goal math, status, reminder/warning eligibility and history
 * are computed exactly one way.
 */

export type MemberStatus =
  | "complete"
  | "inProgress"
  | "notStarted"
  | "exempt"
  | "leave"
  | "excused";

export const STATUS_LABEL: Record<MemberStatus, string> = {
  complete: "🟢 Complete",
  inProgress: "🟡 Needs attention",
  notStarted: "⚠️ Missed",
  exempt: "🛡️ Exempt",
  leave: "🌙 On leave",
  excused: "🔵 Excused",
};

/** The goal this member is measured against this week. */
export function effectiveGoal(clan: Clan, member: ClanMember | null): number {
  if (clan.trackingMode === "complete") return 1;
  const goal = member?.weeklyGoalOverride ?? clan.weeklyGoal;
  return Math.max(1, goal);
}

/**
 * The member's progress within the CURRENT week. A stale weekKey (row not yet
 * touched since the weekly reset) reads as zero, so a missed scheduler run can
 * never carry last week's numbers forward.
 */
export function currentProgress(clan: Clan, member: ClanMember): number {
  return member.weekKey === weekKey(clan) ? member.weeklyProgress : 0;
}

export function statusOf(clan: Clan, member: ClanMember): MemberStatus {
  if (member.onLeave) return "leave";
  if (member.excused) return "excused";
  if (member.exempt) return "exempt";
  const progress = currentProgress(clan, member);
  if (progress >= effectiveGoal(clan, member)) return "complete";
  return progress > 0 ? "inProgress" : "notStarted";
}

/** Human progress string in the server's tracking mode. */
export function formatProgress(clan: Clan, member: ClanMember): string {
  const progress = currentProgress(clan, member);
  const goal = effectiveGoal(clan, member);
  if (clan.trackingMode === "complete") {
    return progress >= goal ? "✅ Complete" : `🟡 Needs ${clan.activityName}`;
  }
  const unit = clan.trackingMode === "exact" ? ` ${clan.activityName}` : "";
  return `${progress.toLocaleString()}/${goal.toLocaleString()}${unit}`;
}

/* -------------------------------------------------------- progress writes */

export type ProgressChange =
  | { kind: "set"; amount: number }
  | { kind: "add"; amount: number }
  | { kind: "remove"; amount: number }
  | { kind: "complete" }
  | { kind: "uncomplete" }
  | { kind: "reset" };

export interface Officer {
  id: string;
  username: string;
}

export interface ApplyResult {
  member: ClanMember;
  before: number;
  after: number;
  goal: number;
  /** Crossed the goal line with this update. */
  completedNow: boolean;
}

/**
 * Apply one progress change for one member. Ensures the member row exists,
 * stamps the current week (resetting weekly counters when the week rolled
 * over underneath the row), records who updated it and writes an audit entry.
 */
export async function applyProgress(
  clan: Clan,
  identity: MemberIdentity,
  change: ProgressChange,
  officer: Officer
): Promise<ApplyResult> {
  const row = await ensureMember(clan.guildId, identity);
  const wk = weekKey(clan);
  const sameWeek = row.weekKey === wk;
  const before = sameWeek ? row.weeklyProgress : 0;
  const goal = effectiveGoal(clan, row);

  let after = before;
  switch (change.kind) {
    case "set":
      after = Math.max(0, change.amount);
      break;
    case "add":
      after = Math.max(0, before + change.amount);
      break;
    case "remove":
      after = Math.max(0, before - change.amount);
      break;
    case "complete":
      after = Math.max(goal, before);
      break;
    case "uncomplete":
      after = clan.trackingMode === "complete" ? 0 : Math.min(before, goal - 1);
      break;
    case "reset":
      after = 0;
      break;
  }

  const wasComplete = before >= goal;
  const isComplete = after >= goal;

  const [updated] = await db
    .update(clanMembersTable)
    .set({
      weekKey: wk,
      weeklyProgress: after,
      weeklyCompletedAt: isComplete
        ? sameWeek && wasComplete
          ? row.weeklyCompletedAt ?? new Date()
          : new Date()
        : null,
      // A week rollover under this row starts its weekly counters fresh.
      weekReminders: sameWeek ? row.weekReminders : 0,
      weekWarnings: sameWeek ? row.weekWarnings : 0,
      lastUpdatedBy: officer.id,
      lastUpdatedByUsername: officer.username,
      progressUpdatedAt: new Date(),
    })
    .where(eq(clanMembersTable.id, row.id))
    .returning();

  await logAction(clan.guildId, {
    action: `xp_${change.kind}`,
    targetUserId: identity.userId,
    targetUsername: identity.username,
    moderatorId: officer.id,
    moderatorUsername: officer.username,
    details: { before, after, goal, weekKey: wk },
  });

  return {
    member: updated ?? row,
    before,
    after,
    goal,
    completedNow: isComplete && !wasComplete,
  };
}

/** Set/clear the exempt, on-leave or excused flag with an audit trail. */
export async function setMemberFlag(
  clan: Clan,
  identity: MemberIdentity,
  flag: "exempt" | "onLeave" | "excused",
  value: boolean,
  officer: Officer
): Promise<ClanMember> {
  const row = await ensureMember(clan.guildId, identity);
  const [updated] = await db
    .update(clanMembersTable)
    .set({
      [flag]: value,
      lastUpdatedBy: officer.id,
      lastUpdatedByUsername: officer.username,
    })
    .where(eq(clanMembersTable.id, row.id))
    .returning();
  await logAction(clan.guildId, {
    action: value ? `${flag}_set` : `${flag}_cleared`,
    targetUserId: identity.userId,
    targetUsername: identity.username,
    moderatorId: officer.id,
    moderatorUsername: officer.username,
  });
  return updated ?? row;
}

/**
 * Nudge a member's enforcement warning-point tally up or down by `delta`
 * (clamped at zero) and audit it. Warning points are a staff-managed number
 * that completing XP never touches — only Add WP / Remove WP move it.
 */
export async function adjustWarningPoints(
  clan: Clan,
  identity: MemberIdentity,
  delta: number,
  officer: Officer
): Promise<ClanMember> {
  const row = await ensureMember(clan.guildId, identity);
  const next = Math.max(0, row.warningPoints + delta);
  const [updated] = await db
    .update(clanMembersTable)
    .set({
      warningPoints: next,
      lastUpdatedBy: officer.id,
      lastUpdatedByUsername: officer.username,
    })
    .where(eq(clanMembersTable.id, row.id))
    .returning();
  await logAction(clan.guildId, {
    action: delta >= 0 ? "warning_points_added" : "warning_points_removed",
    targetUserId: identity.userId,
    targetUsername: identity.username,
    moderatorId: officer.id,
    moderatorUsername: officer.username,
    details: { delta, before: row.warningPoints, after: next },
  });
  return updated ?? row;
}

/** Attach an officer note to the member record. Empty string clears it. */
export async function setMemberNote(
  clan: Clan,
  identity: MemberIdentity,
  note: string,
  officer: Officer
): Promise<ClanMember> {
  const row = await ensureMember(clan.guildId, identity);
  const [updated] = await db
    .update(clanMembersTable)
    .set({
      notes: note.trim() || null,
      lastUpdatedBy: officer.id,
      lastUpdatedByUsername: officer.username,
    })
    .where(eq(clanMembersTable.id, row.id))
    .returning();
  await logAction(clan.guildId, {
    action: "note_set",
    targetUserId: identity.userId,
    targetUsername: identity.username,
    moderatorId: officer.id,
    moderatorUsername: officer.username,
    details: { note: note.trim() || null },
  });
  return updated ?? row;
}

/** Per-member goal override (null restores the clan default). */
export async function setGoalOverride(
  clan: Clan,
  identity: MemberIdentity,
  goal: number | null,
  officer: Officer
): Promise<ClanMember> {
  const row = await ensureMember(clan.guildId, identity);
  const [updated] = await db
    .update(clanMembersTable)
    .set({ weeklyGoalOverride: goal })
    .where(eq(clanMembersTable.id, row.id))
    .returning();
  await logAction(clan.guildId, {
    action: "goal_override_set",
    targetUserId: identity.userId,
    targetUsername: identity.username,
    moderatorId: officer.id,
    moderatorUsername: officer.username,
    details: { goal },
  });
  return updated ?? row;
}

/* ---------------------------------------------------------------- queries */

export async function listTracked(clan: Clan): Promise<ClanMember[]> {
  return db
    .select()
    .from(clanMembersTable)
    .where(eq(clanMembersTable.guildId, clan.guildId))
    .orderBy(clanMembersTable.displayName);
}

export interface WeeklySnapshot {
  weekKey: string;
  tracked: number;
  /** tracked minus exempt/on-leave — the completion-rate denominator. */
  active: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  exempt: number;
  onLeave: number;
  excused: number;
  completionRate: number; // 0..1 over active members
  remindersThisWeek: number;
  warningsThisWeek: number;
}

/** Aggregate the current week from the tracked roster. */
export function snapshotFrom(clan: Clan, members: ClanMember[]): WeeklySnapshot {
  const wk = weekKey(clan);
  const snap: WeeklySnapshot = {
    weekKey: wk,
    tracked: members.length,
    active: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    exempt: 0,
    onLeave: 0,
    excused: 0,
    completionRate: 0,
    remindersThisWeek: 0,
    warningsThisWeek: 0,
  };
  for (const m of members) {
    const status = statusOf(clan, m);
    if (status === "exempt") snap.exempt++;
    else if (status === "leave") snap.onLeave++;
    else if (status === "excused") snap.excused++;
    else {
      snap.active++;
      if (status === "complete") snap.completed++;
      else if (status === "inProgress") snap.inProgress++;
      else snap.notStarted++;
    }
    if (m.weekKey === wk) {
      snap.remindersThisWeek += m.weekReminders;
      snap.warningsThisWeek += m.weekWarnings;
    }
  }
  snap.completionRate = snap.active > 0 ? snap.completed / snap.active : 0;
  return snap;
}

export async function weeklySnapshot(clan: Clan): Promise<WeeklySnapshot> {
  return snapshotFrom(clan, await listTracked(clan));
}

/** Members a reminder should reach: tracked, active, and not yet complete. */
export function reminderTargets(clan: Clan, members: ClanMember[]): ClanMember[] {
  return members.filter((m) => {
    const s = statusOf(clan, m);
    return s === "inProgress" || s === "notStarted";
  });
}

/**
 * Members eligible for an XP enforcement warning: still short of goal after
 * the configured number of reminders this week.
 */
export function warningTargets(clan: Clan, members: ClanMember[]): ClanMember[] {
  const wk = weekKey(clan);
  return reminderTargets(clan, members).filter(
    (m) => m.weekKey === wk && m.weekReminders >= clan.warningThreshold
  );
}

/** Bump the weekly reminder counter (called by the reminder service). */
export async function recordWeeklyReminder(clan: Clan, userId: string): Promise<void> {
  const wk = weekKey(clan);
  await db
    .update(clanMembersTable)
    .set({
      weekReminders: sql`case when ${clanMembersTable.weekKey} = ${wk} then ${clanMembersTable.weekReminders} + 1 else 1 end`,
      weekKey: wk,
    })
    .where(and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, userId)));
}

/** Bump the weekly warning counter (called when an XP warning is issued). */
export async function recordWeeklyWarning(clan: Clan, userId: string): Promise<void> {
  const wk = weekKey(clan);
  await db
    .update(clanMembersTable)
    .set({
      weekWarnings: sql`case when ${clanMembersTable.weekKey} = ${wk} then ${clanMembersTable.weekWarnings} + 1 else 1 end`,
      weekKey: wk,
    })
    .where(and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, userId)));
}

/* ------------------------------------------------------------ weekly roll */

export interface RollResult {
  archived: number;
  weekKey: string;
}

/**
 * Close out the tracking week: archive every member's outcome into
 * xp_week_history (idempotent per member+week) and zero the live weekly
 * fields. Used by the scheduler at the week boundary and by "Reset Week".
 */
export async function rollWeek(clan: Clan, officer?: Officer): Promise<RollResult> {
  const members = await listTracked(clan);
  const closingKeys = new Set(
    members.map((m) => m.weekKey).filter((k): k is string => !!k)
  );
  let archived = 0;

  if (clan.archiveWeeks && members.length) {
    const rows = members
      .filter((m) => m.weekKey)
      .map((m) => ({
        guildId: clan.guildId,
        userId: m.userId,
        username: m.username,
        weekKey: m.weekKey!,
        progress: m.weeklyProgress,
        goal: effectiveGoal(clan, m),
        completed: m.weeklyProgress >= effectiveGoal(clan, m),
        exempt: m.exempt,
        onLeave: m.onLeave,
        remindersSent: m.weekReminders,
        warningsIssued: m.weekWarnings,
        updatedBy: m.lastUpdatedBy,
        updatedByUsername: m.lastUpdatedByUsername,
        notes: m.notes,
      }));
    if (rows.length) {
      await db
        .insert(xpWeekHistoryTable)
        .values(rows)
        .onConflictDoNothing();
      archived = rows.length;
    }
  }

  await db
    .update(clanMembersTable)
    .set({
      weekKey: null,
      weeklyProgress: 0,
      weeklyCompletedAt: null,
      weekReminders: 0,
      weekWarnings: 0,
    })
    .where(eq(clanMembersTable.guildId, clan.guildId));

  await logAction(clan.guildId, {
    action: "week_reset",
    moderatorId: officer?.id ?? null,
    moderatorUsername: officer?.username ?? null,
    details: { archived, closedWeeks: [...closingKeys] },
  });

  return { archived, weekKey: weekKey(clan) };
}

/** A member's archived weekly history, newest first. */
export async function memberHistory(
  clan: Clan,
  userId: string,
  limit = 10
): Promise<XpWeekHistory[]> {
  return db
    .select()
    .from(xpWeekHistoryTable)
    .where(
      and(eq(xpWeekHistoryTable.guildId, clan.guildId), eq(xpWeekHistoryTable.userId, userId))
    )
    .orderBy(desc(xpWeekHistoryTable.weekKey))
    .limit(limit);
}

/* ------------------------------------------------------------- bulk apply */

export interface BulkResult {
  updated: number;
  completedNow: number;
}

/** Apply one change to many members (role bulk actions). */
export async function bulkApply(
  clan: Clan,
  identities: MemberIdentity[],
  change: ProgressChange,
  officer: Officer
): Promise<BulkResult> {
  let updated = 0;
  let completedNow = 0;
  for (const identity of identities) {
    const res = await applyProgress(clan, identity, change, officer);
    updated++;
    if (res.completedNow) completedNow++;
  }
  return { updated, completedNow };
}

/**
 * Mirror the configured exempt/leave ROLES onto member flags for the given
 * user-id → role-check results. Used before reviews so role-based exemptions
 * are honoured without officers flagging members one by one.
 */
export async function syncRoleFlags(
  clan: Clan,
  exemptIds: string[],
  leaveIds: string[]
): Promise<void> {
  if (exemptIds.length) {
    await db
      .update(clanMembersTable)
      .set({ exempt: true })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          inArray(clanMembersTable.userId, exemptIds),
          eq(clanMembersTable.exempt, false)
        )
      );
  }
  if (leaveIds.length) {
    await db
      .update(clanMembersTable)
      .set({ onLeave: true })
      .where(
        and(
          eq(clanMembersTable.guildId, clan.guildId),
          inArray(clanMembersTable.userId, leaveIds),
          eq(clanMembersTable.onLeave, false)
        )
      );
  }
}
