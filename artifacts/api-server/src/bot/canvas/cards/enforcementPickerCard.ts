import type { SKRSContext2D } from "@napi-rs/canvas";
import { createSurface, roundRectPath, fetchAvatar, drawAvatar, toPng } from "../theme";
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
 *
 * IMPORTANT: this is a control-panel PREVIEW, not the card that gets sent. It
 * deliberately uses a dark UI panel (not the light branded card surface) so an
 * officer never mistakes it for the warning/reminder that will be delivered.
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

/* Dark UI-panel palette, local to the preview (distinct from the light cards). */
const UI = {
  bgTop: "#171d2e",
  bgBottom: "#0d111c",
  text: "#f2f5fa",
  soft: "#c3cbdc",
  muted: "#8b93a7",
  hairline: "rgba(255,255,255,0.12)",
  chipNeutral: "rgba(255,255,255,0.10)",
} as const;

function accentFor(mode: "warning" | "reminder"): { accent: string; soft: string; glow: string } {
  return mode === "warning"
    ? { accent: LIGHT.red, soft: LIGHT.redSoft, glow: "rgba(225,29,43,0.28)" }
    : { accent: LIGHT.blue, soft: LIGHT.blueSoft, glow: "rgba(47,107,255,0.26)" };
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
  const w = Math.min(tw + padX * 2, 210);
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
  const { accent, soft, glow } = accentFor(v.mode);
  const rc = createSurface(W, H);
  const { ctx } = rc;

  // Dark UI panel — a vertical gradient with a soft accent glow up top. Clearly
  // a control surface, never mistakable for the light card that gets sent.
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, 30);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, UI.bgTop);
  bg.addColorStop(1, UI.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (const gx of [W * 0.16, W * 0.84]) {
    const g = ctx.createRadialGradient(gx, -60, 0, gx, -60, H * 0.75);
    g.addColorStop(0, glow);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // Border.
  roundRectPath(ctx, 2, 2, W - 4, H - 4, 30);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // A quiet "PREVIEW" tag so it's unmistakably a control panel.
  drawCenter(ctx, "SELECTION PREVIEW", W / 2, 58, 18, UI.muted, true, "display");

  // Huge mode banner.
  const title = v.mode === "warning" ? "WARNING" : "REMINDER";
  drawCenter(ctx, title, W / 2, 138, 92, accent, true, "display");
  const count = v.members.length;
  const subtitle =
    count === 0
      ? "Select members below — this preview updates as you pick"
      : `${count} member${count === 1 ? "" : "s"} will be ${v.mode === "warning" ? "warned" : "reminded"}`;
  drawCenter(ctx, subtitle, W / 2, 180, 26, UI.soft, false, "body");

  // Divider.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, 210);
  ctx.lineTo(W - 120, 210);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (count === 0) {
    drawCenter(ctx, "No one selected yet", W / 2, H / 2 + 10, 40, UI.soft, true, "display");
    drawCenter(
      ctx,
      "Use the member picker to choose one or many clan members.",
      W / 2,
      H / 2 + 56,
      24,
      UI.muted
    );
    footer(ctx, v.communityName, accent);
    return toPng(rc.canvas);
  }

  // Grid of selected members (up to 10 rendered).
  const shown = v.members.slice(0, 10);
  const perRow = Math.min(5, shown.length);
  const rows = Math.ceil(shown.length / perRow);
  const gridTop = 258;
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
    drawCenter(ctx, fitHandle(ctx, handle, cellW - 24, 24), cx, nameY, 24, UI.text, true, "display");

    // Standing chips: current warnings, then warning-role status.
    const warnLabel =
      m.warnings > 0 ? `⚠ ${m.warnings} warning${m.warnings === 1 ? "" : "s"}` : "✓ clean record";
    statusChip(
      ctx,
      warnLabel,
      cx,
      nameY + 30,
      m.warnings > 0 ? "#ffffff" : "#7ff0b0",
      m.warnings > 0 ? LIGHT.red : "rgba(46,158,87,0.30)"
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
        fg = "#ffd79a";
        bg = "rgba(250,166,26,0.28)";
      } else {
        roleLabel = "no warning role";
        fg = UI.soft;
        bg = UI.chipNeutral;
      }
      statusChip(ctx, roleLabel, cx, nameY + 68, fg, bg);
    }
  }

  if (v.members.length > shown.length) {
    drawCenter(ctx, `+ ${v.members.length - shown.length} more selected`, W / 2, H - 96, 22, UI.muted, true);
  }

  footer(ctx, v.communityName, accent);
  return toPng(rc.canvas);
}

function footer(ctx: SKRSContext2D, community: string, accent: string) {
  const y = H - 44;
  ctx.strokeStyle = UI.hairline;
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
    UI.muted,
    true,
    "display"
  );
}
