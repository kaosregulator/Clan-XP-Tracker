import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Modular guild service-order queue (Military Tycoon leveling, trading, …).
 * One row per customer order. Queue position is dense among active orders.
 * Discord ticket channel + orders-board message ids are optional until created.
 */

export const SERVICE_ORDER_STATUSES = [
  "received",
  "queued",
  "claimed",
  "in_progress",
  "on_hold",
  "completed",
  "rejected",
  "cancelled",
] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

/** Statuses that still occupy a slot in the live FIFO queue. */
export const SERVICE_ORDER_QUEUE_STATUSES = [
  "received",
  "queued",
  "claimed",
  "in_progress",
  "on_hold",
] as const;

export const SERVICE_KEYS = [
  "vehicle_leveling",
  "vehicle_trading",
  "other",
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/** Discord CDN attachment captured from the order ticket channel. */
export interface ServiceOrderAttachment {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

export const serviceOrdersTable = pgTable(
  "service_orders",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),

    /** Public Amazon-style code, e.g. LV-1042 — unique per guild. */
    publicId: text("public_id").notNull(),

    /** Modular catalog key so more services can be added later. */
    serviceKey: text("service_key").notNull().default("vehicle_leveling"),
    serviceLabel: text("service_label").notNull(),

    details: text("details").notNull(),
    status: text("status").notNull().default("queued"),

    /** 1-based dense position among active queue statuses; null when terminal. */
    queuePosition: integer("queue_position"),

    customerId: text("customer_id").notNull(),
    customerUsername: text("customer_username").notNull(),
    customerDisplayName: text("customer_display_name").notNull(),

    staffId: text("staff_id"),
    staffUsername: text("staff_username"),

    /** Private ticket channel for customer ↔ staff. */
    channelId: text("channel_id"),
    /** Message in the configured Leveling Orders board channel. */
    boardMessageId: text("board_message_id"),
    boardChannelId: text("board_channel_id"),
    /** Pinned / intro message inside the ticket channel. */
    ticketMessageId: text("ticket_message_id"),

    attachmentsJson: text("attachments_json"),
    attachmentCount: integer("attachment_count").notNull().default(0),

    statusNote: text("status_note"),

    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("service_orders_guild_public_uidx").on(t.guildId, t.publicId)]
);

export const insertServiceOrderSchema = createInsertSchema(serviceOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServiceOrder = z.infer<typeof insertServiceOrderSchema>;
export type ServiceOrder = typeof serviceOrdersTable.$inferSelect;
