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
  PALETTE,
} from "./shared";

export interface RobloxGameCardView {
  name: string;
  description: string;
  creator: string;
  creatorType: string;
  playing: string;
  visits: string;
  favorites: string;
  likes: string | null;
  updated: string | null;
  created: string | null;
  universeId: number;
  placeId: number;
  iconUrl: string | null;
  thumbnailUrl: string | null;
  accentLabel?: string;
}

export async function renderRobloxGameCard(view: RobloxGameCardView): Promise<Buffer> {
  const W = 960;
  const H = 720;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, view.accentLabel ?? "EXPERIENCE", 40, 42, {
    size: 16,
    weight: "bold",
    color: RBX.blueDeep,
  });

  const thumb = await loadRemote(view.thumbnailUrl || view.iconUrl);
  drawRoundedImage(ctx, thumb, 40, 70, W - 80, 280, 22);

  text(ctx, view.name, 48, 400, {
    size: 34,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 96,
  });
  text(ctx, `${view.creatorType}: ${view.creator}`, 48, 440, {
    size: 18,
    color: RBX.soft,
    maxWidth: W - 96,
  });

  const tiles: Array<[string, string]> = [
    ["Players", view.playing],
    ["Visits", view.visits],
    ["Favorites", view.favorites],
  ];
  if (view.likes) tiles.push(["Likes", view.likes]);
  let tx = 48;
  for (const [label, value] of tiles) {
    statTile(ctx, tx, 470, 200, 78, label, value);
    tx += 214;
  }

  const meta: string[] = [];
  if (view.updated) meta.push(`Updated ${view.updated}`);
  if (view.created) meta.push(`Created ${view.created}`);
  meta.push(`Universe ${view.universeId}`);
  meta.push(`Place ${view.placeId}`);
  text(ctx, meta.join("  ·  "), 48, 580, {
    size: 15,
    color: RBX.muted,
    maxWidth: W - 96,
  });

  const desc = view.description.replace(/\s+/g, " ").trim();
  if (desc) {
    ctx.font = "18px Outfit";
    const lines = wrapText(ctx, desc, W - 96, 2);
    let dy = 620;
    for (const line of lines) {
      text(ctx, line, 48, dy, { size: 17, color: RBX.soft, maxWidth: W - 96 });
      dy += 28;
    }
  }

  return toPng(rc.canvas);
}

export interface ServerRowView {
  label: string;
  players: string;
  jobShort: string;
}

export interface RobloxServersCardView {
  gameName: string;
  servers: ServerRowView[];
  page: number;
}

export async function renderRobloxServersCard(view: RobloxServersCardView): Promise<Buffer> {
  const W = 860;
  const rowH = 78;
  const H = 140 + Math.max(view.servers.length, 1) * (rowH + 12) + 50;
  const rc = createSurface(W, Math.max(H, 360));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "SERVER BROWSER", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  text(ctx, view.gameName, 40, 88, {
    size: 28,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 200,
  });
  text(ctx, `Page ${view.page + 1}`, W - 40, 88, {
    size: 16,
    color: RBX.muted,
    align: "right",
  });

  let y = 130;
  if (view.servers.length === 0) {
    text(ctx, "No public servers available right now.", 40, 180, {
      size: 20,
      color: RBX.soft,
    });
  } else {
    for (const s of view.servers) {
      card(ctx, 40, y, W - 80, rowH, { shadow: false, radius: 16 });
      ctx.beginPath();
      ctx.arc(72, y + rowH / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = RBX.green;
      ctx.fill();
      text(ctx, s.label, 100, y + 34, {
        size: 20,
        weight: "bold",
        color: RBX.ink,
      });
      text(ctx, `Players ${s.players}`, 100, y + 60, {
        size: 16,
        color: RBX.soft,
      });
      text(ctx, s.jobShort, W - 60, y + rowH / 2 + 6, {
        size: 14,
        color: RBX.muted,
        align: "right",
        family: "mono",
      });
      y += rowH + 12;
    }
  }
  footerNote(ctx, W, rc.height, "Public server list · Job IDs shortened");
  return toPng(rc.canvas);
}

export interface RobloxInventoryCardView {
  username: string;
  items: Array<{ name: string; id: number; meta: string | null }>;
  page: number;
  note?: string;
}

export async function renderRobloxInventoryCard(view: RobloxInventoryCardView): Promise<Buffer> {
  const W = 860;
  const H = 140 + Math.max(view.items.length, 1) * 52 + 70;
  const rc = createSurface(W, Math.max(H, 360));
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "PUBLIC INVENTORY", 40, 48, { size: 16, weight: "bold", color: RBX.blueDeep });
  text(ctx, view.username, 40, 88, {
    size: 28,
    weight: "bold",
    color: RBX.ink,
  });
  text(ctx, `Page ${view.page + 1}`, W - 40, 88, {
    size: 16,
    color: RBX.muted,
    align: "right",
  });

  let y = 140;
  if (view.items.length === 0) {
    text(ctx, view.note ?? "No public inventory items on this page.", 40, 180, {
      size: 20,
      color: RBX.soft,
      maxWidth: W - 80,
    });
  } else {
    for (const item of view.items) {
      card(ctx, 40, y, W - 80, 44, {
        shadow: false,
        radius: 12,
        fill: PALETTE.cardAlt,
      });
      text(ctx, item.name, 56, y + 28, {
        size: 17,
        weight: "bold",
        color: RBX.ink,
        maxWidth: W - 280,
      });
      text(ctx, item.meta || `ID ${item.id}`, W - 56, y + 28, {
        size: 14,
        color: RBX.muted,
        align: "right",
      });
      y += 52;
    }
  }
  footerNote(ctx, W, rc.height, "Only public inventory data · No cookies");
  return toPng(rc.canvas);
}

