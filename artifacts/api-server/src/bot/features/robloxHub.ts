/**
 * Roblox Hub — unified Discord UI for public Roblox data.
 *
 * Slash commands (/roblox, /military + shortcuts) all open the same hub
 * message. Navigation updates that message in place. Session state is keyed by
 * the hub message id and owned by the Discord user who opened it.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  type AutocompleteInteraction,
  type BaseMessageOptions,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { renderOffThread } from "../canvas/render-pool";
import {
  NS,
  parseId,
  RBX_NAV,
  RBX_PAGE,
  RBX_REFRESH,
  RBX_SEARCH,
  RBX_SEARCH_MODAL,
  RBX_AVATAR_VIEW,
  RBX_PICK_FRIEND,
  RBX_BACK,
} from "../ui/ids";
import {
  RobloxService,
  toUserError,
  logRobloxError,
  type AvatarView,
  type HubView,
  type PlayerCardData,
  type RobloxGame,
} from "../services/roblox";
import { getCurrentlyWearing } from "../services/roblox/thumbnails";

/* ------------------------------------------------------------------ state */

interface HubState {
  ownerId: string;
  view: HubView;
  robloxUserId: number | null;
  page: number;
  cursor: string | null;
  cursorStack: Array<string | null>;
  avatarView: AvatarView;
  gameUniverseId: number | null;
  gamePlaceId: number | null;
  returnView: HubView | null;
  ts: number;
}

const HUB_TTL_MS = 20 * 60_000;
const hubs = new Map<string, HubState>();

function pruneHubs() {
  const cutoff = Date.now() - HUB_TTL_MS;
  for (const [k, v] of hubs) if (v.ts < cutoff) hubs.delete(k);
}

function touch(state: HubState) {
  state.ts = Date.now();
}

function getHub(messageId: string, userId: string): HubState | null {
  pruneHubs();
  const st = hubs.get(messageId);
  if (!st) return null;
  if (st.ownerId !== userId) return null;
  touch(st);
  return st;
}

function bindHub(messageId: string, state: HubState) {
  pruneHubs();
  hubs.set(messageId, state);
}

function freshState(ownerId: string, patch: Partial<HubState> = {}): HubState {
  return {
    ownerId,
    view: "home",
    robloxUserId: null,
    page: 0,
    cursor: null,
    cursorStack: [],
    avatarView: "fullBody",
    gameUniverseId: null,
    gamePlaceId: null,
    returnView: null,
    ts: Date.now(),
    ...patch,
  };
}

function resetPaging(st: HubState) {
  st.page = 0;
  st.cursor = null;
  st.cursorStack = [];
}

/* --------------------------------------------------------------- formatters */

function createdLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function presenceLabel(card: PlayerCardData): { label: string; type: 0 | 1 | 2 | 3 } {
  const t = (card.presence?.userPresenceType ?? 0) as 0 | 1 | 2 | 3;
  const base = RobloxService.PRESENCE_EMOJI[t] + " " + RobloxService.PRESENCE_LABEL[t];
  if (t === 2 && card.currentGameName) {
    return { label: `${RobloxService.PRESENCE_EMOJI[2]} Playing`, type: t };
  }
  return { label: base, type: t };
}

function fmt(n: number | null | undefined): string | null {
  if (n == null) return null;
  return RobloxService.formatCount(n);
}

