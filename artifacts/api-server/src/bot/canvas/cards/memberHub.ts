import type { Image } from "@napi-rs/canvas";
import {
  createSurface,
  paintBackground,
  card,
  text,
  pill,
  progressBar,
  drawAvatar,
  roundRectPath,
  horizontalGradient,
  PALETTE,
  toPng,
} from "../theme";

export type DayState = "done" | "pending" | "missing";

export interface AccountRow {
  label: string;
  state: DayState;
}

export interface MemberHubView {
  communityName: string;
  activityName: string;
  gameName: string;
  displayName: string;
  avatar: Image | null;
  dailyGoal: number;
  status: DayState;
  currentStreak: number;
  longestStreak: number;
  warnings: number;
  approvalRate: number; // 0..1
  totalApproved: number;
  lastActivity: string;
  accounts?: AccountRow[];
}

const STATUS_META: Record<DayState, { label: string; color: string; sub: string }> = {
  done: { label: "Complete", color: PALETTE.greenBright, sub: "You're done for today" },
  pending: { label: "In Review", color: PALETTE.amber, sub: "Waiting on staff approval" },
  missing: { label: "Not Submitted", color: PALETTE.red, sub: "Submit before today's reset" },
};

/** Renders the /xp member hub as a PNG buffer. */
export function renderMemberHub(view: MemberHubView): Buffer {
  const W = 960;
  const H = view.accounts && view.accounts.length ? 600 : 520;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  const pad = 40;

  // Header row -----------------------------------------------------------
  text(ctx, view.communityName.toUpperCase(), pad, 56, {
    size: 22,
    weight: "bold",
    color: PALETTE.soft,
    maxWidth: W - pad * 2 - 160,
  });
  text(ctx, `${view.activityName} Tracker`, pad, 92, {
    size: 40,
    weight: "bold",
    color: PALETTE.text,
  });
  // streak chip top-right (drawn dot instead of emoji — no color-emoji font)
  const streakLabel = `${view.currentStreak} DAY STREAK`;
  ctx.font = `20px "Outfit Bold"`;
  const chipTextW = ctx.measureText(streakLabel).width;
  const chipW = chipTextW + 34 + 22;
  const chipX = W - pad - chipW;
  const chipY = 60;
  const chipH = 40;
  roundRectPath(ctx, chipX, chipY, chipW, chipH, chipH / 2);
  ctx.fillStyle = "rgba(250,166,26,0.14)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(chipX + 22, chipY + chipH / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.amber;
  ctx.fill();
  text(ctx, streakLabel, chipX + 38, chipY + chipH / 2 + 1, {
    size: 20,
    weight: "bold",
    color: PALETTE.text,
    baseline: "middle",
  });

  // Identity + status card ----------------------------------------------
  const topY = 124;
  const topH = 168;
  card(ctx, pad, topY, W - pad * 2, topH, { fill: PALETTE.card });

  const av = 108;
  drawAvatar(ctx, view.avatar, pad + 28, topY + (topH - av) / 2, av, view.displayName, PALETTE.blurple);

  const infoX = pad + 28 + av + 26;
  text(ctx, view.displayName, infoX, topY + 60, {
    size: 32,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 360,
  });

  const meta = STATUS_META[view.status];
  // status dot + label
  ctx.beginPath();
  ctx.arc(infoX + 8, topY + 92, 8, 0, Math.PI * 2);
  ctx.fillStyle = meta.color;
  ctx.fill();
  text(ctx, meta.label, infoX + 26, topY + 100, { size: 24, weight: "bold", color: meta.color });
  text(ctx, meta.sub, infoX, topY + 132, { size: 18, color: PALETTE.muted });

  // Daily goal block (right side of top card)
  const goalX = W - pad - 250;
  const goalY = topY + 30;
  text(ctx, `DAILY ${view.activityName.toUpperCase()} GOAL`, goalX, goalY + 6, {
    size: 15,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(
    ctx,
    view.dailyGoal > 0 ? view.dailyGoal.toLocaleString() : "Submit daily",
    goalX,
    goalY + 46,
    { size: view.dailyGoal > 0 ? 40 : 28, weight: "bold", family: view.dailyGoal > 0 ? "mono" : "display", color: PALETTE.text }
  );
  const goalPct = view.status === "done" ? 1 : view.status === "pending" ? 0.6 : 0.05;
  progressBar(ctx, goalX, goalY + 70, 210, 12, goalPct, {
    fill: horizontalGradient(ctx, goalX, 0, 210, [
      [0, meta.color],
      [1, meta.color],
    ]),
  });

  // Stat tiles -----------------------------------------------------------
  const tilesY = topY + topH + 24;
  const tiles: { label: string; value: string; accent?: string }[] = [
    { label: "Current Streak", value: `${view.currentStreak}`, accent: PALETTE.amber },
    { label: "Longest Streak", value: `${view.longestStreak}` },
    { label: "Approval", value: `${Math.round(view.approvalRate * 100)}%`, accent: PALETTE.greenBright },
    { label: "Warnings", value: `${view.warnings}`, accent: view.warnings > 0 ? PALETTE.red : undefined },
  ];
  const gap = 18;
  const tileW = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 108;
  tiles.forEach((t, i) => {
    const x = pad + i * (tileW + gap);
    card(ctx, x, tilesY, tileW, tileH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
    text(ctx, t.label.toUpperCase(), x + 20, tilesY + 34, {
      size: 14,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, t.value, x + 20, tilesY + 82, {
      size: 42,
      weight: "bold",
      family: "mono",
      color: t.accent ?? PALETTE.text,
    });
  });

  // Footer meta
  const footY = tilesY + tileH + 34;
  text(ctx, `${view.totalApproved} approved • Last activity ${view.lastActivity}`, pad, footY, {
    size: 17,
    color: PALETTE.muted,
  });

  // Patriot / Guardian account grid -------------------------------------
  if (view.accounts && view.accounts.length) {
    const gridY = footY + 20;
    drawAccountGrid(ctx, pad, gridY, W - pad * 2, view.accounts);
  }

  return toPng(rc.canvas);
}

const STATE_COLOR: Record<DayState, string> = {
  done: PALETTE.greenBright,
  pending: PALETTE.amber,
  missing: PALETTE.red,
};
// Glyphs restricted to characters present in the bundled font (no emoji/tofu).
const STATE_GLYPH: Record<DayState, string> = { done: "✓", pending: "•", missing: "×" };

function drawAccountGrid(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  x: number,
  y: number,
  w: number,
  accounts: AccountRow[]
) {
  const perRow = 4;
  const gap = 14;
  const chipW = (w - gap * (perRow - 1)) / perRow;
  const chipH = 56;
  accounts.slice(0, 8).forEach((a, i) => {
    const cx = x + (i % perRow) * (chipW + gap);
    const cy = y + Math.floor(i / perRow) * (chipH + gap);
    card(ctx, cx, cy, chipW, chipH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false, radius: 14 });
    const color = STATE_COLOR[a.state];
    ctx.beginPath();
    ctx.arc(cx + 26, cy + chipH / 2, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    text(ctx, STATE_GLYPH[a.state], cx + 26, cy + chipH / 2 + 1, {
      size: 15,
      weight: "bold",
      color: PALETTE.bg0,
      align: "center",
      baseline: "middle",
    });
    text(ctx, a.label, cx + 48, cy + chipH / 2 + 1, {
      size: 18,
      weight: "bold",
      color: PALETTE.text,
      baseline: "middle",
      maxWidth: chipW - 60,
    });
  });
}
