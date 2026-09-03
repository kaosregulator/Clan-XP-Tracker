import {
  calculateDevex,
  estimateGameRevenue,
  DEFAULT_DEVEX_RATE_USD_PER_ROBUX,
  DEVEX_PAYOUT_MINIMUM_ROBUX,
} from "bloxscout/dist/core/calculators.js";
import { computeTrending, computeUpAndComing } from "bloxscout/dist/core/rankings.js";
import { getTopCreatorsByGenre } from "bloxscout/dist/core/top-creators.js";
import {
  searchGames as searchGamesTool,
  getTrendingGames,
  getTopByGenre,
  compareGames as compareGamesTool,
  analyzeGameVsGenre,
  snapshotGame,
  generateMarketReport,
} from "bloxscout/dist/mcp/tools/index.js";
import {
  getScoutClient,
  getScoutContext,
  getScoutStore,
  resolveScoutDbPath,
  scoutAutoSnapshotStatus,
  startScoutAutoSnapshots,
} from "./client";
import { ScoutServiceError, formatCount, formatDeltaPct, formatUsd } from "./errors";
import type {
  ScoutCompareResult,
  ScoutCreatorRow,
  ScoutDevexResult,
  ScoutGameRow,
  ScoutGroupInfo,
  ScoutHistoryResult,
  ScoutReportResult,
  ScoutRevenueResult,
  ScoutSnapshotPoint,
  ScoutVsGenreResult,
} from "./types";
import { MILITARY_TYCOON_UNIVERSE_ID } from "../roblox/constants";
import { RobloxService } from "../roblox";

function asNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asStr(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v);
}

function mapGameLike(raw: Record<string, unknown>, iconUrl: string | null = null): ScoutGameRow {
  const universeId = asNum(raw.id ?? raw.universeId);
  const placeId = asNum(raw.rootPlaceId ?? raw.placeId);
  const creator =
    raw.creator && typeof raw.creator === "object"
      ? (raw.creator as { name?: string; type?: string })
      : null;
  return {
    universeId,
    placeId,
    name: asStr(raw.name, `Universe ${universeId}`),
    playing: asNum(raw.playing ?? raw.playerCount ?? raw.currentPlaying),
    visits: asNum(raw.visits),
    favorites: asNum(raw.favoritedCount ?? raw.favorites),
    creator: asStr(creator?.name ?? raw.creatorName, "Unknown"),
    creatorType: asStr(creator?.type ?? "User", "User"),
    genre: (raw.genre_l1 as string | undefined) || (raw.genre as string | null) || null,
    iconUrl,
    deltaPct:
      typeof raw.deltaPct === "number"
        ? raw.deltaPct
        : typeof raw.deltaPct === "string"
          ? Number(raw.deltaPct)
          : null,
    snapshotCount: raw.snapshotCount == null ? null : asNum(raw.snapshotCount),
  };
}

async function iconsFor(universeIds: number[]): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (!universeIds.length) return map;
  try {
    const icons = await getScoutClient().getGameIcons(universeIds.slice(0, 50), "150x150");
    for (const ic of icons) map.set(ic.targetId, ic.imageUrl);
  } catch {
    /* icons are decorative */
  }
  return map;
}

async function enrichRows(rows: ScoutGameRow[]): Promise<ScoutGameRow[]> {
  const icons = await iconsFor(rows.map((r) => r.universeId));
  return rows.map((r) => ({ ...r, iconUrl: icons.get(r.universeId) ?? r.iconUrl }));
}

/** Resolve a game query — universe id, place id, or keyword search. */
export async function resolveScoutGame(query: string): Promise<ScoutGameRow> {
  const q = query.trim();
  if (!q) throw new ScoutServiceError("invalid", "empty game query");

  if (/^\d+$/.test(q)) {
    const id = Number(q);
    try {
      const games = await getScoutClient().getGames([id]);
      if (games[0]) {
        const [row] = await enrichRows([mapGameLike(games[0] as unknown as Record<string, unknown>)]);
        return row!;
      }
    } catch {
      /* try as place via RobloxService fallback */
    }
    try {
      const viaPlace = await RobloxService.getGameByPlaceId(id);
      const games = await getScoutClient().getGames([viaPlace.universeId]);
      if (games[0]) {
        const [row] = await enrichRows([mapGameLike(games[0] as unknown as Record<string, unknown>)]);
        return row!;
      }
    } catch {
      /* fall through to search */
    }
  }

  const hits = await searchScoutGames(q, 5);
  const first = hits[0];
  if (!first) throw new ScoutServiceError("not_found", `no game for ${q}`);
  return getScoutGame(first.universeId);
}

