/**
 * Ambient module stubs for bloxscout subpath imports.
 * The package ships compiled ESM under dist/ without an `exports` map.
 */
declare module "bloxscout/dist/core/roblox-client.js" {
  export class RobloxClient {
    constructor(options?: Record<string, unknown>);
    searchGames(keyword: string, opts?: { limit?: number }): Promise<ScoutGameSummary[]>;
    getGames(universeIds: number[]): Promise<ScoutGame[]>;
    getPlayerCounts(universeIds: number[]): Promise<Array<{ universeId: number; playing: number; visits: number }>>;
    getGameIcons(universeIds: number[], size?: string): Promise<Array<{ targetId: number; imageUrl: string | null }>>;
    getCreator(userId: number): Promise<ScoutUser>;
    getGroup(groupId: number): Promise<ScoutGroup>;
    getCreatorGames(userId: number, opts?: { limit?: 10 | 25 | 50 }): Promise<ScoutCreatorGame[]>;
  }
  export interface ScoutGameSummary {
    universeId: number;
    rootPlaceId: number;
    name: string;
    description: string;
    playerCount: number;
    totalUpVotes: number;
    totalDownVotes: number;
    creatorId: number;
    creatorName: string;
    creatorHasVerifiedBadge: boolean;
  }
  export interface ScoutGame {
    id: number;
    rootPlaceId: number;
    name: string;
    description: string | null;
    creator: { id: number; name: string; type: "User" | "Group"; hasVerifiedBadge: boolean };
    playing: number;
    visits: number;
    maxPlayers: number;
    created: string;
    updated: string;
    genre: string;
    genre_l1: string;
    genre_l2: string;
    favoritedCount: number;
  }
  export interface ScoutUser {
    id: number;
    name: string;
    displayName: string;
    description: string;
    created: string;
    isBanned: boolean;
    hasVerifiedBadge: boolean;
  }
  export interface ScoutGroup {
    id: number;
    name: string;
    description: string;
    owner: { userId: number; username: string; displayName: string } | null;
    memberCount: number;
    hasVerifiedBadge: boolean;
  }
  export interface ScoutCreatorGame {
    id: number;
    name: string;
    rootPlace: { id: number };
    placeVisits: number;
  }
}

declare module "bloxscout/dist/core/snapshots.js" {
  export class SnapshotStore {
    constructor(options?: { dbPath?: string });
    recordSnapshot(games: Array<Record<string, unknown>>): { recorded: number; takenAt: string };
    getGameHistory(universeId: number, opts?: { since?: Date; limit?: number }): ScoutSnapshot[];
    getLatestSnapshot(universeId: number): ScoutSnapshot | null;
    getTrackedUniverseIds(): number[];
    getMetadata(universeId: number): {
      universeId: number;
      name: string | null;
      genre: string | null;
      firstSeen: string;
      lastSeen: string;
    } | null;
    prune(before: Date): number;
    close(): void;
  }
  export function defaultDbPath(): string;
  export interface ScoutSnapshot {
    universeId: number;
    takenAt: string;
    playing: number;
    visits: number;
    favoritedCount: number;
    totalUpVotes: number;
    totalDownVotes: number;
  }
}

declare module "bloxscout/dist/core/calculators.js" {
  export const DEFAULT_DEVEX_RATE_USD_PER_ROBUX: number;
  export const DEVEX_PAYOUT_MINIMUM_ROBUX: number;
  export const REVENUE_ESTIMATE_DISCLAIMER: string;
  export function calculateDevex(
    robux: number,
    opts?: { rateUsdPerRobux?: number }
  ): {
    robux: number;
    usd: number;
    rateUsdPerRobux: number;
    payoutMinimumNotMet?: boolean;
  };
  export function estimateGameRevenue(
    game: { playing: number; visits: number },
    opts?: {
      conversionRate?: number;
      averageRobuxPerPayingUser?: number;
      daysActive?: number;
      rateUsdPerRobux?: number;
    }
  ): {
    inputs: Record<string, number>;
    estimatedDailyRobux: number;
    estimatedMonthlyRobux: number;
    estimatedMonthlyUsd: number;
    confidence: "low" | "medium" | "high";
    assumptions: string[];
    disclaimer: string;
  };
}

