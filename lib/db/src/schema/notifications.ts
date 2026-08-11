import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const NOTIFICATION_STATUSES = ["unread", "read", "cleared", "resolved"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "warning",
  "dispute",
  "escalation",
  "note",
  "ticket",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The staff notification center. Each row is one thing that happened and may
 * need attention — a warning issued, a dispute opened, an escalation reached.
 * Rows move unread → read → cleared, and are marked resolved automatically when
 * the thing they point at is resolved (so the feed never nags about stale
 * items). One member-facing note can also be delivered from here.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),

  type: text("type").notNull(), // NotificationType
  title: text("title").notNull(),
  body: text("body").notNull(),

  // The member this notification is about (if any) and the record it points at.
  targetUserId: text("target_user_id"),
  targetUsername: text("target_username"),
  relatedId: integer("related_id"), // warning / dispute / ticket id

  status: text("status").notNull().default("unread"), // NotificationStatus

  createdBy: text("created_by"),
  createdByUsername: text("created_by_username"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
