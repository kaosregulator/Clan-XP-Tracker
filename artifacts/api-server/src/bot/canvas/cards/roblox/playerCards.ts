import {
  createSurface,
  paintBackground,
  card,
  text,
  drawAvatar,
  drawRoundedImage,
  presencePill,
  statTile,
  footerNote,
  loadRemote,
  toPng,
  RBX,
} from "./shared";

export interface RobloxHomeCardView {
  title?: string;
  hint?: string;
}

export async function renderRobloxHomeCard(view: RobloxHomeCardView = {}): Promise<Buffer> {
  const W = 920;
  const H = 520;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "ROBLOX HUB", 48, 56, { size: 18, weight: "bold", color: RBX.blueDeep });
  text(ctx, view.title ?? "Search for a Roblox user", 48, 110, {
    size: 40,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 96,
  });
  text(
    ctx,
    view.hint ??
      "Use /roblox user with autocomplete, or tap Search below to look up any player.",
    48,
    160,
    { size: 20, color: RBX.soft, maxWidth: W - 96 }
  );

  card(ctx, 48, 220, W - 96, 220, { radius: 22, shadow: false });
  text(ctx, "WHAT YOU CAN EXPLORE", 80, 270, {
    size: 14,
    weight: "bold",
    color: RBX.muted,
  });
  const lines = [
    "Profiles, presence, and avatar views",
    "Groups & ranks · Friends · Followers",
    "Badges · Username history · Public inventory",
    "Experiences, servers, and Military Tycoon",
  ];
  let y = 310;
  for (const line of lines) {
    ctx.beginPath();
    ctx.arc(88, y - 6, 5, 0, Math.PI * 2);
    ctx.fillStyle = RBX.blue;
    ctx.fill();
    text(ctx, line, 108, y, { size: 20, color: RBX.ink, maxWidth: W - 180 });
    y += 36;
  }

  footerNote(ctx, W, H, "Public Roblox data only · No cookies · No private game stats");
  return toPng(rc.canvas);
}

export interface RobloxPlayerCardView {
  username: string;
  displayName: string;
  userId: number;
  avatarUrl: string | null;
  presenceLabel: string;
  presenceType: 0 | 1 | 2 | 3;
  currentGame: string | null;
  friendCount: string | null;
  followerCount: string | null;
  followingCount: string | null;
  groupCount: string | null;
  badgeCount: string | null;
  createdLabel: string | null;
  verified?: boolean;
  banned?: boolean;
}

export async function renderRobloxPlayerCard(view: RobloxPlayerCardView): Promise<Buffer> {
  const W = 960;
  const H = 620;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "ROBLOX", 48, 48, { size: 16, weight: "bold", color: RBX.blueDeep });

  const avatar = await loadRemote(view.avatarUrl);
  const avatarSize = 180;
  const ax = (W - avatarSize) / 2;
  drawAvatar(ctx, avatar, ax, 70, avatarSize, view.username[0] ?? "?", RBX.blue);

  const nameY = 290;
  text(ctx, view.username, W / 2, nameY, {
    size: 36,
    weight: "bold",
    color: RBX.ink,
    align: "center",
    maxWidth: W - 120,
  });
  if (view.displayName && view.displayName !== view.username) {
    text(ctx, `Display Name: ${view.displayName}`, W / 2, nameY + 36, {
      size: 20,
      color: RBX.soft,
      align: "center",
      maxWidth: W - 120,
    });
  }

  let pillX = W / 2 - 80;
  const pw = presencePill(ctx, pillX, nameY + 60, view.presenceLabel, view.presenceType);
  pillX += pw + 12;
  if (view.currentGame) {
    text(ctx, view.currentGame, W / 2, nameY + 120, {
      size: 18,
      color: RBX.blueDeep,
      align: "center",
      maxWidth: W - 160,
    });
  }

  const stats: Array<[string, string | null]> = [
    ["Friends", view.friendCount],
    ["Followers", view.followerCount],
    ["Following", view.followingCount],
    ["Groups", view.groupCount],
    ["Badges", view.badgeCount],
  ];
  const visible = stats.filter(([, v]) => v != null) as Array<[string, string]>;
  const tileW = 150;
  const gap = 14;
  const totalW = visible.length * tileW + (visible.length - 1) * gap;
  let tx = (W - totalW) / 2;
  const ty = 460;
  for (const [label, value] of visible) {
    statTile(ctx, tx, ty, tileW, 78, label, value);
    tx += tileW + gap;
  }

  const metaBits = [`User ID: ${view.userId}`];
  if (view.createdLabel) metaBits.push(`Created: ${view.createdLabel}`);
  if (view.verified) metaBits.push("Verified Badge");
  if (view.banned) metaBits.push("Account flagged banned (public)");
  text(ctx, metaBits.join("  ·  "), W / 2, H - 36, {
    size: 15,
    color: view.banned ? RBX.red : RBX.muted,
    align: "center",
    maxWidth: W - 80,
  });

  return toPng(rc.canvas);
}

