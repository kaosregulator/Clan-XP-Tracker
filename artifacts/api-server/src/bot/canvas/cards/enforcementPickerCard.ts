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
import { LIGHT, shieldMark } from "./warningCard";

/**
 * The enforcement picker preview — a "mini layer selector" for warnings and
 * reminders. It shows, in one glance:
 *   • a huge REMINDER / WARNING banner (which mode is armed),
 *   • every member currently selected (avatar + handle), laid out in a tidy grid,
 *   • each member's live standing at the bottom of their tile — current active
 *     warnings and whether the warning role is already on them or will be added.
 *
 * It re-renders on every pick / mode toggle so the officer always sees exactly
 * who will receive the action before they hit Send.
 */

export interface PickerMemberView {
  name: string;
  avatarUrl: string | null;
  /** Active warnings the member currently has. */
  warnings: number;
  /** They already carry a configured warning role. */
  hasRole: boolean;
  /** Sending (a warning) will add the warning role to them. */
  willAddRole: boolean;
}

export interface EnforcementPickerView {
  mode: "warning" | "reminder";
  communityName: string;
  members: PickerMemberView[];
  /** A warning role is configured for the server (drives role-status copy). */
  warnRoleConfigured: boolean;
}

const W = 1200;
const H = 780;

function accentFor(mode: "warning" | "reminder"): { accent: string; soft: string } {
  return mode === "warning"
    ? { accent: LIGHT.red, soft: LIGHT.redSoft }
    : { accent: LIGHT.blue, soft: LIGHT.blueSoft };
}

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

