import {
  pgTable,
  text,
  serial,
  integer,
  bigint,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per (guild, member). Holds the rolled-up activity stats that the
 * hubs and profile card render. Streaks/counts are the canonical stats in the
 * activity model; the legacy xp* columns are retained only so the existing web
 * dashboard keeps compiling and are no longer written by the bot.
 */
export const clanMembersTable = pgTable(
  "clan_members",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),

    // Main game account handle (e.g. Roblox username), optional.
    gameUsername: text("game_username"),
    // Linked Roblox identity for clan cards (assigned by officers via /link).
    // bigint: modern Roblox user IDs exceed Postgres integer (int4) max.
    robloxUserId: bigint("roblox_user_id", { mode: "number" }),
    robloxAvatarUrl: text("roblox_avatar_url"),
    // Lifetime warning tally (active + removed). Never decremented on remove —
    // officers need the full history when reviewing a member. warningsCount
    // remains the active-only mirror used by role thresholds.
    lifetimeWarnings: integer("lifetime_warnings").notNull().default(0),
    // Clean-standing points: earned for weeks without a warning. Used by the
    // leaderboard / "who can go without" bracket. Bumped by the scheduler and
    // reset (or reduced) when a warning is issued.
    cleanPoints: integer("clean_points").notNull().default(0),

    /* ------------------------------------------------------------------
     * Player Manager progression (separate from weekly activity + warnings).
     * progressionXp / playerLevel = lifetime progression. clanPoints =
     * contribution/standing. combatSupportCount = Combat Support participations.
     * Weekly activity still lives in weeklyProgress — it is NOT this XP.
     * ---------------------------------------------------------------- */
    progressionXp: integer("progression_xp").notNull().default(0),
    playerLevel: integer("player_level").notNull().default(1),
    clanPoints: integer("clan_points").notNull().default(0),
    combatSupportCount: integer("combat_support_count").notNull().default(0),

    // Activity stats (canonical)
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    approvedCount: integer("approved_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    pendingCount: integer("pending_count").notNull().default(0),
    remindersCount: integer("reminders_count").notNull().default(0),
    warningsCount: integer("warnings_count").notNull().default(0),
    submissionsCount: integer("submissions_count").notNull().default(0),
    // Self-reported "can't do XP today" days — a negative mark, not an excuse.
    vacationCount: integer("vacation_count").notNull().default(0),
    lastVacationDate: text("last_vacation_date"),

    // The last activity-day (YYYY-MM-DD, clan timezone) the member completed.
    lastActivityDate: text("last_activity_date"),
    lastApprovedAt: timestamp("last_approved_at", { withTimezone: true }),
    lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }),

    // Legacy numeric XP (unused by the activity model; kept for web compat)
    xpDaily: integer("xp_daily").notNull().default(0),
    xpWeekly: integer("xp_weekly").notNull().default(0),
    xpMonthly: integer("xp_monthly").notNull().default(0),
    xpAllTime: integer("xp_all_time").notNull().default(0),
    altXpAllTime: integer("alt_xp_all_time").notNull().default(0),

    /* --------------------------------------------------------------------
     * Weekly XP management (officer-managed model). weekKey identifies which
     * tracking week the live fields below belong to — the progress engine
     * lazily treats a stale weekKey as zero progress for the current week.
     * ------------------------------------------------------------------ */
    weekKey: text("week_key"),
    weeklyProgress: integer("weekly_progress").notNull().default(0),
    // Per-member goal override (null = use the clan's weeklyGoal).
    weeklyGoalOverride: integer("weekly_goal_override"),
    weeklyCompletedAt: timestamp("weekly_completed_at", { withTimezone: true }),
    // Reminders/warnings issued within the current week (reset weekly).
    weekReminders: integer("week_reminders").notNull().default(0),
    weekWarnings: integer("week_warnings").notNull().default(0),
    // Flags managed by officers. Exempt/leave members are skipped by
    // reminders, warnings and completion-rate math.
    exempt: boolean("exempt").notNull().default(false),
    onLeave: boolean("on_leave").notNull().default(false),
    notes: text("notes"),
    // Who last touched this member's progress.
    lastUpdatedBy: text("last_updated_by"),
    lastUpdatedByUsername: text("last_updated_by_username"),
    progressUpdatedAt: timestamp("progress_updated_at", { withTimezone: true }),

    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("clan_members_guild_user_unique").on(table.guildId, table.userId),
  ]
);

export const insertClanMemberSchema = createInsertSchema(clanMembersTable).omit({
  id: true,
  joinedAt: true,
  updatedAt: true,
});
export type InsertClanMember = z.infer<typeof insertClanMemberSchema>;
export type ClanMember = typeof clanMembersTable.$inferSelect;
