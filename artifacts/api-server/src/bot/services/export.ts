import {
  db,
  clansTable,
  clanMembersTable,
  warningsTable,
  remindersTable,
  xpWeekHistoryTable,
  type Clan,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import * as XLSX from "xlsx";
import { effectiveGoal, currentProgress, statusOf, STATUS_LABEL } from "./progress";

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
 * Export the guild's XP-management data as a multi-sheet .xlsx workbook,
 * ready to attach as a Discord file. The first sheet is an officer-friendly
 * weekly report; the rest are raw table dumps for backup purposes.
 */
export async function exportGuildDataAsXlsx(clan: Clan): Promise<Buffer> {
  const guildId = clan.guildId;
  const [members, history, warnings, reminders, settings] = await Promise.all([
    db
      .select()
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, guildId))
      .orderBy(clanMembersTable.displayName),
    db
      .select()
      .from(xpWeekHistoryTable)
      .where(eq(xpWeekHistoryTable.guildId, guildId))
      .orderBy(desc(xpWeekHistoryTable.weekKey)),
    db.select().from(warningsTable).where(eq(warningsTable.guildId, guildId)),
    db
      .select()
      .from(remindersTable)
      .where(eq(remindersTable.guildId, guildId))
      .orderBy(desc(remindersTable.createdAt)),
    db.select().from(clansTable).where(eq(clansTable.guildId, guildId)),
  ]);

  // Officer-friendly current-week report.
  const report = members.map((m) => ({
    Member: m.displayName,
    Username: m.username,
    "Roblox Username": m.gameUsername ?? "",
    Progress: currentProgress(clan, m),
    Goal: effectiveGoal(clan, m),
    Status: STATUS_LABEL[statusOf(clan, m)],
    "Reminders (week)": m.weekKey ? m.weekReminders : 0,
    "Warnings (week)": m.weekKey ? m.weekWarnings : 0,
    Exempt: m.exempt,
    "On Leave": m.onLeave,
    Notes: m.notes ?? "",
    "Last Updated By": m.lastUpdatedByUsername ?? "",
    "Last Updated": m.progressUpdatedAt?.toISOString() ?? "",
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report), "Weekly Report");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(history as Record<string, unknown>[])), "History");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(members as Record<string, unknown>[])), "Members");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(warnings as Record<string, unknown>[])), "Warnings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(reminders as Record<string, unknown>[])), "Reminders");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenRows(settings as Record<string, unknown>[])), "Settings");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
}
