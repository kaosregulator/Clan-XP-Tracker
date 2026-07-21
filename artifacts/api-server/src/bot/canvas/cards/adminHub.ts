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

export interface AdminTopStreak {
  name: string;
  streak: number;
}

export interface AdminHubView {
  communityName: string;
  activityName: string;
  activityDate: string;
  totalMembers: number;
  completed: number;
  pending: number;
  missing: number;
  pendingReviews: number;
  warningsToday: number;
  remindersToday: number;
  deadline: string;
  topStreaks: AdminTopStreak[];
}

/** Renders the /xpadmin operations dashboard as a PNG buffer. */
export function renderAdminHub(view: AdminHubView): Buffer {
  const W = 960;
  const H = 560;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  // Header
  text(ctx, view.communityName.toUpperCase(), pad, 56, {
    size: 22,
    weight: "bold",
    color: PALETTE.soft,
  });
  text(ctx, "Staff Operations", pad, 92, { size: 40, weight: "bold", color: PALETTE.text });
  text(ctx, `Today • ${view.activityDate} • resets ${view.deadline}`, pad, 118, {
    size: 17,
    color: PALETTE.muted,
  });

  // Progress card (completed / total) --------------------------------------
  const topY = 140;
  const progW = 560;
  const progH = 150;
  card(ctx, pad, topY, progW, progH, { fill: PALETTE.card });
  const pct = view.totalMembers > 0 ? view.completed / view.totalMembers : 0;
  text(ctx, `TODAY'S ${view.activityName.toUpperCase()} PROGRESS`, pad + 28, topY + 40, {
    size: 15,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, `${view.completed}`, pad + 28, topY + 96, {
    size: 56,
    weight: "bold",
    family: "mono",
    color: PALETTE.greenBright,
  });
  ctx.font = `56px "JetBrains Mono"`;
  const cw = ctx.measureText(`${view.completed}`).width;
  text(ctx, `/ ${view.totalMembers} verified`, pad + 28 + cw + 16, topY + 96, {
    size: 24,
    color: PALETTE.soft,
  });
  progressBar(ctx, pad + 28, topY + 116, progW - 56, 14, pct, {
    fill: horizontalGradient(ctx, pad + 28, 0, progW - 56, [
      [0, PALETTE.green],
      [1, PALETTE.greenBright],
    ]),
  });

  // Right column mini stats
  const rx = pad + progW + 20;
  const rw = W - pad - rx;
  const miniData: { label: string; value: number; accent: string }[] = [
    { label: "Pending reviews", value: view.pendingReviews, accent: PALETTE.amber },
    { label: "Missing today", value: view.missing, accent: PALETTE.red },
  ];
  const miniH = (progH - 20) / 2;
  miniData.forEach((m, i) => {
    const y = topY + i * (miniH + 20);
    card(ctx, rx, y, rw, miniH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
    text(ctx, m.label.toUpperCase(), rx + 20, y + 26, { size: 13, weight: "bold", color: PALETTE.muted });
    text(ctx, `${m.value}`, rx + 20, y + miniH - 16, {
      size: 30,
      weight: "bold",
      family: "mono",
      color: m.accent,
    });
  });

  // Stat tiles row ---------------------------------------------------------
  const tilesY = topY + progH + 22;
  const tiles = [
    { label: "Verified", value: view.completed, accent: PALETTE.greenBright },
    { label: "Pending", value: view.pending, accent: PALETTE.amber },
    { label: "Warnings Today", value: view.warningsToday, accent: PALETTE.red },
    { label: "Reminders Today", value: view.remindersToday, accent: PALETTE.blurpleSoft },
  ];
  const gap = 18;
  const tileW = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 96;
  tiles.forEach((t, i) => {
    const x = pad + i * (tileW + gap);
    card(ctx, x, tilesY, tileW, tileH, { fill: PALETTE.card, shadow: false });
    text(ctx, t.label.toUpperCase(), x + 18, tilesY + 30, {
      size: 13,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, `${t.value}`, x + 18, tilesY + 76, {
      size: 38,
      weight: "bold",
      family: "mono",
      color: t.accent,
    });
  });

  // Top streaks ------------------------------------------------------------
  const streakY = tilesY + tileH + 22;
  const streakH = H - streakY - 28;
  card(ctx, pad, streakY, W - pad * 2, streakH, { fill: PALETTE.card, shadow: false });
  text(ctx, "TOP STREAKS", pad + 24, streakY + 32, { size: 14, weight: "bold", color: PALETTE.muted });

  const rows = view.topStreaks.slice(0, 3);
  if (!rows.length) {
    text(ctx, "No active streaks yet.", pad + 24, streakY + 66, { size: 18, color: PALETTE.muted });
  } else {
    const colW = (W - pad * 2 - 48) / rows.length;
    rows.forEach((s, i) => {
      const x = pad + 24 + i * colW;
      const rank = ["1st", "2nd", "3rd"][i] ?? `${i + 1}`;
      // rank badge
      roundRectPath(ctx, x, streakY + 52, 44, 28, 8);
      ctx.fillStyle = "rgba(250,166,26,0.16)";
      ctx.fill();
      text(ctx, rank, x + 22, streakY + 66, {
        size: 14,
        weight: "bold",
        color: PALETTE.amber,
        align: "center",
        baseline: "middle",
      });
      text(ctx, s.name, x + 56, streakY + 66, {
        size: 20,
        weight: "bold",
        color: PALETTE.text,
        baseline: "middle",
        maxWidth: colW - 130,
      });
      text(ctx, `${s.streak}d`, x + colW - 40, streakY + 66, {
        size: 22,
        weight: "bold",
        family: "mono",
        color: PALETTE.amber,
        align: "right",
        baseline: "middle",
      });
    });
  }

  return toPng(rc.canvas);
}
