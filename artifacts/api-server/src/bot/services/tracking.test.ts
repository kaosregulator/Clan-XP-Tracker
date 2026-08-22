/**
 * Unit tests for tracking-period helpers and member/staff message separation.
 * Run with: `pnpm --filter @workspace/api-server exec tsx --test src/bot/services/tracking.test.ts`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Clan, ClanMember } from "@workspace/db";
import {
  getTrackingPeriod,
  getRequirement,
  getMemberProgress,
  isRequirementSatisfied,
  periodKey,
  periodAdjective,
  memberReminderBody,
  memberWarningBody,
  memberWarningDmContent,
  memberWarningCanvasMessage,
  sanitizeMemberReason,
  containsStaffAccounting,
  staffWarningReason,
  staffProgressDetail,
  staffProgressLine,
} from "./tracking.js";

function baseClan(over: Partial<Clan> = {}): Clan {
  return {
    id: 1,
    guildId: "g1",
    guildName: "Test",
    clanName: "TestClan",
    clanLogoUrl: null,
    clanRank: null,
    activityName: "XP",
    gameName: "Roblox",
    gameUrl: null,
    dailyGoal: 0,
    clanDailyLimit: 0,
    contributionValue: 1500,
    timezone: "UTC",
    resetTime: "00:00",
    reminderTimes: ["18:00"],
    remindersEnabled: true,
    submissionChannelId: null,
    reviewChannelId: null,
    logChannelId: null,
    staffDashboardChannelId: null,
    clanDashboardChannelId: null,
    patriotDashboardChannelId: null,
    leaderboardChannelId: null,
    staffRoleIds: [],
    warningRoleIds: ["warn-role"],
    reminderRoleId: null,
    adminUserIds: [],
    cardStyle: "canvas",
    warningRemovalHours: 0,
    altAccountsEnabled: false,
    maxAltAccounts: null,
    proofRequired: true,
    autoApprove: true,
    dmOnApprove: false,
    dmOnWarn: true,
    setupComplete: true,
    requiredRoleId: null,
    trackerChannelId: null,
    allowedRoleIds: [],
    allowedUserIds: [],
    trackingMode: "complete",
    trackingPeriod: "weekly",
    weeklyGoal: 1,
    dailyTarget: 0,
    weekStartDay: 1,
    autoWeeklyReset: true,
    archiveWeeks: true,
    reminderDays: [3, 5],
    warningThreshold: 3,
    escalationThreshold: 2,
    reminderChannelId: null,
    warningChannelId: null,
    adminRoleIds: [],
    exemptRoleIds: [],
    leaveRoleIds: [],
    dmReminders: true,
    pingReminders: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Clan;
}

function baseMember(over: Partial<ClanMember> = {}): ClanMember {
  return {
    id: 1,
    guildId: "g1",
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    gameUsername: null,
    currentStreak: 0,
    longestStreak: 0,
    approvedCount: 0,
    rejectedCount: 0,
    pendingCount: 0,
    remindersCount: 0,
    warningsCount: 0,
    submissionsCount: 0,
    vacationCount: 0,
    lastVacationDate: null,
    lastActivityDate: null,
    lastApprovedAt: null,
    lastSubmittedAt: null,
    xpDaily: 0,
    xpWeekly: 0,
    xpMonthly: 0,
    xpAllTime: 0,
    altXpAllTime: 0,
    weekKey: null,
    weeklyProgress: 0,
    weeklyGoalOverride: null,
    weeklyCompletedAt: null,
    weekReminders: 0,
    weekWarnings: 0,
    exempt: false,
    onLeave: false,
    notes: null,
    lastUpdatedBy: null,
    lastUpdatedByUsername: null,
    progressUpdatedAt: null,
    joinedAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as ClanMember;
}

describe("tracking period + requirement", () => {
  it("defaults unknown period to weekly", () => {
    assert.equal(getTrackingPeriod({ trackingPeriod: "weekly" }), "weekly");
    assert.equal(getTrackingPeriod({ trackingPeriod: "daily" }), "daily");
    assert.equal(getTrackingPeriod({ trackingPeriod: "nope" }), "weekly");
    assert.equal(getTrackingPeriod({}), "weekly");
  });

  it("daily: incomplete when progress is 0 against requirement 1", () => {
    const clan = baseClan({
      trackingPeriod: "daily",
      trackingMode: "complete",
      dailyTarget: 1,
      weeklyGoal: 1,
    });
    const member = baseMember({ weekKey: periodKey(clan), weeklyProgress: 0 });
    assert.equal(getRequirement(clan, member), 1);
    assert.equal(getMemberProgress(clan, member), 0);
    assert.equal(isRequirementSatisfied(clan, member), false);
  });

  it("daily: complete when progress meets requirement", () => {
    const clan = baseClan({
      trackingPeriod: "daily",
      trackingMode: "complete",
      dailyTarget: 1,
    });
    const member = baseMember({ weekKey: periodKey(clan), weeklyProgress: 1 });
    assert.equal(isRequirementSatisfied(clan, member), true);
  });

  it("daily: uses dailyTarget as requirement when set (exact mode)", () => {
    const clan = baseClan({
      trackingPeriod: "daily",
      trackingMode: "exact",
      dailyTarget: 500,
      weeklyGoal: 5000,
    });
    assert.equal(getRequirement(clan, null), 500);
    const member = baseMember({ weekKey: periodKey(clan), weeklyProgress: 100 });
    assert.equal(isRequirementSatisfied(clan, member), false);
    const done = baseMember({ weekKey: periodKey(clan), weeklyProgress: 500 });
    assert.equal(isRequirementSatisfied(clan, done), true);
  });

  it("weekly: incomplete / complete against weeklyGoal", () => {
    const clan = baseClan({
      trackingPeriod: "weekly",
      trackingMode: "exact",
      weeklyGoal: 5000,
      dailyTarget: 500, // calendar-only when weekly
    });
    assert.equal(getRequirement(clan, null), 5000);
    const short = baseMember({ weekKey: periodKey(clan), weeklyProgress: 100 });
    assert.equal(isRequirementSatisfied(clan, short), false);
    const done = baseMember({ weekKey: periodKey(clan), weeklyProgress: 5000 });
    assert.equal(isRequirementSatisfied(clan, done), true);
  });

  it("XP transaction-sized progress alone does not satisfy a larger requirement", () => {
    // Simulates "XP was sent" (nonzero ledger) without meeting the goal.
    const clan = baseClan({
      trackingPeriod: "weekly",
      trackingMode: "exact",
      weeklyGoal: 5000,
    });
    const member = baseMember({ weekKey: periodKey(clan), weeklyProgress: 1500 });
    assert.equal(getMemberProgress(clan, member) > 0, true);
    assert.equal(isRequirementSatisfied(clan, member), false);
  });

  it("stale period key reads as zero progress", () => {
    const clan = baseClan({ trackingPeriod: "weekly", trackingMode: "complete" });
    const member = baseMember({ weekKey: "2000-01-01", weeklyProgress: 99 });
    assert.equal(getMemberProgress(clan, member), 0);
    assert.equal(isRequirementSatisfied(clan, member), false);
  });
});

describe("member reminder messages", () => {
  it("uses daily wording when daily is configured", () => {
    const clan = baseClan({ trackingPeriod: "daily" });
    const body = memberReminderBody(clan);
    assert.match(body, /daily/i);
    assert.doesNotMatch(body, /weekly/i);
    assert.equal(containsStaffAccounting(body), false);
    assert.doesNotMatch(body, /\d+\s*\/\s*\d+/);
  });

  it("uses weekly wording when weekly is configured", () => {
    const clan = baseClan({ trackingPeriod: "weekly" });
    const body = memberReminderBody(clan);
    assert.match(body, /weekly/i);
    assert.doesNotMatch(body, /daily XP requirement/i);
  });

  it("does not expose staff accounting in reminders", () => {
    const clan = baseClan({ trackingPeriod: "daily", trackingMode: "exact", dailyTarget: 1 });
    const body = memberReminderBody(clan);
    assert.doesNotMatch(body, /0\/1|1\/1|missing|XP recorded|reminder count/i);
    // Custom note with staff leak is rejected in favor of safe default.
    const leaked = memberReminderBody(clan, "You are at 0/1 — missing 1 XP");
    assert.equal(containsStaffAccounting(leaked), false);
    assert.doesNotMatch(leaked, /0\/1/);
  });
});

describe("member warning messages", () => {
  it("never contains progress fractions, missing XP, reminder counts, or thresholds", () => {
    const texts = [
      memberWarningBody("Failure to complete the required activity."),
      memberWarningBody("Missed the weekly XP goal (0 / 1) after 3 reminder(s)."),
      memberWarningDmContent("Missed goal 0/1"),
      memberWarningCanvasMessage("missing 1 XP after 2 reminders"),
      sanitizeMemberReason("Progress: 0/1 · escalation threshold 2"),
    ];
    for (const t of texts) {
      assert.doesNotMatch(t, /\d+\s*\/\s*\d+/);
      assert.doesNotMatch(t, /missing\s+\d+/i);
      assert.doesNotMatch(t, /missing\s+.+\s*xp/i);
      assert.doesNotMatch(t, /\d+\s*reminder/i);
      assert.doesNotMatch(t, /escalation/i);
      assert.doesNotMatch(t, /threshold/i);
      assert.doesNotMatch(t, /XP recorded|XP sent/i);
      assert.match(t, /warning|required activity/i);
    }
  });

  it("still includes a real warning reason when safe", () => {
    const body = memberWarningBody("Did not show up for clan event.");
    assert.match(body, /Did not show up for clan event/);
    assert.match(body, /warning/i);
  });
});

describe("staff / log messages", () => {
  it("CAN contain progress and accounting information", () => {
    const clan = baseClan({
      trackingPeriod: "weekly",
      trackingMode: "exact",
      weeklyGoal: 5000,
    });
    const member = baseMember({
      weekKey: periodKey(clan),
      weeklyProgress: 1200,
      weekReminders: 3,
    });
    const reason = staffWarningReason(clan, member);
    assert.match(reason, /1,?200/);
    assert.match(reason, /5,?000/);
    assert.match(reason, /3 reminder/);
    assert.match(reason, /weekly/i);

    const detail = staffProgressDetail(clan, member);
    assert.equal(detail.progress, 1200);
    assert.equal(detail.requirement, 5000);
    assert.equal(detail.missing, 3800);
    assert.equal(detail.satisfied, false);

    const line = staffProgressLine(clan, member);
    assert.match(line, /1,?200/);
    assert.match(line, /5,?000/);
  });

  it("staff daily reason uses daily wording", () => {
    const clan = baseClan({
      trackingPeriod: "daily",
      trackingMode: "complete",
      dailyTarget: 1,
    });
    const member = baseMember({ weekKey: periodKey(clan), weeklyProgress: 0, weekReminders: 2 });
    const reason = staffWarningReason(clan, member);
    assert.match(reason, /daily/i);
    assert.match(reason, /0\s*\/\s*1/);
  });
});

describe("auto-role eligibility semantics", () => {
  it("incomplete requirement is NOT eligible (role should stay)", () => {
    const clan = baseClan({
      trackingPeriod: "daily",
      trackingMode: "complete",
      dailyTarget: 1,
    });
    // Nonzero XP-like progress that still fails complete-mode? progress 0.
    // Or exact mode with partial ledger:
    const exact = baseClan({
      trackingPeriod: "weekly",
      trackingMode: "exact",
      weeklyGoal: 10,
    });
    const partial = baseMember({ weekKey: periodKey(exact), weeklyProgress: 1 });
    assert.equal(isRequirementSatisfied(exact, partial), false);
  });

  it("qualifying activity DOES satisfy and is eligible for role removal", () => {
    const clan = baseClan({
      trackingPeriod: "daily",
      trackingMode: "complete",
      dailyTarget: 1,
    });
    const member = baseMember({ weekKey: periodKey(clan), weeklyProgress: 1 });
    assert.equal(isRequirementSatisfied(clan, member), true);
  });

  it("period adjective follows config (not hard-coded weekly)", () => {
    assert.equal(periodAdjective(baseClan({ trackingPeriod: "daily" })), "daily");
    assert.equal(periodAdjective(baseClan({ trackingPeriod: "weekly" })), "weekly");
  });
});
