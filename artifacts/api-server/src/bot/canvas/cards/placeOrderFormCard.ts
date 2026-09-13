/**
 * Place Service Order form preview — matches the mock flow the members see
 * when they open the leveling panel (service, vehicle, levels, tags, image).
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  pill,
  toPng,
  PALETTE,
} from "../theme";

export interface PlaceOrderFormCardView {
  communityName: string;
}

export async function renderPlaceOrderFormCard(
  view: PlaceOrderFormCardView
): Promise<Buffer> {
  const W = 920;
  const H = 720;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  card(ctx, 24, 24, W - 48, H - 48, { radius: 20 });

  // Header
  text(ctx, "🛠️  Place Service Order", 52, 56, {
    size: 28,
    weight: "bold",
    color: PALETTE.text,
  });
  text(ctx, "Tell us what you need and we'll take care of the rest.", 52, 92, {
    size: 15,
    color: PALETTE.soft,
  });

  pill(ctx, "FAST · SAFE · DISCORD ONLY", W - 320, 56, {
    bg: "rgba(63,81,224,0.12)",
    color: PALETTE.blurple,
    size: 12,
    height: 28,
  });
  text(ctx, "No external websites", W - 300, 92, {
    size: 12,
    color: PALETTE.muted,
  });

  const field = (label: string, y: number, value: string, hint?: string) => {
    text(ctx, label, 52, y, { size: 13, weight: "bold", color: PALETTE.muted });
    card(ctx, 52, y + 18, W - 104, 48, { radius: 12, fill: PALETTE.bg1 });
    text(ctx, value, 72, y + 34, { size: 16, color: PALETTE.text, maxWidth: W - 160 });
    if (hint) {
      text(ctx, hint, 52, y + 74, { size: 12, color: PALETTE.muted });
    }
  };

  field("1. Choose Service (required)", 120, "🛠️  Vehicle Leveling");
  field(
    "2. What do you want leveled? (required)",
    220,
    "Enter vehicle, item, or anything…",
    "Example: M1 Abrams, F-22 Raptor, Helicopter, etc."
  );

  text(ctx, "3. Current Level (required)", 52, 330, {
    size: 13,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "4. Target Level (required)", 52, 480, {
    size: 13,
    weight: "bold",
    color: PALETTE.muted,
  });
  card(ctx, 52, 348, 390, 48, { radius: 12, fill: PALETTE.bg1 });
  text(ctx, "📊  Level 1", 72, 364, { size: 16, color: PALETTE.text });
  card(ctx, 478, 348, 390, 48, { radius: 12, fill: PALETTE.bg1 });
  text(ctx, "🎯  Level 50", 498, 364, { size: 16, color: PALETTE.text });

  text(ctx, "5. Add Tags (select all that apply)", 52, 430, {
    size: 13,
    weight: "bold",
    color: PALETTE.muted,
  });
  let tx = 52;
  const tags: [string, boolean][] = [
    ["🛠️ Vehicle", true],
    ["📊 XP", false],
    ["❗ Urgent", false],
    ["⛏️ Grinding", false],
    ["⋯ Other", false],
  ];
  for (const [label, on] of tags) {
    const w = pill(ctx, label, tx, 456, {
      bg: on ? "rgba(63,81,224,0.18)" : "rgba(20,22,31,0.06)",
      color: on ? PALETTE.blurple : PALETTE.soft,
      size: 14,
      height: 34,
    });
    tx += w + 12;
  }

  text(ctx, "6. Add Image (screenshot)", 52, 520, {
    size: 13,
    weight: "bold",
    color: PALETTE.muted,
  });
  card(ctx, 52, 542, W - 104, 90, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, "📷  Click to attach an image", 72, 572, {
    size: 16,
    weight: "bold",
    color: PALETTE.text,
  });
  text(
    ctx,
    "Upload a screenshot of your vehicle, current level, or anything helpful.",
    72,
    600,
    { size: 13, color: PALETTE.muted, maxWidth: W - 160 }
  );

  // Fake action row
  card(ctx, 52, 650, 140, 40, { radius: 10, fill: PALETTE.cardAlt });
  text(ctx, "Cancel", 95, 662, { size: 15, color: PALETTE.soft, align: "center" });
  card(ctx, W - 320, 650, 244, 40, { radius: 10, fill: "rgba(46,204,113,0.2)" });
  text(ctx, "✓  Submit Service Order", W - 198, 662, {
    size: 15,
    weight: "bold",
    color: "#1e7a45",
    align: "center",
  });

  text(
    ctx,
    `${(view.communityName || "CLAN").toUpperCase()} · Press Place Service Order below to start`,
    52,
    H - 36,
    { size: 12, color: PALETTE.muted }
  );

  return toPng(rc.canvas);
}
