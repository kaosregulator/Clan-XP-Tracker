import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** What the member is contesting. */
export const DISPUTE_TYPES = ["warning", "xp_record", "role_action"] as const;
export type DisputeType = (typeof DISPUTE_TYPES)[number];

/**
 * Lifecycle of a dispute ticket channel.
 * Legacy values (pending / accepted / denied / info_requested) are still
 * readable so older rows keep working; new writes use the ticket statuses.
 */
export const DISPUTE_STATUSES = [
  "open",
  "resolved",
  "rejected",
  "closed",
  // Legacy (pre-ticket-channel):
  "pending",
  "accepted",
  "denied",
  "info_requested",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** One Discord-hosted attachment captured from a native slash-command upload. */
export interface DisputeEvidence {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

/**
 * An XP dispute ticket. Members contest a warning, XP record, or role action;
 * the bot opens a private Discord channel for member ↔ staff conversation.
 * Ownership is enforced in the service. A dispute never automatically lifts
 * enforcement — resolving it is an explicit staff action.
 */
export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),

  // Optional linked warning (required when disputeType === "warning").
  warningId: integer("warning_id"),
  // warning | xp_record | role_action
  disputeType: text("dispute_type").notNull().default("warning"),

  userId: text("user_id").notNull(),
  username: text("username").notNull(),

  reason: text("reason").notNull(),
  // Legacy single URL field (no longer collected from members).
  proofUrl: text("proof_url"),
  // JSON array of DisputeEvidence — Discord CDN refs from native uploads.
  evidenceJson: text("evidence_json"),

  // Private ticket channel created for this dispute.
  channelId: text("channel_id"),

  status: text("status").notNull().default("open"), // DisputeStatus

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
