import { logger } from "../../../lib/logger";

export class ScoutServiceError extends Error {
  readonly kind: "unavailable" | "not_found" | "invalid" | "need_history";
  readonly technical: string;

  constructor(kind: ScoutServiceError["kind"], technical: string, message?: string) {
    super(message ?? userMessage(kind));
    this.name = "ScoutServiceError";
    this.kind = kind;
    this.technical = technical;
  }
}

export function userMessage(kind: ScoutServiceError["kind"]): string {
  switch (kind) {
    case "unavailable":
      return "❌ Game intelligence is temporarily unavailable. Try again in a moment.";
    case "not_found":
      return "⚠️ That game, creator, or group couldn't be found.";
    case "invalid":
      return "⚠️ That lookup didn't look valid. Try a game name, universe ID, or genre.";
    case "need_history":
      return "📈 Not enough snapshots yet. Use `/scout snapshot` a few times (or wait for auto-snapshots) to build history.";
  }
}

export function logScoutError(context: string, err: unknown): void {
  if (err instanceof ScoutServiceError) {
    logger.warn({ kind: err.kind, technical: err.technical, context }, "Scout service error");
    return;
  }
  logger.error({ err, context }, "Scout unexpected error");
}

export function toScoutUserError(err: unknown): string {
  if (err instanceof ScoutServiceError) return err.message;
  // Bloxscout validation / not-found style messages
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message);
    if (/not found|no game|unknown/i.test(msg)) return userMessage("not_found");
    if (/validation|invalid|required/i.test(msg)) return userMessage("invalid");
  }
  logScoutError("toScoutUserError", err);
  return userMessage("unavailable");
}

export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

export function formatDeltaPct(deltaPct: number | null | undefined): string {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return "—";
  if (deltaPct === Infinity) return "↑ new";
  const pct = deltaPct * 100;
  const sign = pct > 0 ? "↑ +" : pct < 0 ? "↓ " : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
