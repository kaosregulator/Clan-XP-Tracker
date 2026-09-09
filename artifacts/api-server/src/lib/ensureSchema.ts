/**
 * Apply additive schema fixes that Railway deploys do not run automatically.
 * Drizzle `push` is still the full tool for greenfield installs; this covers the
 * common case where production already has `clan_members` but is missing columns
 * introduced in later merges (#15+).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const STATEMENTS = [
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS roblox_user_id integer`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS roblox_avatar_url text`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS lifetime_warnings integer NOT NULL DEFAULT 0`,
  `ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS clean_points integer NOT NULL DEFAULT 0`,
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
