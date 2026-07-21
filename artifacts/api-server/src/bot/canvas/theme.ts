import {
  createCanvas,
  loadImage,
  type SKRSContext2D,
  type Canvas,
  type Image,
} from "@napi-rs/canvas";
import { ensureFonts, font } from "./fonts";

// The runtime is Node (no DOM lib), so alias the few canvas value/enum types
// we reference instead of relying on the ambient DOM globals.
type Baseline = "top" | "hanging" | "middle" | "alphabetic" | "ideographic" | "bottom";
type Gradient = ReturnType<SKRSContext2D["createLinearGradient"]>;

/**
 * Shared visual language for every canvas surface. One palette, one set of
 * primitives — so the member hub, admin hub, profile and dashboards all read
 * as the same polished application.
 */
export const PALETTE = {
  bg0: "#0b0e17",
  bg1: "#131826",
  card: "#171d2e",
  cardAlt: "#1d2540",
  border: "#2a3450",
  borderSoft: "#212a44",
  text: "#f3f5fb",
  soft: "#aeb7d4",
  muted: "#6b7490",
  blurple: "#5865f2",
  blurpleSoft: "#7c86f6",
  violet: "#a855f7",
  cyan: "#22d3ee",
  green: "#3ba55d",
  greenBright: "#57f287",
  amber: "#faa61a",
  red: "#ed4245",
} as const;

export type RGB = string;

export interface RenderCanvas {
  canvas: Canvas;
  ctx: SKRSContext2D;
  width: number;
  height: number;
}

/** Create a canvas with fonts guaranteed to be registered. */
export function createSurface(width: number, height: number): RenderCanvas {
  ensureFonts();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  return { canvas, ctx, width, height };
}

export function toPng(canvas: Canvas): Buffer {
  return canvas.toBuffer("image/png");
}

/* ------------------------------------------------------------------ shapes */

export function roundRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export interface CardOptions {
  fill?: string;
  stroke?: string;
  radius?: number;
  shadow?: boolean;
}

/** A rounded surface card with optional soft shadow + border. */
export function card(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: CardOptions = {}
) {
  const { fill = PALETTE.card, stroke = PALETTE.border, radius = 22, shadow = true } = opts;
  ctx.save();
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
  }
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  if (stroke) {
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Vertical gradient fill helper. */
export function verticalGradient(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  h: number,
  stops: [number, string][]
) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  return g;
}

export function horizontalGradient(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  stops: [number, string][]
) {
  const g = ctx.createLinearGradient(x, y, x + w, y);
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  return g;
}

/** Paint the standard app background. */
export function paintBackground(rc: RenderCanvas) {
  const { ctx, width, height } = rc;
  ctx.fillStyle = verticalGradient(ctx, 0, 0, height, [
    [0, PALETTE.bg1],
    [1, PALETTE.bg0],
  ]);
  ctx.fillRect(0, 0, width, height);

  // Soft accent glow in the top-left for depth.
  const glow = ctx.createRadialGradient(width * 0.18, -60, 0, width * 0.18, -60, width * 0.7);
  glow.addColorStop(0, "rgba(88,101,242,0.20)");
  glow.addColorStop(1, "rgba(88,101,242,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

/* -------------------------------------------------------------- text utils */

export interface TextOptions {
  size?: number;
  weight?: "regular" | "bold";
  family?: "display" | "body" | "mono";
  color?: string;
  align?: "left" | "center" | "right";
  baseline?: Baseline;
  maxWidth?: number;
  letterSpacing?: number;
}

export function text(
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  opts: TextOptions = {}
) {
  const {
    size = 24,
    weight = "regular",
    family = "display",
    color = PALETTE.text,
    align = "left",
    baseline = "alphabetic",
    maxWidth,
  } = opts;
  ctx.font = font(size, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(maxWidth ? ellipsize(ctx, value, maxWidth) : value, x, y);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export function ellipsize(ctx: SKRSContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let str = value;
  while (str.length > 1 && ctx.measureText(str + "…").width > maxWidth) {
    str = str.slice(0, -1);
  }
  return str + "…";
}

/** Wrap text to a width, returning the lines. */
export function wrapText(
  ctx: SKRSContext2D,
  value: string,
  maxWidth: number,
  maxLines = 3
): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (ctx.measureText(attempt).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const last = lines[maxLines - 1];
  if (last && lines.length === maxLines) lines[maxLines - 1] = ellipsize(ctx, last, maxWidth);
  return lines;
}

/* ------------------------------------------------------------------ pieces */

export interface ProgressOptions {
  radius?: number;
  track?: string;
  fill?: string | Gradient;
  glow?: boolean;
}

/** Horizontal progress bar, value 0..1. */
export function progressBar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  opts: ProgressOptions = {}
) {
  const v = Math.max(0, Math.min(1, value));
  const { radius = h / 2, track = PALETTE.cardAlt } = opts;
  const fill =
    opts.fill ??
    horizontalGradient(ctx, x, y, w, [
      [0, PALETTE.blurple],
      [1, PALETTE.violet],
    ]);
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = track;
  ctx.fill();
  if (v > 0) {
    const fw = Math.max(h, w * v);
    ctx.save();
    roundRectPath(ctx, x, y, fw, h, radius);
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, fw, h);
    ctx.restore();
  }
}

/** A rounded pill (status chip) with text. Returns its width. */
export function pill(
  ctx: SKRSContext2D,
  label: string,
  x: number,
  y: number,
  opts: { color?: string; bg?: string; size?: number; padX?: number; height?: number } = {}
): number {
  const { color = PALETTE.text, bg = "rgba(255,255,255,0.06)", size = 18, padX = 16, height = 34 } =
    opts;
  ctx.font = font(size, "bold", "display");
  const tw = ctx.measureText(label).width;
  const w = tw + padX * 2;
  roundRectPath(ctx, x, y, w, height, height / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, label, x + w / 2, y + height / 2, {
    size,
    weight: "bold",
    color,
    align: "center",
    baseline: "middle",
  });
  return w;
}

/* ----------------------------------------------------------------- avatars */

const avatarCache = new Map<string, Image>();

/** Load a remote (or fallback) avatar with a small in-memory cache. */
export async function fetchAvatar(url: string | null): Promise<Image | null> {
  if (!url) return null;
  const cached = avatarCache.get(url);
  if (cached) return cached;
  try {
    const img = await loadImage(url);
    if (avatarCache.size > 200) avatarCache.clear();
    avatarCache.set(url, img);
    return img;
  } catch {
    return null;
  }
}

/** Draw a circular avatar with a subtle ring. Falls back to an initial. */
export function drawAvatar(
  ctx: SKRSContext2D,
  img: Image | null,
  x: number,
  y: number,
  size: number,
  fallbackInitial = "?",
  ring = PALETTE.blurple
) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = PALETTE.cardAlt;
    ctx.fillRect(x, y, size, size);
    text(ctx, fallbackInitial.slice(0, 1).toUpperCase(), cx, cy, {
      size: size * 0.42,
      weight: "bold",
      color: PALETTE.soft,
      align: "center",
      baseline: "middle",
    });
  }
  ctx.restore();
  // ring
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();
}
