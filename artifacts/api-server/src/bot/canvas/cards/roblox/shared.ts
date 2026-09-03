/**
 * Shared drawing helpers for Roblox Hub canvas cards.
 * Builds on the existing theme primitives — same brand surface, Roblox-accented ink.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  pill,
  fetchAvatar,
  drawAvatar,
  toPng,
  roundRectPath,
  wrapText,
  PALETTE,
  type RenderCanvas,
} from "../../theme";
import type { SKRSContext2D, Image } from "@napi-rs/canvas";

/** Roblox-adjacent accents that still sit on the existing light grunge surface. */
export const RBX = {
  blue: "#00a2ff",
  blueDeep: "#0074bd",
  green: "#2e9e57",
  red: "#e11d2b",
  amber: "#c9820a",
  panel: "#ffffff",
  panelAlt: "#f3f5fa",
  ink: PALETTE.text,
  soft: PALETTE.soft,
  muted: PALETTE.muted,
} as const;

export async function loadRemote(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  return fetchAvatar(url, 4000);
}

export function headerBar(
  ctx: SKRSContext2D,
  title: string,
  subtitle: string | null,
  width: number,
  pad = 40
) {
  text(ctx, "ROBLOX HUB", pad, 42, {
    size: 16,
    weight: "bold",
    color: RBX.blueDeep,
    maxWidth: width - pad * 2,
  });
  text(ctx, title, pad, 78, {
    size: 34,
    weight: "bold",
    color: RBX.ink,
    maxWidth: width - pad * 2,
  });
  if (subtitle) {
    text(ctx, subtitle, pad, 112, {
      size: 18,
      color: RBX.soft,
      maxWidth: width - pad * 2,
    });
  }
}

export function drawRoundedImage(
  ctx: SKRSContext2D,
  img: Image | null,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 18
) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  if (img) {
    // cover-fit
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = PALETTE.cardAlt;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function statTile(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string
) {
  card(ctx, x, y, w, h, { fill: RBX.panelAlt, shadow: false, radius: 14 });
  text(ctx, label.toUpperCase(), x + 16, y + 28, {
    size: 13,
    weight: "bold",
    color: RBX.muted,
    maxWidth: w - 32,
  });
  text(ctx, value, x + 16, y + 58, {
    size: 26,
    weight: "bold",
    color: RBX.ink,
    maxWidth: w - 32,
  });
}

export function presencePill(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  kind: 0 | 1 | 2 | 3
): number {
  const colors: Record<number, { bg: string; fg: string }> = {
    0: { bg: "rgba(225,29,43,0.12)", fg: RBX.red },
    1: { bg: "rgba(46,158,87,0.14)", fg: RBX.green },
    2: { bg: "rgba(0,162,255,0.14)", fg: RBX.blueDeep },
    3: { bg: "rgba(201,130,10,0.16)", fg: RBX.amber },
  };
  const c = colors[kind] ?? colors[0]!;
  return pill(ctx, label, x, y, { bg: c.bg, color: c.fg, size: 16, height: 32, padX: 14 });
}

export function footerNote(ctx: SKRSContext2D, width: number, height: number, note: string) {
  text(ctx, note, 40, height - 24, {
    size: 14,
    color: RBX.muted,
    maxWidth: width - 80,
  });
}

export {
  createSurface,
  paintBackground,
  card,
  text,
  pill,
  drawAvatar,
  toPng,
  wrapText,
  PALETTE,
  roundRectPath,
};
export type { RenderCanvas, SKRSContext2D, Image };
