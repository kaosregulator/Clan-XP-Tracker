/**
 * Place Service Order form preview — matches the live modal
 * (separate current/target numbers + required photos).
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

  text(ctx, "🛠️  Place Service Order", 52, 56, {
    size: 28,
    weight: "bold",
    color: PALETTE.text,
  });
  text(ctx, "Simple numbers for levels — no hardcoded ranges.", 52, 92, {
    size: 15,
    color: PALETTE.soft,
  });

  pill(ctx, "FAST · SAFE · DISCORD ONLY", W - 320, 56, {
    bg: "rgba(63,81,224,0.12)",
    color: PALETTE.blurple,
    size: 12,
    height: 28,
  });
  text(ctx, (view.communityName || "CLAN").toUpperCase(), W - 300, 92, {
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
    210,
    "Enter vehicle, item, or anything…",
    "Example: M1 Abrams, F-22 Raptor, Helicopter…"
  );
  field(
    "3. Current level (required)",
    310,
    "e.g. 12",
    "Just a number — 1 and up. No ranges."
  );
  field(
    "4. Target level (required)",
    410,
    'e.g. 80 or "maxed"',
    "Number you want, or type maxed. Must be ≥ current."
  );
  field(
    "5. Add photos (required, max 5)",
    510,
    "📷  Upload 1–5 screenshots from your device",
    "Before / current state photos are required."
  );

  card(ctx, 52, 620, 140, 40, { radius: 10, fill: PALETTE.cardAlt });
  text(ctx, "Cancel", 95, 632, { size: 15, color: PALETTE.soft, align: "center" });
  card(ctx, W - 320, 620, 244, 40, { radius: 10, fill: "rgba(46,204,113,0.2)" });
  text(ctx, "✓  Submit Service Order", W - 198, 632, {
    size: 15,
    weight: "bold",
    color: "#1e7a45",
    align: "center",
  });

  return toPng(rc.canvas);
}
