import { db, vacationsTable, clanMembersTable } from "@workspace/db";
import type { Clan } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { activityDate } from "./time";
import { ensureMember, type MemberIdentity } from "./config";
import { logAction } from "./logging";

export interface RecordVacationResult {
  recorded: boolean; // false if already on vacation today
  activityDate: string;
}

/**
 * Record that a member can't do their activity today. This is a negative mark,
 * not an excuse: the day stays incomplete and the member's vacation count rises.
 */
export async function recordVacation(clan: Clan, identity: MemberIdentity): Promise<RecordVacationResult> {
  const today = activityDate(clan);
  await ensureMember(clan.guildId, identity);

  const inserted = await db
    .insert(vacationsTable)
    .values({ guildId: clan.guildId, userId: identity.userId, username: identity.username, activityDate: today })
    .onConflictDoNothing()
    .returning();

  if (!inserted.length) return { recorded: false, activityDate: today };

  await db
    .update(clanMembersTable)
    .set({ vacationCount: sql`${clanMembersTable.vacationCount} + 1`, lastVacationDate: today })
    .where(and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, identity.userId)));

  await logAction(clan.guildId, {
    action: "vacation_taken",
    targetUserId: identity.userId,
    targetUsername: identity.username,
    details: { activityDate: today },
  });

  return { recorded: true, activityDate: today };
}

/** Is the member on vacation for the current activity day? */
export async function onVacationToday(clan: Clan, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vacationsTable.id })
    .from(vacationsTable)
    .where(
      and(
        eq(vacationsTable.guildId, clan.guildId),
        eq(vacationsTable.userId, userId),
        eq(vacationsTable.activityDate, activityDate(clan))
      )
    )
    .limit(1);
  return !!row;
}
