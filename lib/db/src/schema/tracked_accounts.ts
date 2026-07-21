import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Powers the Patriot / Guardian system: members who manage several game
 * accounts. Every account a member is responsible for — including their main —
 * gets a row here, and each account tracks its daily submission independently.
 *
 * The main account is represented by a row with isMain = true, so the daily
 * grid can render "Main ✓ / Alt 1 ✓ / Alt 2 Missing" uniformly.
 */
export const trackedAccountsTable = pgTable(
  "tracked_accounts",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(), // "Main", "Alt 1", ...
    gameUsername: text("game_username"),
    isMain: boolean("is_main").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("tracked_accounts_guild_user_label_unique").on(
      table.guildId,
      table.userId,
      table.label
    ),
  ]
);

export const insertTrackedAccountSchema = createInsertSchema(
  trackedAccountsTable
).omit({ id: true, createdAt: true });
export type InsertTrackedAccount = z.infer<typeof insertTrackedAccountSchema>;
export type TrackedAccount = typeof trackedAccountsTable.$inferSelect;
