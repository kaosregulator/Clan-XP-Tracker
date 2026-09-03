/**
 * Multi-provider helper: try primary, fall back to secondary on transient failure.
 */
import { logger } from "../../../../lib/logger";
import { RobloxServiceError } from "../errors";

export async function withFallback<T>(
  label: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    const kind = err instanceof RobloxServiceError ? err.kind : "unknown";
    if (kind === "not_found" || kind === "invalid" || kind === "private") {
      throw err;
    }
    logger.warn({ err, label, kind }, "Primary Roblox provider failed — trying fallback");
    try {
      return await fallback();
    } catch (err2) {
      logger.warn({ err: err2, label }, "Fallback Roblox provider also failed");
      throw err instanceof RobloxServiceError
        ? err
        : err2 instanceof RobloxServiceError
          ? err2
          : new RobloxServiceError(
              "unavailable",
              err instanceof Error ? err.message : String(err)
            );
    }
  }
}
