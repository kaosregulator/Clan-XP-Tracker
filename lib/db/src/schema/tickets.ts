import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * A staff ticket: a tracked record for following an issue about a member to
 * resolution. Kept deliberately as a record (no auto-created Discord channels)
 * so it stays compatible with the existing architecture. A ticket can be linked
 * to the warning and/or dispute that spawned it.
 */
export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),

  // Subject member.
  userId: text("user_id").notNull(),
  username: text("username").notNull(),

  issue: text("issue").notNull(),
  relatedWarningId: integer("related_warning_id"),
  relatedDisputeId: integer("related_dispute_id"),

  assignedTo: text("assigned_to"),
  assignedToUsername: text("assigned_to_username"),

  status: text("status").notNull().default("open"), // TicketStatus
  resolution: text("resolution"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdByUsername: text("created_by_username"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
