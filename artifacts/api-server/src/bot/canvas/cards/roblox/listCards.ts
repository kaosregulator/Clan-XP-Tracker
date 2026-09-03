import {
  createSurface,
  paintBackground,
  card,
  text,
  drawAvatar,
  drawRoundedImage,
  footerNote,
  loadRemote,
  toPng,
  RBX,
} from "./shared";

export interface GroupRowView {
  name: string;
  role: string;
  rank: number | null;
  iconUrl: string | null;
  highlight?: boolean;
}

export interface RobloxGroupsCardView {
  username: string;
  page: number;
  total: number;
  groups: GroupRowView[];
}

export async function renderRobloxGroupsCard(view: RobloxGroupsCardView): Promise<Buffer> {
  const W = 920;
  const rowH = 92;
  const H = 140 + view.groups.length * (rowH + 12) + 60;
  const rc = createSurface(W, Math.max(H, 360));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "ROBLOX GROUPS", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  text(ctx, view.username, 40, 88, {
    size: 30,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 200,
  });
  text(ctx, `${view.total} groups · page ${view.page + 1}`, W - 40, 88, {
    size: 16,
    color: RBX.muted,
    align: "right",
  });

  let y = 130;
  for (const g of view.groups) {
    card(ctx, 40, y, W - 80, rowH, {
      shadow: false,
      radius: 18,
      fill: g.highlight ? "rgba(0,162,255,0.08)" : "#ffffff",
    });
    const icon = await loadRemote(g.iconUrl);
    drawRoundedImage(ctx, icon, 58, y + 16, 60, 60, 14);
    text(ctx, g.name, 140, y + 40, {
      size: 22,
      weight: "bold",
      color: RBX.ink,
      maxWidth: W - 280,
    });
    const roleLine =
      g.rank != null ? `${g.role} · Rank ${g.rank}` : g.role;
    text(ctx, roleLine, 140, y + 70, {
      size: 17,
      color: RBX.soft,
      maxWidth: W - 280,
    });
    y += rowH + 12;
  }

  if (view.groups.length === 0) {
    text(ctx, "No public group memberships found.", 40, 180, {
      size: 20,
      color: RBX.soft,
    });
  }

  footerNote(ctx, W, rc.height, "Ranks shown only when returned by Roblox");
  return toPng(rc.canvas);
}

export interface BadgeRowView {
  name: string;
  id: number;
  iconUrl: string | null;
  awardedLabel: string | null;
  experience: string | null;
}

export interface RobloxBadgesCardView {
  title: string;
  subtitle: string;
  badges: BadgeRowView[];
  page: number;
}

