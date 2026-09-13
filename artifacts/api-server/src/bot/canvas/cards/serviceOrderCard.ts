/**
 * Service-order card — Amazon-style tracking snapshot for the leveling queue.
 * Prefer linked Roblox avatar; fall back to Discord.
 * Shows queue place, vehicles, level range, and order details.
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
  wrapText,
  PALETTE,
} from "../theme";

export interface ServiceOrderCardView {
  communityName: string;
  publicId: string;
  serviceLabel: string;
  statusLabel: string;
  statusTone: "queue" | "active" | "hold" | "done" | "bad";
  customerName: string;
  customerHandle: string;
  avatarUrl: string | null;
  details: string;
  queuePosition: number | null;
  ordersAhead: number | null;
  attachmentCount: number;
  staffName: string | null;
  orderedAt: string;
  /** Friendly place line, e.g. "You're #3 in queue · 2 vehicles" */
  placeMessage?: string | null;
  vehicleCount?: number | null;
  vehicleText?: string | null;
  currentLevel?: number | null;
  targetLevel?: number | null;
  tags?: string[] | null;
}

const TONE: Record<ServiceOrderCardView["statusTone"], { bg: string; fg: string }> = {
  queue: { bg: "rgba(52,152,219,0.14)", fg: "#1a6fa5" },
  active: { bg: "rgba(230,126,34,0.16)", fg: "#a85b12" },
  hold: { bg: "rgba(149,165,166,0.2)", fg: "#5c6b6d" },
  done: { bg: "rgba(46,204,113,0.16)", fg: "#1e7a45" },
  bad: { bg: "rgba(231,76,60,0.14)", fg: "#a83226" },
};

export async function renderServiceOrderCard(view: ServiceOrderCardView): Promise<Buffer> {
  const W = 980;
  const H = 620;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  card(ctx, 28, 28, W - 56, H - 56, { radius: 22 });

  text(ctx, (view.communityName || "CLAN").toUpperCase(), 56, 56, {
    size: 14,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, `ORDER ${view.publicId}`, 56, 92, {
    size: 32,
    weight: "bold",
    color: PALETTE.text,
  });

  const tone = TONE[view.statusTone];
  let px = 56;
  px +=
    pill(ctx, view.statusLabel, px, 132, {
      bg: tone.bg,
      color: tone.fg,
      size: 15,
      height: 32,
    }) + 12;
  pill(ctx, view.serviceLabel, px, 132, {
    bg: "rgba(63,81,224,0.12)",
    color: PALETTE.blurple,
    size: 15,
    height: 32,
  });

  const avatar = await fetchAvatar(view.avatarUrl);
  drawAvatar(ctx, avatar, W - 170, 56, 96, view.customerName[0] ?? "?", PALETTE.blurpleSoft);
  text(ctx, view.customerName, W - 170, 168, {
    size: 16,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 120,
  });
  text(ctx, `@${view.customerHandle}`, W - 170, 190, {
    size: 13,
    color: PALETTE.muted,
    maxWidth: 120,
  });

  if (view.placeMessage) {
    card(ctx, 56, 178, W - 280, 44, { radius: 12, fill: "rgba(63,81,224,0.08)" });
    text(ctx, view.placeMessage, 72, 192, {
      size: 16,
      weight: "bold",
      color: PALETTE.blurple,
      maxWidth: W - 320,
    });
  }

  const levelRange =
    view.currentLevel != null && view.targetLevel != null
      ? `${view.currentLevel} → ${view.targetLevel}`
      : "—";
  const vehicles =
    view.vehicleCount != null && view.vehicleCount > 0
      ? String(view.vehicleCount)
      : view.vehicleText
        ? "1+"
        : "—";

  const tiles: [string, string][] = [
    ["Queue", view.queuePosition != null ? `#${view.queuePosition}` : "—"],
    ["Vehicles", vehicles],
    ["Levels", levelRange],
    ["Files", String(view.attachmentCount)],
  ];
  let tx = 56;
  const tileY = view.placeMessage ? 240 : 190;
  for (const [label, value] of tiles) {
    card(ctx, tx, tileY, 200, 88, { radius: 14, fill: PALETTE.bg1 });
    text(ctx, label.toUpperCase(), tx + 18, tileY + 20, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, value, tx + 18, tileY + 52, {
      size: 22,
      weight: "bold",
      color: PALETTE.text,
      maxWidth: 164,
    });
    tx += 214;
  }

  let infoY = tileY + 110;
  if (view.tags && view.tags.length > 0) {
    let tagX = 56;
    for (const tag of view.tags.slice(0, 6)) {
      tagX +=
        pill(ctx, tag, tagX, infoY, {
          bg: "rgba(52,152,219,0.12)",
          color: "#1a6fa5",
          size: 13,
          height: 28,
        }) + 8;
    }
    infoY += 40;
  }

  text(ctx, "IMPORTANT INFORMATION", 56, infoY, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  ctx.font = "17px sans-serif";
  const lines = wrapText(ctx, view.details || "—", W - 140, 5);
  let ly = infoY + 28;
  for (const line of lines) {
    text(ctx, line, 56, ly, { size: 17, color: PALETTE.soft, maxWidth: W - 140 });
    ly += 26;
  }

  const staffLine = view.staffName ? `Staff: ${view.staffName}` : "Staff: Unclaimed";
  text(ctx, `Ordered ${view.orderedAt} · ${staffLine}`, 56, H - 64, {
    size: 14,
    color: PALETTE.muted,
    maxWidth: W - 280,
  });
  text(ctx, "Service tracking", W - 220, H - 64, {
    size: 14,
    color: PALETTE.muted,
  });

  return toPng(rc.canvas);
}
