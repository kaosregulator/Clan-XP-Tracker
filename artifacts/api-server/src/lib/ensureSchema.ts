/**
 * Apply additive schema fixes that Railway deploys do not run automatically.
 * Drizzle `push` is still the full tool for greenfield installs; this covers the
 * common case where production already has `clan_members` but is missing columns
 * introduced in later merges (#15+).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const STATEMENTS = [
  // Prefer bigint up front — Roblox user IDs often exceed int4 (2_147_483_647).
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS roblox_user_id bigint`,
  // Heal installs that already got the column as integer from an earlier ensureSchema.
  `ALTER TABLE clan_members ALTER COLUMN roblox_user_id TYPE bigint USING roblox_user_id::bigint`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS roblox_avatar_url text`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS lifetime_warnings integer NOT NULL DEFAULT 0`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS clean_points integer NOT NULL DEFAULT 0`,
  // Player Manager progression (safe additive — everyone starts at 0 / level 1).
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS progression_xp integer NOT NULL DEFAULT 0`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS player_level integer NOT NULL DEFAULT 1`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS clan_points integer NOT NULL DEFAULT 0`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS combat_support_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE clans ADD COLUMN IF NOT EXISTS combat_support_role_ids text[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE clans ADD COLUMN IF NOT EXISTS activity_xp_reward integer NOT NULL DEFAULT 50`,
  `ALTER TABLE clans ADD COLUMN IF NOT EXISTS combat_support_points integer NOT NULL DEFAULT 10`,
  `ALTER TABLE clans ADD COLUMN IF NOT EXISTS level_thresholds_json text`,
  // Activity Manager — category-tagged warnings + staff activity logs.
  `ALTER TABLE warnings ADD COLUMN IF NOT EXISTS category_key text`,
  `ALTER TABLE warnings ADD COLUMN IF NOT EXISTS category_label text`,
  `CREATE TABLE IF NOT EXISTS activity_categories (
      id serial PRIMARY KEY,
      guild_id text NOT NULL,
      key text NOT NULL,
      name text NOT NULL,
      description text,
      emoji text NOT NULL DEFAULT '📋',
      default_points integer NOT NULL DEFAULT 1,
      counts_as_activity boolean NOT NULL DEFAULT true,
      awards_xp boolean NOT NULL DEFAULT false,
      counts_as_combat_support boolean NOT NULL DEFAULT false,
      show_on_card boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 100,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_categories_guild_key_uidx
     ON activity_categories (guild_id, key)`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
      id serial PRIMARY KEY,
      guild_id text NOT NULL,
      user_id text NOT NULL,
      username text NOT NULL,
      category_key text NOT NULL,
      category_name text NOT NULL,
      points integer NOT NULL DEFAULT 1,
      note text,
      logged_by text NOT NULL,
      logged_by_username text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  `CREATE INDEX IF NOT EXISTS activity_logs_guild_user_idx
     ON activity_logs (guild_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS activity_logs_guild_category_idx
     ON activity_logs (guild_id, category_key)`,
  // Preserve history for members who already had active warnings before the column existed.
  `UPDATE clan_members
     SET lifetime_warnings = warnings_count
   WHERE lifetime_warnings = 0
     AND warnings_count > 0`,
] as const;

export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
    }
    logger.info("Database schema ensured (clan_members link/leaderboard columns)");
  } catch (err) {
    logger.error(
      { err },
      "Failed to ensure database schema — /link and leaderboard may fail until you run: pnpm --filter @workspace/db push"
    );
    throw err;
  } finally {
    client.release();
  }
}
