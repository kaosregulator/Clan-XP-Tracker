import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  createCanvas,
  loadImage,
  type SKRSContext2D,
  type Canvas,
  type Image,
} from "@napi-rs/canvas";
import { ensureFonts, font, sanitizeText } from "./fonts";
import { logger } from "../../lib/logger";

// The runtime is Node (no DOM lib), so alias the few canvas value/enum types
// we reference instead of relying on the ambient DOM globals.
type Baseline = "top" | "hanging" | "middle" | "alphabetic" | "ideographic" | "bottom";
type Gradient = ReturnType<SKRSContext2D["createLinearGradient"]>;

/**
 * Shared visual language for every canvas surface. One palette, one set of
 * primitives — so the member hub, admin hub, profile and dashboards all read
 * as the same polished application.
 */
// Light "grunge white" theme — one palette shared by every card. The panels
// (cards/tiles) sit as clean light surfaces on the brand texture, with dark ink
// text and accents darkened just enough to stay legible on white.
export const PALETTE = {
  bg0: "#dfe3ec", // deepest tone (gradient fallbacks)
  bg1: "#eef1f6", // tile fill
  card: "#ffffff", // main panel
  cardAlt: "#e7eaf1", // progress track / secondary fill
  border: "#d3d8e4",
  borderSoft: "#e3e7f0",
  text: "#14161f", // ink
  soft: "#454b5c", // secondary ink
  muted: "#7c8397", // tertiary / labels
  blurple: "#3f51e0",
  blurpleSoft: "#6f8bff",
  violet: "#8b3ff0",
  cyan: "#0e9cbb",
  green: "#2e9e57",
  greenBright: "#1fae63",
  amber: "#c9820a",
  red: "#e11d2b",
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

/**
 * Encode the canvas to PNG *asynchronously*. `encode` runs the (CPU-heavy)
 * compression on the libuv thread pool instead of the main thread, so rendering
 * a card never blocks the event loop / stalls other interactions.
 */
export function toPng(canvas: Canvas): Promise<Buffer> {
  return canvas.encode("png");
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
  // Gaussian shadow blur is by far the most expensive canvas op; keep it small
  // and only where it matters. A tight, low-blur shadow reads as depth for a
  // fraction of the cost of the old 28px blur.
  ctx.save();
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.30)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 6;
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

/* -------------------------------------------------------------- background */

// The shared brand texture, loaded once per worker thread and reused for every
// card so a card render never touches the disk on the hot path.
let bgImage: Image | null = null;
let bgLoadAttempted = false;

/**
 * Load the standard background texture from disk (bundled under assets/). Call
 * once before rendering; safe to call repeatedly. The image is optional — if it
 * is ever missing we fall back to the painted gradient so a card still renders.
 */
export async function ensureBackgroundLoaded(): Promise<void> {
  if (bgLoadAttempted) return;
  bgLoadAttempted = true;
  const path = fileURLToPath(new URL("./assets/backgrounds/app-bg.jpg", import.meta.url));
  if (!existsSync(path)) {
    logger.warn({ path }, "Canvas background missing — using painted gradient");
    return;
  }
  try {
    bgImage = await loadImage(await readFile(path));
  } catch (err) {
    logger.warn({ err, path }, "Canvas background failed to decode — using painted gradient");
  }
}

/** Draw an image cover-fit (fill the box, centre-cropping the overflow). */
export function drawCover(
  ctx: SKRSContext2D,
  img: Image,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * Paint the brand texture as a *light* surface — the grunge shows through
 * directly with only a soft white wash so the dark ink text and clean panels
 * stay crisp. `wash` lets a caller calm the texture down a touch (dashboards
 * carry more text than the enforcement cards). Falls back to a light gradient
 * when the texture is unavailable.
 */
export function paintPhotoSurface(rc: RenderCanvas, wash = 0.55) {
  const { ctx, width, height } = rc;
  if (bgImage) {
    drawCover(ctx, bgImage, 0, 0, width, height);
    ctx.fillStyle = `rgba(244,245,248,${wash})`;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = verticalGradient(ctx, 0, 0, height, [
      [0, "#f4f5f8"],
      [1, "#e9ebf1"],
    ]);
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * The standard app background: the grunge-white brand texture behind every
 * card. Dashboards carry a lot of text, so the texture gets a slightly stronger
 * wash than the enforcement cards, plus a soft light bloom at the top for depth.
 */
export function paintBackground(rc: RenderCanvas) {
  const { ctx, width, height } = rc;
  paintPhotoSurface(rc, 0.66);
  const glow = ctx.createRadialGradient(width * 0.18, -60, 0, width * 0.18, -60, width * 0.7);
  glow.addColorStop(0, "rgba(255,255,255,0.45)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
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
  const safe = sanitizeText(value);
  ctx.fillText(maxWidth ? ellipsize(ctx, safe, maxWidth) : safe, x, y);
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
  const { color = PALETTE.text, bg = "rgba(20,22,31,0.06)", size = 18, padX = 16, height = 34 } =
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

/**
 * Load a remote avatar with a small in-memory cache and a hard timeout, so a
 * slow CDN can never stall a hub render — we just fall back to the initial.
 */
export async function fetchAvatar(url: string | null, timeoutMs = 2500): Promise<Image | null> {
  if (!url) return null;
  const cached = avatarCache.get(url);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let img: Image;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      img = await loadImage(Buffer.from(await res.arrayBuffer()));
    } finally {
      clearTimeout(timer);
    }
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
  ring: string = PALETTE.blurple
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
    const initial = (sanitizeText(fallbackInitial).slice(0, 1) || "?").toUpperCase();
    text(ctx, initial, cx, cy, {
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