function shortJob(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/* -------------------------------------------------------------- components */

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function btn(customId: string, label: string, style: ButtonStyle = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function navRows(st: HubState, opts: { hasPrev?: boolean; hasNext?: boolean; extra?: Row[] } = {}): Row[] {
  const hasUser = st.robloxUserId != null;
  const primary: Row[] = [];

  if (st.view === "home" || st.view === "search") {
    primary.push(row(btn(RBX_SEARCH, "Search User", ButtonStyle.Primary)));
    return primary;
  }

  if (st.view === "player" || st.view === "profile") {
    primary.push(
      row(
        btn(RBX_NAV("profile"), "Profile", st.view === "profile" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        btn(RBX_NAV("games"), "Games"),
        btn(RBX_NAV("groups"), "Groups"),
        btn(RBX_NAV("badges"), "Badges"),
        btn(RBX_NAV("avatar"), "Avatar")
      ),
      row(
        btn(RBX_NAV("friends"), "Friends"),
        btn(RBX_NAV("status"), "Status"),
        btn(RBX_NAV("history"), "History"),
        btn(RBX_NAV("inventory"), "Inventory"),
        btn(RBX_NAV("military"), "Military Tycoon")
      ),
      row(
        btn(RBX_NAV("passes"), "Game Passes"),
        btn(RBX_SEARCH, "Search User"),
        btn(RBX_REFRESH, "Refresh", ButtonStyle.Primary)
      )
    );
    return primary;
  }

  // Sub-views: back + pagination + search
  const nav: MessageActionRowComponentBuilder[] = [
    btn(RBX_BACK, "Back"),
    btn(RBX_NAV("player"), "Player Card", hasUser ? ButtonStyle.Secondary : ButtonStyle.Secondary, !hasUser),
  ];
  if (opts.hasPrev || opts.hasNext) {
    nav.push(btn(RBX_PAGE("prev"), "◀ Prev", ButtonStyle.Secondary, !opts.hasPrev));
    nav.push(btn(RBX_PAGE("next"), "Next ▶", ButtonStyle.Secondary, !opts.hasNext));
  }
  nav.push(btn(RBX_SEARCH, "Search"));

  const rows: Row[] = [row(...nav.slice(0, 5))];
  if (opts.extra) rows.push(...opts.extra);

  if (st.view === "military" || st.view.startsWith("military") || st.view === "passes" || st.view === "passesOnSale" || st.view === "integration") {
    rows.unshift(
      row(
        btn(RBX_NAV("militaryPlayer"), "Player", ButtonStyle.Primary, !hasUser),
        btn(RBX_NAV("militaryRank"), "My Rank", ButtonStyle.Secondary, !hasUser),
        btn(RBX_NAV("military"), "Game"),
        btn(RBX_NAV("militaryBadges"), "Badges"),
        btn(RBX_NAV("servers"), "Servers")
      ),
      row(
        btn(RBX_NAV("passes"), "All Passes"),
        btn(RBX_NAV("passesOnSale"), "On Sale"),
        btn(RBX_NAV("militaryItems"), "My Passes", ButtonStyle.Secondary, !hasUser),
        btn(RBX_NAV("integration"), "Integrate"),
        btn(RBX_REFRESH, "Refresh")
      )
    );
  }

  if (st.view === "game" || st.view === "games") {
    rows.unshift(
      row(
        btn(RBX_NAV("servers"), "Servers"),
        btn(RBX_NAV("badges"), "Badges"),
        btn(RBX_REFRESH, "Refresh")
      )
    );
  }

  return rows;
}

/* --------------------------------------------------------------- renderers */

async function fileFrom(fn: string, params: unknown, name: string): Promise<AttachmentBuilder> {
  const png = await renderOffThread(fn, params);
  return new AttachmentBuilder(png, { name });
}

async function buildHome(): Promise<BaseMessageOptions> {
  const file = await fileFrom("robloxHome", {}, "roblox-hub.png");
  return {
    embeds: [],
    files: [file],
    components: navRows(freshState("")),
  };
}

async function buildPlayer(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const card = await RobloxService.getPlayerCardData(st.robloxUserId);
  const p = presenceLabel(card);
  const file = await fileFrom(
    st.view === "profile" ? "robloxProfile" : "robloxPlayer",
    {
      username: card.user.name,
      displayName: card.user.displayName,
      userId: card.user.id,
      avatarUrl: card.thumbs.fullBody || card.thumbs.headshot,
      presenceLabel: p.label,
      presenceType: p.type,
      currentGame: card.currentGameName,
      friendCount: fmt(card.friendCount),
      followerCount: fmt(card.followerCount),
      followingCount: fmt(card.followingCount),
      groupCount: fmt(card.groupCount),
      badgeCount: card.badgeCount != null ? (card.badgeCount > 10 ? "10+" : String(card.badgeCount)) : null,
      createdLabel: createdLabel(card.user.created),
      verified: card.user.hasVerifiedBadge,
      banned: card.user.isBanned,
      description: card.user.description,
    },
    st.view === "profile" ? "roblox-profile.png" : "roblox-player.png"
  );

  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open on Roblox")
          .setURL(RobloxService.ROBLOX_PROFILE_URL(card.user.id))
      ),
    ],
  };
}

async function buildAvatar(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const [user, thumbs, wearing] = await Promise.all([
    RobloxService.getUserById(st.robloxUserId),
    RobloxService.getUserThumbnails(st.robloxUserId),
    getCurrentlyWearing(st.robloxUserId).catch(() => [] as number[]),
  ]);
  const url =
    st.avatarView === "headshot"
      ? thumbs.headshot
      : st.avatarView === "bust"
        ? thumbs.bust
        : thumbs.fullBody;
  const labels: Record<AvatarView, string> = {
    headshot: "Headshot",
    bust: "Bust",
    fullBody: "Full Body",
  };
  const file = await fileFrom(
    "robloxAvatar",
    {
      username: user.name,
      viewLabel: labels[st.avatarView],
      imageUrl: url,
      wearingCount: wearing.length || null,
    },
    "roblox-avatar.png"
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(RBX_AVATAR_VIEW)
    .setPlaceholder("Avatar view")
    .addOptions(
      { label: "Full Body", value: "fullBody", default: st.avatarView === "fullBody" },
      { label: "Bust", value: "bust", default: st.avatarView === "bust" },
      { label: "Headshot", value: "headshot", default: st.avatarView === "headshot" }
    );
  return {
    files: [file],
    components: [row(select), ...navRows(st)],
  };
}

async function buildGroups(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const user = await RobloxService.getUserById(st.robloxUserId);
  const page = await RobloxService.getUserGroupsPage(st.robloxUserId, st.page, 6);
  const file = await fileFrom(
    "robloxGroups",
    {
      username: user.name,
      page: page.page,
      total: page.total,
      groups: page.items.map((g) => ({
        name: g.groupName,
        role: g.roleName,
        rank: g.rank,
        iconUrl: g.groupIconUrl,
        highlight: g.groupId === RobloxService.INFINITY_INTERACTIVE_GROUP_ID,
      })),
    },
    "roblox-groups.png"
  );
  return {
    files: [file],
    components: navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore }),
  };
}

