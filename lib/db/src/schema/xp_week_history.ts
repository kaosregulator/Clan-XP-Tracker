import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per (guild, member, week): the archived outcome of a tracking week.
 * Written by the weekly reset (scheduler or manual "Reset Week") so the bot
 * can answer "how has this member performed historically?" long after the
 * live weekly fields on clan_members have been reset.
 */
export const xpWeekHistoryTable = pgTable(
  "xp_week_history",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),

    // The week this snapshot covers — the YYYY-MM-DD the week started on
    // (clan timezone / configured week start day).
    weekKey: text("week_key").notNull(),

    progress: integer("progress").notNull().default(0),
    goal: integer("goal").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    exempt: boolean("exempt").notNull().default(false),
    onLeave: boolean("on_leave").notNull().default(false),

    remindersSent: integer("reminders_sent").notNull().default(0),
    warningsIssued: integer("warnings_issued").notNull().default(0),

    // The officer who last updated the member during the week, if any.
    updatedBy: text("updated_by"),
    updatedByUsername: text("updated_by_username"),
    notes: text("notes"),

    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("xp_week_history_guild_user_week_unique").on(
      table.guildId,
      table.userId,
      table.weekKey
    ),
  ]
);

export const insertXpWeekHistorySchema = createInsertSchema(
  xpWeekHistoryTable
).omit({ id: true, archivedAt: true });
export type InsertXpWeekHistory = z.infer<typeof insertXpWeekHistorySchema>;
export type XpWeekHistory = typeof xpWeekHistoryTable.$inferSelect;