/** Truncate a handle to fit a tile width at the given font size. */
function fitHandle(ctx: SKRSContext2D, handle: string, maxWidth: number, size: number): string {
  ctx.font = font(size, "bold", "display");
  let s = sanitizeText(handle);
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** A small rounded status chip with centred text. */
function statusChip(
  ctx: SKRSContext2D,
  label: string,
  cx: number,
  cy: number,
  fg: string,
  bg: string
) {
  const size = 19;
  ctx.font = font(size, "bold", "body");
  const tw = ctx.measureText(label).width;
  const padX = 14;
  const h = 32;
  const w = Math.min(tw + padX * 2, 200);
  const x = cx - w / 2;
  roundRectPath(ctx, x, cy - h / 2, w, h, 10);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export async function renderEnforcementPicker(v: EnforcementPickerView): Promise<Buffer> {
  const { accent, soft } = accentFor(v.mode);
  const rc = createSurface(W, H);
  const { ctx } = rc;

  // Card surface with the brand texture + accent glow, matching the enforcement cards.
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, 30);
  ctx.clip();
  paintPhotoSurface(rc);
  for (const gx of [W * 0.14, W * 0.86]) {
    const g = ctx.createRadialGradient(gx, -40, 0, gx, -40, H * 0.7);
    g.addColorStop(0, v.mode === "warning" ? "rgba(225,29,43,0.22)" : "rgba(47,107,255,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // Border.
  roundRectPath(ctx, 2, 2, W - 4, H - 4, 30);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Huge mode banner.
  const title = v.mode === "warning" ? "WARNING" : "REMINDER";
  drawCenter(ctx, title, W / 2, 128, 96, accent, true, "display");
  const count = v.members.length;
  const subtitle =
    count === 0
      ? "Select members below — this preview updates as you pick"
      : `${count} member${count === 1 ? "" : "s"} will be ${v.mode === "warning" ? "warned" : "reminded"}`;
  drawCenter(ctx, subtitle, W / 2, 170, 26, LIGHT.inkSoft, false, "body");

  // Divider.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, 200);
  ctx.lineTo(W - 120, 200);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (count === 0) {
    drawCenter(
      ctx,
      "No one selected yet",
      W / 2,
      H / 2 + 10,
      40,
      LIGHT.muted,
      true,
      "display"
    );
    drawCenter(
      ctx,
      "Use the member picker to choose one or many clan members.",
      W / 2,
      H / 2 + 56,
      24,
      LIGHT.muted
    );
    footer(ctx, v.communityName, accent);
    return toPng(rc.canvas);
  }

  // Grid of selected members (up to 10 rendered).
  const shown = v.members.slice(0, 10);
  const perRow = Math.min(5, shown.length);
  const rows = Math.ceil(shown.length / perRow);
  const gridTop = 250;
  const cellW = (W - 160) / perRow;
  const cellH = rows === 1 ? 300 : 240;
  const avatarSize = rows === 1 ? 128 : 104;

  for (let i = 0; i < shown.length; i++) {
    const m = shown[i]!;
    const rowIdx = Math.floor(i / perRow);
    const colCount = Math.min(perRow, shown.length - rowIdx * perRow);
    const colIdx = i % perRow;
    // Centre the (possibly shorter) final row.
    const rowWidth = colCount * cellW;
    const rowStartX = (W - rowWidth) / 2;
    const cx = rowStartX + colIdx * cellW + cellW / 2;
    const cyTop = gridTop + rowIdx * cellH;

    const img = await fetchAvatar(m.avatarUrl);
    drawAvatar(
      ctx,
      img,
      cx - avatarSize / 2,
      cyTop,
      avatarSize,
      sanitizeText(m.name).replace(/^@/, "").slice(0, 1) || "?",
      soft
    );

    const handle = m.name.startsWith("@") ? m.name : `@${m.name}`;
    const nameY = cyTop + avatarSize + 34;
    ctx.font = font(24, "bold", "display");
    drawCenter(ctx, fitHandle(ctx, handle, cellW - 24, 24), cx, nameY, 24, LIGHT.ink, true, "display");

    // Standing chips: current warnings, then warning-role status.
    const warnLabel = m.warnings > 0 ? `⚠ ${m.warnings} warning${m.warnings === 1 ? "" : "s"}` : "✓ clean record";
    statusChip(
      ctx,
      warnLabel,
      cx,
      nameY + 30,
      m.warnings > 0 ? "#ffffff" : "#0f7a3d",
      m.warnings > 0 ? LIGHT.red : "rgba(59,165,93,0.16)"
    );

    if (v.warnRoleConfigured) {
      let roleLabel: string;
      let fg: string;
      let bg: string;
      if (m.hasRole) {
        roleLabel = "has warning role";
        fg = "#ffffff";
        bg = LIGHT.red;
      } else if (m.willAddRole) {
        roleLabel = "role will be added";
        fg = "#8a3d00";
        bg = "rgba(250,166,26,0.22)";
      } else {
        roleLabel = "no warning role";
        fg = LIGHT.muted;
        bg = "rgba(122,129,149,0.15)";
      }
      statusChip(ctx, roleLabel, cx, nameY + 68, fg, bg);
    }
  }

  if (v.members.length > shown.length) {
    drawCenter(
      ctx,
      `+ ${v.members.length - shown.length} more selected`,
      W / 2,
      H - 96,
      22,
      LIGHT.muted,
      true
    );
  }

  footer(ctx, v.communityName, accent);
  return toPng(rc.canvas);
}

function footer(ctx: SKRSContext2D, community: string, accent: string) {
  const y = H - 44;
  ctx.strokeStyle = LIGHT.hairline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, y - 16);
  ctx.lineTo(W / 2 - 28, y - 16);
  ctx.moveTo(W / 2 + 28, y - 16);
  ctx.lineTo(W - 120, y - 16);
  ctx.stroke();
  shieldMark(ctx, W / 2, y - 16, 30, accent, 0.85);
  drawCenter(
    ctx,
    `${sanitizeText(community).toUpperCase().slice(0, 26)} · XP ENFORCEMENT`,
    W / 2,
    y + 20,
    18,
    LIGHT.muted,
    true,
    "display"
  );
}