async function buildBadges(st: HubState): Promise<BaseMessageOptions> {
  // Player-specific Military Tycoon badges (best-effort intersection).
  if (st.view === "militaryBadges" && st.robloxUserId) {
    const user = await RobloxService.getUserById(st.robloxUserId);
    const badges = await RobloxService.military.getMilitaryBadgesForUser(st.robloxUserId);
    const start = st.page * 10;
    const slice = badges.slice(start, start + 10);
    const file = await fileFrom(
      "robloxBadges",
      {
        title: user.name,
        subtitle: "Military Tycoon badges (public match)",
        page: st.page,
        badges: slice.map((b) => ({
          name: b.displayName || b.name,
          id: b.id,
          iconUrl: b.iconUrl,
          awardedLabel: b.awardedDate ? createdLabel(b.awardedDate) : null,
          experience: RobloxService.MILITARY_TYCOON_NAME,
        })),
      },
      "military-badges.png"
    );
    return {
      files: [file],
      components: navRows(st, {
        hasPrev: st.page > 0,
        hasNext: start + 10 < badges.length,
      }),
    };
  }

  const universeId =
    st.view === "militaryBadges"
      ? RobloxService.MILITARY_TYCOON_UNIVERSE_ID
      : st.gameUniverseId;

  if (universeId && (st.view === "militaryBadges" || (st.view === "badges" && !st.robloxUserId))) {
    const page = await RobloxService.getUniverseBadgesPage(universeId, st.page, st.cursor);
    const game =
      universeId === RobloxService.MILITARY_TYCOON_UNIVERSE_ID
        ? RobloxService.MILITARY_TYCOON_NAME
        : `Universe ${universeId}`;
    const file = await fileFrom(
      "robloxBadges",
      {
        title: game,
        subtitle: "Experience badges",
        page: st.page,
        badges: page.items.map((b) => ({
          name: b.displayName || b.name,
          id: b.id,
          iconUrl: b.iconUrl,
          awardedLabel: null,
          experience: null,
        })),
      },
      "roblox-badges.png"
    );
    return {
      files: [file],
      components: navRows(st, {
        hasPrev: st.page > 0,
        hasNext: page.hasMore,
      }),
    };
  }

  if (!st.robloxUserId) return buildHome();
  const user = await RobloxService.getUserById(st.robloxUserId);
  const page = await RobloxService.getUserBadgesPage(st.robloxUserId, st.page, st.cursor);
  const file = await fileFrom(
    "robloxBadges",
    {
      title: user.name,
      subtitle: "Earned badges",
      page: st.page,
      badges: page.items.map((b) => ({
        name: b.displayName || b.name,
        id: b.id,
        iconUrl: b.iconUrl,
        awardedLabel: b.awardedDate ? createdLabel(b.awardedDate) : null,
        experience: null,
      })),
    },
    "roblox-badges.png"
  );
  // stash next cursor on state for page next
  (st as HubState & { _next?: string | null })._next = page.nextCursor ?? null;
  return {
    files: [file],
    components: navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore }),
  };
}

async function buildFriends(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const user = await RobloxService.getUserById(st.robloxUserId);
  const kind = st.view === "followers" ? "followers" : st.view === "following" ? "following" : "friends";

  let page;
  let totalLabel: string;
  if (kind === "friends") {
    page = await RobloxService.getFriendsPage(st.robloxUserId, st.page, 8);
    totalLabel = `${page.total} friends`;
  } else if (kind === "followers") {
    page = await RobloxService.getFollowersPage(st.robloxUserId, st.page, st.cursor);
    const count = await RobloxService.getFollowerCount(st.robloxUserId).catch(() => null);
    totalLabel = count != null ? `${RobloxService.formatCount(count)} followers` : "Followers";
  } else {
    page = await RobloxService.getFollowingPage(st.robloxUserId, st.page, st.cursor);
    const count = await RobloxService.getFollowingCount(st.robloxUserId).catch(() => null);
    totalLabel = count != null ? `${RobloxService.formatCount(count)} following` : "Following";
  }

  (st as HubState & { _next?: string | null })._next = page.nextCursor ?? null;

  const file = await fileFrom(
    "robloxFriends",
    {
      title: kind,
      subtitle: user.name,
      page: st.page,
      totalLabel,
      friends: page.items.map((f) => ({
        username: f.name,
        displayName: f.displayName,
        headshotUrl: f.headshotUrl,
      })),
    },
    "roblox-friends.png"
  );

  const components = navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore });
  if (kind === "friends" && page.items.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(RBX_PICK_FRIEND)
      .setPlaceholder("Open a friend's profile")
      .addOptions(
        page.items.slice(0, 25).map((f) => ({
          label: f.name.slice(0, 100),
          description: f.displayName !== f.name ? f.displayName.slice(0, 100) : `ID ${f.id}`,
          value: String(f.id),
        }))
      );
    components.unshift(row(select));
  } else if (kind === "friends") {
    components.unshift(
      row(
        btn(RBX_NAV("followers"), "Followers"),
        btn(RBX_NAV("following"), "Following")
      )
    );
  }

  return { files: [file], components };
}

async function buildHistory(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const user = await RobloxService.getUserById(st.robloxUserId);
  const previous = await RobloxService.getUsernameHistory(st.robloxUserId, 25);
  const file = await fileFrom(
    "robloxHistory",
    { current: user.name, previous },
    "roblox-history.png"
  );
  return { files: [file], components: navRows(st) };
}

async function buildStatus(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const card = await RobloxService.getPlayerCardData(st.robloxUserId);
  const p = presenceLabel(card);
  const file = await fileFrom(
    "robloxStatus",
    {
      username: card.user.name,
      presenceLabel: p.label,
      presenceType: p.type,
      gameName: card.currentGameName,
      placeId: card.presence?.placeId ?? card.presence?.rootPlaceId ?? null,
      universeId: card.presence?.universeId ?? null,
      lastLocation: card.presence?.lastLocation ?? null,
      avatarUrl: card.thumbs.headshot,
    },
    "roblox-status.png"
  );
  return { files: [file], components: navRows(st) };
}

