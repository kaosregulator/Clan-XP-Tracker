import path from "node:path";
import fs from "node:fs";
import { RobloxClient } from "bloxscout/dist/core/roblox-client.js";
import { SnapshotStore, defaultDbPath } from "bloxscout/dist/core/snapshots.js";
import { SnapshotScheduler } from "bloxscout/dist/core/scheduler.js";
import { logger } from "../../../lib/logger";
import { MILITARY_TYCOON_UNIVERSE_ID } from "../roblox/constants";

let client: RobloxClient | null = null;
let store: SnapshotStore | null = null;
let scheduler: SnapshotScheduler | null = null;

/** Resolve SQLite path — prefer BLOXSCOUT_DATA_DIR / BLOXSCOUT_DB_PATH, else workspace data dir. */
export function resolveScoutDbPath(): string {
  const explicit = process.env.BLOXSCOUT_DB_PATH?.trim();
  if (explicit) return explicit;
  const dir = process.env.BLOXSCOUT_DATA_DIR?.trim();
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "data.db");
  }
  // Prefer a project-local path over ~/.bloxscout so cloud agents share durable data.
  const localDir = path.resolve(process.cwd(), "data", "bloxscout");
  try {
    fs.mkdirSync(localDir, { recursive: true });
    return path.join(localDir, "data.db");
  } catch {
    return defaultDbPath();
  }
}

export function getScoutClient(): RobloxClient {
  if (!client) {
    client = new RobloxClient({
      userAgent: "ClanXP-ScoutHub/1.0 (+https://github.com/kaosregulator/Clan-XP-Tracker)",
      requestTimeoutMs: 15_000,
      maxRetries: 3,
    });
  }
  return client;
}

export function getScoutStore(): SnapshotStore {
  if (!store) {
    const dbPath = resolveScoutDbPath();
    logger.info({ dbPath }, "Opening Bloxscout snapshot store");
    store = new SnapshotStore({ dbPath });
  }
  return store;
}

export function getScoutContext() {
  return { client: getScoutClient(), store: getScoutStore() };
}

/**
 * Start background snapshots for Military Tycoon (and any extra universe IDs).
 * Interval defaults to 15 minutes — enough to build a useful timeline without
 * hammering Roblox.
 */
export function startScoutAutoSnapshots(extraUniverseIds: number[] = []): void {
  const intervalSec = Number(process.env.BLOXSCOUT_SNAPSHOT_INTERVAL_SEC ?? 900);
  if (!Number.isFinite(intervalSec) || intervalSec < 60) {
    logger.warn({ intervalSec }, "Scout auto-snapshot interval too low; skipping");
    return;
  }
  if (scheduler?.running) return;

  const ids = Array.from(
    new Set([MILITARY_TYCOON_UNIVERSE_ID, ...extraUniverseIds].filter((n) => Number.isFinite(n) && n > 0))
  );
  scheduler = new SnapshotScheduler({
    client: getScoutClient(),
    store: getScoutStore(),
    logger: (line) => logger.info({ source: "bloxscout-scheduler" }, line),
  });
  scheduler.start(ids, intervalSec, (tick) => {
    const recorded = (tick as { recorded?: number })?.recorded;
    logger.debug({ recorded, ids }, "Scout snapshot tick");
  });
  logger.info({ ids, intervalSec }, "Scout auto-snapshots started");
}

export function scoutAutoSnapshotStatus(): {
  running: boolean;
  dbPath: string;
  tracked: number[];
} {
  return {
    running: Boolean(scheduler?.running),
    dbPath: resolveScoutDbPath(),
    tracked: getScoutStore().getTrackedUniverseIds(),
  };
}
