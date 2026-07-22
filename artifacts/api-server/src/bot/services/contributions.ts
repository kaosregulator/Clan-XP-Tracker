import { db, xpSubmissionsTable } from "@workspace/db";
import type { Clan } from "@workspace/db";
import { eq, and, isNull, ne, sql } from "drizzle-orm";
import { activityDate } from "./time";

export interface ClanCapacity {
  limitXp: number; // configured daily clan XP limit (0 = uncapped)
  value: number; // XP per contribution
  contributions: number; // total contributions banked today (all non-rejected)
  contributionCap: number; // contributions needed to max the clan (0 = uncapped)
  totalXp: number; // contributions * value
  filledXp: number; // min(totalXp, limitXp) when capped, else totalXp
  overflowXp: number; // XP earned after the clan maxed
  maxed: boolean;
  pct: number; // 0..100 of the limit
}

export function contributionValue(clan: Clan): number {
  return clan.contributionValue > 0 ? clan.contributionValue : clan.dailyGoal > 0 ? clan.dailyGoal : 1500;
}

/** Total contributions banked today (excludes rejected/deleted submissions). */
export async function contributionsToday(clan: Clan): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${xpSubmissionsTable.contributions}), 0)::int` })
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.activityDate, activityDate(clan)),
        ne(xpSubmissionsTable.status, "rejected"),
        isNull(xpSubmissionsTable.deletedAt)
      )
    );
  return row?.total ?? 0;
}

/** The clan's current daily capacity snapshot. */
export async function clanCapacity(clan: Clan): Promise<ClanCapacity> {
  const value = contributionValue(clan);
  const limitXp = clan.clanDailyLimit;
  const contributions = await contributionsToday(clan);
  const totalXp = contributions * value;
  const capped = limitXp > 0;
  const filledXp = capped ? Math.min(totalXp, limitXp) : totalXp;
  const overflowXp = capped ? Math.max(0, totalXp - limitXp) : 0;
  const maxed = capped && totalXp >= limitXp;
  const pct = capped ? Math.min(100, Math.round((totalXp / limitXp) * 100)) : 0;
  const contributionCap = capped ? Math.ceil(limitXp / value) : 0;
  return { limitXp, value, contributions, contributionCap, totalXp, filledXp, overflowXp, maxed, pct };
}

/**
 * Whether a new submission lands entirely in overflow — i.e. the clan was
 * already maxed before it. Used to flag the submission at creation time.
 */
export async function isOverflowNow(clan: Clan): Promise<boolean> {
  if (clan.clanDailyLimit <= 0) return false;
  const cap = await clanCapacity(clan);
  return cap.totalXp >= cap.limitXp;
}