async function buildInventory(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildHome();
  const user = await RobloxService.getUserById(st.robloxUserId);
  try {
    const page = await RobloxService.getPublicInventoryPage(st.robloxUserId, st.page, st.cursor);
    (st as HubState & { _next?: string | null })._next = page.nextCursor ?? null;
    const file = await fileFrom(
      "robloxInventory",
      {
        username: user.name,
        page: st.page,
        items: page.items.map((i) => ({
          name: i.name,
          id: i.assetId,
          meta: i.recentAveragePrice != null ? `RAP ${i.recentAveragePrice}` : null,
        })),
      },
      "roblox-inventory.png"
    );
    return {
      files: [file],
      components: navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore }),
    };
  } catch (err) {
    const file = await fileFrom(
      "robloxInventory",
      {
        username: user.name,
        page: 0,
        items: [],
        note: toUserError(err),
      },
      "roblox-inventory.png"
    );
    return { files: [file], components: navRows(st) };
  }
}

async function buildGameCard(game: RobloxGame, st: HubState, accent?: string): Promise<BaseMessageOptions> {
  st.gameUniverseId = game.universeId;
  st.gamePlaceId = game.rootPlaceId;
  const likes =
    game.upVotes != null
      ? RobloxService.formatCount(game.upVotes) +
        (game.downVotes != null ? ` / ${RobloxService.formatCount(game.downVotes)}` : "")
      : null;
  const file = await fileFrom(
    "robloxGame",
    {
      name: game.name,
      description: game.description,
      creator: game.creator.name,
      creatorType: game.creator.type,
      playing: RobloxService.formatCount(game.playing),
      visits: RobloxService.formatCount(game.visits),
      favorites: RobloxService.formatCount(game.favoritedCount),
      likes,
      updated: createdLabel(game.updated),
      created: createdLabel(game.created),
      universeId: game.universeId,
      placeId: game.rootPlaceId,
      iconUrl: game.iconUrl,
      thumbnailUrl: game.thumbnailUrl,
      accentLabel: accent,
    },
    "roblox-game.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Play on Roblox")
          .setURL(RobloxService.ROBLOX_GAME_URL(game.rootPlaceId))
      ),
    ],
  };
}

async function buildGames(st: HubState): Promise<BaseMessageOptions> {
  if (st.gameUniverseId && st.view === "game") {
    const game = await RobloxService.getGameByUniverseId(st.gameUniverseId);
    return buildGameCard(game, st);
  }
  if (!st.robloxUserId) return buildHome();
  const user = await RobloxService.getUserById(st.robloxUserId);
  const page = await RobloxService.getUserGames(st.robloxUserId, st.page, 10);
  (st as HubState & { _next?: string | null })._next = page.nextCursor ?? null;

  // Reuse friends card layout for a simple list, or items card.
  const file = await fileFrom(
    "robloxItems",
    {
      title: "Experiences",
      subtitle: `${user.name}'s creations`,
      page: st.page,
      items: page.items.map((g) => ({
        name: g.name,
        meta: `${RobloxService.formatCount(g.playing)} playing · ${RobloxService.formatCount(g.visits)} visits`,
        iconUrl: g.iconUrl,
      })),
    },
    "roblox-games.png"
  );

  const components = navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore });
  if (page.items.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("rbx:pickGame")
      .setPlaceholder("Open an experience")
      .addOptions(
        page.items.slice(0, 25).map((g) => ({
          label: g.name.slice(0, 100),
          description: `Universe ${g.universeId}`.slice(0, 100),
          value: String(g.universeId),
        }))
      );
    components.unshift(row(select));
  }
  return { files: [file], components };
}

async function buildServers(st: HubState): Promise<BaseMessageOptions> {
  const placeId =
    st.gamePlaceId ??
    (st.view.startsWith("military")
      ? RobloxService.MILITARY_TYCOON_PLACE_ID
      : RobloxService.MILITARY_TYCOON_PLACE_ID);

  let gameName = "Experience";
  try {
    if (st.gameUniverseId) {
      const g = await RobloxService.getGameByUniverseId(st.gameUniverseId);
      gameName = g.name;
      st.gamePlaceId = g.rootPlaceId;
    } else {
      const g = await RobloxService.getGameByPlaceId(placeId);
      gameName = g.name;
      st.gameUniverseId = g.universeId;
      st.gamePlaceId = g.rootPlaceId;
    }
  } catch {
    /* keep default */
  }

  const resolvedPlaceId = st.gamePlaceId ?? placeId;
  const page = await RobloxService.getPublicServers(resolvedPlaceId, st.page, st.cursor);
  (st as HubState & { _next?: string | null })._next = page.nextCursor ?? null;

  const file = await fileFrom(
    "robloxServers",
    {
      gameName,
      page: st.page,
      servers: page.items.map((s, i) => ({
        label: `Server ${st.page * 10 + i + 1}`,
        players: `${s.playing}/${s.maxPlayers}`,
        jobShort: shortJob(s.id),
      })),
    },
    "roblox-servers.png"
  );
  return {
    files: [file],
    components: navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore }),
  };
}

