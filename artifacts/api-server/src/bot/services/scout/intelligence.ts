/**
 * Scout Intelligence Layer — assessments from live CCU + local snapshot history.
 * Never invents events/news; every signal is derived from Scout data already collected.
 */
import type {
  ScoutGameAssessment,
  ScoutGameRow,
  ScoutHistoryResult,
  ScoutIntelBand,
  ScoutIntelBoardRow,
  ScoutIntelDashboard,
  ScoutIntelSignal,
  ScoutSnapshotPoint,
} from "./types";
import { formatCount, formatDeltaPct } from "./errors";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function isFiniteNumber(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function avgInWindow(points: ScoutSnapshotPoint[], windowMs: number, nowMs: number): number | null {
  const inWin = points.filter((p) => {
    const t = Date.parse(p.takenAt);
    return Number.isFinite(t) && nowMs - t <= windowMs && nowMs - t >= 0;
  });
  if (!inWin.length) return null;
  return inWin.reduce((sum, p) => sum + p.playing, 0) / inWin.length;
}

function peakInWindow(points: ScoutSnapshotPoint[], windowMs: number, nowMs: number): number | null {
  const inWin = points.filter((p) => {
    const t = Date.parse(p.takenAt);
    return Number.isFinite(t) && nowMs - t <= windowMs && nowMs - t >= 0;
  });
  if (!inWin.length) return null;
  return Math.max(...inWin.map((p) => p.playing));
}

/** Growth from oldest → newest snapshot inside a window (fraction, not percent). */
function growthInWindow(
  points: ScoutSnapshotPoint[],
  windowMs: number,
  nowMs: number
): number | null {
  const inWin = points
    .filter((p) => {
      const t = Date.parse(p.takenAt);
      return Number.isFinite(t) && nowMs - t <= windowMs && nowMs - t >= 0;
    })
    .slice()
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  if (inWin.length < 2) return null;
  const oldest = inWin[0]!;
  const newest = inWin[inWin.length - 1]!;
  if (oldest.playing === 0) return newest.playing > 0 ? Infinity : 0;
  return (newest.playing - oldest.playing) / oldest.playing;
}

function hoursSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / HOUR;
}

function bandFromScore(score: number, snapshotCount: number): ScoutIntelBand {
  if (snapshotCount < 2) return "unknown";
  if (score >= 75) return "hot";
  if (score >= 58) return "rising";
  if (score >= 42) return "stable";
  if (score >= 28) return "watch";
  return "cooling";
}

function headlineFor(band: ScoutIntelBand, name: string): string {
  switch (band) {
    case "hot":
      return `${name} is showing unusual momentum`;
    case "rising":
      return `${name} is gaining players`;
    case "stable":
      return `${name} looks steady vs recent history`;
    case "watch":
      return `${name} is worth watching`;
    case "cooling":
      return `${name} is cooling off`;
    default:
      return `${name} — building snapshot history`;
  }
}

function summaryFor(
  band: ScoutIntelBand,
  signals: ScoutIntelSignal[],
  metrics: ScoutGameAssessment["metrics"]
): string {
  if (band === "unknown") {
    return "Not enough local snapshots yet. Auto-snapshots and manual snaps sharpen assessments over time.";
  }
  const lead =
    signals.find((s) => s.tone === "positive" || s.tone === "warning") ?? signals[0];
  if (lead) {
    const vs =
      metrics.vs7dAvgPct != null && Number.isFinite(metrics.vs7dAvgPct)
        ? ` Currently ${formatDeltaPct(metrics.vs7dAvgPct)} vs its 7-day average.`
        : "";
    return `${lead.detail}.${vs}`.replace(/\.\./g, ".");
  }
  return "Live players look consistent with recent Scout history — no strong anomaly right now.";
}

/**
 * Assess one game from live row + snapshot history.
 * Pure / deterministic — safe to unit test.
 */