export interface RobloxProfileCardView extends RobloxPlayerCardView {
  description: string;
}

export async function renderRobloxProfileCard(view: RobloxProfileCardView): Promise<Buffer> {
  const W = 960;
  const H = 680;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "ROBLOX PROFILE", 48, 48, { size: 16, weight: "bold", color: RBX.blueDeep });

  const avatar = await loadRemote(view.avatarUrl);
  drawAvatar(ctx, avatar, 48, 80, 160, view.username[0] ?? "?", RBX.blue);

  text(ctx, view.username, 240, 130, {
    size: 34,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 280,
  });
  text(ctx, view.displayName, 240, 170, {
    size: 20,
    color: RBX.soft,
    maxWidth: W - 280,
  });
  presencePill(ctx, 240, 196, view.presenceLabel, view.presenceType);
  if (view.currentGame) {
    text(ctx, `Playing ${view.currentGame}`, 240, 250, {
      size: 18,
      color: RBX.blueDeep,
      maxWidth: W - 280,
    });
  }

  card(ctx, 48, 280, W - 96, 140, { shadow: false, radius: 18 });
  text(ctx, "ABOUT", 72, 318, { size: 13, weight: "bold", color: RBX.muted });
  const about = view.description?.trim() || "No public description.";
  text(ctx, about.replace(/\s+/g, " ").slice(0, 280), 72, 350, {
    size: 18,
    color: RBX.ink,
    maxWidth: W - 160,
  });

  const stats: Array<[string, string | null]> = [
    ["Friends", view.friendCount],
    ["Followers", view.followerCount],
    ["Following", view.followingCount],
    ["Groups", view.groupCount],
    ["Badges", view.badgeCount],
  ];
  let sx = 48;
  for (const [label, value] of stats) {
    if (value == null) continue;
    statTile(ctx, sx, 450, 160, 78, label, value);
    sx += 174;
  }

  const meta = [`ID ${view.userId}`];
  if (view.createdLabel) meta.push(view.createdLabel);
  text(ctx, meta.join("  ·  "), 48, H - 36, { size: 15, color: RBX.muted, maxWidth: W - 96 });

  return toPng(rc.canvas);
}

export interface RobloxAvatarCardView {
  username: string;
  viewLabel: string;
  imageUrl: string | null;
  wearingCount?: number | null;
}

export async function renderRobloxAvatarCard(view: RobloxAvatarCardView): Promise<Buffer> {
  const W = 720;
  const H = 780;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "AVATAR", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  text(ctx, view.username, 40, 88, {
    size: 30,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 80,
  });
  text(ctx, view.viewLabel, 40, 124, { size: 18, color: RBX.soft });

  const img = await loadRemote(view.imageUrl);
  drawRoundedImage(ctx, img, 80, 160, W - 160, W - 160, 28);

  if (view.wearingCount != null) {
    text(ctx, `Currently wearing ${view.wearingCount} assets`, 40, H - 36, {
      size: 16,
      color: RBX.muted,
    });
  }
  return toPng(rc.canvas);
}