export interface MilitaryProfileCardView {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  presenceLabel: string;
  presenceType: 0 | 1 | 2 | 3;
  gameName: string | null;
  isPlayingMT: boolean;
  groupName: string;
  roleName: string | null;
  rank: number | null;
  groupIconUrl: string | null;
  playing: string | null;
  visits: string | null;
}

export async function renderMilitaryProfileCard(view: MilitaryProfileCardView): Promise<Buffer> {
  const W = 920;
  const H = 560;
  const rc = createSurface(W, H);
  const { ctx } = rc;
  paintBackground(rc);

  text(ctx, "MILITARY TYCOON PLAYER", 40, 48, {
    size: 16,
    weight: "bold",
    color: RBX.blueDeep,
  });

  const avatar = await loadRemote(view.avatarUrl);
  drawRoundedImage(ctx, avatar, 40, 90, 160, 160, 20);

  text(ctx, view.username, 230, 130, {
    size: 32,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 280,
  });
  text(ctx, view.displayName, 230, 168, { size: 18, color: RBX.soft });
  text(ctx, view.presenceLabel, 230, 210, {
    size: 20,
    weight: "bold",
    color: view.presenceType === 0 ? RBX.red : view.presenceType === 2 ? RBX.blueDeep : RBX.green,
  });
  if (view.gameName) {
    text(ctx, view.gameName, 230, 244, { size: 18, color: RBX.ink, maxWidth: W - 280 });
  }
  if (view.isPlayingMT) {
    text(ctx, "Currently in Military Tycoon", 230, 278, {
      size: 16,
      weight: "bold",
      color: RBX.blueDeep,
    });
  }

  card(ctx, 40, 290, W - 80, 140, { shadow: false, radius: 18 });
  const gIcon = await loadRemote(view.groupIconUrl);
  drawRoundedImage(ctx, gIcon, 64, 318, 84, 84, 16);
  text(ctx, view.groupName, 170, 350, {
    size: 24,
    weight: "bold",
    color: RBX.ink,
  });
  const role =
    view.roleName != null
      ? view.rank != null
        ? `${view.roleName} · Rank ${view.rank}`
        : view.roleName
      : "Not a group member";
  text(ctx, role, 170, 386, { size: 18, color: RBX.soft });

  text(
    ctx,
    "Public Roblox data only — no private XP, cash, vehicles, or base stats.",
    40,
    H - 36,
    { size: 14, color: RBX.muted, maxWidth: W - 80 }
  );

  return toPng(rc.canvas);
}

export interface ItemsCardView {
  title: string;
  subtitle: string;
  items: Array<{ name: string; meta: string; iconUrl: string | null }>;
  page: number;
}

export async function renderRobloxItemsCard(view: ItemsCardView): Promise<Buffer> {
  const W = 920;
  const cols = 2;
  const rowH = 100;
  const rows = Math.ceil(Math.max(view.items.length, 1) / cols);
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
    size: 26,
    weight: "bold",
    color: RBX.ink,
    maxWidth: W - 160,
  });

  if (view.items.length === 0) {
    text(ctx, "No public items found.", 40, 180, { size: 20, color: RBX.soft });
  } else {
    const colW = (W - 80 - 12) / cols;
    for (let i = 0; i < view.items.length; i++) {
      const item = view.items[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 40 + col * (colW + 12);
      const y = 140 + row * (rowH + 12);
      card(ctx, x, y, colW, rowH, { shadow: false, radius: 16 });
      const icon = await loadRemote(item.iconUrl);
      drawRoundedImage(ctx, icon, x + 16, y + 18, 64, 64, 12);
      text(ctx, item.name, x + 96, y + 42, {
        size: 18,
        weight: "bold",
        color: RBX.ink,
        maxWidth: colW - 120,
      });
      text(ctx, item.meta, x + 96, y + 70, {
        size: 14,
        color: RBX.muted,
        maxWidth: colW - 120,
      });
    }
  }
  return toPng(rc.canvas);
}
