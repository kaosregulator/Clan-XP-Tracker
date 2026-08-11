import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Staff notes about a member. Unlike the single free-text note on clan_members,
 * these are an append-only trail: each note keeps its author and timestamp and
 * is visible only to authorised staff. A note can optionally be delivered to
 * the member (as a DM + notification); once delivered its member-facing part is
 * marked done (the "self-clear" behaviour) while the staff record is retained.
 */
export const memberNotesTable = pgTable("member_notes", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),

  // The member the note is about.
  userId: text("user_id").notNull(),
  username: text("username").notNull(),

  authorId: text("author_id").notNull(),
  authorUsername: text("author_username").notNull(),

  body: text("body").notNull(),

  // When true the note is meant to reach the member; delivered flips once the
  // DM/notification has gone out so it isn't re-sent.
  notifyMember: boolean("notify_member").notNull().default(false),
  delivered: boolean("delivered").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMemberNoteSchema = createInsertSchema(memberNotesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMemberNote = z.infer<typeof insertMemberNoteSchema>;
export type MemberNote = typeof memberNotesTable.$inferSelect;
