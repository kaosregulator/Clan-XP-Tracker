import {
  createSurface,
  paintBackground,
  card,
  text,
  roundRectPath,
  PALETTE,
  toPng,
} from "../theme";

export interface LeaderboardRow {
  name: string;
  streak: number;
  approved: number;
}

export interface LeaderboardCardView {
  communityName: string;
  activityName: string;
  rows: LeaderboardRow[];
  subtitle?: string;
}

const MAX = 10;

/** A clean streak leaderboard card, uniform with the dashboards. */
export function renderLeaderboardCard(view: LeaderboardCardView): Buffer {
  const rows = view.rows.slice(0, MAX);
  const W = 960;
  const pad = 40;
  const headerH = 128;
  const rowH = 52;
  const rowGap = 10;
  const listH = Math.max(rowH, rows.length * (rowH + rowGap));
  const H = headerH + listH + 36;

  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), pad, 54, { size: 22, weight: "bold", color: PALETTE.soft, maxWidth: W - pad * 2 });
  text(ctx, `${view.activityName} Leaderboard`, pad, 96, { size: 36, weight: "bold", color: PALETTE.text });
  if (view.subtitle) text(ctx, view.subtitle, pad, 120, { size: 16, color: PALETTE.muted });

  if (!rows.length) {
    text(ctx, "No activity yet — be the first to submit!", pad, headerH + 30, { size: 18, color: PALETTE.muted });
    return toPng(rc.canvas);
  }

  let y = headerH;
  const medal = ["#1", "#2", "#3"];
  rows.forEach((r, i) => {
    card(ctx, pad, y, W - pad * 2, rowH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false, radius: 14 });

    // rank badge
    roundRectPath(ctx, pad + 14, y + (rowH - 30) / 2, 46, 30, 9);
    ctx.fillStyle = i < 3 ? "rgba(250,166,26,0.18)" : PALETTE.cardAlt;
    ctx.fill();
    text(ctx, medal[i] ?? `#${i + 1}`, pad + 37, y + rowH / 2 + 1, {
      size: 15,
      weight: "bold",
      color: i < 3 ? PALETTE.amber : PALETTE.soft,
      align: "center",
      baseline: "middle",
    });

    text(ctx, r.name, pad + 76, y + rowH / 2 + 1, {
      size: 20,
      weight: "bold",
      color: PALETTE.text,
      baseline: "middle",
      maxWidth: 520,
    });

    text(ctx, `${r.approved} approved`, W - pad - 170, y + rowH / 2 + 1, {
      size: 16,
      color: PALETTE.muted,
      align: "right",
      baseline: "middle",
    });
    text(ctx, `${r.streak}d`, W - pad - 24, y + rowH / 2 + 1, {
      size: 22,
      weight: "bold",
      family: "mono",
      color: PALETTE.amber,
      align: "right",
      baseline: "middle",
    });

    y += rowH + rowGap;
  });

  return toPng(rc.canvas);
}
