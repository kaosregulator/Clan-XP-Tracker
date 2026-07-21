import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  paintBackground,
  card,
  text,
  roundRectPath,
  PALETTE,
  toPng,
} from "../theme";
import { font } from "../fonts";
import type { AccountState } from "../../services/accounts";

export interface PatriotDashboardRow {
  name: string;
  accounts: { label: string; state: AccountState }[];
}

export interface PatriotDashboardView {
  communityName: string;
  activityDate: string;
  members: number;
  totalAccounts: number;
  completedAccounts: number;
  rows: PatriotDashboardRow[];
}

const STATE_COLOR: Record<AccountState, string> = {
  done: PALETTE.greenBright,
  pending: PALETTE.amber,
  missing: PALETTE.red,
};

const MAX_ROWS = 7;

/** Patriot / Guardian dashboard: per-member alt-account completion for today. */
export function renderPatriotDashboard(view: PatriotDashboardView): Buffer {
  const rows = view.rows.slice(0, MAX_ROWS);
  const rowH = 58;
  const headerH = 250;
  const H = Math.max(360, headerH + rows.length * (rowH + 12) + 40);
  const W = 960;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  text(ctx, view.communityName.toUpperCase(), pad, 56, { size: 22, weight: "bold", color: PALETTE.soft });
  text(ctx, "Patriot / Guardian Board", pad, 96, { size: 40, weight: "bold", color: PALETTE.text });
  text(ctx, `Alt-account tracking • ${view.activityDate}`, pad, 122, { size: 17, color: PALETTE.muted });

  // Summary tiles
  const tilesY = 146;
  const tiles = [
    { label: "Patriots", value: `${view.members}`, accent: PALETTE.blurpleSoft },
    { label: "Accounts Complete", value: `${view.completedAccounts}/${view.totalAccounts}`, accent: PALETTE.greenBright },
    {
      label: "Completion",
      value: `${view.totalAccounts ? Math.round((view.completedAccounts / view.totalAccounts) * 100) : 0}%`,
      accent: PALETTE.amber,
    },
  ];
  const gap = 18;
  const tileW = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 84;
  tiles.forEach((t, i) => {
    const x = pad + i * (tileW + gap);
    card(ctx, x, tilesY, tileW, tileH, { fill: PALETTE.card, shadow: false });
    text(ctx, t.label.toUpperCase(), x + 18, tilesY + 28, { size: 13, weight: "bold", color: PALETTE.muted });
    text(ctx, t.value, x + 18, tilesY + 66, { size: 32, weight: "bold", family: "mono", color: t.accent });
  });

  // Rows
  let y = headerH;
  if (!rows.length) {
    text(ctx, "No members with alt accounts yet.", pad, y + 10, { size: 18, color: PALETTE.muted });
  }
  for (const r of rows) {
    card(ctx, pad, y, W - pad * 2, rowH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false, radius: 14 });
    text(ctx, r.name, pad + 20, y + rowH / 2 + 1, {
      size: 20,
      weight: "bold",
      color: PALETTE.text,
      baseline: "middle",
      maxWidth: 220,
    });
    drawChips(ctx, pad + 260, y, W - pad * 2 - 280, rowH, r.accounts);
    y += rowH + 12;
  }

  return toPng(rc.canvas);
}

function drawChips(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accounts: { label: string; state: AccountState }[]
) {
  let cx = x;
  const chipH = 30;
  const cy = y + (h - chipH) / 2;
  ctx.font = font(14, "bold", "display");
  for (const a of accounts) {
    const tw = ctx.measureText(a.label).width;
    const chipW = tw + 42;
    if (cx + chipW > x + w) {
      text(ctx, "…", cx + 6, cy + chipH / 2 + 1, { size: 16, color: PALETTE.muted, baseline: "middle" });
      break;
    }
    roundRectPath(ctx, cx, cy, chipW, chipH, chipH / 2);
    ctx.fillStyle = PALETTE.cardAlt;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 16, cy + chipH / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = STATE_COLOR[a.state];
    ctx.fill();
    text(ctx, a.label, cx + 30, cy + chipH / 2 + 1, {
      size: 14,
      weight: "bold",
      color: PALETTE.soft,
      baseline: "middle",
    });
    cx += chipW + 10;
  }
}
