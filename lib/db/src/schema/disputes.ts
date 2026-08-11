import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const DISPUTE_STATUSES = [
  "pending",
  "accepted",
  "denied",
  "info_requested",
  "resolved",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * A member's dispute of one of their OWN XP warnings. Ownership is enforced in
 * the service: a member can only dispute a warning issued against them. Staff
 * review it (accept / deny / ask for info / open a ticket). A dispute never
 * automatically lifts enforcement — resolving it is an explicit staff action.
 */
export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),

  // The warning being disputed and the member who owns it.
  warningId: integer("warning_id").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),

  reason: text("reason").notNull(),
  proofUrl: text("proof_url"),

  status: text("status").notNull().default("pending"), // DisputeStatus

  // Staff handling.
  staffResponse: text("staff_response"),
  handledBy: text("handled_by"),
  handledByUsername: text("handled_by_username"),
  // Free-form final result recorded when the dispute is closed.
  result: text("result"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertDisputeSchema = createInsertSchema(disputesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputesTable.$inferSelect;
