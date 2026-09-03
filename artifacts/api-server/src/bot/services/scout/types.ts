/** Views for the Game Intelligence (/scout) hub. */
export type ScoutView =
  | "home"
  | "search"
  | "trending"
  | "top"
  | "upcoming"
  | "game"
  | "compare"
  | "vsGenre"
  | "history"
  | "snapshot"
  | "creators"
  | "group"
  | "report"
  | "revenue"
  | "devex"
  | "tracked";

export interface ScoutGameRow {
  universeId: number;
  placeId: number;
  name: string;
  playing: number;
  visits: number;
  favorites: number;
  creator: string;
  creatorType: string;
  genre: string | null;
  iconUrl: string | null;
  deltaPct?: number | null;
  snapshotCount?: number | null;
}

export interface ScoutSnapshotPoint {
  takenAt: string;
  playing: number;
  visits: number;
  favoritedCount: number;
  playingDelta: number | null;
  playingDeltaPct: number | null;
}

export interface ScoutCompareResult {
  games: ScoutGameRow[];
  metrics: {
    playing: { min: number; max: number; median: number };
    visits: { min: number; max: number; median: number };
    favoritedCount: { min: number; max: number; median: number };
  };
}

export interface ScoutVsGenreResult {
  game: ScoutGameRow;
  genre: string;
  cohortSize: number;
  metrics: Array<{
    key: string;
    value: number;
    median: number;
    p75: number;
    max: number;
    percentile: number;
  }>;
}

export interface ScoutCreatorRow {
  creatorId: number;
  creatorType: "User" | "Group";
  creatorName: string;
  totalPlaying: number;
  gameCount: number;
  topGameName: string;
  topGameUniverseId: number;
  topGamePlaying: number;
}

export interface ScoutGroupInfo {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  ownerName: string | null;
  hasVerifiedBadge: boolean;
}

export interface ScoutDevexResult {
  robux: number;
  usd: number;
  rateUsdPerRobux: number;
  payoutMinimumNotMet: boolean;
  payoutMinimum: number;
}

export interface ScoutRevenueResult {
  playing: number;
  visits: number;
  estimatedDailyRobux: number;
  estimatedMonthlyRobux: number;
  estimatedMonthlyUsd: number;
  confidence: string;
  disclaimer: string;
  assumptions: string[];
}

export interface ScoutReportResult {
  genre: string;
  generatedAt: string;
  markdown: string;
  topGames: ScoutGameRow[];
  aggregates: {
    gameCount: number;
    totalCcu: number;
    medianCcu: number;
    totalVisits: number;
    totalFavorites: number;
    topCreatorName: string | null;
  };
  focus?: {
    gameName: string;
    playingPercentile: number;
    visitsPercentile: number;
    favoritedPercentile: number;
    playingVsMedian: number;
  };
}

export interface ScoutHistoryResult {
  universeId: number;
  name: string | null;
  points: ScoutSnapshotPoint[];
  latest: ScoutSnapshotPoint | null;
  previous: ScoutSnapshotPoint | null;
}
