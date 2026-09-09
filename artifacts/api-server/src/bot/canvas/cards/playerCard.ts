/**
 * Tactical Player Card — game-style clan player profile.
 * Dark command HUD inspired by the clan player-manager mockup.
 * Keeps the light member-editor card intact as a separate Command Center view.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  text,
  fetchAvatar,
  drawAvatar,
  toPng,
  roundRectPath,
} from "../theme";

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

export interface PlayerCardView {
  clanName: string;
  motto?: string;
  queueLabel: string;
  queueIndex: number;
  queueTotal: number;
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
  memberSinceLabel: string;
  lastActivityLabel: string;
  /** Staff-logged activity totals shown as one breakdown (not separate cards). */
  activityRows: Array<{ emoji: string; name: string; points: number }>;
  warningRows: Array<{ label: string; count: number }>;
}

function panel(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 14
) {
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

export async function renderPlayerCard(view: PlayerCardView): Promise<Buffer> {
  const W = 1100;
  const H = 900;
  const rc = createSurface(W, H);
  const { ctx, canvas } = rc;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, HUD.bg0);
  bg.addColorStop(0.55, HUD.bg1);
  bg.addColorStop(1, "#0a1628");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const bloom = ctx.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.42, 320);
  bloom.addColorStop(0, "rgba(62,203,255,0.18)");
  bloom.addColorStop(1, "rgba(62,203,255,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  text(ctx, view.clanName.toUpperCase(), 44, 40, {
    size: 13,
    weight: "bold",
    color: HUD.muted,
  });
  text(ctx, view.displayName || view.username, 44, 78, {
    size: 34,
    weight: "bold",
    color: HUD.text,
    maxWidth: 520,
  });
  text(ctx, `@${view.username}  ·  CLAN PLAYER`, 44, 108, {
    size: 15,
    color: HUD.soft,
  });

  const standingColor =
    view.standing === "Good Standing"
      ? HUD.green
      : view.standing === "Warned"
        ? HUD.red
        : view.standing === "Needs Attention"
          ? HUD.amber
          : HUD.cyan;
  text(ctx, `● ${view.standing.toUpperCase()}`, W - 44, 70, {
    size: 16,
    weight: "bold",
    color: standingColor,
    align: "right",
  });
  text(ctx, view.motto || "STRONGER TOGETHER", W - 44, 98, {
    size: 13,
    color: HUD.muted,
    align: "right",
  });

  const queueText =
    view.queueTotal > 0
      ? `${view.queueLabel}  ·  ${view.queueIndex + 1} of ${view.queueTotal}`
      : view.queueLabel;
  text(ctx, queueText, W / 2, 40, {
    size: 13,
    weight: "bold",
    color: HUD.cyan,
    align: "center",
  });

  const leftX = 44;
  panel(ctx, leftX, 140, 260, 100);
  text(ctx, "CLAN RANK", leftX + 20, 168, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, view.rankTitle.toUpperCase(), leftX + 20, 205, {
    size: 26,
    weight: "bold",
    color: HUD.gold,
  });
  text(ctx, `Level ${view.level}`, leftX + 20, 230, { size: 14, color: HUD.soft });

  panel(ctx, leftX, 256, 260, 100);
  text(ctx, "CLAN STANDING", leftX + 20, 284, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, view.standing.toUpperCase(), leftX + 20, 320, {
    size: 20,
    weight: "bold",
    color: standingColor,
    maxWidth: 220,
  });
  text(ctx, view.standingHint, leftX + 20, 346, {
    size: 13,
    color: HUD.soft,
    maxWidth: 220,
  });

  panel(ctx, leftX, 372, 260, 100);
  text(ctx, "MEMBER SINCE", leftX + 20, 400, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, view.memberSinceLabel, leftX + 20, 438, {
    size: 22,
    weight: "bold",
    color: HUD.text,
  });
  text(ctx, `Last activity ${view.lastActivityLabel}`, leftX + 20, 464, {
    size: 13,
    color: HUD.soft,
    maxWidth: 220,
  });

  const rightX = W - 44 - 260;
  panel(ctx, rightX, 140, 260, 100);
  text(ctx, "ROBLOX", rightX + 20, 168, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, view.robloxUsername ? view.robloxUsername : "Not linked", rightX + 20, 205, {
    size: 20,
    weight: "bold",
    color: HUD.text,
    maxWidth: 220,
  });
  text(ctx, view.robloxLinked ? "● LINKED" : "○ UNLINKED", rightX + 20, 232, {
    size: 14,
    weight: "bold",
    color: view.robloxLinked ? HUD.green : HUD.muted,
  });

  panel(ctx, rightX, 256, 260, 100);
  text(ctx, "COMBAT SUPPORT", rightX + 20, 284, {
    size: 12,
    weight: "bold",
    color: HUD.muted,
  });
  text(ctx, String(view.combatSupportCount), rightX + 20, 326, {
    size: 34,
    weight: "bold",
    family: "mono",
    color: HUD.cyan,
  });
  text(
    ctx,
    view.hasCombatSupportRole ? "Role active · participations" : "Participations logged",
    rightX + 20,
    354,
    { size: 13, color: HUD.soft, maxWidth: 220 }
  );

  panel(ctx, rightX, 372, 260, 100);
  text(ctx, "WARNINGS", rightX + 20, 400, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, `${view.activeWarnings} / ${view.warningCap}`, rightX + 20, 438, {
    size: 28,
    weight: "bold",
    family: "mono",
    color: view.activeWarnings > 0 ? HUD.red : HUD.green,
  });
  text(ctx, "Active / threshold", rightX + 20, 464, { size: 13, color: HUD.soft });

  const discord = await fetchAvatar(view.discordAvatarUrl);
  const roblox = await fetchAvatar(view.robloxAvatarUrl);
  const initial = (view.displayName || view.username || "?").slice(0, 1).toUpperCase();
  const centerX = W / 2;
  if (view.robloxLinked || roblox) {
    drawAvatar(ctx, roblox, centerX - 90, 150, 180, "R", HUD.cyan);
    drawAvatar(ctx, discord, centerX + 55, 280, 78, initial, "#5865F2");
    text(ctx, "Roblox", centerX, 348, {
      size: 13,
      color: HUD.muted,
      align: "center",
    });
  } else {
    drawAvatar(ctx, discord, centerX - 90, 160, 180, initial, "#5865F2");
    text(ctx, "Discord · link Roblox with /link", centerX, 360, {
      size: 14,
      color: HUD.muted,
      align: "center",
    });
  }

  panel(ctx, 44, 500, 480, 96, 16);
  text(ctx, "PROGRESSION XP", 64, 528, { size: 12, weight: "bold", color: HUD.muted });
  text(ctx, view.xpLabel, 64, 558, {
    size: 22,
    weight: "bold",
    family: "mono",
    color: HUD.cyan,
  });
  fillBar(ctx, 64, 572, 420, 12, view.xpPct, HUD.cyan);

  panel(ctx, W - 44 - 480, 500, 480, 96, 16);
  text(ctx, "WEEKLY ACTIVITY", W - 44 - 460, 528, {
    size: 12,
    weight: "bold",
    color: HUD.muted,
  });
  text(ctx, view.weeklyActivityLabel, W - 44 - 460, 558, {
    size: 20,
    weight: "bold",
    color: view.weeklyActivityDone ? HUD.green : HUD.amber,
    maxWidth: 400,
  });
  fillBar(
    ctx,
    W - 44 - 460,
    572,
    420,
    12,
    view.weeklyActivityPct,
    view.weeklyActivityDone ? HUD.green : HUD.amber
  );

  const stats: Array<[string, string, string]> = [
    ["CLAN POINTS", String(view.clanPoints), HUD.cyan],
    ["CLEAN PTS", String(view.cleanPoints), HUD.gold],
    ["DISPUTES", String(view.openDisputes), view.openDisputes ? HUD.amber : HUD.soft],
    ["SUPPORT", String(view.combatSupportCount), HUD.cyan],
    ["LEVEL", String(view.level), HUD.gold],
  ];
  const tileW = 190;
  let sx = 44;
  for (const [label, value, color] of stats) {
    panel(ctx, sx, 620, tileW, 88, 14);
    text(ctx, label, sx + 16, 648, { size: 12, weight: "bold", color: HUD.muted });
    text(ctx, value, sx + 16, 688, {
      size: 28,
      weight: "bold",
      family: "mono",
      color,
    });
    sx += tileW + 14;
  }

  
  // ACTIVITY breakdown — one section, not a card per category.
  const actY = H - 250;
  panel(ctx, 44, actY, W - 88, 150, 16);
  text(ctx, "ACTIVITY", 64, actY + 28, { size: 12, weight: "bold", color: HUD.muted });
  const rows = (view.activityRows ?? []).filter((r) => r.points > 0).slice(0, 8);
  if (!rows.length) {
    text(ctx, "No staff-logged activity yet", 64, actY + 70, { size: 16, color: HUD.soft });
  } else {
    const colW = (W - 120) / 2;
    rows.forEach((r, i) => {
      const col = i < 4 ? 0 : 1;
      const row = i % 4;
      const x = 64 + col * colW;
      const y = actY + 58 + row * 22;
      text(ctx, `${r.emoji} ${r.name}`, x, y, { size: 15, color: HUD.text, maxWidth: colW - 80 });
      text(ctx, String(r.points), x + colW - 70, y, { size: 15, weight: "bold", family: "mono", color: HUD.cyan });
    });
  }

  const warnRows = (view.warningRows ?? []).filter((r) => r.count > 0).slice(0, 4);
  if (warnRows.length) {
    text(ctx, "WARNINGS BY CATEGORY", W / 2, actY + 28, {
      size: 12,
      weight: "bold",
      color: HUD.muted,
      align: "center",
    });
  }

text(ctx, "DISCIPLINE  ·  UNITY  ·  VICTORY", W / 2, H - 28, {
    size: 13,
    weight: "bold",
    color: HUD.muted,
    align: "center",
  });

  return toPng(canvas);
}
