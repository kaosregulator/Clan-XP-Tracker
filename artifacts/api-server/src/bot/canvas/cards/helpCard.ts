import {
  createSurface,
  paintBackground,
  card,
  text,
  PALETTE,
  toPng,
} from "../theme";

export interface HelpSection {
  title: string;
  accent: string;
  lines: string[];
}

export interface HelpCardView {
  communityName: string;
  activityName: string;
  sections: HelpSection[];
}

/** Help card — wider + larger type so Discord mobile still reads cleanly. */
export async function renderHelpCard(view: HelpCardView): Promise<Buffer> {
  const W = 1100;
  const pad = 48;
  const headerH = 140;
  const lineH = 40;
  const sectionPadTop = 64;
  const sectionGap = 24;

  const sectionHeights = view.sections.map((s) => sectionPadTop + s.lines.length * lineH + 28);
  const bodyH = sectionHeights.reduce((a, b) => a + b, 0) + sectionGap * Math.max(0, view.sections.length - 1);
  const H = headerH + bodyH + 48;

  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), pad, 52, {
    size: 18,
    weight: "bold",
    color: PALETTE.soft,
    maxWidth: W - pad * 2,
  });
  text(ctx, `How ${view.activityName} tracking works`, pad, 100, {
    size: 40,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: W - pad * 2,
  });

  let y = headerH;
  for (let i = 0; i < view.sections.length; i++) {
    const s = view.sections[i]!;
    const h = sectionHeights[i]!;
    card(ctx, pad, y, W - pad * 2, h, { fill: PALETTE.card, shadow: false, radius: 18 });

    ctx.fillStyle = s.accent;
    ctx.fillRect(pad, y, 6, h);

    text(ctx, s.title, pad + 32, y + 42, {
      size: 24,
      weight: "bold",
      color: PALETTE.text,
    });

    let ly = y + sectionPadTop + 14;
    for (const line of s.lines) {
      ctx.beginPath();
      ctx.arc(pad + 40, ly - 7, 5, 0, Math.PI * 2);
      ctx.fillStyle = s.accent;
      ctx.fill();
      text(ctx, line, pad + 58, ly, {
        size: 22,
        color: PALETTE.soft,
        maxWidth: W - pad * 2 - 90,
      });
      ly += lineH;
    }
    y += h + sectionGap;
  }

  return toPng(rc.canvas);
}
