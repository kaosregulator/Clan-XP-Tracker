import {
  pgTable,
  text,
  serial,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const DASHBOARD_TYPES = ["staff", "clan", "patriot", "tracker"] as const;
export type DashboardType = (typeof DASHBOARD_TYPES)[number];

/**
 * Tracks the live auto-updating dashboard messages so the scheduler can edit
 * them in place instead of spamming new messages. One message per (guild, type).
 */
export const dashboardsTable = pgTable(
  "dashboards",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    type: text("type").notNull(), // DashboardType
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("dashboards_guild_type_unique").on(table.guildId, table.type)]
);

export const insertDashboardSchema = createInsertSchema(dashboardsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertDashboard = z.infer<typeof insertDashboardSchema>;
export type Dashboard = typeof dashboardsTable.$inferSelect;
