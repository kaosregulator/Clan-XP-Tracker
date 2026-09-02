import type { Clan, ClanMember } from "@workspace/db";
import { activityDate, weekKey, nextReset, nextWeeklyReset } from "./time";

/**
 * Single source of truth for the configured tracking period and the
 * member/staff message boundary.
 *
 * Progress math still lives in `progress.ts` (one engine). This module owns:
 *   - which period a clan uses (daily / weekly)
 *   - the period key progress rows are stamped with
 *   - the numeric requirement for that period
 *   - member-facing copy that must never leak staff accounting
 *   - staff-facing detail helpers that intentionally include the numbers
 */

export type TrackingPeriod = "daily" | "weekly";

/** Configured tracking period. Unknown/legacy values fall back to weekly. */
export function getTrackingPeriod(
  clan: Pick<Clan, "trackingPeriod"> | { trackingPeriod?: string | null }
): TrackingPeriod {
  return clan.trackingPeriod === "daily" ? "daily" : "weekly";
}

/** Lowercase adjective for copy: "daily" / "weekly". */
export function periodAdjective(clan: Pick<Clan, "trackingPeriod">): string {
  return getTrackingPeriod(clan);
}

/** Title-case label for staff UI: "Daily" / "Weekly". */
export function periodLabel(clan: Pick<Clan, "trackingPeriod">): string {
  return getTrackingPeriod(clan) === "daily" ? "Daily" : "Weekly";
}

/**
 * The current period key progress rows must match.
 *   daily  → activity day YYYY-MM-DD (respects resetTime)
 *   weekly → week-start YYYY-MM-DD (respects weekStartDay + resetTime)
 *
 * Reuses the existing `week_key` column on clan_members — the column name is
 * historical; the value is always the active period key.
 */
export function periodKey(
  clan: Pick<Clan, "trackingPeriod" | "timezone" | "resetTime" | "weekStartDay">,
  at: Date = new Date()
): string {
  return getTrackingPeriod(clan) === "daily" ? activityDate(clan, at) : weekKey(clan, at);
}

/** Moment the current tracking period ends / the next reset fires. */
export function nextPeriodReset(
  clan: Pick<Clan, "trackingPeriod" | "timezone" | "resetTime" | "weekStartDay">,
  from: Date = new Date()
): Date {
  return getTrackingPeriod(clan) === "daily" ? nextReset(clan, from) : nextWeeklyReset(clan, from);
}

/**
 * The numeric requirement this member is measured against for the current
 * tracking period. Source of truth order:
 *   1. trackingMode === "complete" → 1 (done / not-done)
 *   2. per-member override when set
 *   3. daily period → dailyTarget when > 0, else weeklyGoal
 *   4. weekly period → weeklyGoal
 */
export function getRequirement(
  clan: Pick<Clan, "trackingPeriod" | "trackingMode" | "weeklyGoal" | "dailyTarget">,
  member: Pick<ClanMember, "weeklyGoalOverride"> | null
): number {
  if (clan.trackingMode === "complete") return 1;
  if (member?.weeklyGoalOverride != null) return Math.max(1, member.weeklyGoalOverride);
  if (getTrackingPeriod(clan) === "daily") {
    const goal = clan.dailyTarget > 0 ? clan.dailyTarget : clan.weeklyGoal;
    return Math.max(1, goal);
  }
  return Math.max(1, clan.weeklyGoal);
}

/**
 * Live progress for the current period. A stale period key reads as zero so a
 * missed reset can never carry the previous period forward.
 */
export function getMemberProgress(
  clan: Pick<Clan, "trackingPeriod" | "timezone" | "resetTime" | "weekStartDay">,
  member: Pick<ClanMember, "weekKey" | "weeklyProgress">
): number {
  return member.weekKey === periodKey(clan) ? member.weeklyProgress : 0;
}

