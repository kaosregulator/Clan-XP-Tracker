/**
 * Public leveling-service review card — stars, staff/customer faces, before/after photos.
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

export interface ServiceOrderReviewCardView {
  communityName: string;
  publicId: string;
  serviceLabel: string;
  customerName: string;
  customerHandle: string;
  customerAvatarUrl: string | null;
  staffName: string | null;
  staffAvatarUrl: string | null;
  speedRating: number;
  qualityRating: number;
  wouldRecommend: boolean;
  comment: string | null;
  startedAt: string;
  completedAt: string;
  photoUrls: string[];
}

function drawStars(ctx: SKRSContext2D, rating: number, x: number, y: number): void {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const label = "★".repeat(filled) + "☆".repeat(5 - filled);
  text(ctx, label, x, y, {
    size: 28,
    weight: "bold",
    color: "#e6a817",
  });
}

export async function renderServiceOrderReviewCard(
  view: ServiceOrderReviewCardView
): Promise<Buffer> {
  const W = 980;
  const H = view.photoUrls.length ? 720 : 560;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  card(ctx, 28, 28, W - 56, H - 56, { radius: 22 });

  text(ctx, (view.communityName || "CLAN").toUpperCase(), 56, 56, {
    size: 14,
    weight: "bold",
    color: PALETTE.muted,
  });
  text(ctx, "SERVICE REVIEW", 56, 88, {
    size: 14,
    weight: "bold",
    color: "#e6a817",
  });
  text(ctx, `${view.publicId} · ${view.serviceLabel}`, 56, 118, {
    size: 28,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: W - 280,
  });

  pill(ctx, view.wouldRecommend ? "Would recommend" : "Would not recommend", 56, 160, {
    bg: view.wouldRecommend ? "rgba(46,204,113,0.16)" : "rgba(231,76,60,0.14)",
    color: view.wouldRecommend ? "#1e7a45" : "#a83226",
    size: 14,
    height: 30,
  });

  const customerAvatar = await fetchAvatar(view.customerAvatarUrl);
  drawAvatar(
    ctx,
    customerAvatar,
    W - 170,
    56,
    88,
    view.customerName[0] ?? "?",
    PALETTE.blurpleSoft
  );
  text(ctx, view.customerName, W - 170, 158, {
    size: 14,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 120,
  });

  if (view.staffName) {
    const staffAvatar = await fetchAvatar(view.staffAvatarUrl);
    drawAvatar(ctx, staffAvatar, W - 280, 56, 64, view.staffName[0] ?? "S", "#e6a817");
    text(ctx, "Completed by", W - 280, 132, {
      size: 11,
      color: PALETTE.muted,
      maxWidth: 90,
    });
    text(ctx, view.staffName, W - 280, 148, {
      size: 13,
      weight: "bold",
      color: PALETTE.text,
      maxWidth: 90,
    });
  }

  card(ctx, 56, 210, 280, 110, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, "SPEED", 74, 228, { size: 12, weight: "bold", color: PALETTE.muted });
  drawStars(ctx, view.speedRating, 74, 258);

  card(ctx, 352, 210, 280, 110, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, "QUALITY", 370, 228, { size: 12, weight: "bold", color: PALETTE.muted });
  drawStars(ctx, view.qualityRating, 370, 258);

  card(ctx, 648, 210, 276, 110, { radius: 14, fill: PALETTE.bg1 });
  text(ctx, "DATES", 666, 228, { size: 12, weight: "bold", color: PALETTE.muted });
  text(ctx, `Start ${view.startedAt}`, 666, 258, {
    size: 13,
    color: PALETTE.soft,
    maxWidth: 240,
  });
  text(ctx, `Done ${view.completedAt}`, 666, 280, {
    size: 13,
    color: PALETTE.soft,
    maxWidth: 240,
  });

  let y = 350;
  if (view.comment) {
    text(ctx, "COMMENT", 56, y, { size: 12, weight: "bold", color: PALETTE.muted });
    ctx.font = "17px sans-serif";
    const lines = wrapText(ctx, view.comment, W - 140, 3);
    y += 28;
    for (const line of lines) {
      text(ctx, line, 56, y, { size: 17, color: PALETTE.soft, maxWidth: W - 140 });
      y += 24;
    }
    y += 12;
  }

  if (view.photoUrls.length) {
    text(ctx, "BEFORE / AFTER PHOTOS", 56, y, {
      size: 12,
      weight: "bold",
      color: PALETTE.muted,
    });
    y += 20;
    const thumbW = 160;
    const thumbH = 120;
    let x = 56;
    for (const url of view.photoUrls.slice(0, 5)) {
      const img = await fetchAvatar(url, 6000);
      ctx.save();
      roundRect(ctx, x, y, thumbW, thumbH, 12);
      ctx.clip();
      ctx.fillStyle = PALETTE.bg1;
      ctx.fillRect(x, y, thumbW, thumbH);
      if (img) {
        const scale = Math.max(thumbW / img.width, thumbH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, x + (thumbW - dw) / 2, y + (thumbH - dh) / 2, dw, dh);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, thumbW, thumbH, 12);
      ctx.stroke();
      x += thumbW + 14;
    }
  }

  text(ctx, "Leveling service review", 56, H - 56, {
    size: 13,
    color: PALETTE.muted,
  });

  return toPng(rc.canvas);
}

function roundRect(
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
