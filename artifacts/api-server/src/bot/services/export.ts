import {
  db,
  clansTable,
  clanMembersTable,
  xpSubmissionsTable,
  warningsTable,
  vacationsTable,
  trackedAccountsTable,
} from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";

/**
 * A portable JSON snapshot of a guild's tracker data — a backup the admin can
 * download and keep off-platform. The live data always lives in Postgres; this
 * is just an export you control.
 */
export async function exportGuildData(guildId: string): Promise<Record<string, unknown>> {
  const [clan, members, submissions, warnings, vacations, accounts] = await Promise.all([
    db.select().from(clansTable).where(eq(clansTable.guildId, guildId)),
    db.select().from(clanMembersTable).where(eq(clanMembersTable.guildId, guildId)),
    db
      .select()
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), isNull(xpSubmissionsTable.deletedAt))),
    db.select().from(warningsTable).where(eq(warningsTable.guildId, guildId)),
    db.select().from(vacationsTable).where(eq(vacationsTable.guildId, guildId)),
    db.select().from(trackedAccountsTable).where(eq(trackedAccountsTable.guildId, guildId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    guildId,
    version: 1,
    settings: clan[0] ?? null,
    counts: {
      members: members.length,
      submissions: submissions.length,
      warnings: warnings.length,
      vacations: vacations.length,
      trackedAccounts: accounts.length,
    },
    members,
    submissions,
    warnings,
    vacations,
    trackedAccounts: accounts,
  };
}
