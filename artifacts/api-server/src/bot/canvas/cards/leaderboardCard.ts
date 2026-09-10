/**
 * Activity standing leaderboard — podium + roster.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawSquareAvatar,
  toPng,
  PALETTE,
} from "../theme";

export interface LeaderboardRow {
  rank: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  discordAvatarUrl?: string | null;
  robloxAvatarUrl?: string | null;
  cleanPoints: number;
  lifetimeWarnings: number;
  progressLabel: string;
  roleLabel?: string;
}

export interface LeaderboardCardView {
  communityName: string;
  subtitle?: string;
  trackRoleName?: string | null;
  podium: LeaderboardRow[];
  rows: LeaderboardRow[];
  neverWarnedCount: number;
  trackedCount: number;
}

async function drawDualSquare(
  ctx: SKRSContext2D,
  row: LeaderboardRow,
  cx: number,
  y: number,
  size: number
) {
  const discordUrl = row.discordAvatarUrl || row.avatarUrl;
  const robloxUrl = row.robloxAvatarUrl || null;
  if (robloxUrl && discordUrl) {
    const dImg = await fetchAvatar(discordUrl);
    const rImg = await fetchAvatar(robloxUrl);
    drawSquareAvatar(ctx, dImg, cx - size - 6, y, size, row.username[0] ?? "?", PALETTE.blurpleSoft, 12);
    drawSquareAvatar(ctx, rImg, cx + 6, y, size, "R", "#00a2ff", 12);
  } else {
    const img = await fetchAvatar(row.avatarUrl);
    drawSquareAvatar(ctx, img, cx - size / 2, y, size, row.username[0] ?? "?", "#00a2ff", 12);
  }
}

export async function renderLeaderboardCard(view: LeaderboardCardView): Promise<Buffer> {
  const W = 1000;
  const listCount = Math.min(view.rows.length, 10);
  const podiumH = view.podium.length ? 280 : 0;
  const H = 300 + podiumH + listCount * 74 + 70;
  const rc = createSurface(W, Math.max(H, 560));
  const { ctx } = rc;
  paintBackground(rc);

  const roleLine = view.trackRoleName ? ` · tracking ${view.trackRoleName}` : "";

  text(ctx, view.communityName.toUpperCase(), 44, 44, {
    size: 15,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "Activity standing", 44, 88, {
    size: 36,
    weight: "bold",
    color: PALETTE.text,
  });
  text(
    ctx,
    view.subtitle ??
      `${view.trackedCount} tracked${roleLine} · ${view.neverWarnedCount} clean · points for each clean period`,
    44,
    128,
    { size: 17, color: PALETTE.soft, maxWidth: W - 88 }
  );

  if (view.podium.length) {
    text(ctx, "TOP 3 — PODIUM", 44, 175, {
      size: 14,
      weight: "bold",
      color: PALETTE.blurple,
    });

    const cardW = 270;
    const spots = [
      { x: 44, y: 230, h: 220 },
      { x: 365, y: 200, h: 250 },
      { x: 686, y: 240, h: 210 },
    ];
    const order = [view.podium[1], view.podium[0], view.podium[2]];
    const ranks = [2, 1, 3];
    const rankColors = [PALETTE.blurple, PALETTE.amber, PALETTE.blurple];

    for (let i = 0; i < 3; i++) {
      const row = order[i];
      const spot = spots[i]!;
      if (!row) continue;
      card(ctx, spot.x, spot.y, cardW, spot.h, { radius: 10, shadow: ranks[i] === 1 });

      text(ctx, `#${ranks[i]}`, spot.x + cardW / 2, spot.y + 28, {
        size: ranks[i] === 1 ? 26 : 22,
        weight: "bold",
        color: rankColors[i]!,
        align: "center",
      });

      const avatarSize = ranks[i] === 1 ? 64 : 56;
      await drawDualSquare(ctx, row, spot.x + cardW / 2, spot.y + 48, avatarSize);

      const nameY = spot.y + 48 + avatarSize + 28;
      text(ctx, row.displayName || row.username, spot.x + cardW / 2, nameY, {
        size: 17,
        weight: "bold",
        color: PALETTE.text,
        align: "center",
        maxWidth: cardW - 28,
      });

      const roleLabel = row.roleLabel || view.trackRoleName || "Activity";
      text(ctx, roleLabel, spot.x + cardW / 2, nameY + 24, {
        size: 13,
        color: PALETTE.blurple,
        align: "center",
        maxWidth: cardW - 28,
      });

      text(
        ctx,
        `${row.cleanPoints} pts · ${row.progressLabel}`,
        spot.x + cardW / 2,
        spot.y + spot.h - 22,
        {
          size: 13,
          color: PALETTE.muted,
          align: "center",
          maxWidth: cardW - 28,
        }
      );
    }
  }

  let y = view.podium.length ? 510 : 170;
  text(ctx, "LEADERBOARD", 44, y, { size: 14, weight: "bold", color: PALETTE.muted });
  y += 24;

  if (!view.rows.length) {
    text(ctx, "No tracked members yet. Set an activity track role in /setup.", 44, y + 30, {
      size: 18,
      color: PALETTE.soft,
    });
  } else {
    for (const row of view.rows.slice(0, 10)) {
      card(ctx, 44, y, W - 88, 64, { radius: 10, shadow: false });
      text(ctx, String(row.rank).padStart(2, "0"), 64, y + 40, {
        size: 18,
        weight: "bold",
        color: PALETTE.blurple,
      });
      const discordUrl = row.discordAvatarUrl || row.avatarUrl;
      const robloxUrl = row.robloxAvatarUrl || null;
      if (robloxUrl && discordUrl) {
        const dImg = await fetchAvatar(discordUrl);
        const rImg = await fetchAvatar(robloxUrl);
        drawSquareAvatar(ctx, dImg, 110, y + 10, 44, row.username[0] ?? "?", PALETTE.blurpleSoft, 10);
        drawSquareAvatar(ctx, rImg, 162, y + 10, 44, "R", "#00a2ff", 10);
        text(ctx, row.displayName || row.username, 222, y + 28, {
          size: 17,
          weight: "bold",
          color: PALETTE.text,
          maxWidth: 360,
        });
        text(ctx, row.progressLabel, 222, y + 50, {
          size: 13,
          color: PALETTE.muted,
          maxWidth: 360,
        });
      } else {
        const img = await fetchAvatar(row.avatarUrl);
        drawSquareAvatar(ctx, img, 110, y + 10, 44, row.username[0] ?? "?", PALETTE.blurpleSoft, 10);
        text(ctx, row.displayName || row.username, 172, y + 28, {
          size: 17,
          weight: "bold",
          color: PALETTE.text,
          maxWidth: 400,
        });
        text(ctx, row.progressLabel, 172, y + 50, {
          size: 13,
          color: PALETTE.muted,
          maxWidth: 400,
        });
      }
      text(ctx, `${row.cleanPoints} pts`, W - 64, y + 28, {
        size: 18,
        weight: "bold",
        color: PALETTE.text,
        align: "right",
      });
      text(
        ctx,
        row.lifetimeWarnings === 0 ? "clean record" : `${row.lifetimeWarnings} lifetime`,
        W - 64,
        y + 50,
        { size: 13, color: row.lifetimeWarnings === 0 ? PALETTE.green : PALETTE.muted, align: "right" }
      );
      y += 72;
    }
  }

  return toPng(rc.canvas);
}
