import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
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

  // Review metadata
  reviewedBy: text("reviewed_by"),
  reviewedByUsername: text("reviewed_by_username"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  reviewMessageId: text("review_message_id"),

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
