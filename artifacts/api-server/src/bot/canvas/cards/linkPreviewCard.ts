/**
 * Avatar-link preview card — Discord face + Roblox face side by side.
 */
import {
  createSurface,
  paintBackground,
  card,
  text,
  fetchAvatar,
  drawAvatar,
  toPng,
  PALETTE,
} from "../theme";

export interface LinkPreviewCardView {
  title?: string;
  discordName: string;
  discordAvatarUrl: string | null;
  robloxName: string | null;
  robloxAvatarUrl: string | null;
  robloxUserId?: number | null;
  hint?: string;
  queueLabel?: string | null;
}

export async function renderLinkPreviewCard(view: LinkPreviewCardView): Promise<Buffer> {
  const W = 920;
  const H = 480;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "AVATAR LINK", 44, 44, { size: 15, weight: "bold", color: "#00a2ff" });
  text(ctx, view.title ?? "Match Discord → Roblox", 44, 88, {
    size: 32,
    weight: "bold",
    color: PALETTE.text,
  });
  text(
    ctx,
    view.hint ?? "Pick a Roblox user below. Their avatar will show on warnings & standing cards.",
    44,
    128,
    { size: 16, color: PALETTE.soft, maxWidth: W - 88 }
  );

  card(ctx, 44, 170, 390, 230, { radius: 20, shadow: false });
  const dImg = await fetchAvatar(view.discordAvatarUrl);
  drawAvatar(ctx, dImg, 170, 200, 120, view.discordName[0] ?? "?", PALETTE.blurpleSoft);
  text(ctx, "DISCORD", 64, 350, { size: 13, weight: "bold", color: PALETTE.muted });
  text(ctx, view.discordName, 64, 380, {
    size: 22,
    weight: "bold",
    color: PALETTE.text,
    maxWidth: 340,
  });

  card(ctx, 486, 170, 390, 230, { radius: 20, shadow: false });
  const rImg = await fetchAvatar(view.robloxAvatarUrl);
  drawAvatar(ctx, rImg, 612, 200, 120, (view.robloxName ?? "R")[0] ?? "R", "#00a2ff");
  text(ctx, "ROBLOX", 506, 350, { size: 13, weight: "bold", color: PALETTE.muted });
  text(ctx, view.robloxName ?? "Not linked yet", 506, 380, {
    size: 22,
    weight: "bold",
    color: view.robloxName ? PALETTE.text : PALETTE.muted,
    maxWidth: 340,
  });

  if (view.queueLabel) {
    text(ctx, view.queueLabel, 44, H - 28, { size: 14, color: PALETTE.muted, maxWidth: W - 88 });
  } else if (view.robloxUserId) {
    text(ctx, `Roblox ID ${view.robloxUserId}`, 44, H - 28, {
      size: 14,
      color: PALETTE.muted,
    });
  }

  return toPng(rc.canvas);
}