export async function renderRobloxBadgesCard(view: RobloxBadgesCardView): Promise<Buffer> {
  const W = 920;
  const cols = 2;
  const rowH = 110;
  const rows = Math.ceil(view.badges.length / cols);
  const H = 140 + rows * (rowH + 12) + 50;
  const rc = createSurface(W, Math.max(H, 360));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "BADGES", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  text(ctx, view.title, 40, 88, {
    size: 28,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 200,
  });
  text(ctx, `${view.subtitle} · page ${view.page + 1}`, 40, 120, {
    size: 16,
    color: RBX.muted,
  });

  const colW = (W - 80 - 12) / cols;
  for (let i = 0; i < view.badges.length; i++) {
    const b = view.badges[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 40 + col * (colW + 12);
    const y = 150 + row * (rowH + 12);
    card(ctx, x, y, colW, rowH, { shadow: false, radius: 16 });
    const icon = await loadRemote(b.iconUrl);
    drawRoundedImage(ctx, icon, x + 16, y + 20, 70, 70, 14);
    text(ctx, b.name, x + 102, y + 40, {
      size: 18,
      weight: "bold",
      color: RBX.ink,
      maxWidth: colW - 120,
    });
    text(ctx, `ID ${b.id}`, x + 102, y + 68, { size: 14, color: RBX.muted });
    if (b.awardedLabel || b.experience) {
      text(ctx, b.awardedLabel || b.experience || "", x + 102, y + 90, {
        size: 14,
        color: RBX.soft,
        maxWidth: colW - 120,
      });
    }
  }

  if (view.badges.length === 0) {
    text(ctx, "No badges to show on this page.", 40, 180, { size: 20, color: RBX.soft });
  }
  return toPng(rc.canvas);
}

export interface FriendRowView {
  username: string;
  displayName: string;
  headshotUrl: string | null;
  presenceLabel?: string | null;
}

export interface RobloxFriendsCardView {
  title: string;
  subtitle: string;
  friends: FriendRowView[];
  page: number;
  totalLabel: string;
}

export async function renderRobloxFriendsCard(view: RobloxFriendsCardView): Promise<Buffer> {
  const W = 920;
  const cols = 2;
  const rowH = 88;
  const rows = Math.ceil(view.friends.length / cols);
  const H = 140 + rows * (rowH + 12) + 50;
  const rc = createSurface(W, Math.max(H, 360));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.title.toUpperCase(), 40, 48, {
    size: 16,
    weight: "bold",
    color: RBX.blueDeep,
  });
  text(ctx, view.subtitle, 40, 88, {
    size: 28,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 240,
  });
  text(ctx, `${view.totalLabel} · page ${view.page + 1}`, W - 40, 88, {
    size: 16,
    color: RBX.muted,
    align: "right",
  });

  const colW = (W - 80 - 12) / cols;
  for (let i = 0; i < view.friends.length; i++) {
    const f = view.friends[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 40 + col * (colW + 12);
    const y = 140 + row * (rowH + 12);
    card(ctx, x, y, colW, rowH, { shadow: false, radius: 16 });
    const img = await loadRemote(f.headshotUrl);
    drawAvatar(ctx, img, x + 16, y + 14, 60, f.username[0] ?? "?", RBX.blue);
    text(ctx, f.username, x + 92, y + 40, {
      size: 18,
      weight: "bold",
      color: RBX.ink,
      maxWidth: colW - 110,
    });
    text(ctx, f.displayName !== f.username ? f.displayName : " ", x + 92, y + 66, {
      size: 15,
      color: RBX.soft,
      maxWidth: colW - 110,
    });
  }

  if (view.friends.length === 0) {
    text(ctx, "Nothing to show here.", 40, 180, { size: 20, color: RBX.soft });
  }
  return toPng(rc.canvas);
}

export interface RobloxHistoryCardView {
  current: string;
  previous: string[];
}

export async function renderRobloxHistoryCard(view: RobloxHistoryCardView): Promise<Buffer> {
  const W = 720;
  const H = 160 + Math.max(view.previous.length, 1) * 48 + 80;
  const rc = createSurface(W, Math.max(H, 360));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "USERNAME HISTORY", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  text(ctx, "Current", 40, 100, { size: 14, weight: "bold", color: RBX.muted });
  text(ctx, view.current, 40, 136, { size: 32, weight: "bold", color: RBX.ink });

  text(ctx, "Previous", 40, 190, { size: 14, weight: "bold", color: RBX.muted });
  let y = 230;
  if (view.previous.length === 0) {
    text(ctx, "No previous usernames on record.", 40, y, { size: 18, color: RBX.soft });
  } else {
    for (let i = 0; i < view.previous.length; i++) {
      // timeline dot
      ctx.beginPath();
      ctx.arc(52, y - 6, 6, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? RBX.blue : RBX.muted;
      ctx.fill();
      if (i < view.previous.length - 1) {
        ctx.fillStyle = "rgba(124,131,151,0.35)";
        ctx.fillRect(51, y + 2, 2, 36);
      }
      text(ctx, view.previous[i]!, 76, y, { size: 20, color: RBX.ink, maxWidth: W - 120 });
      y += 48;
    }
  }
  return toPng(rc.canvas);
}

export interface RobloxStatusCardView {
  username: string;
  presenceLabel: string;
  presenceType: 0 | 1 | 2 | 3;
  gameName: string | null;
  placeId: number | null;
  universeId: number | null;
  lastLocation: string | null;
  avatarUrl: string | null;
}

export async function renderRobloxStatusCard(view: RobloxStatusCardView): Promise<Buffer> {
  const W = 820;
  const H = 420;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "ROBLOX STATUS", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  const avatar = await loadRemote(view.avatarUrl);
  drawAvatar(ctx, avatar, 40, 90, 120, view.username[0] ?? "?", RBX.blue);
  text(ctx, view.username, 190, 130, {
    size: 32,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 240,
  });

  const colors = [RBX.red, RBX.green, RBX.blueDeep, RBX.amber];
  card(ctx, 190, 160, W - 240, 180, { shadow: false, radius: 18 });
  text(ctx, view.presenceLabel, 220, 220, {
    size: 36,
    weight: "bold",
    color: colors[view.presenceType] ?? RBX.ink,
  });
  if (view.gameName) {
    text(ctx, view.gameName, 220, 265, {
      size: 22,
      color: RBX.ink,
      maxWidth: W - 300,
    });
  } else if (view.lastLocation) {
    text(ctx, view.lastLocation, 220, 265, {
      size: 20,
      color: RBX.soft,
      maxWidth: W - 300,
    });
  }
  const ids: string[] = [];
  if (view.placeId) ids.push(`Place ${view.placeId}`);
  if (view.universeId) ids.push(`Universe ${view.universeId}`);
  if (ids.length) {
    text(ctx, ids.join("  ·  "), 220, 310, { size: 15, color: RBX.muted });
  }
  return toPng(rc.canvas);
}
