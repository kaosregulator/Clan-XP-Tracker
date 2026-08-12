import {
  createSurface,
  paintBackground,
  card,
  text,
  progressBar,
  horizontalGradient,
  PALETTE,
  toPng,
} from "../theme";

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface CommandCenterTile {
  label: string;
  value: number;
  tone: Tone;
}

export interface CommandCenterCardView {
  communityName: string;
  weekRange: string; // "Aug 11 – Aug 17"
  deadline: string; // "resets Mon 00:00" (plain text — canvas fonts carry no emoji)
  completionPct: number; // 0..100
  completed: number;
  active: number;
  needsActionLabel: string; // "7 attention · 3 missed · 4 warnings" or "All clear"
  tiles: CommandCenterTile[]; // exactly 8 for the 2×4 grid
  footer: string;
}

function toneColor(tone: Tone, value: number): string {
  switch (tone) {
    case "good":
      return value > 0 ? PALETTE.greenBright : PALETTE.text;
    case "warn":
      return value > 0 ? PALETTE.amber : PALETTE.text;
    case "bad":
      return value > 0 ? PALETTE.red : PALETTE.text;
    default:
      return PALETTE.text;
  }
}

/**
 * The live command-center card. A calm, scannable summary of the whole roster —
 * completion hero, a 2×4 grid of the actionable counts, and a roster footer —
 * matching the weekly review / calendar design language.
 */
export async function renderCommandCenter(v: CommandCenterCardView): Promise<Buffer> {
  const W = 960;
  const H = 600;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  const pad = 40;

  text(ctx, v.communityName.toUpperCase(), pad, 54, {
    size: 22,
    weight: "bold",
    color: PALETTE.soft,
    maxWidth: W - pad * 2,
  });
  text(ctx, "XP Command Center", pad, 92, { size: 38, weight: "bold", color: PALETTE.text });
  text(ctx, `${v.weekRange} • ${v.deadline}`, pad, 118, {
    size: 16,
    color: PALETTE.muted,
    maxWidth: W - pad * 2,
  });

  // Hero: completion rate + needs-action line.
  const topY = 140;
  const topH = 150;
  card(ctx, pad, topY, W - pad * 2, topH, { fill: PALETTE.card });
  const pct = Math.max(0, Math.min(100, Math.round(v.completionPct)));
  const accent = pct >= 100 ? PALETTE.greenBright : pct >= 50 ? PALETTE.amber : PALETTE.red;
  text(ctx, "WEEK COMPLETION", pad + 28, topY + 40, { size: 15, weight: "bold", color: PALETTE.muted });
  text(ctx, `${pct}%`, pad + 28, topY + 102, { size: 58, weight: "bold", family: "mono", color: accent });
  ctx.font = `58px "JetBrains Mono", "DejaVu Sans"`;
  const bw = ctx.measureText(`${pct}%`).width;
  text(ctx, `${v.completed} of ${v.active} active members complete`, pad + 28 + bw + 18, topY + 92, {
    size: 20,
    color: PALETTE.soft,
  });
  text(ctx, v.needsActionLabel, pad + 28 + bw + 18, topY + 120, {
    size: 16,
    color: PALETTE.muted,
    maxWidth: W - pad * 2 - bw - 80,
  });
  progressBar(ctx, pad + 28, topY + topH - 26, W - pad * 2 - 56, 12, pct / 100, {
    fill: horizontalGradient(ctx, pad + 28, 0, W - pad * 2 - 56, [
      [0, accent],
      [1, accent],
    ]),
  });

  // 2×4 grid of the actionable counts.
  const gridY = topY + topH + 24;
  const cols = 4;
  const gap = 18;
  const tileW = (W - pad * 2 - gap * (cols - 1)) / cols;
  const tileH = 92;
  v.tiles.slice(0, 8).forEach((t, i) => {
    const col = i % cols;
    const rowIdx = Math.floor(i / cols);
    const x = pad + col * (tileW + gap);
    const y = gridY + rowIdx * (tileH + gap);
    card(ctx, x, y, tileW, tileH, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
    text(ctx, t.label.toUpperCase(), x + 16, y + 28, { size: 12, weight: "bold", color: PALETTE.muted, maxWidth: tileW - 32 });
    text(ctx, `${t.value}`, x + 16, y + 74, { size: 34, weight: "bold", family: "mono", color: toneColor(t.tone, t.value) });
  });

  // Footer strip.
  const footY = gridY + 2 * tileH + gap + 22;
  card(ctx, pad, footY, W - pad * 2, 56, { fill: PALETTE.bg1, stroke: PALETTE.borderSoft, shadow: false });
  text(ctx, v.footer, W / 2, footY + 30, {
    size: 17,
    color: PALETTE.soft,
    align: "center",
    baseline: "middle",
    maxWidth: W - pad * 2 - 40,
  });

  return toPng(rc.canvas);
}
