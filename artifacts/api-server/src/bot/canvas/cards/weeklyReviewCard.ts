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

export interface WeeklyReviewView {
  communityName: string;
  activityName: string;
  rangeLabel: string; // "Jul 21 – Jul 27"
  deadline: string; // "resets Mon 00:00"
  goalLabel: string; // "5,000 XP weekly goal" / "Weekly completion"
  tracked: number;
  active: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  exempt: number;
  onLeave: number;
  completionRate: number; // 0..1
  reminders: number;
  warnings: number;
}

/** The flagship weekly review card — the whole clan's week at a glance. */
export async function renderWeeklyReview(v: WeeklyReviewView): Promise<Buffer> {
  const W = 960;
  const H = 560;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  text(ctx, v.communityName.toUpperCase(), pad, 54, {
    size: 22,
    weight: "bold",
    color: PALETTE.soft,
    maxWidth: W - pad * 2,
  });
  text(ctx, `Weekly ${v.activityName} Review`, pad, 92, {
    size: 38,
    weight: "bold",
    color: PALETTE.text,
  });
  text(ctx, `${v.rangeLabel} • ${v.goalLabel} • ${v.deadline}`, pad, 118, {
    size: 16,
    color: PALETTE.muted,
    maxWidth: W - pad * 2,
  });

  // Hero: completion rate
  const topY = 140;
  const topH = 150;
  card(ctx, pad, topY, W - pad * 2, topH, { fill: PALETTE.card });

  const pct = Math.round(v.completionRate * 100);
  const accent = pct >= 100 ? PALETTE.greenBright : pct >= 50 ? PALETTE.amber : PALETTE.red;
  text(ctx, "COMPLETION RATE", pad + 28, topY + 40, { size: 15, weight: "bold", color: PALETTE.muted });
  text(ctx, `${pct}%`, pad + 28, topY + 102, {
    size: 58,
    weight: "bold",
    family: "mono",
    color: accent,
  });
  ctx.font = `58px "JetBrains Mono", "DejaVu Sans"`;
  const bw = ctx.measureText(`${pct}%`).width;
  text(
    ctx,
    `${v.completed} of ${v.active} members hit the goal`,
    pad + 28 + bw + 18,
    topY + 102,
    { size: 22, color: PALETTE.soft }
  );
  progressBar(ctx, pad + 28, topY + topH - 26, W - pad * 2 - 56, 12, v.completionRate, {
    fill: horizontalGradient(ctx, pad + 28, 0, W - pad * 2 - 56, [
      [0, accent],
      [1, accent],
    ]),
  });

  // Stat tiles: the review's four action numbers.
  const tilesY = topY + topH + 24;
  const tiles = [
    { label: "Completed", value: v.completed, accent: PALETTE.greenBright },
    { label: "In Progress", value: v.inProgress, accent: PALETTE.amber },
    { label: "Not Started", value: v.notStarted, accent: v.notStarted > 0 ? PALETTE.red : PALETTE.text },
    { label: "Warnings", value: v.warnings, accent: v.warnings > 0 ? PALETTE.red : PALETTE.text },
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

  // Footer strip: roster + reminders context.
  const footY = tilesY + tileH + 22;
  card(ctx, pad, footY, W - pad * 2, 64, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
  // Plain text only — the bundled canvas fonts carry no emoji glyphs, so an
  // emoji here would render as a tofu box.
  const parts = [
    `${v.tracked} tracked`,
    `${v.exempt} exempt`,
    `${v.onLeave} on leave`,
    `${v.reminders} reminders this week`,
  ];
  text(ctx, parts.join("    •    "), W / 2, footY + 33, {
    size: 18,
    color: PALETTE.soft,
    align: "center",
    baseline: "middle",
    maxWidth: W - pad * 2 - 40,
  });

  return toPng(rc.canvas);
}
