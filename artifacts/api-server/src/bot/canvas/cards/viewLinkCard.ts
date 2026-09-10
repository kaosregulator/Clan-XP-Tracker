/**
 * Public /viewlink dashboard — top-3 podium strip + player profile.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  text,
  fetchAvatar,
  drawSquareAvatar,
  toPng,
  roundRectPath,
} from "../theme";
import type { LeaderboardRow } from "./leaderboardCard";

const HUD = {
  bg0: "#07111f",
  bg1: "#0c1a2e",
  panel: "#11243a",
  border: "#1e3f63",
  cyan: "#3ecbff",
  text: "#e8f4ff",
  soft: "#9db6cc",
  muted: "#6b849c",
  green: "#3dd68c",
  amber: "#f0b429",
  red: "#ff5a5f",
  gold: "#f5c542",
} as const;

export interface ViewLinkCardView {
  clanName: string;
  trackRoleName?: string | null;
  podium: LeaderboardRow[];
  // Focused player
  username: string;
  displayName: string;
  discordAvatarUrl: string | null;
  robloxAvatarUrl: string | null;
  robloxUsername: string | null;
  robloxLinked: boolean;
  rankTitle: string;
  standing: string;
  standingHint: string;
  level: number;
  xpLabel: string;
  xpPct: number;
  clanPoints: number;
  weeklyActivityLabel: string;
  weeklyActivityPct: number;
  weeklyActivityDone: boolean;
  combatSupportCount: number;
  hasCombatSupportRole: boolean;
  activeWarnings: number;
  warningCap: number;
  openDisputes: number;
  cleanPoints: number;
  cleanRank: number | null;
  discordJoinedLabel: string;
  serverJoinedLabel: string;
  trackedSinceLabel: string;
  lastActivityLabel: string;
  activityRows: Array<{ emoji: string; name: string; points: number }>;
  warningRows: Array<{ label: string; count: number }>;
}

function panel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, radius = 14) {
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = HUD.panel;
  ctx.fill();
  ctx.strokeStyle = HUD.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function fillBar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  fill: string
) {
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  const filled = Math.max(0, Math.min(1, pct / 100)) * w;
  if (filled > 1) {
    roundRectPath(ctx, x, y, filled, h, h / 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

async function dualFaces(
  ctx: SKRSContext2D,
  discordUrl: string | null,
  robloxUrl: string | null,
  username: string,
  cx: number,
  y: number,
  size: number
) {
  if (discordUrl && robloxUrl) {
    const d = await fetchAvatar(discordUrl);
    const r = await fetchAvatar(robloxUrl);
    drawSquareAvatar(ctx, d, cx - size - 6, y, size, username[0] ?? "?", HUD.cyan, 12);
    drawSquareAvatar(ctx, r, cx + 6, y, size, "R", "#00a2ff", 12);
  } else {
    const img = await fetchAvatar(discordUrl || robloxUrl);
    drawSquareAvatar(ctx, img, cx - size / 2, y, size, username[0] ?? "?", HUD.cyan, 12);
  }
}

export async function renderViewLinkCard(view: ViewLinkCardView): Promise<Buffer> {
  const W = 1100;
  const H = 1180;
  const rc = createSurface(W, H);
  const { ctx, canvas } = rc;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, HUD.bg0);
  bg.addColorStop(0.5, HUD.bg1);
  bg.addColorStop(1, "#0a1628");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  text(ctx, view.clanName.toUpperCase(), 44, 36, {
    size: 13,
    weight: "bold",
    color: HUD.muted,
  });
  text(ctx, "PLAYER LINK DASHBOARD", 44, 72, {
    size: 28,
    weight: "bold",
    color: HUD.text,
  });
  text(
    ctx,
    view.trackRoleName ? `Tracking role · ${view.trackRoleName}` : "Clan activity roster",
    44,
    100,
    { size: 14, color: HUD.soft }
  );

  // —— Top 3 podium strip ——
  text(ctx, "LEADERBOARD TOP 3", 44, 140, {
    size: 12,
    weight: "bold",
    color: HUD.cyan,
  });

  const cardW = 320;
  const spots = [
    { x: 44, y: 160, h: 168 },
    { x: 390, y: 150, h: 188 },
    { x: 736, y: 160, h: 168 },
  ];
  const order = [view.podium[1], view.podium[0], view.podium[2]];
  const ranks = [2, 1, 3];
  const rankColor = [HUD.cyan, HUD.gold, HUD.cyan];

  for (let i = 0; i < 3; i++) {
    const row = order[i];
    const spot = spots[i]!;
    panel(ctx, spot.x, spot.y, cardW, spot.h, 12);
    if (!row) {
      text(ctx, "—", spot.x + cardW / 2, spot.y + spot.h / 2, {
        size: 22,
        color: HUD.muted,
        align: "center",
      });
      continue;
    }
    text(ctx, `#${ranks[i]}`, spot.x + cardW / 2, spot.y + 26, {
      size: ranks[i] === 1 ? 22 : 18,
      weight: "bold",
      color: rankColor[i]!,
      align: "center",
    });
    const size = ranks[i] === 1 ? 52 : 44;
    await dualFaces(
      ctx,
      row.discordAvatarUrl || row.avatarUrl,
      row.robloxAvatarUrl || null,
      row.username,
      spot.x + cardW / 2,
      spot.y + 40,
      size
    );
    text(ctx, row.displayName || row.username, spot.x + cardW / 2, spot.y + 40 + size + 24, {
      size: 15,
      weight: "bold",
      color: HUD.text,
      align: "center",
      maxWidth: cardW - 24,
    });
    text(
      ctx,
      `${row.cleanPoints} pts · ${row.progressLabel}`,
      spot.x + cardW / 2,
      spot.y + spot.h - 18,
      { size: 12, color: HUD.muted, align: "center", maxWidth: cardW - 24 }
    );
  }

  // —— Focused player ——
  let y = 370;
  panel(ctx, 44, y, W - 88, 220, 14);

  await dualFaces(
    ctx,
    view.discordAvatarUrl,
    view.robloxAvatarUrl,
    view.username,
    160,
    y + 36,
    72
  );

  text(ctx, view.displayName || view.username, 280, y + 50, {
    size: 28,
    weight: "bold",
    color: HUD.text,
    maxWidth: 520,
  });
  text(
    ctx,
    `@${view.username}${view.robloxUsername ? `  ·  Roblox ${view.robloxUsername}` : view.robloxLinked ? "  ·  Roblox linked" : ""}`,
    280,
    y + 82,
    { size: 14, color: HUD.soft, maxWidth: 520 }
  );

  const standingColor =
    view.standing === "Good Standing"
      ? HUD.green
      : view.standing === "Warned"
        ? HUD.red
        : view.standing === "Needs Attention"
          ? HUD.amber
          : HUD.cyan;
  text(ctx, view.standing.toUpperCase(), W - 64, y + 50, {
    size: 15,
    weight: "bold",
    color: standingColor,
    align: "right",
  });
  text(ctx, view.standingHint, W - 64, y + 74, {
    size: 12,
    color: HUD.muted,
    align: "right",
    maxWidth: 280,
  });

  text(ctx, `Discord joined  ${view.discordJoinedLabel}`, 280, y + 120, {
    size: 14,
    color: HUD.soft,
  });
  text(ctx, `Server joined  ${view.serverJoinedLabel}`, 280, y + 146, {
    size: 14,
    color: HUD.soft,
  });
  text(ctx, `Tracked since  ${view.trackedSinceLabel}`, 280, y + 172, {
    size: 14,
    color: HUD.soft,
  });
  if (view.cleanRank) {
    text(ctx, `Board rank #${view.cleanRank}`, 280, y + 198, {
      size: 14,
      weight: "bold",
      color: HUD.gold,
    });
  }

  // —— Stats grid ——
  y = 620;
  const cells: Array<{ label: string; value: string; sub?: string }> = [
    { label: "CLAN RANK", value: view.rankTitle.toUpperCase(), sub: `Level ${view.level}` },
    { label: "CLAN POINTS", value: view.clanPoints.toLocaleString() },
    {
      label: "ACTIVITY",
      value: view.weeklyActivityLabel,
      sub: view.weeklyActivityDone ? "Complete" : `${view.weeklyActivityPct}%`,
    },
    {
      label: "COMBAT SUPPORT",
      value: String(view.combatSupportCount),
      sub: view.hasCombatSupportRole ? "Role active" : undefined,
    },
    {
      label: "WARNINGS",
      value: `${view.activeWarnings} / ${view.warningCap}`,
      sub: view.openDisputes ? `${view.openDisputes} open dispute(s)` : "No open disputes",
    },
    { label: "CLEAN POINTS", value: String(view.cleanPoints) },
  ];

  const cellW = 320;
  const cellH = 100;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 44 + col * (cellW + 16);
    const cy = y + row * (cellH + 14);
    panel(ctx, x, cy, cellW, cellH, 12);
    text(ctx, c.label, x + 18, cy + 28, { size: 11, weight: "bold", color: HUD.muted });
    text(ctx, c.value, x + 18, cy + 58, {
      size: 22,
      weight: "bold",
      color: HUD.text,
      maxWidth: cellW - 36,
    });
    if (c.sub) {
      text(ctx, c.sub, x + 18, cy + 82, { size: 13, color: HUD.soft, maxWidth: cellW - 36 });
    }
  }

  // Progression bar
  y = 860;
  panel(ctx, 44, y, W - 88, 90, 12);
  text(ctx, "PROGRESSION", 64, y + 28, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, view.xpLabel, W - 64, y + 28, {
    size: 13,
    color: HUD.soft,
    align: "right",
  });
  fillBar(ctx, 64, y + 48, W - 128, 18, view.xpPct, HUD.cyan);
  text(ctx, `Last activity · ${view.lastActivityLabel}`, 64, y + 78, {
    size: 13,
    color: HUD.muted,
  });

  // Activity / warning breakdowns
  y = 970;
  panel(ctx, 44, y, 500, 170, 12);
  text(ctx, "ACTIVITY LOG", 64, y + 28, { size: 12, weight: "bold", color: HUD.muted });
  if (!view.activityRows.length) {
    text(ctx, "No staff-logged activity yet.", 64, y + 70, { size: 14, color: HUD.soft });
  } else {
    let ay = y + 54;
    for (const r of view.activityRows.slice(0, 4)) {
      text(ctx, `${r.emoji} ${r.name}`, 64, ay, { size: 14, color: HUD.text, maxWidth: 320 });
      text(ctx, `${r.points} pts`, 500, ay, { size: 14, color: HUD.cyan, align: "right" });
      ay += 26;
    }
  }

  panel(ctx, 560, y, 496, 170, 12);
  text(ctx, "WARNING CATEGORIES", 580, y + 28, { size: 12, weight: "bold", color: HUD.muted });
  if (!view.warningRows.length) {
    text(ctx, "Clean — no category hits.", 580, y + 70, { size: 14, color: HUD.green });
  } else {
    let wy = y + 54;
    for (const r of view.warningRows.slice(0, 4)) {
      text(ctx, r.label, 580, wy, { size: 14, color: HUD.text, maxWidth: 320 });
      text(ctx, String(r.count), 1020, wy, { size: 14, color: HUD.amber, align: "right" });
      wy += 26;
    }
  }

  return toPng(canvas);
}
