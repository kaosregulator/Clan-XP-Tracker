/**
 * Service-order card — live tracking snapshot for ticket + orders board.
 * Clean layout: status + big quote up top, order facts, large uncropped photos.
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
  /** Order photos shown large on the card (letterboxed, not cropped). */
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
  const photos = (view.photoUrls ?? []).slice(0, 5);
  const photoRows = photos.length ? Math.ceil(photos.length / 3) : 0;
  const photoBlockH = photos.length ? 28 + photoRows * 210 : 0;
  const notesBody = stripStructuredDetailLines(view.details);
  const notesLines = notesBody ? Math.min(3, notesBody.split(/\n/).length) : 0;
  const notesH = notesLines ? 36 + notesLines * 26 : 0;

  const W = 980;
  // Header + quote + facts + photos + optional notes + footer padding
  const H = 56 + 200 + 150 + 24 + photoBlockH + notesH + 72;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  card(ctx, 28, 28, W - 56, H - 56, { radius: 22 });

  // —— Header ——
  text(ctx, (view.communityName || "CLAN").toUpperCase(), 56, 52, {
    size: 13,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, `ORDER ${view.publicId}`, 56, 84, {
    size: 30,
    weight: "bold",
    color: PALETTE.text,
  });

  const tone = TONE[view.statusTone];
  let px = 56;
  px +=
    pill(ctx, view.statusLabel, px, 122, {
      bg: tone.bg,
      color: tone.fg,
      size: 15,
      height: 30,
    }) + 10;
  px +=
    pill(ctx, view.serviceLabel, px, 122, {
      bg: "rgba(63,81,224,0.12)",
      color: PALETTE.blurple,
      size: 14,
      height: 30,
    }) + 10;
  if (view.speedLabel) {
    pill(ctx, view.speedLabel, px, 122, {
      bg: "rgba(230,126,34,0.16)",
      color: "#a85b12",
      size: 14,
      height: 30,
    });
  }

  const avatar = await fetchAvatar(view.avatarUrl);
  drawAvatar(ctx, avatar, W - 150, 48, 80, view.customerName[0] ?? "?", PALETTE.blurpleSoft);
  text(ctx, view.customerName, W - 150, 140, {
    size: 14,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 110,
  });

  // —— Queue strip (status lives here — no second embed needed) ——
  const queueY = 168;
  card(ctx, 56, queueY, W - 280, 48, { radius: 12, fill: "rgba(63,81,224,0.10)" });
  text(
    ctx,
    view.placeMessage ||
      (view.queuePosition != null
        ? `Queue #${view.queuePosition}`
        : view.statusLabel),
    72,
    queueY + 14,
    {
      size: 17,
      weight: "bold",
      color: PALETTE.blurple,
      maxWidth: W - 320,
    }
  );

  // —— Big quote + staff/files ——
  const quoteY = 232;
  const quoteW = 360;
  card(ctx, 56, quoteY, quoteW, 100, {
    radius: 14,
    fill: "rgba(46,204,113,0.10)",
  });
  text(ctx, "ESTIMATED QUOTE", 74, quoteY + 16, {
    size: 12,
    weight: "bold",
    color: "#1e7a45",
  });
  text(ctx, view.quoteLine?.trim() || "Staff will confirm", 74, quoteY + 48, {
    size: view.quoteLine ? 26 : 20,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: quoteW - 40,
  });

  card(ctx, 56 + quoteW + 16, quoteY, 200, 100, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, "QUEUE", 74 + quoteW + 16, quoteY + 16, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(
    ctx,
    view.queuePosition != null ? `#${view.queuePosition}` : "—",
    74 + quoteW + 16,
    quoteY + 48,
    { size: 28, weight: "bold", color: PALETTE.text }
  );

  card(ctx, 56 + quoteW + 16 + 216, quoteY, 200, 100, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, "STAFF", 74 + quoteW + 16 + 216, quoteY + 16, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, view.staffName ?? "Unclaimed", 74 + quoteW + 16 + 216, quoteY + 48, {
    size: 22,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 168,
  });

  // —— Order facts (single clean row) ——
  let infoY = quoteY + 120;
  const noun = (view.itemNoun || "item").toUpperCase();
  const vehicleName =
    (view.vehicleText && view.vehicleText.trim()) ||
    (view.vehicleCount != null && view.vehicleCount > 0
      ? `${view.vehicleCount} ${view.itemNoun || "item"}(s)`
      : "—");
  const targetLabel = view.targetMaxed
    ? "maxed"
    : view.targetLevel != null
      ? String(view.targetLevel)
      : "—";

  card(ctx, 56, infoY, W - 112, 118, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, `${noun}`, 74, infoY + 14, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, vehicleName, 74, infoY + 38, {
    size: 22,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: W - 160,
  });

  text(ctx, "CURRENT → TARGET", 74, infoY + 72, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(
    ctx,
    `${view.currentLevel != null ? view.currentLevel : "—"}  →  ${targetLabel}`,
    74,
    infoY + 92,
    { size: 20, weight: "bold", color: PALETTE.text }
  );

  if (view.speedLabel) {
    text(ctx, "PRIORITY", 420, infoY + 72, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    text(ctx, view.speedLabel, 420, infoY + 92, {
      size: 18,
      weight: "bold",
      color: PALETTE.text,
      maxWidth: 220,
    });
  }

  text(ctx, "PHOTOS", 700, infoY + 72, {
    size: 12,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, String(view.attachmentCount), 700, infoY + 92, {
    size: 20,
    weight: "bold",
    color: PALETTE.text,
  });

  infoY += 134;

  // —— Large letterboxed photos (never crop) ——
  if (photos.length) {
    text(ctx, "ORDER PHOTOS", 56, infoY, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    infoY += 22;
    const gap = 14;
    const cols = Math.min(3, photos.length);
    const thumbW = Math.floor((W - 112 - gap * (cols - 1)) / cols);
    const thumbH = 190;
    for (let i = 0; i < photos.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const pxPhoto = 56 + col * (thumbW + gap);
      const pyPhoto = infoY + row * (thumbH + gap);
      const img = await fetchAvatar(photos[i]!, 10_000);
      ctx.save();
      roundThumb(ctx, pxPhoto, pyPhoto, thumbW, thumbH, 12);
      ctx.clip();
      ctx.fillStyle = "#e8eaf0";
      ctx.fillRect(pxPhoto, pyPhoto, thumbW, thumbH);
      if (img) {
        // contain — full photo visible, letterboxed
        const scale = Math.min(thumbW / img.width, thumbH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(
          img,
          pxPhoto + (thumbW - dw) / 2,
          pyPhoto + (thumbH - dh) / 2,
          dw,
          dh
        );
      } else {
        text(ctx, "📷", pxPhoto + thumbW / 2, pyPhoto + thumbH / 2 - 8, {
          size: 28,
          align: "center",
          baseline: "middle",
          color: PALETTE.muted,
        });
        text(ctx, "Use View Pics", pxPhoto + thumbW / 2, pyPhoto + thumbH / 2 + 24, {
          size: 14,
          align: "center",
          baseline: "middle",
          color: PALETTE.muted,
        });
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(63,81,224,0.28)";
      ctx.lineWidth = 2;
      roundThumb(ctx, pxPhoto, pyPhoto, thumbW, thumbH, 12);
      ctx.stroke();
    }
    infoY += photoRows * (thumbH + gap) + 8;
  }

  if (notesBody) {
    text(ctx, "NOTES", 56, infoY, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    ctx.font = "16px sans-serif";
    const lines = wrapText(ctx, notesBody, W - 140, 3);
    let ly = infoY + 26;
    for (const line of lines) {
      text(ctx, line, 56, ly, { size: 16, color: PALETTE.soft, maxWidth: W - 140 });
      ly += 24;
    }
  }

  const staffLine = view.staffName ? `Staff: ${view.staffName}` : "Staff: Unclaimed";
  text(ctx, `Ordered ${view.orderedAt} · ${staffLine}`, 56, H - 56, {
    size: 13,
    color: PALETTE.muted,
    maxWidth: W - 280,
  });
  text(
    ctx,
    photos.length ? `${photos.length} photo(s) · tap View Pics for full size` : "Live order card",
    W - 380,
    H - 56,
    {
      size: 13,
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
