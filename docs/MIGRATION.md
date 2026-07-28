# XP Submission Bot → XP Management & Enforcement Platform

This document records the audit that preceded the refactor, what was reused,
what was removed, and what a server operator needs to do to migrate.

## 1. Audit of the previous system

The bot was a **member-driven submission tracker**. The daily loop was:

1. A member ran `/xp`, hit **Submit XP**, and posted a screenshot.
2. The submission entered a review queue (`xp_submissions`, status
   `pending → approved | rejected`).
3. Staff approved or rejected it from a review card.
4. Streaks, dashboards and a leaderboard were computed from approved
   submissions.

Everything was **daily** (`activity_date`, `reset_time`, daily streaks) and
assumed members were the ones entering data.

## 2. Reused — the load-bearing architecture

None of the following was rebuilt; it was extended in place.

| Area | Reused as-is / extended |
| --- | --- |
| Database | `clans`, `clan_members`, `warnings`, `reminders`, `audit_logs` all kept; new columns added rather than new tables where possible |
| Canvas engine | `canvas/theme.ts`, `fonts.ts`, `render-pool.ts`, `render-worker.ts` untouched — the new review card is just another card |
| Command framework | `commands.ts` + `router.ts` namespace dispatch pattern kept |
| Custom-ID registry | `ui/ids.ts` `ns:action:arg` encoding kept, entries replaced |
| Permissions | `isStaff` extended into `isOfficer` / `isAdmin` (`isStaff` kept as an alias) |
| Logging | `services/logging.ts` (`logAction` + `sendLog`) unchanged |
| Scheduler | `scheduler.ts` tick/`fireOnce` de-dupe structure kept, windows rewritten |
| Reminder pacing | `p-queue` at 3 sends/second retained |
| Export | `xlsx` multi-sheet export retained, sheets re-pointed |
| Clan cache | `services/config.ts` 30-second cache + `deferReply`-first discipline |
| Embed & UI styling | Same palette, same panel-with-back-button interaction shape |

## 3. Removed — the submission workflow

Deleted only after confirming no remaining importers (`grep` for each module
across `src/`, plus a clean `tsc --noEmit`):

**Features:** `submit.ts`, `hub.ts`, `accounts.ts`, `adminHub.ts`,
`tracker.ts`, `xpAdmin.ts`, `xpcard.ts`
**Services:** `submissions.ts`, `accounts.ts`, `extraction.ts` (screenshot
OCR hook), `vacations.ts`, `contributions.ts`, `dashboards.ts`,
`dashboardStats.ts`, `stats.ts`, `members.ts` (daily streak math)
**Canvas cards:** `memberHub.ts`, `adminHub.ts`, `clanDashboard.ts`,
`patriotDashboard.ts`, `trackerCard.ts`, `leaderboardCard.ts`, `reportCard.ts`

Also removed:

- The `MessageContent` and `GuildMessages` gateway intents and the
  `MessageCreate` listener — they existed solely to read screenshot
  attachments. **The bot no longer needs the privileged message-content
  intent.**
- The old static setup embeds, replaced by the configuration hub.
- The XP leaderboard, replaced by the Warning Dashboard.

The `xp_submissions`, `tracked_accounts` and `vacations` **tables** are
retained (not dropped) because the existing web dashboard routes still read
them. They are no longer written by the bot. Dropping them is a follow-up
that belongs with the web dashboard's own migration.

## 4. New architecture

### Progress engine — `services/progress.ts`

The single place weekly logic lives. Everything else (commands, review,
dashboard, scheduler, export) calls into it, so there is one implementation of
each rule:

- `effectiveGoal` / `currentProgress` / `statusOf` / `formatProgress`
- `applyProgress` — set / add / remove / complete / uncomplete / reset
- `reminderTargets` / `warningTargets` — reminder & warning eligibility
- `snapshotFrom` — weekly aggregate (completion rate, counts)
- `rollWeek` — archive to history + reset
- `bulkApply` / `syncRoleFlags` — bulk and role-driven operations

A deliberate design point: a member row whose `week_key` is stale reads as
**zero progress for the current week**. A missed scheduler run therefore can
never carry last week's numbers into this week.

### Schema changes

`clans` gains: `tracking_mode`, `weekly_goal`, `week_start_day`,
`auto_weekly_reset`, `archive_weeks`, `reminder_days`, `warning_threshold`,
`escalation_threshold`, `reminder_channel_id`, `warning_channel_id`,
`admin_role_ids`, `exempt_role_ids`, `leave_role_ids`, `dm_reminders`,
`ping_reminders`.

`clan_members` gains: `week_key`, `weekly_progress`, `weekly_goal_override`,
`weekly_completed_at`, `week_reminders`, `week_warnings`, `exempt`,
`on_leave`, `notes`, `last_updated_by`, `last_updated_by_username`,
`progress_updated_at`.

New table `xp_week_history` — one row per (guild, member, week), written at
each weekly reset, unique on `(guild_id, user_id, week_key)` so re-running a
reset is idempotent.

All new columns have defaults, so **existing rows migrate without a backfill**.

### Tracking modes

Configured per server, never hardcoded to any game:

| Mode | Display |
| --- | --- |
| `exact` | `4200 / 5000 XP` |
| `complete` | `✅ Complete` / `🟡 Needs XP` |
| `custom` | `8 / 10` |

### Commands

```
/setup                        configuration hub (admins)
/xp set|add|remove|complete|reset @user
/xp note|goal|exempt|leave|remind @user
/xp progress|history [@user]
/xp review                    weekly review panel
/xp dashboard                 warning dashboard
/xp role add|complete|reset|track|remind  @role
/warnings [@user]
/help
```

### Enforcement ladder

Reminders accumulate per week. After `warning_threshold` reminders without
reaching the goal, a member becomes warning-eligible and appears under the
review's **Issue Warnings** action. At `escalation_threshold` active
warnings the member is surfaced for leadership review. Both are configurable.
These are **XP enforcement warnings, not moderation warnings** — the wording
in every user-facing string says so.

## 5. Operator migration steps

1. **Apply the schema.** `pnpm --filter @workspace/db exec drizzle-kit push`
   (or generate a migration). All new columns are defaulted; no backfill and
   no data loss.
2. **Re-run `/setup`.** Set the weekly goal, tracking mode, week start day,
   reminder days, officer/admin roles and channels. Old daily settings
   (`daily_goal`, submission/review channels) are ignored by the bot now.
3. **Import your roster.** `/xp role track @Members` creates tracked rows for
   everyone in a role.
4. **Optional — trim the bot's Discord permissions.** The Message Content
   intent can be switched off in the Discord Developer Portal; the bot no
   longer reads messages. Server Members intent is still required.
5. **Delete the old submission channels** if you had them; nothing posts there.

## 6. Known follow-ups

- The web dashboard (`artifacts/clan-xp-tracker`) still renders the old
  submission/leaderboard pages against retained tables. It compiles and runs,
  but its pages describe the previous product and should be re-pointed at the
  weekly model in a separate change.
- `xp_submissions`, `tracked_accounts` and `vacations` can be dropped once the
  web dashboard no longer reads them.
