/**
 * Activity Manager — staff-logged category points + saved categories.
 *
 * Categories are clan-configurable (Combat Support, XP, Chat, …).
 * Officers log activity for one or many members; the bot never auto-guesses
 * Combat Support from chat. Warnings reference a category as the missed
 * "required [category] activity" — same warning system, selectable category.
 */
import {
  db,
  activityCategoriesTable,
  activityLogsTable,
  clanMembersTable,
  type ActivityCategory,
  type ActivityLog,
  type Clan,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ensureMember, type MemberIdentity } from "./config";
import { awardProgressionXp } from "./player";

export interface CategorySeed {
  key: string;
  name: string;
  emoji: string;
  description: string;
  defaultPoints: number;
  countsAsActivity: boolean;
  awardsXp: boolean;
  countsAsCombatSupport: boolean;
  showOnCard: boolean;
  sortOrder: number;
}

/** Built-in starter categories — clans can edit/add later. */
export const DEFAULT_ACTIVITY_CATEGORIES: CategorySeed[] = [
  {
    key: "xp",
    name: "XP Activity",
    emoji: "🟦",
    description: "Required period XP / progression activity",
    defaultPoints: 1,
    countsAsActivity: true,
    awardsXp: true,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 10,
  },
  {
    key: "combat_support",
    name: "Combat Support",
    emoji: "⚔️",
    description: "Helped in combat / support operations",
    defaultPoints: 10,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: true,
    showOnCard: true,
    sortOrder: 20,
  },
  {
    key: "communication",
    name: "Communication",
    emoji: "💬",
    description: "Chat / coordination / communication activity",
    defaultPoints: 1,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 30,
  },
  {
    key: "helping",
    name: "Helping Members",
    emoji: "🤝",
    description: "Helped another clan member",
    defaultPoints: 5,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 40,
  },
  {
    key: "events",
    name: "Events",
    emoji: "🎯",
    description: "Clan event participation",
    defaultPoints: 10,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 50,
  },
  {
    key: "contribution",
    name: "Clan Contribution",
    emoji: "🏆",
    description: "General clan contribution / recognition",
    defaultPoints: 10,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 60,
  },
  {
    key: "training",
    name: "Training",
    emoji: "🎖️",
    description: "Training / drills",
    defaultPoints: 5,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 70,
  },
  {
    key: "recruiting",
    name: "Recruiting",
    emoji: "📢",
    description: "Recruiting / onboarding help",
    defaultPoints: 5,
    countsAsActivity: true,
    awardsXp: false,
    countsAsCombatSupport: false,
    showOnCard: true,
    sortOrder: 80,
  },
];

/** Ensure default categories exist for a guild (idempotent — fills missing seeds). */
export async function ensureDefaultCategories(guildId: string): Promise<ActivityCategory[]> {
  for (const seed of DEFAULT_ACTIVITY_CATEGORIES) {
    await db
      .insert(activityCategoriesTable)
      .values({
        guildId,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        emoji: seed.emoji,
        defaultPoints: seed.defaultPoints,
        countsAsActivity: seed.countsAsActivity,
        awardsXp: seed.awardsXp,
        countsAsCombatSupport: seed.countsAsCombatSupport,
        showOnCard: seed.showOnCard,
        sortOrder: seed.sortOrder,
        active: true,
      })
      .onConflictDoNothing();
  }
  return listCategories(guildId);
}

export async function listCategories(
  guildId: string,
  opts?: { includeInactive?: boolean }
): Promise<ActivityCategory[]> {
  return db
    .select()
    .from(activityCategoriesTable)
    .where(
      opts?.includeInactive
        ? eq(activityCategoriesTable.guildId, guildId)
        : and(eq(activityCategoriesTable.guildId, guildId), eq(activityCategoriesTable.active, true))
    )
    .orderBy(asc(activityCategoriesTable.sortOrder), asc(activityCategoriesTable.name));
}

export async function getCategory(
  guildId: string,
  key: string
): Promise<ActivityCategory | null> {
  const [row] = await db
    .select()
    .from(activityCategoriesTable)
    .where(and(eq(activityCategoriesTable.guildId, guildId), eq(activityCategoriesTable.key, key)))
    .limit(1);
  return row ?? null;
}

export interface ActivityBreakdownRow {
  key: string;
  name: string;
  emoji: string;
  points: number;
  showOnCard: boolean;
}

/** Totals per category for one member (for the player card). */
export async function activityBreakdownForUser(
  guildId: string,
  userId: string
): Promise<ActivityBreakdownRow[]> {
  const cats = await ensureDefaultCategories(guildId);
  const totals = await db
    .select({
      categoryKey: activityLogsTable.categoryKey,
      points: sql<number>`coalesce(sum(${activityLogsTable.points}), 0)`.mapWith(Number),
    })
    .from(activityLogsTable)
    .where(and(eq(activityLogsTable.guildId, guildId), eq(activityLogsTable.userId, userId)))
    .groupBy(activityLogsTable.categoryKey);

  const byKey = new Map(totals.map((t) => [t.categoryKey, t.points]));
  return cats
    .filter((c) => c.showOnCard)
    .map((c) => ({
      key: c.key,
      name: c.name,
      emoji: c.emoji,
      points: byKey.get(c.key) ?? 0,
      showOnCard: c.showOnCard,
    }));
}

export interface LogActivityInput {
  clan: Clan;
  identity: MemberIdentity;
  category: ActivityCategory;
  points: number;
  note?: string | null;
  officer: { id: string; username: string };
}

/** Log activity for one member and update related standing counters. */
export async function logActivityForMember(input: LogActivityInput): Promise<ActivityLog> {
  const { clan, identity, category, officer } = input;
  const points = Math.max(0, Math.floor(input.points));
  await ensureMember(clan.guildId, identity);

  const [row] = await db
    .insert(activityLogsTable)
    .values({
      guildId: clan.guildId,
      userId: identity.userId,
      username: identity.username,
      categoryKey: category.key,
      categoryName: category.name,
      points,
      note: input.note?.trim() || null,
      loggedBy: officer.id,
      loggedByUsername: officer.username,
    })
    .returning();

  if (category.countsAsCombatSupport && points > 0) {
    await db
      .update(clanMembersTable)
      .set({
        combatSupportCount: sql`${clanMembersTable.combatSupportCount} + 1`,
        clanPoints: sql`${clanMembersTable.clanPoints} + ${points}`,
      })
      .where(
        and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, identity.userId))
      );
  } else if (points > 0 && category.key !== "xp") {
    await db
      .update(clanMembersTable)
      .set({ clanPoints: sql`${clanMembersTable.clanPoints} + ${points}` })
      .where(
        and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, identity.userId))
      );
  }

  if (category.awardsXp && points > 0) {
    await awardProgressionXp(clan, identity, points, `activity:${category.key}`);
  }

  return row!;
}

/** Recent activity rows for a member (detail / history). */
export async function recentActivityForUser(
  guildId: string,
  userId: string,
  limit = 20
): Promise<ActivityLog[]> {
  return db
    .select()
    .from(activityLogsTable)
    .where(and(eq(activityLogsTable.guildId, guildId), eq(activityLogsTable.userId, userId)))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit);
}

/** Label used in "Failure to complete the required X activity." */
export function categoryActivityLabel(category: Pick<ActivityCategory, "name"> | string): string {
  if (typeof category === "string") return category;
  return category.name.replace(/\s+Activity$/i, "").trim() || category.name;
}
