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

export interface ClanLeaderRow {
  name: string;
  streak: number;
  approved: number;
}

export interface ClanDashboardView {
  communityName: string;
  activityName: string;
  activityDate: string;
  dailyGoal: number;
  completed: number;
  totalMembers: number;
  deadline: string;
  leaders: ClanLeaderRow[];
}

/** Public, auto-updating clan dashboard. */
export function renderClanDashboard(view: ClanDashboardView): Buffer {
  const W = 960;
  const H = 600;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  text(ctx, view.communityName.toUpperCase(), pad, 56, { size: 22, weight: "bold", color: PALETTE.soft });
  text(ctx, `${view.activityName} Dashboard`, pad, 96, { size: 40, weight: "bold", color: PALETTE.text });
  text(ctx, `${view.activityDate} • resets ${view.deadline}`, pad, 122, { size: 17, color: PALETTE.muted });

  // Progress hero
  const topY = 146;
  const topH = 150;
  card(ctx, pad, topY, W - pad * 2, topH, { fill: PALETTE.card });
  const pct = view.totalMembers > 0 ? view.completed / view.totalMembers : 0;
  text(ctx, "TODAY'S PROGRESS", pad + 28, topY + 40, { size: 15, weight: "bold", color: PALETTE.muted });
  text(ctx, `${view.completed}`, pad + 28, topY + 100, {
    size: 58,
    weight: "bold",
    family: "mono",
    color: PALETTE.greenBright,
  });
  ctx.font = `58px "JetBrains Mono"`;
  const cw = ctx.measureText(`${view.completed}`).width;
  text(ctx, `/ ${view.totalMembers} members complete`, pad + 28 + cw + 16, topY + 100, {
    size: 24,
    color: PALETTE.soft,
  });
  // goal chip
  const goalText = view.dailyGoal > 0 ? `Daily goal: ${view.dailyGoal.toLocaleString()} ${view.activityName}` : "Goal: submit daily";
  ctx.font = `18px "Outfit Bold"`;
  const gw = ctx.measureText(goalText).width + 34;
  roundRectPath(ctx, W - pad - 28 - gw, topY + 28, gw, 36, 18);
  ctx.fillStyle = "rgba(88,101,242,0.16)";
  ctx.fill();
  text(ctx, goalText, W - pad - 28 - gw / 2, topY + 46, {
    size: 18,
    weight: "bold",
    color: PALETTE.blurpleSoft,
    align: "center",
    baseline: "middle",
  });
  progressBar(ctx, pad + 28, topY + 118, W - pad * 2 - 56, 14, pct, {
    fill: horizontalGradient(ctx, pad + 28, 0, W - pad * 2 - 56, [
      [0, PALETTE.green],
      [1, PALETTE.greenBright],
    ]),
  });

  // Leaderboard
  const lbY = topY + topH + 22;
  const lbH = H - lbY - 28;
  card(ctx, pad, lbY, W - pad * 2, lbH, { fill: PALETTE.card, shadow: false });
  text(ctx, "TOP STREAKS", pad + 24, lbY + 34, { size: 14, weight: "bold", color: PALETTE.muted });

  const rows = view.leaders.slice(0, 5);
  if (!rows.length) {
    text(ctx, "No activity yet — be the first to submit!", pad + 24, lbY + 74, {
      size: 18,
      color: PALETTE.muted,
    });
  } else {
    const rowH = (lbH - 60) / rows.length;
    rows.forEach((r, i) => {
      const y = lbY + 54 + i * rowH;
      const medal = ["1", "2", "3", "4", "5"][i] ?? `${i + 1}`;
      // rank badge
      ctx.beginPath();
      ctx.arc(pad + 44, y + rowH / 2, 16, 0, Math.PI * 2);
      ctx.fillStyle = i < 3 ? "rgba(250,166,26,0.18)" : PALETTE.cardAlt;
      ctx.fill();
      text(ctx, medal, pad + 44, y + rowH / 2 + 1, {
        size: 16,
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
        maxWidth: 480,
      });
      text(ctx, `${r.approved} approved`, W - pad - 200, y + rowH / 2 + 1, {
        size: 16,
        color: PALETTE.muted,
        baseline: "middle",
        align: "right",
      });
      text(ctx, `${r.streak}d`, W - pad - 40, y + rowH / 2 + 1, {
        size: 22,
        weight: "bold",
        family: "mono",
        color: PALETTE.amber,
        baseline: "middle",
        align: "right",
      });
    });
  }

  return toPng(rc.canvas);
}
