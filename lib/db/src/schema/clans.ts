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

/**
 * A "clan" is one Discord guild's configuration row. It carries both the
 * identity of the community and every setting the setup wizard writes.
 *
 * The product is Roblox-first in its defaults (activity "XP", game "Roblox"),
 * but every game-facing label is a plain setting, so another community can
 * point it at any game/link without code changes.
 */
export const clansTable = pgTable("clans", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  guildName: text("guild_name").notNull(),

  // Identity
  clanName: text("clan_name").notNull(),
  clanLogoUrl: text("clan_logo_url"),
  // Optional in-game clan rank (e.g. "#3" or "Diamond"). Shown on the clan and
  // admin dashboards only when set ("rank if enabled").
  clanRank: text("clan_rank"),

  // Game / activity configuration (Roblox-first defaults, fully configurable)
  activityName: text("activity_name").notNull().default("XP"),
  gameName: text("game_name").notNull().default("Roblox"),
  gameUrl: text("game_url"),

  // Daily requirement. `dailyGoal` is the per-member display target (e.g.
  // 1500 XP). 0 means "no numeric target, just submit daily".
  dailyGoal: integer("daily_goal").notNull().default(0),

  // Clan-wide daily capacity (mirrors the in-game "Daily Clan Limit").
  // `clanDailyLimit` is the total XP the clan can bank per day (0 = no cap);
  // `contributionValue` is the XP one contribution is worth (a member's daily,
  // and each alt). Once the limit is reached the clan is MAXED and further
  // contributions become overflow (credited to the member, not the clan).
  clanDailyLimit: integer("clan_daily_limit").notNull().default(0),
  contributionValue: integer("contribution_value").notNull().default(1500),

  // Scheduling — all reminder/reset math is done in this timezone.
  timezone: text("timezone").notNull().default("UTC"),
  resetTime: text("reset_time").notNull().default("00:00"), // HH:mm
  reminderTimes: text("reminder_times").array().notNull().default([]), // ["18:00","22:00"]
  // Master safety switch for automatic reminders. When false, the scheduler
  // sends no auto reminders (staff can still use the manual Remind button).
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),

  // Channels
  submissionChannelId: text("submission_channel_id"),
  reviewChannelId: text("review_channel_id"),
  logChannelId: text("log_channel_id"),
  staffDashboardChannelId: text("staff_dashboard_channel_id"),
  clanDashboardChannelId: text("clan_dashboard_channel_id"),
  patriotDashboardChannelId: text("patriot_dashboard_channel_id"),
  leaderboardChannelId: text("leaderboard_channel_id"),

  // Roles
  staffRoleIds: text("staff_role_ids").array().notNull().default([]),
  warningRoleIds: text("warning_role_ids").array().notNull().default([]),
  reminderRoleId: text("reminder_role_id"),

  // Patriot / Guardian (alt account) system. null max = unlimited.
  altAccountsEnabled: boolean("alt_accounts_enabled").notNull().default(false),
  maxAltAccounts: integer("max_alt_accounts"),

  // Behaviour
  proofRequired: boolean("proof_required").notNull().default(true),
  // When true, submissions count immediately (no staff approval). When false,
  // they enter the review queue for approve/reject.
  autoApprove: boolean("auto_approve").notNull().default(true),
  dmOnApprove: boolean("dm_on_approve").notNull().default(false),
  dmOnWarn: boolean("dm_on_warn").notNull().default(true),
  setupComplete: boolean("setup_complete").notNull().default(false),

  // The role whose members are REQUIRED to submit (the tracker denominator).
  requiredRoleId: text("required_role_id"),
  // Channel holding the live admin progress tracker embed.
  trackerChannelId: text("tracker_channel_id"),

  // Legacy access controls (kept for the existing web dashboard)
  allowedRoleIds: text("allowed_role_ids").array().notNull().default([]),
  allowedUserIds: text("allowed_user_ids").array().notNull().default([]),

  /* ----------------------------------------------------------------------
   * Weekly XP management (officer-managed model).
   *
   * Members never submit XP. Officers verify progress in-game and update the
   * bot; everything below configures how that weekly cycle behaves.
   * -------------------------------------------------------------------- */

  // How progress is tracked:
  //   "exact"    — numeric progress toward weeklyGoal (4200 / 5000)
  //   "complete" — a simple done / not-done flag per week
  //   "custom"   — numeric progress toward a small custom goal (8 / 10)
  trackingMode: text("tracking_mode").notNull().default("exact"),

  // The weekly requirement everyone is measured against. Unit label comes
  // from activityName ("XP", "Activities", ...). Per-member overrides live on
  // clan_members.weeklyGoalOverride.
  weeklyGoal: integer("weekly_goal").notNull().default(5000),

  // Day the tracking week starts, 0 = Sunday … 6 = Saturday. The weekly reset
  // fires at resetTime on this day in the clan timezone.
  weekStartDay: integer("week_start_day").notNull().default(1),
  // Automatically archive + reset progress at the week boundary.
  autoWeeklyReset: boolean("auto_weekly_reset").notNull().default(true),
  // Keep per-member weekly snapshots in xp_week_history on reset.
  archiveWeeks: boolean("archive_weeks").notNull().default(true),

  // Reminder schedule: days of week (0-6) reminders fire, at the first
  // reminderTimes entry. remindersEnabled is the master switch.
  reminderDays: integer("reminder_days").array().notNull().default([3, 5]),

  // Escalation thresholds (XP enforcement, not moderation):
  // after warningThreshold reminders in a week a warning is suggested; after
  // escalationThreshold active warnings the member is flagged for leadership.
  warningThreshold: integer("warning_threshold").notNull().default(3),
  escalationThreshold: integer("escalation_threshold").notNull().default(2),

  // Channels for the weekly workflow.
  reminderChannelId: text("reminder_channel_id"),
  warningChannelId: text("warning_channel_id"),

  // Roles. staffRoleIds are the officer roles (kept name for compat);
  // adminRoleIds may additionally change configuration. Members holding an
  // exempt/leave role are skipped by reminders & warnings automatically.
  adminRoleIds: text("admin_role_ids").array().notNull().default([]),
  exemptRoleIds: text("exempt_role_ids").array().notNull().default([]),
  leaveRoleIds: text("leave_role_ids").array().notNull().default([]),

  // Delivery settings for reminders.
  dmReminders: boolean("dm_reminders").notNull().default(true),
  pingReminders: boolean("ping_reminders").notNull().default(false),

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
