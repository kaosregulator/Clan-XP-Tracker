import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Configurable activity categories per clan (Combat Support, XP, Chat, etc.).
 * Staff log points against these; warnings reference them as the missed
 * "required activity" without inventing a separate warning system.
 */
export const activityCategoriesTable = pgTable(
  "activity_categories",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    /** Stable key used in logs/warnings (e.g. "xp", "combat_support"). */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    emoji: text("emoji").notNull().default("📋"),
    /** Default points suggested when logging this category. */
    defaultPoints: integer("default_points").notNull().default(1),
    /** Counts toward weekly activity requirement. */
    countsAsActivity: boolean("counts_as_activity").notNull().default(true),
    /** Awards progression XP when logged. */
    awardsXp: boolean("awards_xp").notNull().default(false),
    /** Increments combat support participation count when logged. */
    countsAsCombatSupport: boolean("counts_as_combat_support").notNull().default(false),
    /** Shown on the player card activity breakdown. */
    showOnCard: boolean("show_on_card").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("activity_categories_guild_key_uidx").on(t.guildId, t.key)]
);

export const insertActivityCategorySchema = createInsertSchema(activityCategoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertActivityCategory = z.infer<typeof insertActivityCategorySchema>;
export type ActivityCategory = typeof activityCategoriesTable.$inferSelect;
