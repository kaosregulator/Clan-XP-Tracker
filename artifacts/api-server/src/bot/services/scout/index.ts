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
import { SCOUT_PRESET_UNIVERSE_IDS, scoutIntelSnapshotIds } from "./seeds";
import {
  assessScoutGame,
  assembleIntelDashboard,
  emptyIntelDashboard,
} from "./intelligence";
import { ScoutServiceError, formatCount, formatDeltaPct, formatUsd } from "./errors";
import type {
  ScoutGameAssessment,
  ScoutIntelDashboard,
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
    updatedAt: asStr(raw.updated || raw.updatedAt || "", "") || null,
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

/** Race a promise against a timer; returns null on timeout or rejection. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((v) => v).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const out = await withTimeout(
    searchGamesTool.handler({ keyword: keyword.trim(), limit }, ctx),
    6_000
  );
  if (!out || !Array.isArray((out as { results?: unknown }).results)) {
    // Omni-search blocked — still try exact universe / place resolve via games API.
    if (/^\d+$/.test(keyword.trim())) {
      try {
        return [await getScoutGame(Number(keyword.trim()))];
      } catch {
        return [];
      }
    }
    return [];
  }
  const rows = ((out as { results: Array<Record<string, unknown>> }).results).map((r) =>
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

/** Guaranteed Top-N from known popular universe IDs (no charts API required). */
export { SCOUT_PRESET_UNIVERSE_IDS } from "./seeds";

/** Rank popular seed universes by live CCU — one Roblox games call, no omni-search. */
export async function getPresetTopGames(limit = 10): Promise<ScoutGameRow[]> {
  const seed = [...new Set(SCOUT_PRESET_UNIVERSE_IDS.filter((id) => Number.isFinite(id) && id > 0))].slice(
    0,
    40
  );
  const games = await getScoutClient().getGames(seed);
  const ranked = games
    .map((g) => mapGameLike(g as unknown as Record<string, unknown>))
    .filter((g) => g.universeId > 0)
    .sort((a, b) => b.playing - a.playing)
    .slice(0, Math.max(1, limit));
  return enrichRows(ranked);
}

/**
 * Live "hot right now" ranking:
 * 1) Fast path — popular seed universes sorted by live CCU (1 Roblox call).
 * 2) Optional omni-search sweep (bloxscout) when it finishes quickly.
 * Snapshot growth only when we already have enough history.
 */
export async function getTrending(limit = 12, genre?: string): Promise<ScoutGameRow[]> {
  if (genre?.trim()) {
    const byGenre = await getTopGamesByGenre(genre.trim(), limit);
    if (byGenre.length) return byGenre;
  }

  // Snapshot growth when history exists (true trending).
  const snapStore = getScoutStore();
  if (snapStore && !genre) {
    try {
      const growth = computeTrending(snapStore, { limit });
      if (growth.length >= 3) {
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
    } catch {
      /* fall through */
    }
  }

  // Fast live CCU ranking of popular games — usually <2s.
  let liveTop: ScoutGameRow[] = [];
  try {
    liveTop = await getPresetTopGames(limit);
  } catch {
    liveTop = [];
  }

  // Broader omni-search trending if it finishes before the timeout.
  try {
    const ctx = getScoutContext();
    const args = { limit: Math.max(limit, 15) };
    const out = await withTimeout(getTrendingGames.handler(args, ctx), 5_000);
    if (out && Array.isArray((out as { games?: unknown }).games)) {
      const omni = await enrichRows(
        ((out as { games: Array<Record<string, unknown>> }).games).map((g) => mapGameLike(g))
      );
      if (omni.length >= liveTop.length && omni.some((g) => g.playing > 0)) {
        return omni.slice(0, limit);
      }
      const byId = new Map<number, ScoutGameRow>();
      for (const g of [...liveTop, ...omni]) {
        const prev = byId.get(g.universeId);
        if (!prev || g.playing > prev.playing) byId.set(g.universeId, g);
      }
      const merged = [...byId.values()].sort((a, b) => b.playing - a.playing).slice(0, limit);
      if (merged.length) return merged;
    }
  } catch {
    /* keep liveTop */
  }

  if (liveTop.length) return liveTop;
  return [];
}

/**
 * Top-by-genre with a hard timeout on omni-search. If Roblox search is blocked
 * or slow (common on Railway), fall back to live CCU ranking of popular games
 * so the Top button never hangs the hub.
 */
export async function getTopGamesByGenre(genre: string, limit = 12): Promise<ScoutGameRow[]> {
  const g = genre.trim() || "tycoon";
  const ctx = getScoutContext();
  const out = await withTimeout(getTopByGenre.handler({ genre: g, limit }, ctx), 5_000);
  if (out && Array.isArray((out as { games?: unknown }).games)) {
    const rows = await enrichRows(
      ((out as { games: Array<Record<string, unknown>> }).games).map((game) => mapGameLike(game))
    );
    if (rows.length) return rows;
  }

  // Backup API path: games.roblox.com/v1/games on curated seeds (no omni-search).
  const live = await getPresetTopGames(Math.max(limit, 12)).catch(() => [] as ScoutGameRow[]);
  if (!live.length) return [];
  const needle = g.toLowerCase().replace(/[-_]/g, " ");
  const filtered = live.filter((row) => {
    const hay = `${row.name} ${row.genre ?? ""} ${row.creator}`.toLowerCase();
    if (hay.includes(needle)) return true;
    if (needle === "tycoon" || needle === "simulator") {
      return /tycoon|simulator|military|pet|bee|adopt|garden/i.test(hay);
    }
    if (needle === "horror") return /door|horror|scary|flee/i.test(hay);
    if (needle === "shooter" || needle === "fps") return /arsenal|shoot|gun|hood/i.test(hay);
    if (needle === "social" || needle === "roleplay") return /brookhaven|adopt|role/i.test(hay);
    return false;
  });
  return (filtered.length >= 3 ? filtered : live).slice(0, limit);
}

export async function getUpAndComing(limit = 12): Promise<{
  rows: ScoutGameRow[];
  needHistory: boolean;
}> {
  const snapStore = getScoutStore();
  if (!snapStore) return { rows: [], needHistory: true };
  const growth = computeUpAndComing(snapStore, { limit });
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
  const out = await withTimeout(
    analyzeGameVsGenre.handler({ universeId, genre, cohortLimit }, ctx),
    8_000
  );
  if (!out) {
    // Soft backup: show the focus game vs live popular peers without omni cohort.
    const game = await getScoutGame(universeId);
    const peers = (await getPresetTopGames(12)).filter((g) => g.universeId !== universeId);
    const peerPlaying = peers.map((p) => p.playing);
    const median =
      peerPlaying.length === 0
        ? game.playing
        : [...peerPlaying].sort((a, b) => a - b)[Math.floor(peerPlaying.length / 2)]!;
    return {
      game,
      genre: genre?.trim() || game.genre || "popular",
      cohortSize: peers.length,
      metrics: [
        {
          key: "playing",
          value: game.playing,
          median,
          p75: median,
          max: Math.max(game.playing, ...peerPlaying, 0),
          percentile: median === 0 ? 100 : Math.min(100, (game.playing / median) * 50),
        },
      ],
    };
  }
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
  if (!ctx.store) {
    // Still return live game cards so Snapshot doesn't wipe the hub.
    const games = await Promise.all(ids.map((id) => getScoutGame(id).catch(() => null)));
    return {
      recorded: 0,
      takenAt: new Date().toISOString(),
      universeIds: ids,
      games: games.filter((g): g is ScoutGameRow => Boolean(g)),
    };
  }
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
  if (!store) {
    return { universeId, name: null, points: [], latest: null, previous: null };
  }
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
  const rows = await withTimeout(
    getTopCreatorsByGenre(getScoutClient(), genre.trim(), { limit }),
    6_000
  );
  if (!rows?.length) return [];
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
  const out = await withTimeout(
    generateMarketReport.handler({ genre: genre.trim(), focusUniverseId, limit }, ctx),
    10_000
  );
  if (!out) {
    const topGames = await getTopGamesByGenre(genre, limit);
    const totalCcu = topGames.reduce((s, g) => s + g.playing, 0);
    const medianCcu =
      topGames.length === 0
        ? 0
        : [...topGames.map((g) => g.playing)].sort((a, b) => a - b)[
            Math.floor(topGames.length / 2)
          ]!;
    return {
      genre: genre.trim(),
      generatedAt: new Date().toISOString(),
      markdown: `## ${genre.trim()}\n\nLive CCU snapshot (search API briefly unavailable).\n\n${topGames
        .map((g, i) => `${i + 1}. **${g.name}** — ${g.playing} playing`)
        .join("\n")}`,
      topGames,
      aggregates: {
        gameCount: topGames.length,
        totalCcu,
        medianCcu,
        totalVisits: topGames.reduce((s, g) => s + g.visits, 0),
        totalFavorites: topGames.reduce((s, g) => s + g.favorites, 0),
        topCreatorName: topGames[0]?.creator ?? null,
      },
      focus: undefined,
    };
  }
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
  if (!store) return [];
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

/**
 * Recently updated experiences among tracked + popular seed universes.
 * Uses Roblox games API `updated` timestamps (not news/leak scrapers).
 */
export async function getRecentlyUpdated(limit = 12): Promise<ScoutGameRow[]> {
  const store = getScoutStore();
  const tracked = store?.getTrackedUniverseIds() ?? [];
  const seed = [
    MILITARY_TYCOON_UNIVERSE_ID,
    ...tracked,
    ...SCOUT_PRESET_UNIVERSE_IDS,
  ].filter((id) => Number.isFinite(id) && id > 0);
  const unique = [...new Set(seed)].slice(0, 40);
  if (!unique.length) return [];

  try {
    const games = await getScoutClient().getGames(unique);
    const ranked = games
      .map((g) => mapGameLike(g as unknown as Record<string, unknown>))
      .filter((g) => g.universeId > 0 && g.updatedAt)
      .sort((a, b) => {
        const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return tb - ta;
      })
      .slice(0, Math.max(1, limit));
    return enrichRows(ranked);
  } catch (err) {
    throw new ScoutServiceError(
      "unavailable",
      err instanceof Error ? err.message : String(err)
    );
  }
}


/** Assess one game from live CCU + local snapshot history. */
export async function assessGame(universeId: number): Promise<ScoutGameAssessment> {
  const live = await getScoutGame(universeId);
  const history = await getHistory(universeId, 48);
  return assessScoutGame(live, history);
}

/**
 * Intelligence dashboard — risers, drops, unusual activity, up-and-coming, update impact.
 * Derived only from Scout live data + local snapshots (never invented news).
 */
export async function getIntelDashboard(): Promise<ScoutIntelDashboard> {
  const status = scoutAutoSnapshotStatus();
  const ids = scoutIntelSnapshotIds(status.tracked);
  if (!ids.length) {
    return emptyIntelDashboard("No tracked or seed games yet — open Scout to start auto-snapshots.");
  }

  try {
    const games = await getScoutClient().getGames(ids);
    const rows = await enrichRows(
      games.map((g) => mapGameLike(g as unknown as Record<string, unknown>))
    );
    const assessments = await Promise.all(
      rows.map(async (row) => {
        const history = await getHistory(row.universeId, 48);
        return assessScoutGame(row, history);
      })
    );
    return assembleIntelDashboard(assessments, { intervalSec: status.intervalSec });
  } catch (err) {
    return emptyIntelDashboard(
      err instanceof Error ? err.message : "Could not build Intelligence boards right now."
    );
  }
}

export const ScoutService = {
  search: searchScoutGames,
  resolveGame: resolveScoutGame,
  getGame: getScoutGame,
  trending: getTrending,
  presetTop: getPresetTopGames,
  topByGenre: getTopGamesByGenre,
  upAndComing: getUpAndComing,
  recentlyUpdated: getRecentlyUpdated,
  intelDashboard: getIntelDashboard,
  assessGame,
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

export type {
  ScoutGameRow,
  ScoutView,
  ScoutGameAssessment,
  ScoutIntelDashboard,
} from "./types";
export { toScoutUserError, logScoutError, ScoutServiceError } from "./errors";
export { startScoutAutoSnapshots, scoutAutoSnapshotStatus } from "./client";
