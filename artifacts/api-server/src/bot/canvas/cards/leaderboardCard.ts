/**
 * Clean-standing leaderboard — who can go without warnings.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawAvatar,
  toPng,
  PALETTE,
} from "../theme";

export interface LeaderboardRow {
  rank: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  cleanPoints: number;
  lifetimeWarnings: number;
  progressLabel: string;
}

export interface LeaderboardCardView {
  communityName: string;
  subtitle?: string;
  podium: LeaderboardRow[];
  rows: LeaderboardRow[];
  neverWarnedCount: number;
  trackedCount: number;
}

export async function renderLeaderboardCard(view: LeaderboardCardView): Promise<Buffer> {
  const W = 1000;
  const listCount = Math.min(view.rows.length, 10);
  const H = 320 + (view.podium.length ? 200 : 0) + listCount * 70 + 70;
  const rc = createSurface(W, Math.max(H, 560));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), 44, 44, {
    size: 15,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "Clean standing", 44, 88, {
    size: 36,
    weight: "bold",
    color: PALETTE.text,
  });
  text(
    ctx,
    view.subtitle ??
      `${view.neverWarnedCount} never warned · ${view.trackedCount} tracked · earn points each clean period`,
    44,
    128,
    { size: 17, color: PALETTE.soft, maxWidth: W - 88 }
  );

  // Top-3 podium
  if (view.podium.length) {
    text(ctx, "WHO CAN GO WITHOUT — TOP 3", 44, 175, {
      size: 14,
      weight: "bold",
      color: PALETTE.blurple,
    });
    const podiumW = 280;
    // Visual order left→right: 2nd · 1st · 3rd
    const spots = [
      { x: 44, y: 220, h: 150 },
      { x: 360, y: 200, h: 170 },
      { x: 676, y: 230, h: 140 },
    ];
    const order = [view.podium[1], view.podium[0], view.podium[2]];
    const ranks = [2, 1, 3];
    for (let i = 0; i < 3; i++) {
      const row = order[i];
      const spot = spots[i]!;
      if (!row) continue;
      card(ctx, spot.x, spot.y, podiumW, spot.h, { radius: 18, shadow: false });
      const img = await fetchAvatar(row.avatarUrl);
      drawAvatar(ctx, img, spot.x + podiumW / 2 - 36, spot.y + 16, 72, row.username[0] ?? "?", "#00a2ff");
      text(ctx, `#${ranks[i]}`, spot.x + 20, spot.y + 36, {
        size: 22,
        weight: "bold",
        color: ranks[i] === 1 ? PALETTE.amber : PALETTE.blurple,
      });
      text(ctx, row.displayName || row.username, spot.x + 20, spot.y + spot.h - 48, {
        size: 18,
        weight: "bold",
        color: PALETTE.text,
        maxWidth: podiumW - 40,
      });
      text(ctx, `${row.cleanPoints} pts · ${row.lifetimeWarnings} warns`, spot.x + 20, spot.y + spot.h - 22, {
        size: 14,
        color: PALETTE.muted,
        maxWidth: podiumW - 40,
      });
    }
  }

  let y = view.podium.length ? 410 : 170;
  text(ctx, "LEADERBOARD", 44, y, { size: 14, weight: "bold", color: PALETTE.muted });
  y += 24;

  if (!view.rows.length) {
    text(ctx, "No tracked members yet.", 44, y + 30, { size: 20, color: PALETTE.soft });
  } else {
    for (const row of view.rows.slice(0, 10)) {
      card(ctx, 44, y, W - 88, 60, { radius: 14, shadow: false });
      text(ctx, String(row.rank).padStart(2, "0"), 64, y + 38, {
        size: 18,
        weight: "bold",
        color: PALETTE.blurple,
      });
      const img = await fetchAvatar(row.avatarUrl);
      drawAvatar(ctx, img, 110, y + 8, 44, row.username[0] ?? "?", PALETTE.blurpleSoft);
      text(ctx, row.displayName || row.username, 170, y + 28, {
        size: 18,
        weight: "bold",
        color: PALETTE.text,
        maxWidth: 360,
      });
      text(ctx, row.progressLabel, 170, y + 48, {
        size: 13,
        color: PALETTE.muted,
        maxWidth: 360,
      });
      text(ctx, `${row.cleanPoints} pts`, W - 64, y + 28, {
        size: 18,
        weight: "bold",
        color: PALETTE.text,
        align: "right",
      });
      text(
        ctx,
        row.lifetimeWarnings === 0 ? "never warned" : `${row.lifetimeWarnings} lifetime`,
        W - 64,
        y + 48,
        { size: 13, color: row.lifetimeWarnings === 0 ? PALETTE.green : PALETTE.muted, align: "right" }
      );
      y += 68;
    }
  }

  return toPng(rc.canvas);
}
