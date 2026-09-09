/**
 * Clan Player Manager — progression, Clan Points, and player profile.
 *
 * Three SEPARATE systems (do not mix):
 *   1) Weekly Activity  → requirement/engagement (weekly_progress)
 *   2) Progression XP   → level curve (progression_xp / player_level)
 *   3) Warnings         → enforcement (unchanged)
 * Plus Clan Points / Combat Support as contribution standing.
 *
 * Nobody has entered historical progression XP — everyone starts at 0 / L1.
 */
import {
  db,
  clanMembersTable,
  type Clan,
  type ClanMember,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { ensureMember, type MemberIdentity } from "./config";
import {
  currentProgress,
  effectiveGoal,
  statusOf,
  formatProgress,
} from "./progress";
import { disputesForUser, OPEN_DISPUTE_STATUSES } from "./disputes";
import { weekKey } from "./time";

/** Default cumulative XP needed to *reach* each level (index 0 = level 1). */
export const DEFAULT_LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 900, 1400, 2000, 2800, 3800, 5000, 6500, 8500, 11000, 14000, 18000,
] as const;

export type ClanStanding =
  | "Good Standing"
  | "Needs Attention"
  | "Warned"
  | "Exempt"
  | "On Leave";

export type ClanRankTitle =
  | "Recruit"
  | "Member"
  | "Regular"
  | "Veteran"
  | "Elite"
  | "Legend";

export interface LevelProgress {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  xpToNext: number;
  pct: number;
  title: ClanRankTitle;
}

export interface PlayerProfile {
  member: ClanMember;
  level: LevelProgress;
  clanPoints: number;
  combatSupportCount: number;
  standing: ClanStanding;
  standingHint: string;
  weeklyActivityLabel: string;
  weeklyActivityPct: number;
  weeklyActivityDone: boolean;
  activeWarnings: number;
  warningCap: number;
  lifetimeWarnings: number;
  openDisputes: number;
  cleanPoints: number;
  memberSince: Date;
  lastActivityLabel: string;
  robloxLinked: boolean;
  hasCombatSupportRole: boolean;
}

function parseThresholds(clan: Clan): number[] {
  const raw = clan.levelThresholdsJson;
  if (!raw) return [...DEFAULT_LEVEL_THRESHOLDS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length >= 2 &&
      parsed.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
    ) {
      return parsed as number[];
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_LEVEL_THRESHOLDS];
}

export function rankTitleForLevel(level: number): ClanRankTitle {
  if (level >= 12) return "Legend";
  if (level >= 9) return "Elite";
  if (level >= 6) return "Veteran";
  if (level >= 4) return "Regular";
  if (level >= 2) return "Member";
  return "Recruit";
}

/** Pure level math from cumulative progression XP. */
export function levelFromXp(clan: Clan, xp: number): LevelProgress {
  const thresholds = parseThresholds(clan);
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) {
    if (safeXp >= (thresholds[i] ?? Infinity)) level = i + 1;
    else break;
  }
  const last = thresholds[thresholds.length - 1] ?? 0;
  if (safeXp > last) {
    level = thresholds.length + Math.floor((safeXp - last) / 5000);
  }

  const floorIdx = Math.min(level - 1, thresholds.length - 1);
  const floor = thresholds[Math.max(0, floorIdx)] ?? 0;
  const next =
    level < thresholds.length
      ? (thresholds[level] ?? floor + 5000)
      : last + Math.max(1, level - thresholds.length + 1) * 5000;
  const xpIntoLevel = Math.max(0, safeXp - floor);
  const span = Math.max(1, next - floor);
  const pct = Math.max(0, Math.min(100, Math.round((xpIntoLevel / span) * 100)));

  return {
    level,
    xp: safeXp,
    xpIntoLevel,
    xpForNext: span,
    xpToNext: Math.max(0, next - safeXp),
    pct,
    title: rankTitleForLevel(level),
  };
}

function standingOf(clan: Clan, member: ClanMember): { standing: ClanStanding; hint: string } {
  if (member.onLeave) return { standing: "On Leave", hint: "Skipped until leave ends" };
  if (member.exempt) return { standing: "Exempt", hint: "Not required this period" };
  const active = member.warningsCount ?? 0;
  if (active > 0) {
    return {
      standing: "Warned",
      hint:
        active >= (clan.escalationThreshold ?? 2)
          ? "Escalation threshold reached"
          : "Active warning on record",
    };
  }
  if (statusOf(clan, member) === "complete") {
    return { standing: "Good Standing", hint: "Weekly activity complete" };
  }
  if (statusOf(clan, member) !== "notStarted" || (member.weekReminders ?? 0) > 0) {
    return { standing: "Needs Attention", hint: "Weekly activity still open" };
  }
  return { standing: "Good Standing", hint: "Keep it up" };
}

