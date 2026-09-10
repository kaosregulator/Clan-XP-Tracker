import path from "node:path";
import fs from "node:fs";
import { RobloxClient } from "bloxscout/dist/core/roblox-client.js";
import { SnapshotStore, defaultDbPath } from "bloxscout/dist/core/snapshots.js";
import { SnapshotScheduler } from "bloxscout/dist/core/scheduler.js";
import { logger } from "../../../lib/logger";
import { MILITARY_TYCOON_UNIVERSE_ID } from "../roblox/constants";
import { scoutIntelSnapshotIds } from "./seeds";

let client: RobloxClient | null = null;
let store: SnapshotStore | null = null;
let storeFailed = false;
let scheduler: SnapshotScheduler | null = null;
let schedulerIds: number[] = [];

/** Resolve SQLite path — prefer BLOXSCOUT_DATA_DIR / BLOXSCOUT_DB_PATH, else /tmp or cwd. */
export function resolveScoutDbPath(): string {
  const explicit = process.env.BLOXSCOUT_DB_PATH?.trim();
  if (explicit) return explicit;
  const dir = process.env.BLOXSCOUT_DATA_DIR?.trim() || "/tmp/bloxscout";
  try {
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "data.db");
  } catch {
    /* fall through */
  }
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
      requestTimeoutMs: 12_000,
      maxRetries: 2,
    });
  }
  return client;
}

/**
 * Snapshot store is optional. Live trending/search/getGame work without it.
 * When SQLite/native bindings fail on a host, we degrade gracefully.
 */
export function getScoutStore(): SnapshotStore | null {
  if (storeFailed) return null;
  if (!store) {
    try {
      const dbPath = resolveScoutDbPath();
      logger.info({ dbPath }, "Opening Bloxscout snapshot store");
      store = new SnapshotStore({ dbPath });
    } catch (err) {
      storeFailed = true;
      logger.warn({ err }, "Scout snapshot store unavailable — live APIs only");
      return null;
    }
  }
  return store;
}

/** Context for bloxscout MCP tools. `store` may be undefined when SQLite is down. */
export function getScoutContext(): { client: RobloxClient; store?: SnapshotStore } {
  const s = getScoutStore();
  return s ? { client: getScoutClient(), store: s } : { client: getScoutClient() };
}

/**
 * Start background snapshots for Military Tycoon (and any extra universe IDs).
 * No-ops if the snapshot store cannot open.
 */
export function startScoutAutoSnapshots(extraUniverseIds: number[] = []): void {
  const intervalSec = Number(process.env.BLOXSCOUT_SNAPSHOT_INTERVAL_SEC ?? 900);
  if (!Number.isFinite(intervalSec) || intervalSec < 60) {
    logger.warn({ intervalSec }, "Scout auto-snapshot interval too low; skipping");
    return;
  }

  const snapStore = getScoutStore();
  if (!snapStore) {
    logger.warn("Scout auto-snapshots skipped — no snapshot store");
    return;
  }

  const tracked = snapStore.getTrackedUniverseIds();
  const ids = scoutIntelSnapshotIds([
    MILITARY_TYCOON_UNIVERSE_ID,
    ...tracked,
    ...extraUniverseIds,
  ]);

  // Restart if already running on a smaller set so Intelligence gets seed history.
  if (scheduler?.running) {
    const missing = ids.filter((id) => !schedulerIds.includes(id));
    if (!missing.length) return;
    try {
      scheduler.stop();
    } catch {
      /* ignore */
    }
    scheduler = null;
    schedulerIds = [];
  }

  try {
    scheduler = new SnapshotScheduler({
      client: getScoutClient(),
      store: snapStore,
      logger: (line) => logger.info({ source: "bloxscout-scheduler" }, line),
    });
    scheduler.start(ids, intervalSec, (tick) => {
      const recorded = (tick as { recorded?: number })?.recorded;
      logger.debug({ recorded, ids }, "Scout snapshot tick");
    });
    schedulerIds = ids;
    logger.info({ ids, intervalSec }, "Scout auto-snapshots started");
  } catch (err) {
    logger.warn({ err }, "Scout auto-snapshots failed to start");
  }
}

export function scoutAutoSnapshotStatus(): {
  running: boolean;
  dbPath: string;
  tracked: number[];
  intervalSec: number;
} {
  const snapStore = getScoutStore();
  const intervalSec = Number(process.env.BLOXSCOUT_SNAPSHOT_INTERVAL_SEC ?? 900);
  return {
    running: Boolean(scheduler?.running),
    dbPath: resolveScoutDbPath(),
    tracked: schedulerIds.length ? schedulerIds : (snapStore?.getTrackedUniverseIds() ?? []),
    intervalSec: Number.isFinite(intervalSec) ? intervalSec : 900,
  };
}