export function assessScoutGame(
  live: ScoutGameRow,
  history: ScoutHistoryResult,
  nowMs = Date.now()
): ScoutGameAssessment {
  const points = history.points ?? [];
  const snapshotCount = points.length;
  const playing = live.playing;
  const deltaPct = history.latest?.playingDeltaPct ?? live.deltaPct ?? null;

  const avg6h = avgInWindow(points, 6 * HOUR, nowMs);
  const avg24h = avgInWindow(points, DAY, nowMs);
  const avg7d = avgInWindow(points, 7 * DAY, nowMs);
  const peak7d = peakInWindow(points, 7 * DAY, nowMs);
  const recentGrowthPct = growthInWindow(points, 6 * HOUR, nowMs) ?? deltaPct;
  const dayGrowthPct = growthInWindow(points, DAY, nowMs);
  const vs7dAvgPct =
    isFiniteNumber(avg7d) && avg7d > 0 ? (playing - avg7d) / avg7d : null;
  const hoursSinceUpdate = hoursSince(live.updatedAt, nowMs);

  const signals: ScoutIntelSignal[] = [];
  let score = 50;

  if (snapshotCount < 2) {
    signals.push({
      id: "need_history",
      label: "Limited history",
      detail: "Need more Scout snapshots before momentum can be scored",
      tone: "neutral",
    });
  }

  if (isFiniteNumber(recentGrowthPct) && recentGrowthPct >= 0.15) {
    signals.push({
      id: "accel_6h",
      label: "Momentum",
      detail: `Player growth accelerating over the last 6 hours (${formatDeltaPct(recentGrowthPct)})`,
      tone: "positive",
    });
    score += Math.min(22, 10 + recentGrowthPct * 20);
  } else if (isFiniteNumber(recentGrowthPct) && recentGrowthPct <= -0.15) {
    signals.push({
      id: "decel_6h",
      label: "Momentum",
      detail: `Players easing over the last 6 hours (${formatDeltaPct(recentGrowthPct)})`,
      tone: "negative",
    });
    score -= Math.min(22, 10 + Math.abs(recentGrowthPct) * 20);
  } else if (isFiniteNumber(recentGrowthPct)) {
    signals.push({
      id: "flat_6h",
      label: "Momentum",
      detail: "Near-term player count is relatively steady",
      tone: "neutral",
    });
  }

  if (isFiniteNumber(vs7dAvgPct) && vs7dAvgPct >= 0.35) {
    signals.push({
      id: "above_7d",
      label: "vs 7-day avg",
      detail: `Currently outperforming its 7-day average (${formatDeltaPct(vs7dAvgPct)})`,
      tone: "positive",
    });
    score += Math.min(18, 8 + vs7dAvgPct * 15);
  } else if (isFiniteNumber(vs7dAvgPct) && vs7dAvgPct <= -0.25) {
    signals.push({
      id: "below_7d",
      label: "vs 7-day avg",
      detail: `Below its 7-day average (${formatDeltaPct(vs7dAvgPct)})`,
      tone: "negative",
    });
    score -= Math.min(18, 8 + Math.abs(vs7dAvgPct) * 15);
  }

  if (isFiniteNumber(hoursSinceUpdate) && hoursSinceUpdate <= 24) {
    signals.push({
      id: "updated_recent",
      label: "Updated recently",
      detail:
        hoursSinceUpdate < 1
          ? "Roblox reports an update in the last hour"
          : `Roblox reports an update about ${Math.max(1, Math.round(hoursSinceUpdate))}h ago`,
      tone: "neutral",
    });
    if (isFiniteNumber(recentGrowthPct) && recentGrowthPct >= 0.1) {
      signals.push({
        id: "update_impact",
        label: "Possible update activity",
        detail: "Players rose after a recent Roblox update timestamp",
        tone: "warning",
      });
      score += 8;
    }
  }

  if (
    isFiniteNumber(vs7dAvgPct) &&
    vs7dAvgPct >= 1.0 &&
    isFiniteNumber(avg7d) &&
    avg7d >= 50
  ) {
    signals.push({
      id: "unusual",
      label: "Unusual activity",
      detail: `Live CCU is ${formatDeltaPct(vs7dAvgPct)} above the 7-day Scout average`,
      tone: "warning",
    });
    score += 10;
  }

  if (
    isFiniteNumber(dayGrowthPct) &&
    dayGrowthPct >= 0.4 &&
    playing < 8_000 &&
    playing >= 100
  ) {
    signals.push({
      id: "breakout",
      label: "Up-and-coming",
      detail: "Smaller baseline with strong day-over-day growth in Scout history",
      tone: "positive",
    });
    score += 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFromScore(score, snapshotCount);
  const metrics: ScoutGameAssessment["metrics"] = {
    snapshotCount,
    avg6h,
    avg24h,
    avg7d,
    peak7d,
    vs7dAvgPct,
    hoursSinceUpdate,
    recentGrowthPct: isFiniteNumber(recentGrowthPct) ? recentGrowthPct : null,
  };

  const trimmed = signals.slice(0, 5);

  return {
    universeId: live.universeId,
    name: live.name,
    band,
    headline: headlineFor(band, live.name),
    summary: summaryFor(band, trimmed, metrics),
    score,
    playing,
    deltaPct: isFiniteNumber(deltaPct) ? deltaPct : null,
    signals: trimmed,
    metrics,
  };
}

function boardRow(
  a: ScoutGameAssessment,
  valueLabel: string,
  detail: string
): ScoutIntelBoardRow {
  return {
    universeId: a.universeId,
    name: a.name,
    playing: a.playing,
    valueLabel,
    detail,
    deltaPct: a.metrics.recentGrowthPct ?? a.deltaPct,
  };
}

export function buildIntelBoards(
  assessments: ScoutGameAssessment[],
  limit = 5
): ScoutIntelDashboard["boards"] {
  const withHistory = assessments.filter((a) => a.metrics.snapshotCount >= 2);

  const risers = [...withHistory]
    .filter(
      (a) =>
        isFiniteNumber(a.metrics.recentGrowthPct) &&
        (a.metrics.recentGrowthPct as number) > 0.05
    )
    .sort(
      (a, b) => (b.metrics.recentGrowthPct ?? -1) - (a.metrics.recentGrowthPct ?? -1)
    )
    .slice(0, limit)
    .map((a) =>
      boardRow(
        a,
        formatDeltaPct(a.metrics.recentGrowthPct),
        `${formatCount(a.playing)} players · 6h momentum`
      )
    );

  const drops = [...withHistory]
    .filter(
      (a) =>
        isFiniteNumber(a.metrics.recentGrowthPct) &&
        (a.metrics.recentGrowthPct as number) < -0.05
    )
    .sort(
      (a, b) => (a.metrics.recentGrowthPct ?? 1) - (b.metrics.recentGrowthPct ?? 1)
    )
    .slice(0, limit)
    .map((a) =>
      boardRow(
        a,
        formatDeltaPct(a.metrics.recentGrowthPct),
        `${formatCount(a.playing)} players · 6h decline`
      )
    );

  const unusual = [...withHistory]
    .filter(
      (a) =>
        isFiniteNumber(a.metrics.vs7dAvgPct) &&
        Math.abs(a.metrics.vs7dAvgPct as number) >= 0.5
    )
    .sort(
      (a, b) => Math.abs(b.metrics.vs7dAvgPct ?? 0) - Math.abs(a.metrics.vs7dAvgPct ?? 0)
    )
    .slice(0, limit)
    .map((a) =>
      boardRow(
        a,
        formatDeltaPct(a.metrics.vs7dAvgPct),
        `Normally ~${formatCount(a.metrics.avg7d)} · now ${formatCount(a.playing)}`
      )
    );

  const upAndComing = [...withHistory]
    .filter(
      (a) =>
        a.playing >= 50 &&
        a.playing < 8_000 &&
        isFiniteNumber(a.metrics.recentGrowthPct) &&
        (a.metrics.recentGrowthPct as number) >= 0.25
    )
    .sort(
      (a, b) => (b.metrics.recentGrowthPct ?? 0) - (a.metrics.recentGrowthPct ?? 0)
    )
    .slice(0, limit)
    .map((a) =>
      boardRow(
        a,
        formatDeltaPct(a.metrics.recentGrowthPct),
        `Breakout pattern · ${formatCount(a.playing)} live`
      )
    );

  const updateImpact = [...withHistory]
    .filter(
      (a) =>
        isFiniteNumber(a.metrics.hoursSinceUpdate) &&
        (a.metrics.hoursSinceUpdate as number) <= 48 &&
        isFiniteNumber(a.metrics.recentGrowthPct) &&
        (a.metrics.recentGrowthPct as number) >= 0.08
    )
    .sort(
      (a, b) => (b.metrics.recentGrowthPct ?? 0) - (a.metrics.recentGrowthPct ?? 0)
    )
    .slice(0, limit)
    .map((a) =>
      boardRow(
        a,
        formatDeltaPct(a.metrics.recentGrowthPct),
        `Updated ~${Math.round(a.metrics.hoursSinceUpdate ?? 0)}h ago · players moved after`
      )
    );

  return { risers, drops, unusual, upAndComing, updateImpact };
}

export function pickWatchlist(
  assessments: ScoutGameAssessment[],
  limit = 4
): ScoutGameAssessment[] {
  return [...assessments]
    .filter((a) => a.band !== "unknown")
    .sort((a, b) => {
      const rank = (band: ScoutIntelBand) =>
        band === "hot"
          ? 0
          : band === "rising"
            ? 1
            : band === "watch"
              ? 2
              : band === "cooling"
                ? 3
                : 4;
      const d = rank(a.band) - rank(b.band);
      if (d !== 0) return d;
      return b.score - a.score;
    })
    .slice(0, limit);
}

export function emptyIntelDashboard(hint?: string): ScoutIntelDashboard {
  return {
    generatedAt: new Date().toISOString(),
    trackedGames: 0,
    snapshotWindowHours: 24,
    intervalHint: "Auto-snapshots every ~15 minutes on seed + tracked games",
    needHistory: true,
    hint:
      hint ??
      "Snap games or wait for auto-snapshots — Intelligence boards fill from Scout history.",
    boards: {
      risers: [],
      drops: [],
      unusual: [],
      upAndComing: [],
      updateImpact: [],
    },
    watchlist: [],
  };
}

export function assembleIntelDashboard(
  assessments: ScoutGameAssessment[],
  opts?: { intervalSec?: number }
): ScoutIntelDashboard {
  const withHistory = assessments.filter((a) => a.metrics.snapshotCount >= 2);
  const intervalSec = opts?.intervalSec ?? 900;
  const intervalMin = Math.max(1, Math.round(intervalSec / 60));
  const boards = buildIntelBoards(assessments);
  const boardCount =
    boards.risers.length +
    boards.drops.length +
    boards.unusual.length +
    boards.upAndComing.length +
    boards.updateImpact.length;

  return {
    generatedAt: new Date().toISOString(),
    trackedGames: assessments.length,
    snapshotWindowHours: 24,
    intervalHint: `Auto-snapshots every ~${intervalMin} minutes on seed + tracked games`,
    needHistory: withHistory.length < 2,
    hint:
      boardCount === 0
        ? "Boards fill as Scout collects snapshot history — seed games snap automatically in the background."
        : null,
    boards,
    watchlist: pickWatchlist(assessments),
  };
}
