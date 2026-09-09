import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Staff-logged activity events. One row per (member, category, log action).
 * The bot never auto-guesses Combat Support from chat — officers record it.
 */
export const activityLogsTable = pgTable(
  "activity_logs",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    categoryKey: text("category_key").notNull(),
    categoryName: text("category_name").notNull(),
    points: integer("points").notNull().default(1),
    note: text("note"),
    loggedBy: text("logged_by").notNull(),
    loggedByUsername: text("logged_by_username").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_logs_guild_user_idx").on(t.guildId, t.userId),
    index("activity_logs_guild_category_idx").on(t.guildId, t.categoryKey),
  ]
);

export const insertActivityLogSchema = createInsertSchema(activityLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogsTable.$inferSelect;
