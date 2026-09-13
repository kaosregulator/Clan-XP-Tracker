/**
 * Live leveling-queue tracker canvas — header board users can watch.
 * Mini Discord embeds (one per order) sit under this image so the panel
 * reads as one composition.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawAvatar,
  pill,
  toPng,
  PALETTE,
} from "../theme";

export interface OrderTrackerRow {
  queuePosition: number;
  publicId: string;
  customerName: string;
  serviceLabel: string;
  statusLabel: string;
  statusTone: "queue" | "active" | "hold" | "done" | "bad";
  avatarUrl: string | null;
}

export interface OrderTrackerCardView {
  communityName: string;
  activeCount: number;
  rows: OrderTrackerRow[];
  updatedAt: string;
}

const TONE: Record<OrderTrackerRow["statusTone"], { bg: string; fg: string }> = {
  queue: { bg: "rgba(52,152,219,0.14)", fg: "#1a6fa5" },
  active: { bg: "rgba(230,126,34,0.16)", fg: "#a85b12" },
  hold: { bg: "rgba(149,165,166,0.2)", fg: "#5c6b6d" },
  done: { bg: "rgba(46,204,113,0.16)", fg: "#1e7a45" },
  bad: { bg: "rgba(231,76,60,0.14)", fg: "#a83226" },
};

export async function renderOrderTrackerCard(view: OrderTrackerCardView): Promise<Buffer> {
  const rows = view.rows.slice(0, 8);
  const W = 980;
  const rowH = 72;
  const H = 200 + Math.max(rows.length, 1) * (rowH + 12);
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  card(ctx, 28, 28, W - 56, H - 56, { radius: 22 });

  text(ctx, (view.communityName || "CLAN").toUpperCase(), 56, 56, {
    size: 14,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "LIVE ORDER TRACKER", 56, 92, {
    size: 32,
    weight: "bold",
    color: PALETTE.text,
  });
  text(ctx, `${view.activeCount} active in queue · updates live`, 56, 128, {
    size: 16,
    color: PALETTE.soft,
  });

  let y = 168;
  if (!rows.length) {
    card(ctx, 56, y, W - 112, 88, { radius: 14, fill: PALETTE.bg1 });
    text(ctx, "Queue is clear", 80, y + 36, {
      size: 22,
      weight: "bold",
      color: PALETTE.text,
    });
    text(ctx, "New orders will appear here automatically.", 80, y + 64, {
      size: 15,
      color: PALETTE.muted,
    });
  } else {
    for (const row of rows) {
      card(ctx, 56, y, W - 112, rowH, { radius: 14, fill: PALETTE.bg1 });
      text(ctx, `#${row.queuePosition}`, 72, y + 28, {
        size: 26,
        weight: "bold",
        color: PALETTE.blurple,
      });
      const avatar = await fetchAvatar(row.avatarUrl);
      drawAvatar(ctx, avatar, 150, y + 12, 48, row.customerName[0] ?? "?", PALETTE.blurpleSoft);
      text(ctx, row.customerName, 214, y + 22, {
        size: 18,
        weight: "bold",
        color: PALETTE.text,
        maxWidth: 360,
      });
      text(ctx, `${row.publicId} · ${row.serviceLabel}`, 214, y + 46, {
        size: 14,
        color: PALETTE.muted,
        maxWidth: 400,
      });
      const tone = TONE[row.statusTone];
      pill(ctx, row.statusLabel, W - 280, y + 22, {
        bg: tone.bg,
        color: tone.fg,
        size: 14,
        height: 30,
      });
      y += rowH + 12;
    }
  }

  text(ctx, `Updated ${view.updatedAt}`, 56, H - 52, {
    size: 13,
    color: PALETTE.muted,
  });
  text(ctx, "Watch the queue here · ticket updates still send", W - 420, H - 52, {
    size: 13,
    color: PALETTE.muted,
  });

  return toPng(rc.canvas);
}
