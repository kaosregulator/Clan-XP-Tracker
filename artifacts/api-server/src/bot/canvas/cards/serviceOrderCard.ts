/**
 * Service-order card — live tracking snapshot for ticket + orders board.
 * Clear labeled fields: vehicle name, current level, target level, tags, queue.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
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
  /** e.g. "vehicle" / "character" — drives labeled fields. */
  itemNoun?: string | null;
  currentLevel?: number | null;
  targetLevel?: number | null;
  targetMaxed?: boolean;
  speedLabel?: string | null;
  quoteLine?: string | null;
  tags?: string[] | null;
  /** Order photos shown as a visible strip on the card. */
  photoUrls?: string[] | null;
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
  const photoCount = (view.photoUrls ?? []).length;
  const H = photoCount ? 820 : 700;
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
  px +=
    pill(ctx, view.serviceLabel, px, 132, {
      bg: "rgba(63,81,224,0.12)",
      color: PALETTE.blurple,
      size: 15,
      height: 32,
    }) + 12;
  if (view.speedLabel) {
    px +=
      pill(ctx, view.speedLabel, px, 132, {
        bg: "rgba(230,126,34,0.16)",
        color: "#a85b12",
        size: 14,
        height: 32,
      }) + 12;
  }
  if (view.quoteLine) {
    pill(ctx, view.quoteLine, px, 132, {
      bg: "rgba(46,204,113,0.14)",
      color: "#1e7a45",
      size: 14,
      height: 32,
    });
  }

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

  const tileY = view.placeMessage ? 240 : 190;
  const tiles: [string, string][] = [
    ["Queue", view.queuePosition != null ? `#${view.queuePosition}` : "—"],
    [
      "Ahead",
      view.ordersAhead != null ? String(view.ordersAhead) : "—",
    ],
    ["Files", String(view.attachmentCount)],
    ["Staff", view.staffName ?? "Unclaimed"],
  ];
  let tx = 56;
  for (const [label, value] of tiles) {
    card(ctx, tx, tileY, 200, 78, { radius: 14, fill: PALETTE.bg1 });
    text(ctx, label.toUpperCase(), tx + 18, tileY + 16, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, value, tx + 18, tileY + 44, {
      size: 22,
      weight: "bold",
      color: PALETTE.text,
      maxWidth: 164,
    });
    tx += 214;
  }

  // Clear labeled order facts — item name, current/target level, tags
  let infoY = tileY + 100;
  const noun = (view.itemNoun || "item").toUpperCase();
  const vehicleName =
    (view.vehicleText && view.vehicleText.trim()) ||
    (view.vehicleCount != null && view.vehicleCount > 0
      ? `${view.vehicleCount} ${view.itemNoun || "item"}(s)`
      : "—");

  card(ctx, 56, infoY, W - 112, 150, { radius: 14, fill: PALETTE.bg1 });

  text(ctx, `${noun} NAME`, 74, infoY + 16, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, vehicleName, 74, infoY + 40, {
    size: 20,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: W - 160,
  });

  text(ctx, "CURRENT LEVEL", 74, infoY + 78, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(
    ctx,
    view.currentLevel != null ? String(view.currentLevel) : "—",
    74,
    infoY + 102,
    { size: 22, weight: "bold", color: PALETTE.text }
  );

  text(ctx, "TARGET LEVEL", 280, infoY + 78, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(
    ctx,
    view.targetMaxed
      ? "maxed"
      : view.targetLevel != null
        ? String(view.targetLevel)
        : "—",
    280,
    infoY + 102,
    { size: 22, weight: "bold", color: PALETTE.text }
  );

  text(ctx, "TAGS", 480, infoY + 78, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  if (view.tags && view.tags.length > 0) {
    let tagX = 480;
    for (const tag of view.tags.slice(0, 4)) {
      const next =
        pill(ctx, tag, tagX, infoY + 100, {
          bg: "rgba(52,152,219,0.14)",
          color: "#1a6fa5",
          size: 12,
          height: 28,
        }) + 8;
      tagX += next;
      if (tagX > W - 140) break;
    }
  } else {
    text(ctx, "—", 480, infoY + 102, {
      size: 20,
      weight: "bold",
      color: PALETTE.text,
    });
  }

  infoY += 170;

  // Photo strip — small but clearly part of the ticket
  const photos = (view.photoUrls ?? []).slice(0, 5);
  if (photos.length) {
    text(ctx, "ORDER PHOTOS", 56, infoY, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    infoY += 18;
    const thumbW = 140;
    const thumbH = 96;
    let pxPhoto = 56;
    for (const url of photos) {
      const img = await fetchAvatar(url, 6000);
      ctx.save();
      roundThumb(ctx, pxPhoto, infoY, thumbW, thumbH, 10);
      ctx.clip();
      ctx.fillStyle = PALETTE.bg1;
      ctx.fillRect(pxPhoto, infoY, thumbW, thumbH);
      if (img) {
        const scale = Math.max(thumbW / img.width, thumbH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(
          img,
          pxPhoto + (thumbW - dw) / 2,
          infoY + (thumbH - dh) / 2,
          dw,
          dh
        );
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(63,81,224,0.35)";
      ctx.lineWidth = 2;
      roundThumb(ctx, pxPhoto, infoY, thumbW, thumbH, 10);
      ctx.stroke();
      pxPhoto += thumbW + 12;
    }
    infoY += thumbH + 18;
  }

  text(ctx, "IMPORTANT INFORMATION", 56, infoY, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  ctx.font = "17px sans-serif";
  // Prefer notes-only body when structured fields already shown above
  const detailBody = stripStructuredDetailLines(view.details);
  const lines = wrapText(ctx, detailBody || "—", W - 140, photos.length ? 2 : 4);
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
  text(
    ctx,
    photos.length ? `${photos.length} photo(s) on ticket` : "Live service tracking",
    W - 250,
    H - 64,
    {
      size: 14,
      color: photos.length ? PALETTE.blurple : PALETTE.muted,
    }
  );

  return toPng(rc.canvas);
}

function roundThumb(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stripStructuredDetailLines(details: string): string {
  return details
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^Service:/i.test(l) &&
        !/^Vehicle(?:\(s\)|s)?:/i.test(l) &&
        !/^Item(?:\(s\)|s)?:/i.test(l) &&
        !/^Levels?:/i.test(l) &&
        !/^Priority:/i.test(l) &&
        !/^Quote:/i.test(l) &&
        !/^Tags?:/i.test(l)
    )
    .join("\n");
}