async function buildMilitary(st: HubState): Promise<BaseMessageOptions> {
  const game = await RobloxService.military.getMilitaryGame();
  st.view = "military";
  return buildGameCard(game, st, "MILITARY TYCOON");
}

async function buildMilitaryPlayer(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildMilitary(st);
  const data = await RobloxService.military.getMilitaryPlayer(st.robloxUserId);
  const t = (data.presence?.userPresenceType ?? 0) as 0 | 1 | 2 | 3;
  const file = await fileFrom(
    "robloxMilitaryProfile",
    {
      username: data.user.name,
      displayName: data.user.displayName,
      avatarUrl: data.thumbs.fullBody || data.thumbs.headshot,
      presenceLabel: `${RobloxService.PRESENCE_EMOJI[t]} ${RobloxService.PRESENCE_LABEL[t]}`,
      presenceType: t,
      gameName: data.currentGameName,
      isPlayingMT: data.isPlayingMilitaryTycoon,
      groupName: RobloxService.INFINITY_INTERACTIVE_NAME,
      roleName: data.groupMembership?.roleName ?? null,
      rank: data.groupMembership?.rank ?? null,
      groupIconUrl: data.groupMembership?.groupIconUrl ?? null,
      playing: data.game ? RobloxService.formatCount(data.game.playing) : null,
      visits: data.game ? RobloxService.formatCount(data.game.visits) : null,
    },
    "military-player.png"
  );
  return { files: [file], components: navRows(st) };
}

async function buildMilitaryRank(st: HubState): Promise<BaseMessageOptions> {
  if (!st.robloxUserId) return buildMilitary(st);
  // Reuse groups card highlighting InfinityInteractive.
  const user = await RobloxService.getUserById(st.robloxUserId);
  const membership = await RobloxService.getGroupMembership(
    st.robloxUserId,
    RobloxService.INFINITY_INTERACTIVE_GROUP_ID
  );
  const group = await RobloxService.getGroupDetails(RobloxService.INFINITY_INTERACTIVE_GROUP_ID);
  const file = await fileFrom(
    "robloxGroups",
    {
      username: user.name,
      page: 0,
      total: membership ? 1 : 0,
      groups: membership
        ? [
            {
              name: group.name,
              role: membership.roleName,
              rank: membership.rank,
              iconUrl: membership.groupIconUrl || group.iconUrl,
              highlight: true,
            },
          ]
        : [
            {
              name: group.name,
              role: "Not a member",
              rank: null,
              iconUrl: group.iconUrl,
              highlight: false,
            },
          ],
    },
    "military-rank.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open Community")
          .setURL(RobloxService.ROBLOX_GROUP_URL(RobloxService.INFINITY_INTERACTIVE_GROUP_ID))
      ),
    ],
  };
}

async function buildMilitaryItems(st: HubState): Promise<BaseMessageOptions> {
  // When a user is selected, show ownership against the MT pass catalog.
  if (st.robloxUserId) {
    const page = await RobloxService.military.getMilitaryPassesForUser(
      st.robloxUserId,
      st.cursor
    );
    (st as HubState & { _next?: string | null })._next = page.nextPageToken;
    const user = await RobloxService.getUserById(st.robloxUserId);
    const file = await fileFrom(
      "robloxItems",
      {
        title: "Game Passes",
        subtitle: `${user.name} · Military Tycoon`,
        page: st.page,
        items: page.items.map((p) => ({
          name: p.displayName || p.name,
          meta:
            (p.isForSale ? "On sale" : "Not for sale") +
            (p.price != null ? ` · R$ ${p.price}` : ""),
          iconUrl: p.iconUrl,
          owned: p.owned,
        })),
      },
      "military-passes-owned.png"
    );
    const linkRows: Row[] = [];
    const sale = page.items.filter((p) => p.isForSale).slice(0, 5);
    if (sale.length) {
      linkRows.push(
        row(
          ...sale.map((p) =>
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(p.displayName.slice(0, 70))
              .setURL(p.url)
          )
        )
      );
    }
    return {
      files: [file],
      components: [...navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore }), ...linkRows],
    };
  }
  return buildPasses(st, "all");
}

async function buildPasses(
  st: HubState,
  filter: "all" | "onsale" = st.view === "passesOnSale" ? "onsale" : "all"
): Promise<BaseMessageOptions> {
  const universeId = st.gameUniverseId ?? RobloxService.MILITARY_TYCOON_UNIVERSE_ID;
  const page = await RobloxService.listUniverseGamePasses(universeId, {
    pageToken: st.cursor,
    count: 12,
    filter,
  });
  (st as HubState & { _next?: string | null })._next = page.nextPageToken;

  let items = page.items;
  if (st.robloxUserId) {
    items = await RobloxService.withOwnership(st.robloxUserId, items);
  }

  const title =
    universeId === RobloxService.MILITARY_TYCOON_UNIVERSE_ID
      ? RobloxService.MILITARY_TYCOON_NAME
      : `Universe ${universeId}`;

  const file = await fileFrom(
    "robloxItems",
    {
      title: filter === "onsale" ? "Passes on sale" : "Game Passes",
      subtitle: title,
      page: st.page,
      items: items.map((p) => ({
        name: p.displayName || p.name,
        meta:
          (p.isForSale ? "On sale" : "Off sale") +
          (p.price != null ? ` · R$ ${p.price}` : "") +
          ` · #${p.id}`,
        iconUrl: p.iconUrl,
        owned: p.owned,
      })),
    },
    "roblox-passes.png"
  );

  // Up to 5 store links (Discord allows 5 buttons per row).
  const linkTargets = (filter === "onsale" ? items.filter((p) => p.isForSale) : items).slice(0, 5);
  const components = [
    ...navRows(st, { hasPrev: st.page > 0, hasNext: page.hasMore }),
    ...(linkTargets.length
      ? [
          row(
            ...linkTargets.map((p) =>
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel((p.displayName || "Pass").slice(0, 70))
                .setURL(p.url)
            )
          ),
        ]
      : []),
    row(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Open experience")
        .setURL(
          RobloxService.ROBLOX_GAME_URL(
            st.gamePlaceId ?? RobloxService.MILITARY_TYCOON_PLACE_ID
          )
        )
    ),
  ];

  return { files: [file], components };
}

