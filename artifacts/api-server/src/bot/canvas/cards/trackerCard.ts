import {
  createSurface,
  paintBackground,
  card,
  text,
  progressBar,
  horizontalGradient,
  PALETTE,
  toPng,
} from "../theme";

export interface TrackerCardView {
  communityName: string;
  activityName: string;
  activityDate: string;
  deadline: string;
  submitted: number;
  total: number;
  missing: number;
  vacation: number;
  overflow: number;
  // Capacity (0 limit => uncapped, show member progress instead)
  limitXp: number;
  filledXp: number;
  pct: number;
  maxed: boolean;
  contributions: number;
  contributionCap: number;
  overflowXp: number;
}

/** Clean, at-a-glance tracker card (no mention wall — that's behind Check Users). */
export function renderTrackerCard(v: TrackerCardView): Buffer {
  const W = 960;
  const H = 460;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  text(ctx, v.communityName.toUpperCase(), pad, 54, { size: 22, weight: "bold", color: PALETTE.soft, maxWidth: W - pad * 2 });
  text(ctx, `${v.activityName} Tracker`, pad, 92, { size: 38, weight: "bold", color: PALETTE.text });
  text(ctx, `${v.activityDate} • resets ${v.deadline}`, pad, 118, { size: 16, color: PALETTE.muted });

  // Hero progress card
  const topY = 140;
  const topH = 150;
  card(ctx, pad, topY, W - pad * 2, topH, { fill: PALETTE.card });

  const capped = v.limitXp > 0;
  const heroLabel = capped ? "CLAN CONTRIBUTIONS" : `${v.activityName.toUpperCase()} SUBMITTED TODAY`;
  const bigNum = capped ? `${Math.min(v.contributions, v.contributionCap)}` : `${v.submitted}`;
  const bigDen = capped ? `/ ${v.contributionCap}` : `/ ${v.total}`;
  const pct = capped ? v.pct : v.total > 0 ? Math.round((v.submitted / v.total) * 100) : 0;
  const accent = pct >= 100 ? PALETTE.greenBright : pct >= 50 ? PALETTE.amber : PALETTE.red;

  text(ctx, heroLabel, pad + 28, topY + 40, { size: 15, weight: "bold", color: PALETTE.muted });
  text(ctx, bigNum, pad + 28, topY + 100, { size: 58, weight: "bold", family: "mono", color: accent });
  ctx.font = `58px "JetBrains Mono", "DejaVu Sans"`;
  const bw = ctx.measureText(bigNum).width;
  text(ctx, bigDen, pad + 28 + bw + 14, topY + 100, { size: 26, color: PALETTE.soft });
  text(ctx, `${pct}%`, W - pad - 28, topY + 100, { size: 40, weight: "bold", family: "mono", color: accent, align: "right" });

  // XP line under the number when capped
  if (capped) {
    text(
      ctx,
      v.maxed
        ? `MAXED • ${v.limitXp.toLocaleString()} ${v.activityName}${v.overflowXp > 0 ? ` (+${v.overflowXp.toLocaleString()} overflow)` : ""}`
        : `${v.filledXp.toLocaleString()} / ${v.limitXp.toLocaleString()} ${v.activityName}`,
      pad + 28,
      topY + 128,
      { size: 15, color: v.maxed ? PALETTE.greenBright : PALETTE.muted }
    );
  }
  progressBar(ctx, pad + 28, topY + topH - 20, W - pad * 2 - 56, 12, pct / 100, {
    fill: horizontalGradient(ctx, pad + 28, 0, W - pad * 2 - 56, [
      [0, accent],
      [1, accent],
    ]),
  });

  // Stat tiles
  const tilesY = topY + topH + 24;
  const tiles = [
    { label: "Submitted", value: v.submitted, accent: PALETTE.greenBright },
    { label: "Missing", value: v.missing, accent: v.missing > 0 ? PALETTE.red : PALETTE.text },
    { label: "Vacation", value: v.vacation, accent: PALETTE.cyan },
    { label: "Overflow", value: v.overflow, accent: PALETTE.blurpleSoft },
  ];
  const gap = 18;
  const tileW = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 96;
  tiles.forEach((t, i) => {
    const x = pad + i * (tileW + gap);
    card(ctx, x, tilesY, tileW, tileH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
    text(ctx, t.label.toUpperCase(), x + 18, tilesY + 30, { size: 13, weight: "bold", color: PALETTE.muted });
    text(ctx, `${t.value}`, x + 18, tilesY + 78, { size: 38, weight: "bold", family: "mono", color: t.accent });
  });

  return toPng(rc.canvas);
}
