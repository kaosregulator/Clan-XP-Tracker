import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  createSurface,
  paintPhotoSurface,
  roundRectPath,
  fetchAvatar,
  drawAvatar,
  toPng,
} from "../theme";
import { font, sanitizeText } from "../fonts";

/**
 * The two enforcement cards — an XP warning (red) and an XP reminder (blue) —
 * that post into the configured channel with the member's avatar. They share a
 * light-textured "card" look on the brand background, distinct from the app's
 * dark dashboards so a warning/reminder reads as a deliberate callout.
 */

export interface EnforcementCardView {
  /** Community name, upper-cased into the footer ("KEEP DARKNIGHT STRONG"). */
  communityName: string;
  /** Display name shown under the avatar; an "@" is added if missing. */
  memberName: string;
  avatarUrl: string | null;
  /** Optional custom body copy; falls back to the standard message. */
  message?: string | null;
  /** Configured tracking period adjective ("daily" / "weekly") for default copy. */
  periodLabel?: string;
}

export interface WarningCardView extends EnforcementCardView {
  /**
   * Optional legacy staff badge fields. Member-facing renders ignore these —
   * warning count and escalation threshold must never appear on the card.
   */
  count?: number;
  threshold?: number;
}

/* Light-card palette, local to the enforcement cards. */
export const LIGHT = {
  ink: "#14161f",
  inkSoft: "#3b4150",
  muted: "#7a8195",
  hairline: "rgba(20,22,31,0.14)",
  red: "#e11d2b",
  redSoft: "#ff5a63",
  blue: "#2f6bff",
  blueSoft: "#6f9bff",
} as const;

const W = 1200;
const H = 916;

export interface Seg {
  t: string;
  color: string;
  bold?: boolean;
}

function segFont(size: number, bold?: boolean): string {
  return font(size, bold ? "bold" : "regular", "body");
}

/**
 * Like sanitizeText but preserves surrounding spaces — segments are stitched
 * side by side, so trimming each one would fuse adjacent words together.
 */
function inlineSafe(value: string): string {
  return value
    .normalize("NFKC")
    // strip control, zero-width & bidi marks (but keep ordinary spaces)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\uFEFF]/g, "");
}

/** Total width of a run of coloured segments at a given size. */
function measureSegs(ctx: SKRSContext2D, segs: Seg[], size: number): number {
  let w = 0;
  for (const s of segs) {
    ctx.font = segFont(size, s.bold);
    w += ctx.measureText(inlineSafe(s.t)).width;
  }
  return w;
}

/** Draw a run of coloured segments centred on cx. */
export function drawSegLine(
  ctx: SKRSContext2D,
  segs: Seg[],
  cx: number,
  y: number,
  size: number
) {
  const total = measureSegs(ctx, segs, size);
  let x = cx - total / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const s of segs) {
    ctx.font = segFont(size, s.bold);
    ctx.fillStyle = s.color;
    const t = inlineSafe(s.t);
    ctx.fillText(t, x, y);
    x += ctx.measureText(t).width;
  }
}

/** Centre a single-colour string. */
function drawCenter(
  ctx: SKRSContext2D,
  value: string,
  cx: number,
  y: number,
  size: number,
  color: string,
  bold = false,
  family: "display" | "body" = "body"
) {
  ctx.font = font(size, bold ? "bold" : "regular", family);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(sanitizeText(value), cx, y);
  ctx.textAlign = "left";
}

/** Small caps footer line with tracked letters and one accent word. */
function drawFooter(ctx: SKRSContext2D, community: string, accent: string) {
  const parts: Seg[] = [
    { t: "STAY ACTIVE.  EARN ", color: LIGHT.muted },
    { t: "XP", color: accent, bold: true },
    { t: ".  KEEP ", color: LIGHT.muted },
    { t: sanitizeText(community).toUpperCase().slice(0, 22), color: LIGHT.ink, bold: true },
    { t: " STRONG.", color: LIGHT.muted },
  ];
  drawSegLine(ctx, parts, W / 2, H - 46, 20);
}

