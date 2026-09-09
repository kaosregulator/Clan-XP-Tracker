/**
 * Member standing card — clean warnings / history / clean-points view used by
 * /warnings @user and the member self-serve hub.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawAvatar,
  pill,
  toPng,
  PALETTE,
} from "../theme";

export interface StandingWarningRow {
  id: number;
  reason: string;
  when: string;
  by: string;
  removed: boolean;
}

export interface StandingCardView {
  communityName: string;
  username: string;
  displayName: string;
  discordAvatarUrl: string | null;
  robloxAvatarUrl: string | null;
  robloxUsername: string | null;
  activeCount: number;
  lifetimeCount: number;
  cleanPoints: number;
  cleanRank: number | null;
  progressLabel: string;
  statusLabel: string;
  warnings: StandingWarningRow[];
  officerView: boolean;
}

export async function renderStandingCard(view: StandingCardView): Promise<Buffer> {
  const W = 1000;
  const warnRows = view.warnings.slice(0, 6);
  const H = Math.max(620, 360 + warnRows.length * 72 + 80);
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), 44, 44, {
    size: 15,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, view.officerView ? "Member standing" : "Your standing", 44, 84, {
    size: 34,
    weight: "bold",
    color: PALETTE.text,
  });

  // Dual avatars
  const discord = await fetchAvatar(view.discordAvatarUrl);
  const roblox = await fetchAvatar(view.robloxAvatarUrl);
  drawAvatar(ctx, discord, 44, 120, 110, view.username[0] ?? "?", PALETTE.blurpleSoft);
  if (roblox || view.robloxUsername) {
    drawAvatar(ctx, roblox, 170, 120, 110, "R", "#00a2ff");
    text(ctx, "Discord", 44, 250, { size: 13, color: PALETTE.muted });
    text(ctx, view.robloxUsername ? `Roblox · ${view.robloxUsername}` : "Roblox", 170, 250, {
      size: 13,
      color: PALETTE.muted,
      maxWidth: 200,
    });
  } else {
    text(ctx, "Discord avatar · link a Roblox face with /link", 44, 250, {
      size: 14,
      color: PALETTE.muted,
      maxWidth: 420,
    });
  }

  text(ctx, view.displayName || view.username, 320, 155, {
    size: 28,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: W - 360,
  });
  text(ctx, `@${view.username}`, 320, 190, { size: 18, color: PALETTE.soft });

  let px = 320;
  px +=
    pill(ctx, view.statusLabel, px, 210, {
      bg: view.activeCount ? "rgba(225,29,43,0.12)" : "rgba(46,158,87,0.14)",
      color: view.activeCount ? PALETTE.red : PALETTE.green,
      size: 15,
      height: 30,
    }) + 10;
  if (view.cleanRank != null) {
    pill(ctx, `Clean #${view.cleanRank}`, px, 210, {
      bg: "rgba(63,81,224,0.12)",
      color: PALETTE.blurple,
      size: 15,
      height: 30,
    });
  }

  // Stat tiles
  const stats: Array<[string, string]> = [
    ["Active", String(view.activeCount)],
    ["Lifetime", String(view.lifetimeCount)],
    ["Clean pts", String(view.cleanPoints)],
    ["Progress", view.progressLabel],
  ];
  let sx = 44;
  for (const [label, value] of stats) {
    card(ctx, sx, 280, 220, 86, { radius: 16, shadow: false });
    text(ctx, label.toUpperCase(), sx + 18, 310, {
      size: 13,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, value, sx + 18, 348, {
      size: 26,
      weight: "bold",
      color: PALETTE.text,
      maxWidth: 184,
    });
    sx += 236;
  }

  text(ctx, "WARNING HISTORY", 44, 406, {
    size: 14,
    weight: "bold",
    color: PALETTE.muted,
  });

  if (!warnRows.length) {
    card(ctx, 44, 430, W - 88, 90, { radius: 16, shadow: false });
    text(ctx, "No warnings on record — clean standing.", 68, 485, {
      size: 20,
      color: PALETTE.green,
    });
  } else {
    let y = 430;
    for (const w of warnRows) {
      card(ctx, 44, y, W - 88, 64, {
        radius: 14,
        shadow: false,
        fill: w.removed ? PALETTE.cardAlt : PALETTE.card,
      });
      text(ctx, `#${w.id}`, 64, y + 28, {
        size: 16,
        weight: "bold",
        color: w.removed ? PALETTE.muted : PALETTE.red,
      });
      text(ctx, w.reason, 120, y + 28, {
        size: 17,
        color: w.removed ? PALETTE.muted : PALETTE.text,
        maxWidth: W - 340,
      });
      text(ctx, `${w.when} · ${w.by}${w.removed ? " · removed" : ""}`, 120, y + 50, {
        size: 13,
        color: PALETTE.muted,
        maxWidth: W - 200,
      });
      y += 72;
    }
  }

  text(ctx, "Active warnings stay until cleared · lifetime history never resets", 44, H - 28, {
    size: 14,
    color: PALETTE.muted,
    maxWidth: W - 88,
  });

  return toPng(rc.canvas);
}