export async function searchScoutGames(keyword: string, limit = 15): Promise<ScoutGameRow[]> {
  const ctx = getScoutContext();
  const out = await searchGamesTool.handler({ keyword: keyword.trim(), limit }, ctx);
  const rows = (out.results as Array<Record<string, unknown>>).map((r) =>
    mapGameLike({
      ...r,
      id: r.universeId,
      playing: r.playerCount,
      favoritedCount: 0,
      visits: 0,
      genre: null,
      creator: { name: r.creatorName, type: "User" },
    })
  );
  return enrichRows(rows);
}

export async function getScoutGame(universeId: number): Promise<ScoutGameRow> {
  const games = await getScoutClient().getGames([universeId]);
  const g = games[0];
  if (!g) throw new ScoutServiceError("not_found", `universe ${universeId}`);
  const [row] = await enrichRows([mapGameLike(g as unknown as Record<string, unknown>)]);
  return row!;
}

export async function getTrending(limit = 12, genre?: string): Promise<ScoutGameRow[]> {
  const ctx = getScoutContext();
  // Prefer snapshot-based growth when we have enough history.
  const growth = computeTrending(getScoutStore(), { limit });
  if (!genre && growth.length >= 3) {
    return enrichRows(
      growth.map((e) =>
        mapGameLike({
          id: e.universeId,
          name: e.name,
          playing: e.currentPlaying,
          deltaPct: e.deltaPct,
          snapshotCount: e.snapshotCount,
          rootPlaceId: 0,
          visits: 0,
          favoritedCount: 0,
          creator: { name: "—", type: "User" },
        })
      )
    );
  }
  const out = await getTrendingGames.handler({ limit, genre }, ctx);
  return enrichRows((out.games as Array<Record<string, unknown>>).map((g) => mapGameLike(g)));
}

export async function getTopGamesByGenre(genre: string, limit = 12): Promise<ScoutGameRow[]> {
  const ctx = getScoutContext();
  const out = await getTopByGenre.handler({ genre: genre.trim(), limit }, ctx);
  return enrichRows((out.games as Array<Record<string, unknown>>).map((g) => mapGameLike(g)));
}

export async function getUpAndComing(limit = 12): Promise<{
  rows: ScoutGameRow[];
  needHistory: boolean;
}> {
  const growth = computeUpAndComing(getScoutStore(), { limit });
  if (!growth.length) {
    return { rows: [], needHistory: true };
  }
  const rows = await enrichRows(
    growth.map((e) =>
      mapGameLike({
        id: e.universeId,
        name: e.name,
        playing: e.currentPlaying,
        deltaPct: e.deltaPct,
        snapshotCount: e.snapshotCount,
        rootPlaceId: 0,
        visits: 0,
        favoritedCount: 0,
        creator: { name: "—", type: "User" },
      })
    )
  );
  return { rows, needHistory: false };
}

export async function compareScoutGames(universeIds: number[]): Promise<ScoutCompareResult> {
  const ids = Array.from(new Set(universeIds.filter((n) => Number.isFinite(n) && n > 0))).slice(0, 10);
  if (ids.length < 2) throw new ScoutServiceError("invalid", "need at least 2 universe ids");
  const ctx = getScoutContext();
  const out = await compareGamesTool.handler({ universeIds: ids }, ctx);
  const rows = await enrichRows(out.games.map((g) => mapGameLike(g)));
  return {
    games: rows,
    metrics: out.metrics as ScoutCompareResult["metrics"],
  };
}