/** A rounded pill badge (filled) with centred bold text. */
function badge(ctx: SKRSContext2D, label: string, rightX: number, y: number, color: string) {
  const size = 26;
  ctx.font = font(size, "bold", "display");
  const tw = ctx.measureText(label).width;
  const padX = 26;
  const h = 52;
  const w = tw + padX * 2;
  const x = rightX - w;
  ctx.save();
  ctx.shadowColor = "rgba(225,29,43,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  roundRectPath(ctx, x, y, w, h, 14);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(size, "bold", "display");
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Header rule: a short line, two dots, the icon, two dots, a short line. */
function headerRule(ctx: SKRSContext2D, cy: number, color: string, iconR: number) {
  const gap = iconR + 44;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.65;
  for (const dir of [-1, 1]) {
    const inner = W / 2 + dir * gap;
    const outer = W / 2 + dir * (W / 2 - 150);
    ctx.beginPath();
    ctx.moveTo(inner + dir * 26, cy);
    ctx.lineTo(outer, cy);
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(inner + dir * (6 + i * 14), cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Warning triangle inside a soft ring. */
function warningIcon(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  // ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(225,29,43,0.10)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // triangle
  const t = r * 0.62;
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - t);
  ctx.lineTo(cx + t * 0.92, cy + t * 0.72);
  ctx.lineTo(cx - t * 0.92, cy + t * 0.72);
  ctx.closePath();
  ctx.stroke();
  // exclamation
  ctx.fillStyle = color;
  ctx.fillRect(cx - 3, cy - t * 0.18, 6, t * 0.55);
  ctx.beginPath();
  ctx.arc(cx, cy + t * 0.56, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Small shield-and-sword crest, used as the footer mark and side watermarks. */
export function shieldMark(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  h: number,
  color: string,
  alpha = 1
) {
  const w = h * 0.82;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h / 2 + h * 0.16);
  ctx.lineTo(cx + w / 2, cy + h * 0.05);
  ctx.quadraticCurveTo(cx + w / 2, cy + h * 0.42, cx, cy + h / 2);
  ctx.quadraticCurveTo(cx - w / 2, cy + h * 0.42, cx - w / 2, cy + h * 0.05);
  ctx.lineTo(cx - w / 2, cy - h / 2 + h * 0.16);
  ctx.closePath();
  ctx.lineWidth = Math.max(2, h * 0.05);
  ctx.strokeStyle = color;
  ctx.stroke();
  // sword down the middle
  ctx.lineWidth = Math.max(2, h * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.28);
  ctx.lineTo(cx, cy + h * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - h * 0.14, cy - h * 0.1);
  ctx.lineTo(cx + h * 0.14, cy - h * 0.1);
  ctx.stroke();
  ctx.restore();
}

/** Faint crest watermarks bleeding in from the left and right edges. */
function sideWatermarks(ctx: SKRSContext2D, color: string) {
  shieldMark(ctx, 150, H * 0.5, 210, color, 0.06);
  shieldMark(ctx, W - 150, H * 0.5, 210, color, 0.06);
}

/** Wrap a custom message into centred dark lines (max 3). */
function drawCustomMessage(ctx: SKRSContext2D, message: string, cy: number, size: number) {
  const maxWidth = W - 260;
  const words = sanitizeText(message).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  ctx.font = segFont(size);
  for (const word of words) {
    const attempt = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(attempt).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length === 2) break;
    } else {
      cur = attempt;
    }
  }
  if (cur && lines.length < 3) lines.push(cur);
  const lh = size * 1.34;
  const startY = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => drawCenter(ctx, ln, W / 2, startY + i * lh, size, LIGHT.inkSoft));
}

/** Shared card scaffold (surface, border, badge/icon header, title, avatar). */
async function renderEnforcementCard(opts: {
  v: EnforcementCardView;
  accent: string;
  accentSoft: string;
  title: [string, string]; // ["XP", "WARNING"]
  bodySegs: Seg[][]; // default body lines
  badgeLabel?: string;
  icon: "warning" | "bell";
}): Promise<Buffer> {
  const { v, accent, accentSoft } = opts;
  const rc = createSurface(W, H);
  const { ctx } = rc;

  // Rounded card surface with the brand texture showing through.
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, 30);
  ctx.clip();
  paintPhotoSurface(rc);
  sideWatermarks(ctx, accent);
  // Accent glows blooming up from the bottom corners.
  for (const gx of [W * 0.12, W * 0.88]) {
    const g = ctx.createRadialGradient(gx, H + 40, 0, gx, H + 40, H * 0.7);
    g.addColorStop(0, opts.icon === "warning" ? "rgba(225,29,43,0.30)" : "rgba(47,107,255,0.20)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // Card border.
  roundRectPath(ctx, 2, 2, W - 4, H - 4, 30);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const pad = 48;
  if (opts.badgeLabel) badge(ctx, opts.badgeLabel, W - pad, pad, accent);

  // Header icon + rule.
  const iconCy = 150;
  const iconR = 46;
  headerRule(ctx, iconCy, accent, iconR);
  if (opts.icon === "warning") warningIcon(ctx, W / 2, iconCy, iconR, accent);
  else bellIcon(ctx, W / 2, iconCy, iconR, accent);

  // Title — "XP" in accent, second word in ink.
  const titleSize = 116;
  const titleY = 320;
  ctx.font = font(titleSize, "bold", "display");
  const w1 = ctx.measureText(opts.title[0]).width;
  const wSpace = ctx.measureText(" ").width;
  const w2 = ctx.measureText(opts.title[1]).width;
  const totalW = w1 + wSpace + w2;
  const startX = W / 2 - totalW / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent;
  ctx.fillText(opts.title[0], startX, titleY);
  ctx.fillStyle = LIGHT.ink;
  ctx.fillText(opts.title[1], startX + w1 + wSpace, titleY);

  // Divider under the title with a small downward notch.
  const divY = titleY + 42;
  const half = totalW / 2 - 10;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2 - half, divY);
  ctx.lineTo(W / 2 - 16, divY);
  ctx.moveTo(W / 2 + 16, divY);
  ctx.lineTo(W / 2 + half, divY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 16, divY);
  ctx.lineTo(W / 2, divY + 14);
  ctx.lineTo(W / 2 + 16, divY);
  ctx.stroke();

  // Body copy.
  const bodyTop = divY + 66;
  if (v.message && v.message.trim()) {
    drawCustomMessage(ctx, v.message.trim(), bodyTop + 34, 34);
  } else {
    const lh = 50;
    opts.bodySegs.forEach((segs, i) => drawSegLine(ctx, segs, W / 2, bodyTop + i * lh, 34));
  }

  // Avatar + name.
  const avatarSize = 150;
  const avatarY = 604;
  const img = await fetchAvatar(v.avatarUrl);
  drawAvatar(
    ctx,
    img,
    W / 2 - avatarSize / 2,
    avatarY,
    avatarSize,
    sanitizeText(v.memberName).replace(/^@/, "").slice(0, 1) || "?",
    accentSoft
  );
  const handle = v.memberName.startsWith("@") ? v.memberName : `@${v.memberName}`;
  drawCenter(ctx, handle, W / 2, avatarY + avatarSize + 44, 34, accent, true, "display");

  // Footer mark + line.
  const footRuleY = H - 92;
  ctx.strokeStyle = LIGHT.hairline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad + 40, footRuleY);
  ctx.lineTo(W / 2 - 30, footRuleY);
  ctx.moveTo(W / 2 + 30, footRuleY);
  ctx.lineTo(W - pad - 40, footRuleY);
  ctx.stroke();
  shieldMark(ctx, W / 2, footRuleY, 34, accent, 0.85);
  drawFooter(ctx, v.communityName, accent);

  return toPng(rc.canvas);
}

