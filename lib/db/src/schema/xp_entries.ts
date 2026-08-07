import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The daily XP ledger — one row per (guild, member, activity-day) holding that
 * day's total. Officers enter XP for a member (or role) and the amount lands
 * on a day here; the bot rolls these up into week/month/all-time totals and
 * paints the per-member calendar from them. Past days can be backfilled (bot
 * or Discord was down) by entering with an explicit date.
 */
export const xpEntriesTable = pgTable(
  "xp_entries",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),

    // The activity-day this total belongs to (YYYY-MM-DD, clan timezone).
    activityDate: text("activity_date").notNull(),

    // The running total earned on this day. Officers "add" to bump it or
    // "set" to overwrite it.
    amount: integer("amount").notNull().default(0),

    note: text("note"),

    // Who last touched this day's entry.
    enteredBy: text("entered_by"),
    enteredByUsername: text("entered_by_username"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("xp_entries_guild_user_date_unique").on(
      table.guildId,
      table.userId,
      table.activityDate
    ),
  ]
);

export const insertXpEntrySchema = createInsertSchema(xpEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertXpEntry = z.infer<typeof insertXpEntrySchema>;
export type XpEntry = typeof xpEntriesTable.$inferSelect;
