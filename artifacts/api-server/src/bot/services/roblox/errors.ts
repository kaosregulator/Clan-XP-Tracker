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
      return "❌ Roblox couldn't be reached right now. Try again in a moment.";
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

export function toUserError(err: unknown): string {
  if (err instanceof RobloxServiceError) return err.message;
  logRobloxError("toUserError", err);
  return userMessage("unavailable");
}
