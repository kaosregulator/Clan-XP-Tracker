import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A friendly nudge, never a warning. Records every reminder sent — whether
 * fired automatically by the scheduler or manually from a review card — so the
 * bot can avoid double-pinging and surface reminder counts on profiles.
 */
export const remindersTable = pgTable("reminders", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  activityDate: text("activity_date").notNull(),
  auto: boolean("auto").notNull().default(false),
  sentBy: text("sent_by"), // moderator id, or null when auto
  sentByUsername: text("sent_by_username"),
  channel: text("channel").notNull().default("dm"), // "dm" | "channel"
  delivered: boolean("delivered").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertReminderSchema = createInsertSchema(remindersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertReminder = z.infer<typeof insertReminderSchema>;
export type Reminder = typeof remindersTable.$inferSelect;