/** True when the member has met (or exceeded) the configured requirement. */
export function isRequirementSatisfied(
  clan: Pick<
    Clan,
    "trackingPeriod" | "trackingMode" | "weeklyGoal" | "dailyTarget" | "timezone" | "resetTime" | "weekStartDay"
  >,
  member: Pick<ClanMember, "weekKey" | "weeklyProgress" | "weeklyGoalOverride" | "exempt" | "onLeave">
): boolean {
  if (member.exempt || member.onLeave) return true;
  return getMemberProgress(clan, member) >= getRequirement(clan, member);
}

/* ------------------------------------------------------ member-facing copy */

const STAFF_LEAK_PATTERNS: RegExp[] = [
  /\d+\s*\/\s*\d+/, // 0/1, 1/1, 4200/5000
  /missing\s+\d+/i,
  /missing\s+.+\s*xp/i,
  /xp\s+recorded/i,
  /xp\s+sent/i,
  /reminder\s*count/i,
  /\d+\s*reminder/i,
  /warning\s*threshold/i,
  /escalation/i,
  /active\s+warning/i,
  /progress\s*:/i,
];

/**
 * True when a string contains staff-only accounting that must never reach a
 * member-facing surface (DM, warn channel, reminder channel, canvas card).
 */
export function containsStaffAccounting(text: string | null | undefined): boolean {
  if (!text) return false;
  return STAFF_LEAK_PATTERNS.some((re) => re.test(text));
}

/** Strip / reject a reason that leaks staff bookkeeping. */
export function sanitizeMemberReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed || containsStaffAccounting(trimmed)) {
    return "Failure to complete the required activity.";
  }
  return trimmed.slice(0, 1800);
}

/**
 * The member-facing dispute command. Kept in one place so every surface
 * (embed, canvas, DM, warning card, the /warnings dispute button) points at the
 * same dispute flow and can never disagree.
 */
export const DISPUTE_COMMAND = "/dispute";

/**
 * Rotating friendly reminder lines. A reminder is *never* a warning, so these
 * stay light — a nudge or a bit of motivation, picked at random each send so
 * reminders don't read like a form letter.
 */
const REMINDER_NUDGES: string[] = [
  "Hey — don't forget to get your XP in before the period closes!",
  "Quick nudge: your XP still needs doing. You've got this!",
  "A little progress each day adds up — time to log some XP.",
  "Friendly reminder to knock out your XP while there's still time.",
  "Champions are made one grind at a time — go get that XP!",
  "Still time to hit your goal today. Let's get that XP in!",
  "Consistency beats intensity — a quick session keeps you on track.",
  "Your clan's counting on you — a bit of XP goes a long way.",
  "Don't let the streak slip — squeeze in your XP today.",
  "Small steps, big results. Log your XP and stay ahead!",
];

/** Pick a random friendly nudge line (deterministic input allowed for tests). */
export function reminderNudge(seed?: number): string {
  const i =
    seed === undefined
      ? Math.floor(Math.random() * REMINDER_NUDGES.length)
      : ((seed % REMINDER_NUDGES.length) + REMINDER_NUDGES.length) % REMINDER_NUDGES.length;
  return REMINDER_NUDGES[i] ?? REMINDER_NUDGES[0]!;
}

/**
 * Default member-facing reminder body (no accounting, never a warning). A
 * custom officer note wins; otherwise a random friendly nudge is used. Compute
 * this ONCE per send and pass the result to both the embed and the canvas so
 * the two surfaces can never drift.
 */
export function memberReminderBody(
  clan: Pick<Clan, "trackingPeriod" | "activityName">,
  customNote?: string | null
): string {
  const note = (customNote ?? "").trim();
  if (note && !containsStaffAccounting(note)) return note;
  return reminderNudge();
}

/** Short channel ping line for reminders. */
export function memberReminderPingLine(): string {
  return "🔔 this is your XP reminder.";
}

/**
 * Member-facing warning body — dispute-focused. Tells the member (1) they got a
 * warning, (2) exactly how to dispute it, and (3) that they need their proof
 * ready. When a warning number is known it's surfaced as the dispute ticket so
 * the member can reference it. Never leaks staff accounting.
 */
