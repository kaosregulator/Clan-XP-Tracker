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
 * A member's dispute of a warning. Members open one from their /xp view or the
 * warning callout ("Something Wrong?"); staff review it in the Warnings &
 * Enforcement hub. Only the member who was warned can open a dispute for their
 * own warning — the hub enforces that on write.
 */
export const DISPUTE_STATUSES = [
  "open",
  "accepted",
  "denied",
  "info_requested",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),

  // The warning being disputed, when the dispute is about a specific one.
  warningId: integer("warning_id"),

  // The member's explanation and any proof they attached (Discord CDN URL).
  reason: text("reason").notNull(),
  proofUrl: text("proof_url"),

  status: text("status").notNull().default("open"), // DisputeStatus

  // Staff resolution.
  reviewedBy: text("reviewed_by"),
  reviewedByUsername: text("reviewed_by_username"),
  resolutionNote: text("resolution_note"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
