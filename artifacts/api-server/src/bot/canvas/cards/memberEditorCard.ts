/**
 * Clan Command Center — member editor card.
 * One clean player-stat surface at a time (no @mention spam lists).
 * Dual Discord + Roblox faces when linked, progress %, clean pts, warnings.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawAvatar,
  pill,
  progressBar,
  toPng,
  PALETTE,
  horizontalGradient,
} from "../theme";

export interface MemberEditorCardView {
  communityName: string;
  queueLabel: string;
  queueIndex: number;
  queueTotal: number;
  username: string;
  displayName: string;
  discordAvatarUrl: string | null;
  robloxAvatarUrl: string | null;
  robloxUsername: string | null;
  statusLabel: string;
  progressPct: number;
  progressLabel: string;
  cleanPoints: number;
  cleanRank: number | null;
  activeWarnings: number;
  lifetimeWarnings: number;
  weekReminders: number;
  notesPreview: string | null;
}

export async function renderMemberEditorCard(view: MemberEditorCardView): Promise<Buffer> {
  const W = 1000;
  const H = 720;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), 44, 42, {
    size: 14,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "Command Center", 44, 78, {
    size: 34,
    weight: "bold",
    color: PALETTE.text,
  });
  text(ctx, "Member editor", 44, 108, { size: 16, color: PALETTE.soft });

  const queueText =
    view.queueTotal > 0
      ? `${view.queueLabel}  ·  ${view.queueIndex + 1} of ${view.queueTotal}`
      : `${view.queueLabel}  ·  empty`;
  const chipW = Math.min(440, Math.max(180, queueText.length * 8.2 + 28));
  const chipX = W - 44 - chipW;
  ctx.beginPath();
  ctx.roundRect(chipX, 48, chipW, 32, 16);
  ctx.fillStyle = "rgba(63,81,224,0.12)";
  ctx.fill();
  text(ctx, queueText, chipX + chipW / 2, 64, {
    size: 14,
    weight: "bold",
    color: PALETTE.blurple,
    align: "center",
    baseline: "middle",
    maxWidth: chipW - 16,
  });

  card(ctx, 44, 140, W - 88, 520, { radius: 24 });

  const discord = await fetchAvatar(view.discordAvatarUrl);
  const roblox = await fetchAvatar(view.robloxAvatarUrl);
  const initial = (view.displayName || view.username || "?").slice(0, 1).toUpperCase();
  const hasRoblox = Boolean(roblox || view.robloxUsername);

  drawAvatar(ctx, discord, 80, 176, 128, initial, PALETTE.blurpleSoft);
  if (hasRoblox) {
    drawAvatar(ctx, roblox, 232, 176, 128, "R", "#00a2ff");
    text(ctx, "Discord", 80, 322, { size: 13, color: PALETTE.muted });
    text(ctx, view.robloxUsername ? `Roblox · ${view.robloxUsername}` : "Roblox", 232, 322, {
      size: 13,
      color: PALETTE.muted,
      maxWidth: 160,
    });
  } else {
    text(ctx, "Discord  ·  link Roblox with /link to show both faces", 80, 322, {
      size: 14,
      color: PALETTE.muted,
      maxWidth: 360,
    });
  }

  const nameX = hasRoblox ? 400 : 240;
  text(ctx, view.displayName || view.username, nameX, 210, {
    size: 32,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: W - nameX - 80,
  });
  text(ctx, `@${view.username}`, nameX, 246, { size: 18, color: PALETTE.soft });

  let px = nameX;
  px +=
    pill(ctx, view.statusLabel, px, 268, {
      bg: view.activeWarnings
        ? "rgba(225,29,43,0.12)"
        : view.progressPct >= 100
          ? "rgba(46,158,87,0.14)"
          : "rgba(201,130,10,0.14)",
      color: view.activeWarnings
        ? PALETTE.red
        : view.progressPct >= 100
          ? PALETTE.green
          : PALETTE.amber,
      size: 14,
      height: 28,
    }) + 10;
  if (view.cleanRank != null) {
    pill(ctx, `Clean #${view.cleanRank}`, px, 268, {
      bg: "rgba(63,81,224,0.12)",
      color: PALETTE.blurple,
      size: 14,
      height: 28,
    });
  }

  const pct = Math.max(0, Math.min(100, Math.round(view.progressPct)));
  const accent =
    pct >= 100 ? PALETTE.greenBright : pct >= 50 ? PALETTE.amber : PALETTE.red;
  text(ctx, "PERIOD PROGRESS", 80, 370, {
    size: 13,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, `${pct}%`, 80, 430, {
    size: 56,
    weight: "bold",
    family: "mono",
    color: accent,
  });
  text(ctx, view.progressLabel, 220, 420, {
    size: 20,
    color: PALETTE.soft,
    maxWidth: 400,
  });
  progressBar(ctx, 80, 460, W - 204, 16, pct / 100, {
    fill: horizontalGradient(ctx, 80, 0, W - 204, [
      [0, accent],
      [1, accent],
    ]),
  });

  const stats: Array<[string, string, string]> = [
    ["Clean pts", String(view.cleanPoints), PALETTE.blurple],
    ["Active warns", String(view.activeWarnings), view.activeWarnings ? PALETTE.red : PALETTE.green],
    ["Lifetime", String(view.lifetimeWarnings), PALETTE.soft],
    ["Reminders", String(view.weekReminders), PALETTE.amber],
  ];
  let sx = 80;
  for (const [label, value, color] of stats) {
    card(ctx, sx, 500, 200, 100, { radius: 16, shadow: false });
    text(ctx, label.toUpperCase(), sx + 18, 528, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, value, sx + 18, 576, {
      size: 34,
      weight: "bold",
      family: "mono",
      color,
    });
    sx += 216;
  }

  text(
    ctx,
    view.notesPreview
      ? `Note · ${view.notesPreview}`
      : "Use ◀ ▶ to browse · actions below edit this member",
    80,
    630,
    { size: 14, color: PALETTE.muted, maxWidth: W - 160 }
  );

  card(ctx, 44, H - 48, W - 88, 36, { radius: 12, shadow: false });
  text(
    ctx,
    "No @mention lists  ·  one clean profile at a time  ·  Roblox face shows when linked",
    W / 2,
    H - 30,
    {
      size: 13,
      color: PALETTE.muted,
      align: "center",
      baseline: "middle",
    }
  );

  return toPng(rc.canvas);
}
