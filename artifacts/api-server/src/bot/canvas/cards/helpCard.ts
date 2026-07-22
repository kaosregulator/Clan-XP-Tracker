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

/** A clean, uniform help card matching the hubs/dashboards. */
export function renderHelpCard(view: HelpCardView): Buffer {
  const W = 960;
  const pad = 40;
  const headerH = 130;
  const lineH = 34;
  const sectionPadTop = 58;
  const sectionGap = 22;

  // Measure height from the content.
  const sectionHeights = view.sections.map((s) => sectionPadTop + s.lines.length * lineH + 20);
  const bodyH = sectionHeights.reduce((a, b) => a + b, 0) + sectionGap * (view.sections.length - 1);
  const H = headerH + bodyH + 36;

  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.communityName.toUpperCase(), pad, 54, { size: 22, weight: "bold", color: PALETTE.soft, maxWidth: W - pad * 2 });
  text(ctx, `How ${view.activityName} Tracking Works`, pad, 96, { size: 36, weight: "bold", color: PALETTE.text });

  let y = headerH;
  for (let i = 0; i < view.sections.length; i++) {
    const s = view.sections[i]!;
    const h = sectionHeights[i]!;
    card(ctx, pad, y, W - pad * 2, h, { fill: PALETTE.card, shadow: false });

    // accent bar
    ctx.fillStyle = s.accent;
    ctx.fillRect(pad, y, 5, h);

    text(ctx, s.title, pad + 28, y + 38, { size: 22, weight: "bold", color: PALETTE.text });

    let ly = y + sectionPadTop + 12;
    for (const line of s.lines) {
      // bullet dot
      ctx.beginPath();
      ctx.arc(pad + 34, ly - 6, 4, 0, Math.PI * 2);
      ctx.fillStyle = s.accent;
      ctx.fill();
      text(ctx, line, pad + 50, ly, { size: 19, color: PALETTE.soft, maxWidth: W - pad * 2 - 76 });
      ly += lineH;
    }
    y += h + sectionGap;
  }

  return toPng(rc.canvas);
}