async function buildIntegration(st: HubState): Promise<BaseMessageOptions> {
  const snap = await RobloxService.military.getMtIntegrationSnapshot();
  const file = await fileFrom(
    "robloxIntegration",
    {
      title: "Military Tycoon · public surface",
      lines: [
        { label: "Players now", value: RobloxService.formatCount(snap.game.playing) },
        { label: "Visits", value: RobloxService.formatCount(snap.game.visits) },
        { label: "Favorites", value: RobloxService.formatCount(snap.game.favoritedCount) },
        {
          label: "Votes",
          value:
            snap.game.upVotes != null
              ? `${RobloxService.formatCount(snap.game.upVotes)} / ${RobloxService.formatCount(snap.game.downVotes ?? 0)}`
              : "—",
        },
        { label: "Community", value: `${snap.group.name} · ${RobloxService.formatCount(snap.group.memberCount)}` },
        { label: "Group roles", value: String(snap.roles.length) },
        { label: "Group experiences", value: String(snap.experiences.length) },
        {
          label: "Game passes (sample)",
          value: `${snap.passesTotalSample}${snap.passesTotalSample > 50 ? "+" : ""} · ${snap.passesForSale} on sale`,
        },
        { label: "Badges (sample)", value: String(snap.badgeSampleCount) },
        {
          label: "In-game XP / DataStores",
          value: snap.openCloudConfigured
            ? "Key set — needs II authorization"
            : "Needs InfinityInteractive Open Cloud key",
        },
        {
          label: "Clan XP in Discord",
          value: "Already handled by ClanXP (/xp) — link via gameUsername",
        },
      ],
      note: "Public Roblox only · No cookies · No private MT stats · No alt-hunting",
    },
    "mt-integration.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Play Military Tycoon")
          .setURL(RobloxService.ROBLOX_GAME_URL(RobloxService.MILITARY_TYCOON_PLACE_ID)),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("InfinityInteractive")
          .setURL(RobloxService.ROBLOX_GROUP_URL(RobloxService.INFINITY_INTERACTIVE_GROUP_ID))
      ),
    ],
  };
}

async function buildView(st: HubState): Promise<BaseMessageOptions> {
  switch (st.view) {
    case "home":
    case "search":
      return buildHome();
    case "player":
    case "profile":
      return buildPlayer(st);
    case "avatar":
      return buildAvatar(st);
    case "groups":
      return buildGroups(st);
    case "badges":
    case "militaryBadges":
      return buildBadges(st);
    case "friends":
    case "followers":
    case "following":
      return buildFriends(st);
    case "history":
      return buildHistory(st);
    case "status":
      return buildStatus(st);
    case "inventory":
      return buildInventory(st);
    case "games":
    case "game":
      return buildGames(st);
    case "servers":
      return buildServers(st);
    case "military":
      return buildMilitary(st);
    case "militaryPlayer":
      return buildMilitaryPlayer(st);
    case "militaryRank":
      return buildMilitaryRank(st);
    case "militaryItems":
      return buildMilitaryItems(st);
    case "passes":
      return buildPasses(st, "all");
    case "passesOnSale":
      return buildPasses(st, "onsale");
    case "integration":
      return buildIntegration(st);
    default:
      return buildHome();
  }
}

/* ----------------------------------------------------------- open helpers */

async function replyHub(
  interaction: ChatInputCommandInteraction,
  state: HubState
): Promise<void> {
  await interaction.deferReply({ flags: 64 });
  try {
    const payload = await buildView(state);
    const msg = await interaction.editReply(payload);
    bindHub(msg.id, state);
  } catch (err) {
    logRobloxError("replyHub", err);
    await interaction.editReply({ content: toUserError(err), components: [], files: [], embeds: [] });
  }
}

async function updateHub(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  state: HubState
): Promise<void> {
  try {
    const payload = await buildView(state);
    await interaction.editReply(payload);
    bindHub(interaction.message!.id, state);
  } catch (err) {
    logRobloxError("updateHub", err);
    await interaction.editReply({ content: toUserError(err), components: [], files: [] });
  }
}

function assertOwner(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction
): HubState | null {
  const st = getHub(interaction.message!.id, interaction.user.id);
  return st;
}

/* -------------------------------------------------------------- commands */