/** Bell icon inside a soft ring — the reminder counterpart to warningIcon. */
function bellIcon(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(47,107,255,0.10)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const s = r * 0.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // little top knob
  ctx.beginPath();
  ctx.arc(cx, cy - s * 1.05, 4, 0, Math.PI * 2);
  ctx.fill();
  // bell body
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.9, cy + s * 0.5);
  ctx.quadraticCurveTo(cx - s * 0.9, cy - s * 0.7, cx, cy - s * 0.8);
  ctx.quadraticCurveTo(cx + s * 0.9, cy - s * 0.7, cx + s * 0.9, cy + s * 0.5);
  ctx.stroke();
  // rim
  ctx.beginPath();
  ctx.moveTo(cx - s * 1.06, cy + s * 0.5);
  ctx.lineTo(cx + s * 1.06, cy + s * 0.5);
  ctx.stroke();
  // clapper
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.78, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * XP warning card (red) — MEMBER-FACING.
 * Never shows warning counts, escalation thresholds, progress fractions, or
 * missing-XP amounts. A custom `message` (already sanitized by the caller)
 * replaces the default body when provided.
 */
export function renderWarningCard(v: WarningCardView): Promise<Buffer> {
  return renderEnforcementCard({
    v,
    accent: LIGHT.red,
    accentSoft: LIGHT.redSoft,
    title: ["XP", "WARNING"],
    // No badge — count/threshold are staff-only accounting.
    icon: "warning",
    bodySegs: [
      [{ t: "You have received an XP activity warning.", color: LIGHT.inkSoft, bold: true }],
      [{ t: "Reason: Failure to complete the required activity.", color: LIGHT.ink }],
      [{ t: "Please make sure you complete your required activity.", color: LIGHT.ink }],
    ],
  });
}

/**
 * XP reminder card (blue) — MEMBER-FACING.
 * Period-aware ("daily" / "weekly" from config). No progress fractions.
 */
export function renderReminderCard(v: EnforcementCardView): Promise<Buffer> {
  const period = (v.periodLabel === "daily" || v.periodLabel === "weekly"
    ? v.periodLabel
    : "weekly") as string;
  return renderEnforcementCard({
    v,
    accent: LIGHT.blue,
    accentSoft: LIGHT.blueSoft,
    title: ["XP", "REMINDER"],
    icon: "bell",
    bodySegs: [
      [
        {
          t: `Please make sure you complete your ${period} XP requirement.`,
          color: LIGHT.inkSoft,
          bold: true,
        },
      ],
      [
        { t: "Complete it before the period ends to ", color: LIGHT.ink },
        { t: "avoid", color: LIGHT.blue, bold: true },
        { t: " a ", color: LIGHT.ink },
        { t: "warning", color: LIGHT.blue, bold: true },
        { t: ".", color: LIGHT.ink },
      ],
    ],
  });
}
