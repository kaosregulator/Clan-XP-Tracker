/**
 * Marketplace hub canvas cards — avatar shop (not Creator Store).
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  drawRoundedImage,
  statTile,
  footerNote,
  loadRemote,
  wrapText,
  toPng,
  RBX,
} from "../roblox/shared";

const MKT = {
  accent: "#e11d48",
  accentDeep: "#be123c",
  gold: "#b45309",
} as const;

function brand(ctx: import("@napi-rs/canvas").SKRSContext2D) {
  text(ctx, "ROBLOX MARKET", 40, 42, {
    size: 16,
    weight: "bold",
    color: MKT.accentDeep,
  });
}

export interface MarketHomeCardView {
  subtitle?: string;
}

export async function renderMarketHomeCard(view: MarketHomeCardView = {}): Promise<Buffer> {
  const W = 960;
  const H = 520;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, "Avatar Marketplace", 40, 92, {
    size: 40,
    weight: "bold",
    color: RBX.ink,
  });
  text(
    ctx,
    view.subtitle ??
      "Browse clothing, accessories, bodies, animations & collectibles players wear.",
    40,
    145,
    { size: 18, color: RBX.soft, maxWidth: W - 80 }
  );

  const tiles = [
    ["Clothing", "Shirts · pants · layered"],
    ["Accessories", "Hats · hair · gear"],
    ["Bodies", "Bundles · heads"],
    ["Collectibles", "Limiteds · resale"],
  ] as const;
  let x = 40;
  for (const [title, sub] of tiles) {
    card(ctx, x, 220, 210, 140, { radius: 16, shadow: false });
    text(ctx, title, x + 20, 270, { size: 20, weight: "bold", color: RBX.ink });
    text(ctx, sub, x + 20, 305, { size: 14, color: RBX.soft, maxWidth: 170 });
    x += 225;
  }

  footerNote(ctx, W, H, "Player Marketplace only · Not Creator Store · Public catalog · No cookies");
  return toPng(rc.canvas);
}

export interface MarketGridRow {
  name: string;
  meta: string;
  price: string;
  iconUrl: string | null;
  badge?: string | null;
}

export interface MarketGridCardView {
  title: string;
  subtitle: string;
  rows: MarketGridRow[];
}

export async function renderMarketGridCard(view: MarketGridCardView): Promise<Buffer> {
  const W = 980;
  const cols = 2;
  const rowH = 110;
  const rows = Math.ceil(Math.max(view.rows.length, 1) / cols);
  const H = 150 + rows * (rowH + 12) + 50;
  const rc = createSurface(W, Math.max(H, 420));
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);
  text(ctx, view.title, 40, 88, { size: 28, weight: "bold", color: RBX.ink, maxWidth: W - 80 });
  text(ctx, view.subtitle, 40, 122, { size: 15, color: RBX.soft, maxWidth: W - 80 });

  if (!view.rows.length) {
    text(ctx, "No marketplace items matched these filters.", 40, 200, {
      size: 20,
      color: RBX.soft,
    });
    return toPng(rc.canvas);
  }

  const cellW = (W - 80 - 16) / cols;
  for (let i = 0; i < view.rows.length; i++) {
    const r = view.rows[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 40 + col * (cellW + 16);
    const y = 150 + row * (rowH + 12);
    card(ctx, x, y, cellW, rowH, { radius: 14, shadow: false });
    const icon = await loadRemote(r.iconUrl);
    drawRoundedImage(ctx, icon, x + 14, y + 14, 82, 82, 12);
    text(ctx, r.name, x + 110, y + 36, {
      size: 17,
      weight: "bold",
      color: RBX.ink,
      maxWidth: cellW - 130,
    });
    text(ctx, r.meta, x + 110, y + 60, {
      size: 13,
      color: RBX.muted,
      maxWidth: cellW - 130,
    });
    text(ctx, r.price, x + 110, y + 88, {
      size: 16,
      weight: "bold",
      color: MKT.gold,
    });
    if (r.badge) {
      text(ctx, r.badge, x + cellW - 14, y + 30, {
        size: 12,
        weight: "bold",
        color: MKT.accentDeep,
        align: "right",
      });
    }
  }
  return toPng(rc.canvas);
}

export interface MarketItemCardView {
  name: string;
  typeLabel: string;
  price: string;
  creator: string;
  favorites: string;
  description: string;
  iconUrl: string | null;
  restrictions: string[];
  quantityLine: string | null;
  createdLabel: string | null;
  itemId: number;
}

export async function renderMarketItemCard(view: MarketItemCardView): Promise<Buffer> {
  const W = 920;
  const H = 680;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);
  brand(ctx);

  const icon = await loadRemote(view.iconUrl);
  drawRoundedImage(ctx, icon, (W - 280) / 2, 70, 280, 280, 22);

  text(ctx, view.name, 40, 390, {
    size: 30,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 80,
  });
  text(ctx, view.typeLabel, 40, 428, { size: 16, color: RBX.soft });

  let tx = 40;
  for (const [label, value] of [
    ["Price", view.price],
    ["Favorites", view.favorites],
    ["Creator", view.creator],
  ] as const) {
    statTile(ctx, tx, 460, 270, 78, label, value.length > 18 ? value.slice(0, 16) + "…" : value);
    tx += 285;
  }

  if (view.restrictions.length) {
    text(ctx, view.restrictions.join(" · "), 40, 565, {
      size: 15,
      weight: "bold",
      color: MKT.accentDeep,
    });
  }
  if (view.quantityLine) {
    text(ctx, view.quantityLine, 40, 590, { size: 15, color: RBX.soft });
  }

  ctx.font = "16px Outfit";
  const lines = wrapText(ctx, view.description.replace(/\s+/g, " ").trim() || "No description.", W - 80, 2);
  let y = 620;
  for (const line of lines) {
    text(ctx, line, 40, y, { size: 15, color: RBX.muted, maxWidth: W - 80 });
    y += 22;
  }

  const meta = [`ID ${view.itemId}`];
  if (view.createdLabel) meta.push(`Created ${view.createdLabel}`);
  footerNote(ctx, W, H, meta.join(" · "));
  return toPng(rc.canvas);
}