export async function handleRobloxAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "username" && focused.name !== "user" && focused.name !== "game") {
    await interaction.respond([]);
    return;
  }
  const q = String(focused.value ?? "").trim();
  if (q.length < 2) {
    await interaction.respond([]);
    return;
  }
  try {
    if (focused.name === "game") {
      const hits = await RobloxService.searchGames(q, 8);
      await interaction.respond(
        hits.map((h) => ({
          name: `${h.name}`.slice(0, 100),
          value: String(h.universeId),
        }))
      );
      return;
    }
    const hits = await RobloxService.searchUsers(q, 10);
    await interaction.respond(
      hits.slice(0, 25).map((h) => ({
        name: `${h.displayName} (@${h.name})`.slice(0, 100),
        value: String(h.id),
      }))
    );
  } catch (err) {
    logRobloxError("autocomplete", err);
    await interaction.respond([]).catch(() => {});
  }
}

export async function handleRobloxCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(false);
  const ownerId = interaction.user.id;

  // Bare /roblox hub or /roblox search → home hub
  if (!sub || sub === "hub" || sub === "search") {
    return replyHub(interaction, freshState(ownerId, { view: "home" }));
  }

  try {
    if (sub === "user" || sub === "profile" || sub === "avatar" ||
        sub === "status" || sub === "groups" || sub === "friends" || sub === "followers" ||
        sub === "following" || sub === "badges" || sub === "history" || sub === "inventory") {
      const raw =
        interaction.options.getString("username") ??
        interaction.options.getString("user") ??
        "";
      if (!raw) {
        await interaction.reply({
          content: "Provide a Roblox username (autocomplete available).",
          flags: 64,
        });
        return;
      }
      const user = /^\d+$/.test(raw)
        ? await RobloxService.getUserById(Number(raw))
        : await RobloxService.resolveUsername(raw);

      const viewMap: Record<string, HubView> = {
        user: "player",
        profile: "profile",
        avatar: "avatar",
        status: "status",
        groups: "groups",
        friends: "friends",
        followers: "followers",
        following: "following",
        badges: "badges",
        history: "history",
        inventory: "inventory",
      };
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: viewMap[sub] ?? "player",
          robloxUserId: user.id,
        })
      );
    }

    if (sub === "game") {
      const q = interaction.options.getString("game", true);
      const game = await RobloxService.resolveGame(q);
      const st = freshState(ownerId, {
        view: "game",
        gameUniverseId: game.universeId,
        gamePlaceId: game.rootPlaceId,
      });
      return replyHub(interaction, st);
    }

    if (sub === "servers") {
      const q = interaction.options.getString("game");
      const game = q
        ? await RobloxService.resolveGame(q)
        : await RobloxService.military.getMilitaryGame();
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: "servers",
          gameUniverseId: game.universeId,
          gamePlaceId: game.rootPlaceId,
        })
      );
    }

    if (sub === "passes") {
      const q = interaction.options.getString("game");
      const onsale = interaction.options.getBoolean("onsale") ?? false;
      const game = q
        ? await RobloxService.resolveGame(q)
        : await RobloxService.military.getMilitaryGame();
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: onsale ? "passesOnSale" : "passes",
          gameUniverseId: game.universeId,
          gamePlaceId: game.rootPlaceId,
        })
      );
    }

    // default
    return replyHub(interaction, freshState(ownerId, { view: "home" }));
  } catch (err) {
    logRobloxError("handleRobloxCommand", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: toUserError(err) });
    } else {
      await interaction.reply({ content: toUserError(err), flags: 64 });
    }
  }
}

export async function handleMilitaryCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(false);
  const ownerId = interaction.user.id;

  try {
    if (!sub || sub === "game") {
      return replyHub(interaction, freshState(ownerId, { view: "military" }));
    }
    if (sub === "group") {
      // Show InfinityInteractive via military rank view without a user → game+group link
      const st = freshState(ownerId, { view: "military" });
      await interaction.deferReply({ flags: 64 });
      const group = await RobloxService.getGroupDetails(RobloxService.INFINITY_INTERACTIVE_GROUP_ID);
      const game = await RobloxService.military.getMilitaryGame();
      const file = await fileFrom(
        "robloxGame",
        {
          name: group.name,
          description: group.description || game.description,
          creator: "Community",
          creatorType: "Group",
          playing: RobloxService.formatCount(group.memberCount),
          visits: RobloxService.formatCount(game.visits),
          favorites: RobloxService.formatCount(game.favoritedCount),
          likes: null,
          updated: null,
          created: null,
          universeId: game.universeId,
          placeId: game.rootPlaceId,
          iconUrl: group.iconUrl,
          thumbnailUrl: game.thumbnailUrl,
          accentLabel: "INFINITYINTERACTIVE",
        },
        "military-group.png"
      );
      const msg = await interaction.editReply({
        files: [file],
        components: [
          ...navRows(st),
          row(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel("Open Community")
              .setURL(RobloxService.ROBLOX_GROUP_URL(group.id))
          ),
        ],
      });
      bindHub(msg.id, st);
      return;
    }
    if (sub === "servers") {
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: "servers",
          gameUniverseId: RobloxService.MILITARY_TYCOON_UNIVERSE_ID,
          gamePlaceId: RobloxService.MILITARY_TYCOON_PLACE_ID,
        })
      );
    }
    if (sub === "items" || sub === "passes") {
      const raw = interaction.options.getString("username");
      const onsale = interaction.options.getBoolean("onsale") ?? false;
      let robloxUserId: number | null = null;
      if (raw) {
        const user = /^\d+$/.test(raw)
          ? await RobloxService.getUserById(Number(raw))
          : await RobloxService.resolveUsername(raw);
        robloxUserId = user.id;
      }
      return replyHub(
        interaction,
        freshState(ownerId, {
          view:
            sub === "items" && robloxUserId
              ? "militaryItems"
              : onsale
                ? "passesOnSale"
                : "passes",
          robloxUserId,
          gameUniverseId: RobloxService.MILITARY_TYCOON_UNIVERSE_ID,
          gamePlaceId: RobloxService.MILITARY_TYCOON_PLACE_ID,
        })
      );
    }
    if (sub === "integrate") {
      return replyHub(interaction, freshState(ownerId, { view: "integration" }));
    }
    if (sub === "badges") {
      const raw = interaction.options.getString("username");
      if (raw) {
        const user = /^\d+$/.test(raw)
          ? await RobloxService.getUserById(Number(raw))
          : await RobloxService.resolveUsername(raw);
        return replyHub(
          interaction,
          freshState(ownerId, { view: "militaryBadges", robloxUserId: user.id })
        );
      }
      return replyHub(interaction, freshState(ownerId, { view: "militaryBadges" }));
    }
    if (sub === "search") {
      return replyHub(interaction, freshState(ownerId, { view: "home" }));
    }
    if (sub === "player" || sub === "rank" || sub === "profile") {
      const raw = interaction.options.getString("username", true);
      const user = /^\d+$/.test(raw)
        ? await RobloxService.getUserById(Number(raw))
        : await RobloxService.resolveUsername(raw);
      const view: HubView =
        sub === "rank" ? "militaryRank" : sub === "profile" ? "militaryPlayer" : "militaryPlayer";
      return replyHub(
        interaction,
        freshState(ownerId, { view, robloxUserId: user.id })
      );
    }
    return replyHub(interaction, freshState(ownerId, { view: "military" }));
  } catch (err) {
    logRobloxError("handleMilitaryCommand", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: toUserError(err) });
    } else {
      await interaction.reply({ content: toUserError(err), flags: 64 });
    }
  }
}

