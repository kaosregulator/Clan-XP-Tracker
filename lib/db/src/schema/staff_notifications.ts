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
 * The staff notification queue — the actionable "here's what needs attention"
 * items surfaced in the XP Manager and DMed to owners/staff. Each item carries
 * a `category` so its [View Members] button can jump straight to the right
 * manager tab, and a Read / Clear lifecycle:
 *
 *   unread → staff hasn't seen it (counts toward the badge, gets re-nudged)
 *   read   → acknowledged (👁️ Read) — stops being re-nudged, still listed
 *   cleared→ dealt with / dismissed (✅ Clear) — drops out of the active list
 *
 * `dedupeKey` lets the scheduler upsert one live item per concern per period
 * (e.g. "xp_entry:2026-08-10") and bump its count instead of stacking dupes.
 */
export const NOTIFICATION_KINDS = [
  "xp_entry",
  "warning_review",
  "status",
  "dispute",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ["unread", "read", "cleared"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const staffNotificationsTable = pgTable(
  "staff_notifications",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),

    kind: text("kind").notNull(), // NotificationKind
    // The manager tab the [View Members] button should open (e.g. "missed").
    category: text("category"),

    title: text("title").notNull(),
    body: text("body").notNull(),
    count: integer("count").notNull().default(0),

    // One live item per concern per period; scheduler upserts on this.
    dedupeKey: text("dedupe_key").notNull(),

    status: text("status").notNull().default("unread"), // NotificationStatus

    readBy: text("read_by"),
    readByUsername: text("read_by_username"),
    readAt: timestamp("read_at", { withTimezone: true }),

    clearedBy: text("cleared_by"),
    clearedByUsername: text("cleared_by_username"),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("staff_notifications_guild_dedupe_unique").on(
      table.guildId,
      table.dedupeKey
    ),
  ]
);

export const insertStaffNotificationSchema = createInsertSchema(
  staffNotificationsTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffNotification = z.infer<
  typeof insertStaffNotificationSchema
>;
export type StaffNotification = typeof staffNotificationsTable.$inferSelect;
