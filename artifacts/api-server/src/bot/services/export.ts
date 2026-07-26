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
import * as XLSX from "xlsx";

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

/** Flatten any value to something XLSX can display in a cell. */
function flattenValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function flattenRows(rows: Record<string, unknown>[]): Record<string, string | number | boolean | null>[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, flattenValue(v)]))
  );
}

/**
 * Export all guild data as a multi-sheet .xlsx workbook. Returns a Buffer
 * ready to attach as a Discord file. Each table gets its own sheet so admins
 * can open it in Excel / Google Sheets without any parsing.
 */
export async function exportGuildDataAsXlsx(guildId: string): Promise<Buffer> {
  const [members, submissions, warnings, vacations, accounts, clan] = await Promise.all([
    db.select().from(clanMembersTable).where(eq(clanMembersTable.guildId, guildId)),
    db
      .select()
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), isNull(xpSubmissionsTable.deletedAt))),
    db.select().from(warningsTable).where(eq(warningsTable.guildId, guildId)),
    db.select().from(vacationsTable).where(eq(vacationsTable.guildId, guildId)),
    db.select().from(trackedAccountsTable).where(eq(trackedAccountsTable.guildId, guildId)),
    db.select().from(clansTable).where(eq(clansTable.guildId, guildId)),
  ]);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(members as Record<string, unknown>[])), "Members");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(submissions as Record<string, unknown>[])), "Submissions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(warnings as Record<string, unknown>[])), "Warnings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(vacations as Record<string, unknown>[])), "Vacations");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(accounts as Record<string, unknown>[])), "Accounts");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(clan as Record<string, unknown>[])), "Settings");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
}