export async function buildPlayerProfile(
  clan: Clan,
  member: ClanMember,
  opts?: { hasCombatSupportRole?: boolean }
): Promise<PlayerProfile> {
  const level = levelFromXp(clan, member.progressionXp ?? 0);
  const { standing, hint } = standingOf(clan, member);
  const goal = effectiveGoal(clan, member);
  const progress = currentProgress(clan, member);
  const weeklyPct =
    goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : progress > 0 ? 100 : 0;
  const openRows = await disputesForUser(clan.guildId, member.userId, 20);
  const open = openRows.filter((d) =>
    OPEN_DISPUTE_STATUSES.includes(d.status as (typeof OPEN_DISPUTE_STATUSES)[number])
  );
  const last =
    member.lastActivityDate ||
    (member.progressUpdatedAt
      ? member.progressUpdatedAt.toISOString().slice(0, 10)
      : "—");

  return {
    member,
    level,
    clanPoints: member.clanPoints ?? 0,
    combatSupportCount: member.combatSupportCount ?? 0,
    standing,
    standingHint: hint,
    weeklyActivityLabel: formatProgress(clan, member),
    weeklyActivityPct: weeklyPct,
    weeklyActivityDone: statusOf(clan, member) === "complete",
    activeWarnings: member.warningsCount ?? 0,
    warningCap: Math.max(1, clan.warningThreshold ?? 3),
    lifetimeWarnings: member.lifetimeWarnings ?? 0,
    openDisputes: open.length,
    cleanPoints: member.cleanPoints ?? 0,
    memberSince: member.joinedAt,
    lastActivityLabel: last,
    robloxLinked: Boolean(member.robloxUserId || member.robloxAvatarUrl || member.gameUsername),
    hasCombatSupportRole: Boolean(opts?.hasCombatSupportRole),
  };
}

/** Award progression XP and recompute level. Does not touch weekly activity. */
export async function awardProgressionXp(
  clan: Clan,
  identity: MemberIdentity,
  amount: number,
  _reason: string
): Promise<ClanMember> {
  const add = Math.max(0, Math.floor(amount));
  const row = await ensureMember(clan.guildId, identity);
  if (add <= 0) return row;
  const xp = (row.progressionXp ?? 0) + add;
  const level = levelFromXp(clan, xp).level;
  const [updated] = await db
    .update(clanMembersTable)
    .set({ progressionXp: xp, playerLevel: level })
    .where(
      and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, identity.userId))
    )
    .returning();
  return updated ?? row;
}

/** Award Clan Points (contribution). Independent of progression XP. */
export async function awardClanPoints(
  clan: Clan,
  identity: MemberIdentity,
  amount: number
): Promise<ClanMember> {
  const add = Math.floor(amount);
  const row = await ensureMember(clan.guildId, identity);
  if (add === 0) return row;
  const [updated] = await db
    .update(clanMembersTable)
    .set({ clanPoints: sql`${clanMembersTable.clanPoints} + ${add}` })
    .where(
      and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, identity.userId))
    )
    .returning();
  return updated ?? row;
}

/** Record one Combat Support participation (+count, +clan points). */
export async function recordCombatSupport(
  clan: Clan,
  identity: MemberIdentity
): Promise<ClanMember> {
  const points = clan.combatSupportPoints ?? 10;
  const row = await ensureMember(clan.guildId, identity);
  const [updated] = await db
    .update(clanMembersTable)
    .set({
      combatSupportCount: sql`${clanMembersTable.combatSupportCount} + 1`,
      clanPoints: sql`${clanMembersTable.clanPoints} + ${points}`,
    })
    .where(
      and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, identity.userId))
    )
    .returning();
  return updated ?? row;
}

/**
 * When weekly activity is newly completed, grant progression XP once.
 * Call only when applyProgress reports completedNow.
 */
export async function grantActivityCompletionXp(
  clan: Clan,
  identity: MemberIdentity
): Promise<ClanMember> {
  const reward = clan.activityXpReward ?? 50;
  return awardProgressionXp(clan, identity, reward, `weekly-activity:${weekKey(clan)}`);
}

/** True if the member currently holds any configured Combat Support role. */
export function memberHasCombatSupportRole(
  clan: Clan,
  roleIds: Iterable<string> | undefined
): boolean {
  const configured = clan.combatSupportRoleIds ?? [];
  if (!configured.length || !roleIds) return false;
  const set = new Set(roleIds);
  return configured.some((id) => set.has(id));
}
