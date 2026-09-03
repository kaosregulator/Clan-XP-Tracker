/**
 * Game Intelligence (/scout) canvas cards — same brand surface as Roblox Hub,
 * teal scout accent to distinguish from player-lookup hub.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  drawRoundedImage,
  statTile,
  footerNote,
  loadRemote,
  wrapText,
  toPng,
  RBX,
} from "../roblox/shared";

const SCOUT = {
  accent: "#0d9488",
  accentDeep: "#0f766e",
  up: "#2e9e57",
  down: "#e11d2b",
} as const;

function brand(ctx: import("@napi-rs/canvas").SKRSContext2D, pad = 40) {
  text(ctx, "GAME INTELLIGENCE", pad, 42, {
    size: 16,
    weight: "bold",
    color: SCOUT.accentDeep,
  });
}

export interface ScoutHomeCardView {
  mtName?: string;
  mtPlaying?: string;
  mtDelta?: string | null;
  trackedCount?: number;
  dbHint?: string;
}

export async function renderScoutHomeCard(view: ScoutHomeCardView = {}): Promise<Buffer> {
  const W = 960;
  const H = 560;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);

  text(ctx, "Scout Hub", 40, 90, { size: 40, weight: "bold", color: RBX.ink });
  text(
    ctx,
    "Search, trend, compare, and snapshot Roblox games — powered by Bloxscout.",
    40,
    140,
    { size: 18, color: RBX.soft, maxWidth: W - 80 }
  );

  card(ctx, 40, 190, W - 80, 120, { radius: 18, shadow: false });
  text(ctx, "MILITARY TYCOON TIMELINE", 64, 230, {
    size: 13,
    weight: "bold",
    color: SCOUT.accentDeep,
  });
  text(ctx, view.mtName ?? "Military Tycoon", 64, 268, {
    size: 24,
    weight: "bold",
    color: RBX.ink,
  });
  text(
    ctx,
    `Players ${view.mtPlaying ?? "—"}   ${view.mtDelta ? view.mtDelta : "Snapshot to start history"}`,
    64,
    300,
    { size: 16, color: RBX.soft }
  );

  const features = [
    "Trending & top-by-genre discovery",
    "Compare games · Genre benchmarks",
    "SQLite snapshots & growth history",
    "DevEx calculator · Revenue estimate",
  ];
  let y = 340;
  for (const line of features) {
    ctx.beginPath();
    ctx.arc(56, y - 5, 4, 0, Math.PI * 2);
    ctx.fillStyle = SCOUT.accent;
    ctx.fill();
    text(ctx, line, 72, y, { size: 17, color: RBX.ink });
    y += 32;
  }

  footerNote(
    ctx,
    W,
    H,
    `Tracked ${view.trackedCount ?? 0} · ${view.dbHint ?? "local SQLite"} · Public APIs only`
  );
  return toPng(rc.canvas);
}

export interface ScoutListRow {
  rank: string;
  title: string;
  subtitle: string;
  value: string;
  delta?: string | null;
}

export interface ScoutListCardView {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  rows: ScoutListRow[];
}

export async function renderScoutListCard(view: ScoutListCardView): Promise<Buffer> {
  const W = 960;
  const rowH = 72;
  const H = 130 + Math.max(view.rows.length, 1) * (rowH + 10) + 60;
  const rc = createSurface(W, Math.max(H, 400));
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, view.eyebrow, 40, 70, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.title, 40, 108, { size: 30, weight: "bold", color: RBX.ink, maxWidth: W - 80 });
  if (view.subtitle) {
    text(ctx, view.subtitle, 40, 140, { size: 16, color: RBX.soft, maxWidth: W - 80 });
  }

  let y = view.subtitle ? 170 : 150;
  if (!view.rows.length) {
    text(ctx, "No results yet.", 40, y + 30, { size: 20, color: RBX.soft });
  } else {
    for (const row of view.rows) {
      card(ctx, 40, y, W - 80, rowH, { radius: 14, shadow: false });
      text(ctx, row.rank, 60, y + 42, { size: 18, weight: "bold", color: SCOUT.accentDeep });
      text(ctx, row.title, 110, y + 30, {
        size: 20,
        weight: "bold",
        color: RBX.ink,
        maxWidth: W - 320,
      });
      text(ctx, row.subtitle, 110, y + 54, { size: 14, color: RBX.muted, maxWidth: W - 320 });
      text(ctx, row.value, W - 60, y + 30, {
        size: 20,
        weight: "bold",
        color: RBX.ink,
        align: "right",
      });
      if (row.delta) {
        const up = row.delta.includes("↑") || row.delta.includes("+");
        text(ctx, row.delta, W - 60, y + 54, {
          size: 14,
          color: up ? SCOUT.up : row.delta.includes("↓") ? SCOUT.down : RBX.muted,
          align: "right",
        });
      }
      y += rowH + 10;
    }
  }
  return toPng(rc.canvas);
}

export interface ScoutGameIntelCardView {
  name: string;
  creator: string;
  genre: string | null;
  playing: string;
  visits: string;
  favorites: string;
  universeId: number;
  placeId: number;
  iconUrl: string | null;
  deltaLabel?: string | null;
  accentLabel?: string;
}

export async function renderScoutGameIntelCard(view: ScoutGameIntelCardView): Promise<Buffer> {
  const W = 960;
  const H = 520;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, view.accentLabel ?? "EXPERIENCE INTEL", 40, 72, {
    size: 14,
    weight: "bold",
    color: SCOUT.accentDeep,
  });

  const icon = await loadRemote(view.iconUrl);
  drawRoundedImage(ctx, icon, 40, 100, 160, 160, 20);

  text(ctx, view.name, 230, 140, { size: 32, weight: "bold", color: RBX.ink, maxWidth: W - 280 });
  text(ctx, `${view.creator}${view.genre ? ` · ${view.genre}` : ""}`, 230, 185, {
    size: 18,
    color: RBX.soft,
    maxWidth: W - 280,
  });
  if (view.deltaLabel) {
    text(ctx, view.deltaLabel, 230, 220, { size: 18, weight: "bold", color: SCOUT.up });
  }

  let tx = 40;
  for (const [label, value] of [
    ["Players", view.playing],
    ["Visits", view.visits],
    ["Favorites", view.favorites],
  ] as const) {
    statTile(ctx, tx, 300, 280, 90, label, value);
    tx += 300;
  }

  text(ctx, `Universe ${view.universeId}  ·  Place ${view.placeId}`, 40, 430, {
    size: 15,
    color: RBX.muted,
  });
  footerNote(ctx, W, H, "Bloxscout · Public Roblox APIs · Local SQLite snapshots");
  return toPng(rc.canvas);
}

export interface ScoutHistoryCardView {
  title: string;
  subtitle: string;
  latestPlaying: string;
  deltaLabel: string | null;
  points: Array<{ when: string; playing: string; delta: string | null }>;
}

export async function renderScoutHistoryCard(view: ScoutHistoryCardView): Promise<Buffer> {
  const W = 960;
  const H = 160 + Math.max(view.points.length, 1) * 52 + 80;
  const rc = createSurface(W, Math.max(H, 420));
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, "SNAPSHOT HISTORY", 40, 72, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.title, 40, 110, { size: 28, weight: "bold", color: RBX.ink, maxWidth: W - 80 });
  text(ctx, view.subtitle, 40, 148, { size: 16, color: RBX.soft, maxWidth: W - 80 });

  card(ctx, 40, 180, W - 80, 70, { radius: 14, shadow: false });
  text(ctx, `Latest players  ${view.latestPlaying}`, 64, 222, {
    size: 20,
    weight: "bold",
    color: RBX.ink,
  });
  if (view.deltaLabel) {
    text(ctx, view.deltaLabel, W - 64, 222, {
      size: 20,
      weight: "bold",
      color: view.deltaLabel.includes("↓") ? SCOUT.down : SCOUT.up,
      align: "right",
    });
  }

  let y = 270;
  for (const p of view.points) {
    text(ctx, p.when, 50, y, { size: 15, color: RBX.muted, maxWidth: 280 });
    text(ctx, p.playing, 360, y, { size: 17, weight: "bold", color: RBX.ink });
    if (p.delta) {
      text(ctx, p.delta, W - 50, y, {
        size: 15,
        color: p.delta.includes("↓") ? SCOUT.down : SCOUT.up,
        align: "right",
      });
    }
    y += 48;
  }
  return toPng(rc.canvas);
}

export interface ScoutCompareCardView {
  title: string;
  rows: Array<{ name: string; playing: string; visits: string; favorites: string }>;
  medians: { playing: string; visits: string; favorites: string };
}

export async function renderScoutCompareCard(view: ScoutCompareCardView): Promise<Buffer> {
  const W = 960;
  const H = 180 + view.rows.length * 70 + 120;
  const rc = createSurface(W, Math.max(H, 480));
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, "COMPARE", 40, 72, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.title, 40, 110, { size: 28, weight: "bold", color: RBX.ink, maxWidth: W - 80 });

  text(ctx, "Game", 50, 160, { size: 13, weight: "bold", color: RBX.muted });
  text(ctx, "Players", 420, 160, { size: 13, weight: "bold", color: RBX.muted });
  text(ctx, "Visits", 600, 160, { size: 13, weight: "bold", color: RBX.muted });
  text(ctx, "Favorites", 780, 160, { size: 13, weight: "bold", color: RBX.muted });

  let y = 185;
  for (const r of view.rows) {
    card(ctx, 40, y, W - 80, 58, { radius: 12, shadow: false });
    text(ctx, r.name, 56, y + 36, { size: 17, weight: "bold", color: RBX.ink, maxWidth: 340 });
    text(ctx, r.playing, 420, y + 36, { size: 17, color: RBX.ink });
    text(ctx, r.visits, 600, y + 36, { size: 17, color: RBX.ink });
    text(ctx, r.favorites, 780, y + 36, { size: 17, color: RBX.ink });
    y += 68;
  }

  text(
    ctx,
    `Median  Players ${view.medians.playing}  ·  Visits ${view.medians.visits}  ·  Favorites ${view.medians.favorites}`,
    40,
    y + 20,
    { size: 15, color: RBX.soft, maxWidth: W - 80 }
  );
  return toPng(rc.canvas);
}

export interface ScoutVsGenreCardView {
  title: string;
  genre: string;
  cohortSize: number;
  metrics: Array<{ label: string; value: string; median: string; percentile: string }>;
}

export async function renderScoutVsGenreCard(view: ScoutVsGenreCardView): Promise<Buffer> {
  const W = 960;
  const H = 200 + view.metrics.length * 90;
  const rc = createSurface(W, Math.max(H, 480));
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, "VS GENRE", 40, 72, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.title, 40, 110, { size: 28, weight: "bold", color: RBX.ink, maxWidth: W - 80 });
  text(ctx, `${view.genre} cohort · ${view.cohortSize} games`, 40, 148, {
    size: 16,
    color: RBX.soft,
  });

  let y = 190;
  for (const m of view.metrics) {
    card(ctx, 40, y, W - 80, 78, { radius: 14, shadow: false });
    text(ctx, m.label, 64, y + 32, { size: 16, weight: "bold", color: RBX.muted });
    text(ctx, m.value, 64, y + 58, { size: 22, weight: "bold", color: RBX.ink });
    text(ctx, `Median ${m.median}`, 420, y + 48, { size: 16, color: RBX.soft });
    text(ctx, `Percentile ${m.percentile}`, W - 64, y + 48, {
      size: 18,
      weight: "bold",
      color: SCOUT.accentDeep,
      align: "right",
    });
    y += 90;
  }
  return toPng(rc.canvas);
}

export interface ScoutMoneyCardView {
  eyebrow: string;
  title: string;
  primary: string;
  secondary: string;
  notes: string[];
  disclaimer?: string | null;
}

export async function renderScoutMoneyCard(view: ScoutMoneyCardView): Promise<Buffer> {
  const W = 920;
  const H = 420 + Math.min(view.notes.length, 4) * 28;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, view.eyebrow, 40, 72, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.title, 40, 110, { size: 28, weight: "bold", color: RBX.ink, maxWidth: W - 80 });
  text(ctx, view.primary, 40, 180, { size: 44, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.secondary, 40, 230, { size: 18, color: RBX.soft, maxWidth: W - 80 });

  let y = 280;
  for (const note of view.notes.slice(0, 4)) {
    text(ctx, `·  ${note}`, 40, y, { size: 15, color: RBX.ink, maxWidth: W - 80 });
    y += 28;
  }
  if (view.disclaimer) {
    ctx.font = "14px Outfit";
    const lines = wrapText(ctx, view.disclaimer, W - 80, 3);
    y += 16;
    for (const line of lines) {
      text(ctx, line, 40, y, { size: 13, color: RBX.muted, maxWidth: W - 80 });
      y += 20;
    }
  }
  return toPng(rc.canvas);
}

export interface ScoutReportCardView {
  genre: string;
  generatedAt: string;
  gameCount: string;
  totalCcu: string;
  medianCcu: string;
  topCreator: string | null;
  focusLine: string | null;
  topNames: string[];
}

export async function renderScoutReportCard(view: ScoutReportCardView): Promise<Buffer> {
  const W = 960;
  const H = 560;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, "MARKET REPORT", 40, 72, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.genre, 40, 112, { size: 34, weight: "bold", color: RBX.ink });
  text(ctx, view.generatedAt, 40, 152, { size: 15, color: RBX.muted });

  let tx = 40;
  for (const [label, value] of [
    ["Games", view.gameCount],
    ["Total CCU", view.totalCcu],
    ["Median CCU", view.medianCcu],
  ] as const) {
    statTile(ctx, tx, 190, 280, 88, label, value);
    tx += 300;
  }

  if (view.topCreator) {
    text(ctx, `Top creator  ${view.topCreator}`, 40, 320, { size: 18, color: RBX.ink });
  }
  if (view.focusLine) {
    text(ctx, view.focusLine, 40, 355, { size: 16, color: SCOUT.accentDeep, maxWidth: W - 80 });
  }

  text(ctx, "Top games", 40, 400, { size: 14, weight: "bold", color: RBX.muted });
  let y = 430;
  for (const name of view.topNames.slice(0, 5)) {
    text(ctx, `·  ${name}`, 40, y, { size: 17, color: RBX.ink, maxWidth: W - 80 });
    y += 28;
  }
  return toPng(rc.canvas);
}

export interface ScoutGroupCardView {
  name: string;
  description: string;
  members: string;
  owner: string | null;
  groupId: number;
}

export async function renderScoutGroupCard(view: ScoutGroupCardView): Promise<Buffer> {
  const W = 920;
  const H = 440;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, "GROUP", 40, 72, { size: 14, weight: "bold", color: SCOUT.accentDeep });
  text(ctx, view.name, 40, 112, { size: 32, weight: "bold", color: RBX.ink, maxWidth: W - 80 });
  text(ctx, `Members ${view.members}${view.owner ? `  ·  Owner ${view.owner}` : ""}`, 40, 160, {
    size: 17,
    color: RBX.soft,
    maxWidth: W - 80,
  });
  ctx.font = "18px Outfit";
  const lines = wrapText(ctx, view.description.replace(/\s+/g, " ").trim() || "No description.", W - 80, 5);
  let y = 220;
  for (const line of lines) {
    text(ctx, line, 40, y, { size: 17, color: RBX.ink, maxWidth: W - 80 });
    y += 28;
  }
  text(ctx, `Group ID ${view.groupId}`, 40, H - 50, { size: 14, color: RBX.muted });
  return toPng(rc.canvas);
}
