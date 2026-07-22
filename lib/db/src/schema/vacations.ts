import {
  pgTable,
  text,
  serial,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A member declaring they can't do their activity for a given day. It is
 * tracked and counts against the member (a negative mark), it is not an excuse
 * that completes the day. One record per member per activity-day.
 */
export const vacationsTable = pgTable(
  "vacations",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    activityDate: text("activity_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("vacations_guild_user_date_unique").on(table.guildId, table.userId, table.activityDate)]
);

export const insertVacationSchema = createInsertSchema(vacationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVacation = z.infer<typeof insertVacationSchema>;
export type Vacation = typeof vacationsTable.$inferSelect;