export async function analyzeVsGenre(
  universeId: number,
  genre?: string,
  cohortLimit = 20
): Promise<ScoutVsGenreResult> {
  const ctx = getScoutContext();
  const out = await analyzeGameVsGenre.handler({ universeId, genre, cohortLimit }, ctx);
  const [game] = await enrichRows([mapGameLike(out.game)]);
  return {
    game: game!,
    genre: out.genre,
    cohortSize: out.cohortSize,
    metrics: Object.entries(out.metrics).map(([key, m]) => ({
      key,
      value: m.value,
      median: m.genreMedian,
      p75: m.genreP75,
      max: m.genreMax,
      percentile: m.percentile,
    })),
  };
}

export async function takeSnapshots(universeIds: number[]): Promise<{
  recorded: number;
  takenAt: string;
  universeIds: number[];
  games: ScoutGameRow[];
}> {
  const ids = Array.from(new Set(universeIds.filter((n) => Number.isFinite(n) && n > 0))).slice(0, 25);
  if (!ids.length) throw new ScoutServiceError("invalid", "no universe ids");
  const ctx = getScoutContext();
  const out = await snapshotGame.handler({ universeIds: ids }, ctx);
  const games = await Promise.all(out.universeIds.map((id) => getScoutGame(id).catch(() => null)));
  return {
    recorded: out.recorded,
    takenAt: out.takenAt,
    universeIds: out.universeIds,
    games: games.filter((g): g is ScoutGameRow => Boolean(g)),
  };
}

export async function getHistory(universeId: number, limit = 24): Promise<ScoutHistoryResult> {
  const store = getScoutStore();
  const snaps = store.getGameHistory(universeId, { limit });
  const meta = store.getMetadata(universeId);
  const points: ScoutSnapshotPoint[] = snaps.map((s, i) => {
    const older = snaps[i + 1];
    let playingDelta: number | null = null;
    let playingDeltaPct: number | null = null;
    if (older) {
      playingDelta = s.playing - older.playing;
      playingDeltaPct =
        older.playing === 0 ? (s.playing > 0 ? Infinity : 0) : playingDelta / older.playing;
    }
    return {
      takenAt: s.takenAt,
      playing: s.playing,
      visits: s.visits,
      favoritedCount: s.favoritedCount,
      playingDelta,
      playingDeltaPct,
    };
  });
  return {
    universeId,
    name: meta?.name ?? null,
    points,
    latest: points[0] ?? null,
    previous: points[1] ?? null,
  };
}

export async function getCreators(genre: string, limit = 10): Promise<ScoutCreatorRow[]> {
  const rows = await getTopCreatorsByGenre(getScoutClient(), genre.trim(), { limit });
  return rows.map((c) => ({
    creatorId: c.creatorId,
    creatorType: c.creatorType,
    creatorName: c.creatorName,
    totalPlaying: c.totalPlayingAcrossSeedGames,
    gameCount: c.gameCount,
    topGameName: c.topGame.name,
    topGameUniverseId: c.topGame.universeId,
    topGamePlaying: c.topGame.playing,
  }));
}

export async function getScoutGroup(groupId: number): Promise<ScoutGroupInfo> {
  const g = await getScoutClient().getGroup(groupId);
  return {
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    memberCount: g.memberCount,
    ownerName: g.owner ? `${g.owner.displayName} (@${g.owner.username})` : null,
    hasVerifiedBadge: g.hasVerifiedBadge,
  };
}

export function calcDevex(robux: number): ScoutDevexResult {
  if (!Number.isFinite(robux) || robux < 0) {
    throw new ScoutServiceError("invalid", `bad robux ${robux}`);
  }
  const r = calculateDevex(Math.floor(robux));
  return {
    robux: r.robux,
    usd: r.usd,
    rateUsdPerRobux: r.rateUsdPerRobux ?? DEFAULT_DEVEX_RATE_USD_PER_ROBUX,
    payoutMinimumNotMet: Boolean(r.payoutMinimumNotMet),
    payoutMinimum: DEVEX_PAYOUT_MINIMUM_ROBUX,
  };
}