declare module "bloxscout/dist/core/rankings.js" {
  export interface TrendingEntry {
    universeId: number;
    name: string | null;
    currentPlaying: number;
    deltaPct: number;
    snapshotCount: number;
  }
  export function computeTrending(
    store: import("bloxscout/dist/core/snapshots.js").SnapshotStore,
    opts?: { since?: Date; limit?: number }
  ): TrendingEntry[];
  export function computeUpAndComing(
    store: import("bloxscout/dist/core/snapshots.js").SnapshotStore,
    opts?: { since?: Date; limit?: number; minBaselinePlayers?: number }
  ): TrendingEntry[];
  export function computeGrowthSeries(
    store: import("bloxscout/dist/core/snapshots.js").SnapshotStore,
    universeId: number,
    opts?: { window?: "1h" | "24h" | "7d" | "30d" }
  ): Array<{ bucketStart: string; avgPlaying: number; maxPlaying: number }>;
}

declare module "bloxscout/dist/core/top-creators.js" {
  export function getTopCreatorsByGenre(
    client: import("bloxscout/dist/core/roblox-client.js").RobloxClient,
    genre: string,
    opts?: { limit?: number }
  ): Promise<
    Array<{
      creatorId: number;
      creatorType: "User" | "Group";
      creatorName: string;
      totalPlayingAcrossSeedGames: number;
      gameCount: number;
      topGame: { universeId: number; name: string; playing: number };
    }>
  >;
}

declare module "bloxscout/dist/core/scheduler.js" {
  export class SnapshotScheduler {
    constructor(options: {
      client: import("bloxscout/dist/core/roblox-client.js").RobloxClient;
      store: import("bloxscout/dist/core/snapshots.js").SnapshotStore;
      logger?: (line: string) => void;
    });
    start(universeIds: number[], intervalSeconds: number, onTick?: (result: unknown) => void): void;
    stop(): void;
    readonly running: boolean;
  }
}

declare module "bloxscout/dist/mcp/tools/index.js" {
  export const searchGames: {
    handler: (input: { keyword: string; limit?: number }, ctx: ScoutToolCtx) => Promise<{ results: unknown[] }>;
  };
  export const getTrendingGames: {
    handler: (input: { genre?: string; limit?: number }, ctx: ScoutToolCtx) => Promise<{ games: unknown[] }>;
  };
  export const getTopByGenre: {
    handler: (input: { genre: string; limit?: number }, ctx: ScoutToolCtx) => Promise<{ games: unknown[] }>;
  };
  export const getUpAndComing: {
    handler: (
      input: { since?: string; limit?: number; minBaselinePlayers?: number },
      ctx: ScoutToolCtx
    ) => Promise<{ games: unknown[] }>;
  };
  export const compareGames: {
    handler: (
      input: { universeIds: number[] },
      ctx: ScoutToolCtx
    ) => Promise<{
      games: Array<Record<string, unknown>>;
      metrics: Record<string, { min: number; max: number; median: number }>;
      missingUniverseIds: number[];
    }>;
  };
  export const analyzeGameVsGenre: {
    handler: (
      input: { universeId: number; genre?: string; cohortLimit?: number },
      ctx: ScoutToolCtx
    ) => Promise<{
      game: Record<string, unknown>;
      genre: string;
      cohortSize: number;
      metrics: Record<
        string,
        { value: number; genreMedian: number; genreP75: number; genreMax: number; percentile: number }
      >;
    }>;
  };
  export const snapshotGame: {
    handler: (
      input: { universeIds: number[] },
      ctx: ScoutToolCtx
    ) => Promise<{ recorded: number; takenAt: string; universeIds: number[] }>;
  };
  export const getGameHistory: {
    handler: (
      input: { universeId: number; since?: string; limit?: number },
      ctx: ScoutToolCtx
    ) => Promise<{ universeId: number; snapshots: unknown[] }>;
  };
  export const generateMarketReport: {
    handler: (
      input: { genre: string; focusUniverseId?: number; limit?: number },
      ctx: ScoutToolCtx
    ) => Promise<{
      genre: string;
      generatedAt: string;
      markdown: string;
      structured: {
        topGames: Array<Record<string, unknown>>;
        aggregates: Record<string, unknown>;
        focusComparison?: Record<string, unknown>;
      };
    }>;
  };
  export const getCreator: {
    handler: (input: { userId: number }, ctx: ScoutToolCtx) => Promise<unknown>;
  };
  export const getGroup: {
    handler: (input: { groupId: number }, ctx: ScoutToolCtx) => Promise<unknown>;
  };
  interface ScoutToolCtx {
    client: import("bloxscout/dist/core/roblox-client.js").RobloxClient;
    store?: import("bloxscout/dist/core/snapshots.js").SnapshotStore;
  }
}
