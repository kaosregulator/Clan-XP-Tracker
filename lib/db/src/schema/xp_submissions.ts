import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const xpSubmissionsTable = pgTable("xp_submissions", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),
  xpEarned: integer("xp_earned").notNull(),
  altAccountsCompleted: integer("alt_accounts_completed").notNull().default(0),
  notes: text("notes"),
  proofImageUrls: text("proof_image_urls").array().notNull().default([]),
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