export function memberWarningBody(reason?: string | null, warningId?: number | null): string {
  const safe = sanitizeMemberReason(reason);
  const ticket = warningId ? `\n\n**Warning ticket:** #${warningId}` : "";
  return (
    `⚠️ You received an **XP Warning**.\n\n` +
    `**Reason:** ${safe}\n\n` +
    `If you believe this warning is incorrect, run \`${DISPUTE_COMMAND}\` to dispute it — ` +
    `have your XP proof/screenshot ready to submit with the dispute.` +
    ticket
  );
}

/** Plain-text variant for canvas cards (no markdown). */
export function memberWarningCanvasMessage(reason?: string | null): string {
  const safe = sanitizeMemberReason(reason);
  return (
    `You received an XP Warning. Reason: ${safe}. ` +
    `If this is incorrect, run ${DISPUTE_COMMAND} to dispute it — have your XP proof ready.`
  );
}

/** Compact DM companion text when a canvas card is attached. */
export function memberWarningDmContent(reason?: string | null, warningId?: number | null): string {
  const ticket = warningId ? ` (ticket #${warningId})` : "";
  return (
    `⚠️ You received an **XP Warning**${ticket}.\n` +
    `**Reason:** ${sanitizeMemberReason(reason)}\n` +
    `Dispute with \`${DISPUTE_COMMAND}\` — have your XP proof/screenshot ready.`
  );
}

/** Canvas / embed title fragments. */
export const MEMBER_WARNING_TITLE = "XP WARNING";
export const MEMBER_REMINDER_TITLE = "XP REMINDER";

/** Default reason stored for auto / bulk warnings (staff DB + logs keep detail separately). */
export function memberSafeWarningReason(clan: Pick<Clan, "activityName" | "trackingPeriod">): string {
  return `Failure to complete the required ${periodAdjective(clan)} ${clan.activityName} activity.`;
}

/* ------------------------------------------------------- staff-facing copy */

export interface StaffProgressDetail {
  period: TrackingPeriod;
  periodKey: string;
  progress: number;
  requirement: number;
  missing: number;
  satisfied: boolean;
  remindersThisPeriod: number;
  warningsThisPeriod: number;
}

/** Full accounting snapshot for logs / dashboards / officer previews. */
export function staffProgressDetail(
  clan: Clan,
  member: ClanMember
): StaffProgressDetail {
  const progress = getMemberProgress(clan, member);
  const requirement = getRequirement(clan, member);
  const pk = periodKey(clan);
  return {
    period: getTrackingPeriod(clan),
    periodKey: pk,
    progress,
    requirement,
    missing: Math.max(0, requirement - progress),
    satisfied: progress >= requirement,
    remindersThisPeriod: member.weekKey === pk ? member.weekReminders : 0,
    warningsThisPeriod: member.weekKey === pk ? member.weekWarnings : 0,
  };
}

/** Staff audit reason including progress / reminder counts. */
export function staffWarningReason(clan: Clan, member: ClanMember): string {
  const d = staffProgressDetail(clan, member);
  return (
    `Missed the ${periodAdjective(clan)} ${clan.activityName} goal ` +
    `(${d.progress.toLocaleString()} / ${d.requirement.toLocaleString()})` +
    (d.remindersThisPeriod > 0 ? ` after ${d.remindersThisPeriod} reminder(s)` : "") +
    `.`
  );
}

/** One-line staff progress for embeds / previews: "0/1 · missing 1". */
export function staffProgressLine(clan: Clan, member: ClanMember): string {
  const d = staffProgressDetail(clan, member);
  if (clan.trackingMode === "complete") {
    return d.satisfied ? "✅ Complete" : `🟡 Needs ${clan.activityName}`;
  }
  const unit = clan.trackingMode === "exact" ? ` ${clan.activityName}` : "";
  return `${d.progress.toLocaleString()}/${d.requirement.toLocaleString()}${unit}`;
}
