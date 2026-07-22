import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/**
 * A submission is a member's proof-of-activity for a given account and day.
 * It moves pending -> approved | rejected through the admin review queue.
 */
export const xpSubmissionsTable = pgTable("xp_submissions", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),

  // Which tracked account this is for (null = the member's main account).
  accountId: integer("account_id"),
  accountLabel: text("account_label"),

  // The activity-day (YYYY-MM-DD, clan timezone) this submission counts toward.
  activityDate: text("activity_date").notNull(),

  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  proofImageUrls: text("proof_image_urls").array().notNull().default([]),

  // Optional data extracted from the screenshot (e.g. OCR). Null until an
  // extractor is registered; shape is provider-defined (see services/extraction).
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),

  // Review metadata
  reviewedBy: text("reviewed_by"),
  reviewedByUsername: text("reviewed_by_username"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  reviewMessageId: text("review_message_id"),

  // How many contributions this submission represents (1 for the member's own
  // daily, +1 per alt they completed). Drives the clan capacity/overflow math.
  contributions: integer("contributions").notNull().default(1),
  // True when the clan was already MAXED at submit time: the member still gets
  // credit (no XP warning) but it does not count toward the clan total.
  overflow: boolean("overflow").notNull().default(false),

  // Legacy numeric field (kept for web compat; defaults to 0 in the new model)
  xpEarned: integer("xp_earned").notNull().default(0),
  altAccountsCompleted: integer("alt_accounts_completed").notNull().default(0),

  editedBy: text("edited_by"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editReason: text("edit_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertXpSubmissionSchema = createInsertSchema(
  xpSubmissionsTable
).omit({
  id: true,
  submittedAt: true,
});
export type InsertXpSubmission = z.infer<typeof insertXpSubmissionSchema>;
export type XpSubmission = typeof xpSubmissionsTable.$inferSelect;