export async function estimateRevenue(
  target: { universeId?: number; playing?: number; visits?: number }
): Promise<ScoutRevenueResult & { gameName?: string }> {
  let playing = target.playing;
  let visits = target.visits ?? 0;
  let gameName: string | undefined;
  if (target.universeId) {
    const g = await getScoutGame(target.universeId);
    playing = g.playing;
    visits = g.visits;
    gameName = g.name;
  }
  if (playing == null || !Number.isFinite(playing)) {
    throw new ScoutServiceError("invalid", "need playing or universeId");
  }
  const est = estimateGameRevenue({ playing, visits });
  return {
    playing,
    visits,
    estimatedDailyRobux: est.estimatedDailyRobux,
    estimatedMonthlyRobux: est.estimatedMonthlyRobux,
    estimatedMonthlyUsd: est.estimatedMonthlyUsd,
    confidence: est.confidence,
    disclaimer: est.disclaimer,
    assumptions: est.assumptions,
    gameName,
  };
}

export async function buildReport(
  genre: string,
  focusUniverseId?: number,
  limit = 8
): Promise<ScoutReportResult> {
  const ctx = getScoutContext();
  const out = await generateMarketReport.handler(
    { genre: genre.trim(), focusUniverseId, limit },
    ctx
  );
  const topGames = await enrichRows(
    (out.structured.topGames as Array<Record<string, unknown>>).map((g) => mapGameLike(g))
  );
  const agg = out.structured.aggregates as Record<string, unknown>;
  const topCreator = agg.topCreator as { creatorName?: string } | null;
  const focus = out.structured.focusComparison as
    | {
        gameName: string;
        playingPercentile: number;
        visitsPercentile: number;
        favoritedPercentile: number;
        playingVsMedian: number;
      }
    | undefined;
  return {
    genre: out.genre,
    generatedAt: out.generatedAt,
    markdown: out.markdown,
    topGames,
    aggregates: {
      gameCount: asNum(agg.gameCount),
      totalCcu: asNum(agg.totalCcu),
      medianCcu: asNum(agg.medianCcu),
      totalVisits: asNum(agg.totalVisits),
      totalFavorites: asNum(agg.totalFavorites),
      topCreatorName: topCreator?.creatorName ?? null,
    },
    focus: focus
      ? {
          gameName: focus.gameName,
          playingPercentile: focus.playingPercentile,
          visitsPercentile: focus.visitsPercentile,
          favoritedPercentile: focus.favoritedPercentile,
          playingVsMedian: focus.playingVsMedian,
        }
      : undefined,
  };
}

export function listTracked(): Array<{
  universeId: number;
  name: string | null;
  genre: string | null;
  latestPlaying: number | null;
  lastSeen: string | null;
}> {
  const store = getScoutStore();
  return store.getTrackedUniverseIds().map((id) => {
    const meta = store.getMetadata(id);
    const latest = store.getLatestSnapshot(id);
    return {
      universeId: id,
      name: meta?.name ?? null,
      genre: meta?.genre ?? null,
      latestPlaying: latest?.playing ?? null,
      lastSeen: meta?.lastSeen ?? latest?.takenAt ?? null,
    };
  });
}

/** Ensure MT is snapshotted at least once when scout is used. */
export async function ensureMilitarySnapshot(): Promise<void> {
  try {
    await takeSnapshots([MILITARY_TYCOON_UNIVERSE_ID]);
  } catch {
    /* non-fatal */
  }
}

export const ScoutService = {
  search: searchScoutGames,
  resolveGame: resolveScoutGame,
  getGame: getScoutGame,
  trending: getTrending,
  topByGenre: getTopGamesByGenre,
  upAndComing: getUpAndComing,
  compare: compareScoutGames,
  vsGenre: analyzeVsGenre,
  snapshot: takeSnapshots,
  history: getHistory,
  creators: getCreators,
  group: getScoutGroup,
  devex: calcDevex,
  revenue: estimateRevenue,
  report: buildReport,
  tracked: listTracked,
  startAutoSnapshots: startScoutAutoSnapshots,
  autoStatus: scoutAutoSnapshotStatus,
  ensureMilitarySnapshot,
  dbPath: resolveScoutDbPath,
  formatCount,
  formatDeltaPct,
  formatUsd,
};

export type { ScoutGameRow, ScoutView } from "./types";
export { toScoutUserError, logScoutError, ScoutServiceError } from "./errors";
export { startScoutAutoSnapshots, scoutAutoSnapshotStatus } from "./client";
