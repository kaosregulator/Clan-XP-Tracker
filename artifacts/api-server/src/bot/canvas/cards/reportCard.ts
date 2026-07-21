import {
  createSurface,
  paintBackground,
  card,
  text,
  progressBar,
  roundRectPath,
  horizontalGradient,
  PALETTE,
  toPng,
} from "../theme";

export interface ReportView {
  communityName: string;
  activityName: string;
  periodLabel: string; // "Weekly" | "Monthly"
  rangeLabel: string; // "Jul 14 – Jul 21"
  submissions: number;
  approved: number;
  approvalRate: number;
  activeMembers: number;
  reminders: number;
  warnings: number;
  top: { name: string; approved: number }[];
}

/** A weekly/monthly summary report card. */
export function renderReportCard(view: ReportView): Buffer {
  const W = 960;
  const H = 680;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  text(ctx, view.communityName.toUpperCase(), pad, 56, { size: 22, weight: "bold", color: PALETTE.soft });
  text(ctx, `${view.periodLabel} ${view.activityName} Report`, pad, 96, {
    size: 38,
    weight: "bold",
    color: PALETTE.text,
  });
  text(ctx, view.rangeLabel, pad, 122, { size: 17, color: PALETTE.muted });

  // Headline: approval rate ring-ish bar
  const topY = 146;
  const topH = 150;
  card(ctx, pad, topY, W - pad * 2, topH, { fill: PALETTE.card });
  text(ctx, "APPROVAL RATE", pad + 28, topY + 40, { size: 15, weight: "bold", color: PALETTE.muted });
  text(ctx, `${Math.round(view.approvalRate * 100)}%`, pad + 28, topY + 104, {
    size: 60,
    weight: "bold",
    family: "mono",
    color: PALETTE.greenBright,
  });
  ctx.font = `60px "JetBrains Mono"`;
  const rw = ctx.measureText(`${Math.round(view.approvalRate * 100)}%`).width;
  text(ctx, `${view.approved} of ${view.submissions} submissions approved`, pad + 28 + rw + 20, topY + 104, {
    size: 22,
    color: PALETTE.soft,
  });
  progressBar(ctx, pad + 28, topY + 120, W - pad * 2 - 56, 12, view.approvalRate, {
    fill: horizontalGradient(ctx, pad + 28, 0, W - pad * 2 - 56, [
      [0, PALETTE.green],
      [1, PALETTE.greenBright],
    ]),
  });

  // Stat tiles
  const tilesY = topY + topH + 22;
  const tiles = [
    { label: "Submissions", value: `${view.submissions}`, accent: PALETTE.text },
    { label: "Active Members", value: `${view.activeMembers}`, accent: PALETTE.blurpleSoft },
    { label: "Reminders", value: `${view.reminders}`, accent: PALETTE.amber },
    { label: "Warnings", value: `${view.warnings}`, accent: view.warnings > 0 ? PALETTE.red : PALETTE.text },
  ];
  const gap = 18;
  const tileW = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 96;
  tiles.forEach((t, i) => {
    const x = pad + i * (tileW + gap);
    card(ctx, x, tilesY, tileW, tileH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
    text(ctx, t.label.toUpperCase(), x + 18, tilesY + 30, { size: 13, weight: "bold", color: PALETTE.muted });
    text(ctx, t.value, x + 18, tilesY + 76, { size: 36, weight: "bold", family: "mono", color: t.accent });
  });

  // Top performers
  const tpY = tilesY + tileH + 22;
  const tpH = H - tpY - 28;
  card(ctx, pad, tpY, W - pad * 2, tpH, { fill: PALETTE.card, shadow: false });
  text(ctx, "TOP PERFORMERS", pad + 24, tpY + 32, { size: 14, weight: "bold", color: PALETTE.muted });

  const rows = view.top.slice(0, 5);
  if (!rows.length) {
    text(ctx, "No approved submissions in this period.", pad + 24, tpY + 68, { size: 18, color: PALETTE.muted });
  } else {
    const rowH = (tpH - 56) / rows.length;
    rows.forEach((r, i) => {
      const y = tpY + 50 + i * rowH;
      roundRectPath(ctx, pad + 24, y + rowH / 2 - 14, 40, 28, 8);
      ctx.fillStyle = i < 3 ? "rgba(87,242,135,0.16)" : PALETTE.cardAlt;
      ctx.fill();
      text(ctx, `${i + 1}`, pad + 44, y + rowH / 2 + 1, {
        size: 15,
        weight: "bold",
        color: i < 3 ? PALETTE.greenBright : PALETTE.soft,
        align: "center",
        baseline: "middle",
      });
      text(ctx, r.name, pad + 78, y + rowH / 2 + 1, {
        size: 20,
        weight: "bold",
        color: PALETTE.text,
        baseline: "middle",
        maxWidth: 560,
      });
      text(ctx, `${r.approved} approved`, W - pad - 40, y + rowH / 2 + 1, {
        size: 18,
        weight: "bold",
        family: "mono",
        color: PALETTE.greenBright,
        align: "right",
        baseline: "middle",
      });
    });
  }

  return toPng(rc.canvas);
}
