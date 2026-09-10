import { logger } from "../../../lib/logger";

/** User-facing Roblox error kinds — never expose raw API payloads. */
export type RobloxErrorKind =
  | "unavailable"
  | "not_found"
  | "private"
  | "rate_limited"
  | "auth_required"
  | "open_cloud_required"
  | "invalid";

export class RobloxServiceError extends Error {
  readonly kind: RobloxErrorKind;
  readonly technical: string;

  constructor(kind: RobloxErrorKind, technical: string) {
    super(userMessage(kind));
    this.name = "RobloxServiceError";
    this.kind = kind;
    this.technical = technical;
  }
}

export function userMessage(kind: RobloxErrorKind): string {
  switch (kind) {
    case "unavailable":
      return "❌ Roblox data is temporarily unavailable. Please try again.";
    case "not_found":
      return "⚠️ That Roblox user, group, or experience couldn't be found.";
    case "private":
      return "⚠️ Roblox does not publicly expose that information.";
    case "rate_limited":
      return "⏳ Roblox is rate-limiting requests. Please wait a few seconds and try again.";
    case "auth_required":
      return "🔐 This information requires authorized Roblox access (not available).";
    case "open_cloud_required":
      return "🔐 This information requires authorized Roblox Open Cloud access.";
    case "invalid":
      return "⚠️ That lookup didn't look valid. Try a username, place ID, or universe ID.";
  }
}

export function logRobloxError(context: string, err: unknown): void {
  if (err instanceof RobloxServiceError) {
    logger.warn({ kind: err.kind, technical: err.technical, context }, "Roblox service error");
    return;
  }
  logger.error({ err, context }, "Roblox unexpected error");
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return `${err.message} ${cause instanceof Error ? cause.message : String(cause ?? "")}`;
  }
  return String(err ?? "");
}

function looksLikeMissingSchema(err: unknown): boolean {
  const msg = errText(err);
  // Require an actual "column … does not exist" signal — don't match every
  // query that merely mentions roblox_user_id in SQL text.
  return /column ["']?(roblox_user_id|roblox_avatar_url|lifetime_warnings|clean_points)["']? does not exist/i.test(
    msg
  );
}

/** Postgres int4 overflow — Roblox IDs often exceed 2_147_483_647. */
function looksLikeRobloxIdOverflow(err: unknown): boolean {
  const msg = errText(err);
  return (
    /out of range for type integer|integer out of range|value "?\d+"? is out of range/i.test(msg) &&
    /roblox_user_id|clan_members/i.test(msg)
  );
}

function looksLikeRawSqlLeak(err: unknown): boolean {
  const msg = errText(err);
  return /Failed query:|params:|UPDATE ["']?clan_members/i.test(msg);
}

export function toUserError(err: unknown): string {
  if (err instanceof RobloxServiceError) return err.message;
  if (looksLikeMissingSchema(err) || looksLikeRobloxIdOverflow(err)) {
    logRobloxError("toUserError", err);
    return "⚠️ Database needs a quick link-column fix. Redeploy once (boot widens roblox_user_id to bigint), then try `/link` Confirm again.";
  }
  if (looksLikeRawSqlLeak(err)) {
    logRobloxError("toUserError", err);
    return "⚠️ Couldn't save that Roblox link right now. Try Confirm again in a moment — if it keeps failing, redeploy so the database columns update.";
  }
  if (err instanceof Error && err.message && !/fetch|network|timeout|ECONN|ENOTFOUND|Failed query/i.test(err.message)) {
    // Preserve intentional link/hub messages (roster missing, confirm validation, etc.)
    // Avoid matching SQL that happens to contain "clan_members".
    const intentional =
      !looksLikeRawSqlLeak(err) &&
      (/^(Couldn't|Pick|Only)/i.test(err.message.trim()) ||
        /roster|confirm this|pick both|before confirming/i.test(err.message));
    if (intentional) {
      return `⚠️ ${err.message}`;
    }
  }
  logRobloxError("toUserError", err);
  return userMessage("unavailable");
}
