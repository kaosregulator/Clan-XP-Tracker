import {
  pgTable,
  text,
  serial,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clansTable = pgTable("clans", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  guildName: text("guild_name").notNull(),
  clanName: text("clan_name").notNull(),
  clanLogoUrl: text("clan_logo_url"),
  logChannelId: text("log_channel_id"),
  proofRequired: boolean("proof_required").notNull().default(false),
  allowedRoleIds: text("allowed_role_ids").array().notNull().default([]),
  allowedUserIds: text("allowed_user_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertClanSchema = createInsertSchema(clansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClan = z.infer<typeof insertClanSchema>;
export type Clan = typeof clansTable.$inferSelect;
