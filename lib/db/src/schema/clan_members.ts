import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clanMembersTable = pgTable(
  "clan_members",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    xpDaily: integer("xp_daily").notNull().default(0),
    xpWeekly: integer("xp_weekly").notNull().default(0),
    xpMonthly: integer("xp_monthly").notNull().default(0),
    xpAllTime: integer("xp_all_time").notNull().default(0),
    altXpAllTime: integer("alt_xp_all_time").notNull().default(0),
    submissionsCount: integer("submissions_count").notNull().default(0),
    warningsCount: integer("warnings_count").notNull().default(0),
    lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("clan_members_guild_user_unique").on(table.guildId, table.userId)]
);

export const insertClanMemberSchema = createInsertSchema(clanMembersTable).omit(
  {
    id: true,
    joinedAt: true,
    updatedAt: true,
  }
);
export type InsertClanMember = z.infer<typeof insertClanMemberSchema>;
export type ClanMember = typeof clanMembersTable.$inferSelect;