/* ------------------------------------------------------- component handlers */

export async function handleRobloxButton(interaction: ButtonInteraction): Promise<void> {
  const st = assertOwner(interaction);
  if (!st) {
    await interaction.reply({
      content: "This Roblox Hub belongs to someone else — run `/roblox` to open yours.",
      flags: 64,
    });
    return;
  }
  const { action, arg } = parseId(interaction.customId);

  if (action === "search") {
    const modal = new ModalBuilder()
      .setCustomId(RBX_SEARCH_MODAL)
      .setTitle("Search Roblox User")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("username")
            .setLabel("Username or user ID")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(40)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();

  if (action === "refresh") {
    // Bust presence/game caches lightly by advancing timestamp; service TTLs still apply.
    resetPaging(st);
    return updateHub(interaction, st);
  }

  if (action === "back") {
    st.view = st.returnView ?? (st.robloxUserId ? "player" : "home");
    st.returnView = null;
    resetPaging(st);
    return updateHub(interaction, st);
  }

  if (action === "page") {
    const extended = st as HubState & { _next?: string | null };
    if (arg === "next") {
      st.cursorStack.push(st.cursor);
      st.cursor = extended._next ?? null;
      st.page += 1;
    } else if (arg === "prev" && st.page > 0) {
      st.page -= 1;
      st.cursor = st.cursorStack.pop() ?? null;
    }
    return updateHub(interaction, st);
  }

  if (action === "nav" && arg) {
    st.returnView = st.view;
    resetPaging(st);
    if (arg === "military") {
      st.gameUniverseId = RobloxService.MILITARY_TYCOON_UNIVERSE_ID;
      st.gamePlaceId = RobloxService.MILITARY_TYCOON_PLACE_ID;
    }
    st.view = arg as HubView;
    return updateHub(interaction, st);
  }
}

export async function handleRobloxSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const st = assertOwner(interaction);
  if (!st) {
    await interaction.reply({
      content: "This Roblox Hub belongs to someone else — run `/roblox` to open yours.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  const { action } = parseId(interaction.customId);
  const value = interaction.values[0];
  if (!value) return;

  if (action === "avatarView") {
    st.avatarView = value as AvatarView;
    st.view = "avatar";
    return updateHub(interaction, st);
  }
  if (action === "pickFriend") {
    st.robloxUserId = Number(value);
    st.view = "player";
    resetPaging(st);
    return updateHub(interaction, st);
  }
  if (action === "pickGame") {
    st.gameUniverseId = Number(value);
    st.view = "game";
    resetPaging(st);
    return updateHub(interaction, st);
  }
}

export async function handleRobloxModal(interaction: ModalSubmitInteraction): Promise<void> {
  const username = interaction.fields.getTextInputValue("username");
  const hasMessage = Boolean(interaction.message);
  if (hasMessage) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: 64 });

  try {
    const user = await RobloxService.resolveUsername(username);
    const messageId = interaction.message?.id;
    const existing = messageId ? getHub(messageId, interaction.user.id) : null;
    const st =
      existing ??
      freshState(interaction.user.id, {
        view: "player",
        robloxUserId: user.id,
      });
    st.robloxUserId = user.id;
    st.view = "player";
    resetPaging(st);
    const payload = await buildView(st);
    const msg = await interaction.editReply(payload);
    bindHub(messageId ?? msg.id, st);
  } catch (err) {
    logRobloxError("handleRobloxModal", err);
    if (hasMessage) {
      await interaction.followUp({ content: toUserError(err), flags: 64 }).catch(() => {});
    } else {
      await interaction.editReply({ content: toUserError(err) }).catch(() => {});
    }
  }
}

// Silence unused NS import warning by referencing
void NS;
