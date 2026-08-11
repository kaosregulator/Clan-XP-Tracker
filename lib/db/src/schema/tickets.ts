import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A lightweight staff ticket. Opened either directly or escalated from a
 * dispute ("Open Ticket") so a back-and-forth about a warning has a durable
 * home. Kept intentionally minimal — the conversation lives in Discord; this
 * row is the tracked record staff can list, reference and close.
 */
export const TICKET_STATUSES = ["open", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),

  // The member the ticket concerns (usually the opener).
  userId: text("user_id").notNull(),
  username: text("username").notNull(),

  subject: text("subject").notNull(),
  status: text("status").notNull().default("open"), // TicketStatus

  // Optional link back to the dispute this ticket was escalated from.
  disputeId: integer("dispute_id"),
  // Optional dedicated channel/thread created for the ticket.
  channelId: text("channel_id"),

  openedBy: text("opened_by"),
  openedByUsername: text("opened_by_username"),
  closedBy: text("closed_by"),
  closedByUsername: text("closed_by_username"),
  closeNote: text("close_note"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
