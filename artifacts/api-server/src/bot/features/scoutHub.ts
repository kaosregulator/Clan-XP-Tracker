/**
 * Game Intelligence Hub (/scout) — Bloxscout-powered discovery, snapshots,
 * comparisons, DevEx/revenue. Separate from the Roblox player Hub (/roblox).
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
import { clearHubCard, replaceHubCard } from "../ui/hubMessage";
import { armHubAutoDelete, deferPublicHub } from "../ui/hubVisibility";
import {
  accessOwnedState,
  bindAfterEditReply,
  denyHubInteraction,
  type HubDenialReason,
} from "../ui/hubSession";
import {
  parseId,
  SCT_NAV,
  SCT_PAGE,
  SCT_REFRESH,
  SCT_SEARCH,
  SCT_SEARCH_MODAL,
  SCT_PICK_GAME,
  SCT_BACK,
  SCT_SNAPSHOT,
  SCT_GENRE_MODAL,
  SCT_COMPARE_MODAL,
  SCT_DEVEX_MODAL,
  SCT_TOOLS,
} from "../ui/ids";
import {
  ScoutService,
  toScoutUserError,
  logScoutError,
  type ScoutGameRow,
  type ScoutView,
} from "../services/scout";
import {
  INFINITY_INTERACTIVE_GROUP_ID,
  MILITARY_TYCOON_UNIVERSE_ID,
  ROBLOX_GAME_URL,
  ROBLOX_GROUP_URL,
} from "../services/roblox/constants";

/* ------------------------------------------------------------------ state */

interface ScoutState {
  ownerId: string;
  view: ScoutView;
  page: number;
  genre: string | null;
  universeId: number | null;
  compareIds: number[];
  keyword: string | null;
  robux: number | null;
  returnView: ScoutView | null;
  ts: number;
}

const HUB_TTL_MS = 20 * 60_000;
const hubs = new Map<string, ScoutState>();
const PAGE_SIZE = 8;

function prune() {
  const cutoff = Date.now() - HUB_TTL_MS;
  for (const [k, v] of hubs) if (v.ts < cutoff) hubs.delete(k);
}

function touch(st: ScoutState) {
  st.ts = Date.now();
}

function getHub(messageId: string, userId: string): ScoutState | null {
  prune();
  const st = hubs.get(messageId);
  if (!st || st.ownerId !== userId) return null;
  touch(st);
  return st;
}

function bindHub(messageId: string, state: ScoutState) {
  prune();
  hubs.set(messageId, state);
}

function freshState(ownerId: string, patch: Partial<ScoutState> = {}): ScoutState {
  return {
    ownerId,
    view: "home",
    page: 0,
    genre: null,
    universeId: null,
    compareIds: [],
    keyword: null,
    robux: null,
    returnView: null,
    ts: Date.now(),
    ...patch,
  };
}

function row(...components: MessageActionRowComponentBuilder[]) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function btn(label: string, customId: string, style: ButtonStyle = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

async function fileFrom(fn: string, params: unknown, name: string) {
  const png = await renderOffThread(fn, params);
  return new AttachmentBuilder(png, { name });
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toolsMenu(placeholder = "More tools…") {
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(SCT_TOOLS)
      .setPlaceholder(placeholder)
      .addOptions(
        { label: "Compare games", value: "compare", description: "Side-by-side two universes" },
        { label: "DevEx calculator", value: "devex", description: "Robux → USD estimate" },
        { label: "Revenue estimate", value: "revenue", description: "Rough income for a game" },
        { label: "MT snapshot", value: "snapshot", description: "Capture Military Tycoon now" },
        { label: "Recently updated", value: "updates", description: "Seed/tracked games by last update" },
        { label: "History", value: "history", description: "Local snapshot deltas" },
        { label: "Creators", value: "creators", description: "Top creators by genre" },
        { label: "Genre report", value: "report", description: "Genre overview card" },
        { label: "Tracked games", value: "tracked", description: "Auto-snapshot list" },
        { label: "vs Genre", value: "vsGenre", description: "Game vs genre peers" }
      )
  );
}

function navRows(st: ScoutState): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  // Home: one discovery row + tools select. Deeper views: short chrome + tools.
  // Keeps Discord's 5-row budget free for game picks / paging.
  if (st.view === "home") {
    return [
      row(
        btn("Trending", SCT_NAV("trending"), ButtonStyle.Primary),
        btn("Top genre", SCT_NAV("top"), ButtonStyle.Primary),
        btn("Upcoming", SCT_NAV("upcoming")),
        btn("Updated", SCT_NAV("updates")),
        btn("Search", SCT_SEARCH, ButtonStyle.Success)
      ),
      row(btn("Refresh", SCT_REFRESH)),
      toolsMenu("Jump to a tool…"),
    ];
  }

  return [
    row(
      btn("Home", SCT_NAV("home"), ButtonStyle.Primary),
      btn("Trending", SCT_NAV("trending")),
      btn("Top", SCT_NAV("top")),
      btn("Search", SCT_SEARCH),
      btn("Refresh", SCT_REFRESH)
    ),
    toolsMenu(),
  ];
}

function pageRow(st: ScoutState, hasMore: boolean) {
  if (st.page === 0 && !hasMore) return null;
  return row(
    btn("◀ Prev", SCT_PAGE("prev")).setDisabled(st.page === 0),
    btn(`Page ${st.page + 1}`, SCT_NAV(st.view)).setDisabled(true),
    btn("Next ▶", SCT_PAGE("next")).setDisabled(!hasMore)
  );
}

function listRows(rows: ScoutGameRow[], page: number) {
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const hasMore = rows.length > (page + 1) * PAGE_SIZE;
  return { slice, hasMore };
}

function gameSelect(slice: ScoutGameRow[]) {
  if (!slice.length) return null;
  const seen = new Set<string>();
  const options = [];
  for (const g of slice.slice(0, 25)) {
    const value = String(Math.trunc(g.universeId));
    if (!Number.isFinite(g.universeId) || g.universeId <= 0 || seen.has(value)) continue;
    // Discord rejects empty / control-char-only labels → "Invalid Form Body".
    const label =
      g.name
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || `Universe ${value}`;
    if (!label.trim()) continue;
    seen.add(value);
    const desc = `${ScoutService.formatCount(g.playing)} playing`
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .slice(0, 100);
    options.push({
      label: label.slice(0, 100),
      description: desc || "Open game",
      value,
    });
  }
  if (!options.length) return null;
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(SCT_PICK_GAME)
      .setPlaceholder("Open a game…")
      .addOptions(options)
  );
}

/** Live trending with a hard timeout, then live-CCU preset Top-10 so /scout always opens. */
async function loadOpeningGames(): Promise<{
  rows: ScoutGameRow[];
  eyebrow: string;
  title: string;
  subtitle: string;
}> {
  // Prefer the fast live-CCU seed ranking first so the hub paints with real players.
  try {
    const rows = await Promise.race([
      ScoutService.presetTop(10),
      new Promise<ScoutGameRow[]>((_, reject) =>
        setTimeout(() => reject(new Error("preset timeout")), 8_000)
      ),
    ]);
    if (rows.length) {
      // Kick a broader trending refresh in the background for next open.
      void ScoutService.trending(10).catch(() => {});
      return {
        rows,
        eyebrow: "TOP 10 · LIVE CCU",
        title: "Hot right now",
        subtitle: "Ranked by live players — pick a game or search",
      };
    }
  } catch (err) {
    logScoutError("loadOpeningGames.preset", err);
  }
  try {
    const rows = await Promise.race([
      ScoutService.trending(10),
      new Promise<ScoutGameRow[]>((_, reject) =>
        setTimeout(() => reject(new Error("trending timeout")), 10_000)
      ),
    ]);
    if (rows.length) {
      return {
        rows,
        eyebrow: "TOP 10 · TRENDING",
        title: "Hot right now",
        subtitle: "Live ranking — pick a game below or search",
      };
    }
  } catch (err) {
    logScoutError("loadOpeningGames.trending", err);
  }
  return {
    rows: [],
    eyebrow: "SCOUT",
    title: "Game Intelligence",
    subtitle: "Try Search or Trending again in a moment",
  };
}

/** Keep nav chrome on errors so a failed button doesn't "close" the hub. */
function softErrorView(st: ScoutState, message: string): BaseMessageOptions {
  return {
    content: message,
    files: [],
    components: [
      row(
        btn("Home", SCT_NAV("home"), ButtonStyle.Primary),
        btn("Trending", SCT_NAV("trending"), ButtonStyle.Primary),
        btn("Search", SCT_SEARCH, ButtonStyle.Success),
        btn("Refresh", SCT_REFRESH)
      ),
      toolsMenu("Try another tool…"),
    ],
  };
}

/* --------------------------------------------------------------- builders */

async function buildHome(st: ScoutState): Promise<BaseMessageOptions> {
  void ScoutService.ensureMilitarySnapshot().catch(() => {});
  let status = { tracked: [] as number[], running: false, dbPath: "" };
  try {
    status = ScoutService.autoStatus();
  } catch {
    /* store optional */
  }
  let mtPlaying = "—";
  let mtDelta: string | null = null;
  let mtName = "Military Tycoon";
  try {
    const g = await ScoutService.getGame(MILITARY_TYCOON_UNIVERSE_ID);
    mtName = g.name;
    mtPlaying = ScoutService.formatCount(g.playing);
    const hist = await ScoutService.history(MILITARY_TYCOON_UNIVERSE_ID, 3);
    if (hist.latest && hist.previous) {
      mtDelta = ScoutService.formatDeltaPct(hist.latest.playingDeltaPct);
    }
  } catch {
    /* home still useful without live MT */
  }

  const file = await fileFrom(
    "scoutHome",
    {
      mtName,
      mtPlaying,
      mtDelta,
      trackedCount: status.tracked.length,
      dbHint: status.running ? "auto-snapshots on" : "live APIs",
    },
    "scout-home.png"
  );

  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open MT")
          .setURL(ROBLOX_GAME_URL(7180042682)),
        btn("Snap MT now", SCT_SNAPSHOT, ButtonStyle.Success)
      ),
    ],
  };
}

async function buildListView(
  st: ScoutState,
  eyebrow: string,
  title: string,
  subtitle: string | null,
  rows: ScoutGameRow[]
): Promise<BaseMessageOptions> {
  const { slice, hasMore } = listRows(rows, st.page);
  const file = await fileFrom(
    "scoutList",
    {
      eyebrow,
      title,
      subtitle,
      rows: slice.map((g, i) => ({
        rank: String(st.page * PAGE_SIZE + i + 1).padStart(2, "0"),
        title: g.name,
        subtitle: `${g.creator}${g.genre ? ` · ${g.genre}` : ""}${
          g.updatedAt ? ` · upd ${whenLabel(g.updatedAt)}` : ""
        }`,
        value: ScoutService.formatCount(g.playing),
        delta: g.deltaPct != null ? ScoutService.formatDeltaPct(g.deltaPct) : null,
      })),
    },
    "scout-list.png"
  );
  const components = [...navRows(st)];
  const sel = gameSelect(slice);
  if (sel) components.push(sel);
  const pg = pageRow(st, hasMore);
  if (pg) components.push(pg);
  return { files: [file], components };
}

async function buildGame(st: ScoutState): Promise<BaseMessageOptions> {
  const id = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
  const g = await ScoutService.getGame(id);
  const hist = await ScoutService.history(id, 3);
  const deltaLabel =
    hist.latest && hist.previous
      ? `Players ${ScoutService.formatDeltaPct(hist.latest.playingDeltaPct)} since last snapshot`
      : null;
  const file = await fileFrom(
    "scoutGame",
    {
      name: g.name,
      creator: `${g.creatorType}: ${g.creator}`,
      genre: g.genre,
      playing: ScoutService.formatCount(g.playing),
      visits: ScoutService.formatCount(g.visits),
      favorites: ScoutService.formatCount(g.favorites),
      universeId: g.universeId,
      placeId: g.placeId,
      iconUrl: g.iconUrl,
      deltaLabel,
    },
    "scout-game.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        btn("Snapshot", SCT_SNAPSHOT, ButtonStyle.Success),
        btn("History", SCT_NAV("history")),
        btn("vs Genre", SCT_NAV("vsGenre")),
        btn("Revenue", SCT_NAV("revenue")),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open on Roblox")
          .setURL(ROBLOX_GAME_URL(g.placeId || 7180042682))
      ),
    ],
  };
}

async function buildHistory(st: ScoutState): Promise<BaseMessageOptions> {
  const id = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
  const hist = await ScoutService.history(id, 12);
  const name = hist.name ?? (await ScoutService.getGame(id).catch(() => null))?.name ?? `Universe ${id}`;
  const file = await fileFrom(
    "scoutHistory",
    {
      title: name,
      subtitle:
        hist.points.length < 2
          ? "Take more snapshots to unlock deltas (auto-snapshots run in the background)."
          : `${hist.points.length} snapshots recorded locally`,
      latestPlaying: hist.latest ? ScoutService.formatCount(hist.latest.playing) : "—",
      deltaLabel: hist.latest ? ScoutService.formatDeltaPct(hist.latest.playingDeltaPct) : null,
      points: hist.points.slice(0, 10).map((p) => ({
        when: whenLabel(p.takenAt),
        playing: ScoutService.formatCount(p.playing),
        delta: p.playingDeltaPct != null ? ScoutService.formatDeltaPct(p.playingDeltaPct) : null,
      })),
    },
    "scout-history.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(btn("Take snapshot", SCT_SNAPSHOT, ButtonStyle.Success), btn("Back", SCT_BACK)),
    ],
  };
}

async function buildCompare(st: ScoutState): Promise<BaseMessageOptions> {
  const ids =
    st.compareIds.length >= 2
      ? st.compareIds
      : [MILITARY_TYCOON_UNIVERSE_ID, ...(st.universeId && st.universeId !== MILITARY_TYCOON_UNIVERSE_ID ? [st.universeId] : [])];
  if (ids.length < 2) {
    return {
      content:
        "Use Compare → Enter games, or pass two games via `/scout game:…` then open Compare.",
      components: [
        ...navRows(st),
        row(btn("Enter games", SCT_COMPARE_MODAL, ButtonStyle.Primary)),
      ],
      files: [],
    };
  }
  const cmp = await ScoutService.compare(ids);
  const file = await fileFrom(
    "scoutCompare",
    {
      title: cmp.games.map((g) => g.name).join(" vs "),
      rows: cmp.games.map((g) => ({
        name: g.name,
        playing: ScoutService.formatCount(g.playing),
        visits: ScoutService.formatCount(g.visits),
        favorites: ScoutService.formatCount(g.favorites),
      })),
      medians: {
        playing: ScoutService.formatCount(cmp.metrics.playing.median),
        visits: ScoutService.formatCount(cmp.metrics.visits.median),
        favorites: ScoutService.formatCount(cmp.metrics.favoritedCount.median),
      },
    },
    "scout-compare.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(btn("New compare", SCT_COMPARE_MODAL, ButtonStyle.Primary)),
    ],
  };
}

async function buildVsGenre(st: ScoutState): Promise<BaseMessageOptions> {
  const id = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
  const vs = await ScoutService.vsGenre(id, st.genre ?? undefined);
  const file = await fileFrom(
    "scoutVsGenre",
    {
      title: vs.game.name,
      genre: vs.genre,
      cohortSize: vs.cohortSize,
      metrics: vs.metrics.map((m) => ({
        label: m.key,
        value: ScoutService.formatCount(m.value),
        median: ScoutService.formatCount(m.median),
        percentile: `${m.percentile.toFixed(0)}th`,
      })),
    },
    "scout-vs-genre.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(btn("Change genre", SCT_GENRE_MODAL, ButtonStyle.Primary)),
    ],
  };
}

async function buildCreators(st: ScoutState): Promise<BaseMessageOptions> {
  const genre = st.genre ?? "tycoon";
  const creators = await ScoutService.creators(genre, 12);
  if (!creators.length) {
    const rows = await ScoutService.topByGenre(genre, 12).catch(() => [] as ScoutGameRow[]);
    if (rows.length) {
      return buildListView(
        st,
        "TOP GAMES",
        genre,
        "Creator ranking briefly unavailable — showing live games instead",
        rows
      );
    }
    return softErrorView(
      st,
      "⚠️ Creator ranking needs Roblox search. Try Trending or Search for now."
    );
  }
  const { slice, hasMore } = listRows(
    creators.map((c) => ({
      universeId: c.topGameUniverseId,
      placeId: 0,
      name: c.creatorName,
      playing: c.totalPlaying,
      visits: 0,
      favorites: 0,
      creator: `${c.creatorType} · ${c.gameCount} games`,
      creatorType: c.creatorType,
      genre: c.topGameName,
      iconUrl: null,
    })),
    st.page
  );
  const file = await fileFrom(
    "scoutList",
    {
      eyebrow: "TOP CREATORS",
      title: genre,
      subtitle: "Ranked by live CCU across genre search results",
      rows: slice.map((g, i) => ({
        rank: String(st.page * PAGE_SIZE + i + 1).padStart(2, "0"),
        title: g.name,
        subtitle: g.creator,
        value: ScoutService.formatCount(g.playing),
        delta: g.genre,
      })),
    },
    "scout-creators.png"
  );
  const components = [...navRows(st), row(btn("Change genre", SCT_GENRE_MODAL))];
  const pg = pageRow(st, hasMore);
  if (pg) components.push(pg);
  return { files: [file], components };
}

async function buildReport(st: ScoutState): Promise<BaseMessageOptions> {
  const genre = st.genre ?? "tycoon";
  const report = await ScoutService.report(
    genre,
    st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID,
    8
  );
  const file = await fileFrom(
    "scoutReport",
    {
      genre: report.genre,
      generatedAt: whenLabel(report.generatedAt),
      gameCount: ScoutService.formatCount(report.aggregates.gameCount),
      totalCcu: ScoutService.formatCount(report.aggregates.totalCcu),
      medianCcu: ScoutService.formatCount(report.aggregates.medianCcu),
      topCreator: report.aggregates.topCreatorName,
      focusLine: report.focus
        ? `${report.focus.gameName}: ${report.focus.playingPercentile.toFixed(0)}th pct players (${report.focus.playingVsMedian.toFixed(1)}× median)`
        : null,
      topNames: report.topGames.map((g) => g.name),
    },
    "scout-report.png"
  );
  // Discord caption with truncated markdown summary for copy/paste
  const mdPreview = report.markdown.slice(0, 500);
  return {
    content: mdPreview.length < report.markdown.length ? `${mdPreview}…` : mdPreview,
    files: [file],
    components: [
      ...navRows(st),
      row(btn("Change genre", SCT_GENRE_MODAL, ButtonStyle.Primary)),
    ],
  };
}

async function buildRevenue(st: ScoutState): Promise<BaseMessageOptions> {
  const id = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
  const rev = await ScoutService.revenue({ universeId: id });
  const file = await fileFrom(
    "scoutMoney",
    {
      eyebrow: "REVENUE ESTIMATE",
      title: rev.gameName ?? `Universe ${id}`,
      primary: ScoutService.formatUsd(rev.estimatedMonthlyUsd),
      secondary: `~${ScoutService.formatCount(rev.estimatedMonthlyRobux)} Robux / month (heuristic)`,
      notes: [
        `Live CCU ${ScoutService.formatCount(rev.playing)} · Visits ${ScoutService.formatCount(rev.visits)}`,
        `Daily ~${ScoutService.formatCount(rev.estimatedDailyRobux)} Robux`,
        `Confidence: ${rev.confidence}`,
      ],
      disclaimer: rev.disclaimer,
    },
    "scout-revenue.png"
  );
  return { files: [file], components: navRows(st) };
}

async function buildDevex(st: ScoutState): Promise<BaseMessageOptions> {
  const robux = st.robux ?? 100_000;
  const dx = ScoutService.devex(robux);
  const file = await fileFrom(
    "scoutMoney",
    {
      eyebrow: "DEVEX CALCULATOR",
      title: `${ScoutService.formatCount(dx.robux)} Robux`,
      primary: ScoutService.formatUsd(dx.usd),
      secondary: `@ $${dx.rateUsdPerRobux} per Robux`,
      notes: [
        dx.payoutMinimumNotMet
          ? `Below DevEx payout minimum (${ScoutService.formatCount(dx.payoutMinimum)} Robux)`
          : `Meets DevEx payout minimum (${ScoutService.formatCount(dx.payoutMinimum)} Robux)`,
        "Rate reflects post-2025-09-05 DevEx ($0.0038)",
      ],
      disclaimer: null,
    },
    "scout-devex.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(btn("Change amount", SCT_DEVEX_MODAL, ButtonStyle.Primary)),
    ],
  };
}

async function buildGroup(st: ScoutState): Promise<BaseMessageOptions> {
  const group = await ScoutService.group(INFINITY_INTERACTIVE_GROUP_ID);
  const file = await fileFrom(
    "scoutGroup",
    {
      name: group.name,
      description: group.description,
      members: ScoutService.formatCount(group.memberCount),
      owner: group.ownerName,
      groupId: group.id,
    },
    "scout-group.png"
  );
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open group")
          .setURL(ROBLOX_GROUP_URL(group.id))
      ),
    ],
  };
}

async function buildTracked(st: ScoutState): Promise<BaseMessageOptions> {
  const tracked = ScoutService.tracked();
  let status = { tracked: [] as number[], running: false, dbPath: "" };
  try {
    status = ScoutService.autoStatus();
  } catch {
    /* optional */
  }
  const file = await fileFrom(
    "scoutList",
    {
      eyebrow: "TRACKED SNAPSHOTS",
      title: `${tracked.length} universes`,
      subtitle: status.running
        ? `Auto-snapshots running · ${status.dbPath}`
        : `Auto-snapshots idle · ${status.dbPath || "live APIs only"}`,
      rows: tracked.slice(0, 12).map((t, i) => ({
        rank: String(i + 1).padStart(2, "0"),
        title: t.name ?? `Universe ${t.universeId}`,
        subtitle: t.lastSeen ? `Last ${whenLabel(t.lastSeen)}` : "—",
        value: ScoutService.formatCount(t.latestPlaying),
        delta: t.genre,
      })),
    },
    "scout-tracked.png"
  );
  const components = [...navRows(st)];
  if (tracked.length) {
    const sel = gameSelect(
      tracked.slice(0, 25).map((t) => ({
        universeId: t.universeId,
        placeId: 0,
        name: t.name ?? `Universe ${t.universeId}`,
        playing: t.latestPlaying ?? 0,
        visits: 0,
        favorites: 0,
        creator: "Tracked",
        creatorType: "System",
        genre: t.genre,
        iconUrl: null,
      }))
    );
    if (sel) components.push(sel);
  } else {
    return {
      content:
        "📌 No tracked games yet. Snap MT or open a game and hit Snapshot — live Top charts still work without tracking.",
      files: [file],
      components,
    };
  }
  return { files: [file], components };
}

async function buildSnapshot(st: ScoutState): Promise<BaseMessageOptions> {
  const id = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
  const snap = await ScoutService.snapshot([id]);
  const g = snap.games[0] ?? (await ScoutService.getGame(id));
  const hist = await ScoutService.history(id, 3);
  const saved =
    snap.recorded > 0
      ? hist.latest && hist.previous
        ? `Saved ${whenLabel(snap.takenAt)} · ${ScoutService.formatDeltaPct(hist.latest.playingDeltaPct)} vs prior`
        : `Saved ${whenLabel(snap.takenAt)} · first snapshot`
      : `Live card · local snapshots unavailable on this host`;
  const file = await fileFrom(
    "scoutGame",
    {
      name: g.name,
      creator: `${g.creatorType}: ${g.creator}`,
      genre: g.genre,
      playing: ScoutService.formatCount(g.playing),
      visits: ScoutService.formatCount(g.visits),
      favorites: ScoutService.formatCount(g.favorites),
      universeId: g.universeId,
      placeId: g.placeId,
      iconUrl: g.iconUrl,
      deltaLabel: saved,
      accentLabel: snap.recorded > 0 ? "SNAPSHOT SAVED" : "LIVE LOOKUP",
    },
    "scout-snapshot.png"
  );
  st.view = "game";
  st.universeId = id;
  return {
    files: [file],
    components: [
      ...navRows(st),
      row(btn("View history", SCT_NAV("history"), ButtonStyle.Primary)),
    ],
  };
}

async function buildView(st: ScoutState): Promise<BaseMessageOptions> {
  try {
    switch (st.view) {
      case "home":
        return await buildHome(st);
      case "search": {
        const rows = st.keyword ? await ScoutService.search(st.keyword, 25) : [];
        return await buildListView(st, "SEARCH", st.keyword ?? "Search", null, rows);
      }
      case "trending": {
        const opening = await loadOpeningGames();
        if (opening.rows.length) {
          return await buildListView(
            st,
            opening.eyebrow,
            opening.title,
            opening.subtitle,
            opening.rows
          );
        }
        return await buildHome(st);
      }
      case "top": {
        const genre = st.genre ?? "tycoon";
        const rows = await ScoutService.topByGenre(genre, 25);
        if (rows.length) {
          return await buildListView(
            st,
            "TOP BY GENRE",
            genre,
            "Ranked by live players (search + live CCU backup)",
            rows
          );
        }
        return softErrorView(
          st,
          "⚠️ Couldn't load that genre right now. Try Trending or Search."
        );
      }
      case "upcoming": {
        const { rows, needHistory } = await ScoutService.upAndComing(25);
        if (needHistory) {
          return {
            content:
              "📈 Up-and-coming needs snapshot history. Snap a few games (or wait for MT auto-snapshots), then refresh. Trending still works.",
            files: [],
            components: [
              ...navRows(st),
              row(
                btn("Snap MT", SCT_SNAPSHOT, ButtonStyle.Success),
                btn("Trending", SCT_NAV("trending"), ButtonStyle.Primary),
                btn("Tracked", SCT_NAV("tracked"))
              ),
            ],
          };
        }
        return await buildListView(
          st,
          "UP-AND-COMING",
          "Breakouts",
          "Small-baseline games with high growth in local snapshots",
          rows
        );
      }
      case "updates": {
        const rows = await ScoutService.recentlyUpdated(25);
        if (!rows.length) {
          return softErrorView(
            st,
            "⚠️ No recently updated games yet. Try Trending, or snap MT so we have seed data."
          );
        }
        return await buildListView(
          st,
          "RECENTLY UPDATED",
          "Last Roblox update",
          "Seed + tracked experiences sorted by Roblox `updated` timestamp",
          rows
        );
      }
      case "game":
        return await buildGame(st);
      case "history":
        return await buildHistory(st);
      case "compare":
        return await buildCompare(st);
      case "vsGenre":
        return await buildVsGenre(st);
      case "creators":
        return await buildCreators(st);
      case "report":
        return await buildReport(st);
      case "revenue":
        return await buildRevenue(st);
      case "devex":
        return await buildDevex(st);
      case "group":
        return await buildGroup(st);
      case "tracked":
        return await buildTracked(st);
      case "snapshot":
        return await buildSnapshot(st);
      default:
        return await buildHome(st);
    }
  } catch (err) {
    logScoutError(`buildView.${st.view}`, err);
    // Last resort: keep a live Top list so the hub never "closes" on a tool failure.
    try {
      const rows = await ScoutService.presetTop(10);
      if (rows.length) {
        return await buildListView(
          st,
          "TOP · LIVE CCU",
          "Popular now",
          "That tool briefly failed — showing live popular games",
          rows
        );
      }
    } catch (fallbackErr) {
      logScoutError("buildView.fallback", fallbackErr);
    }
    return softErrorView(st, toScoutUserError(err));
  }
}

async function replyHub(
  interaction: ChatInputCommandInteraction,
  state: ScoutState
): Promise<void> {
  await deferPublicHub(interaction);
  try {
    const payload = await Promise.race([
      buildView(state),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Scout hub timed out building the card")), 20_000)
      ),
    ]);
    await interaction.editReply(replaceHubCard(payload));
    const msg = await bindAfterEditReply(interaction, hubs, state, HUB_TTL_MS);
    armHubAutoDelete(msg);
    // Start snapshots after the card is visible — never block open on SQLite.
    setTimeout(() => {
      try {
        ScoutService.startAutoSnapshots();
      } catch (err) {
        logScoutError("startAutoSnapshots", err);
      }
    }, 0);
  } catch (err) {
    logScoutError("replyHub", err);
    try {
      // Last-ditch: home card without store/trending.
      const home = await buildHome(freshState(state.ownerId, { view: "home" }));
      const msg = await interaction.editReply(replaceHubCard(home));
      bindHub(msg.id, freshState(state.ownerId, { view: "home" }));
      armHubAutoDelete(msg);
    } catch {
      await interaction.editReply(clearHubCard(toScoutUserError(err))).catch(() => {});
    }
  }
}

async function updateHub(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  state: ScoutState
): Promise<void> {
  try {
    const payload = await Promise.race([
      buildView(state),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Scout hub timed out")), 25_000)
      ),
    ]);
    // Must clear prior attachments — otherwise every hub click stacks another PNG.
    try {
      await interaction.editReply(replaceHubCard(payload));
    } catch (editErr) {
      // Discord often rejects select menus with odd labels — retry without the select.
      logScoutError("updateHub.edit", editErr);
      const stripped: typeof payload = {
        ...payload,
        components: (payload.components ?? []).filter((row) => {
          const data = "toJSON" in row ? (row as { toJSON: () => { components?: Array<{ type?: number }> } }).toJSON() : null;
          const comps = data?.components ?? [];
          // Drop string-select rows (type 3) on retry.
          return !comps.some((c) => c.type === 3);
        }),
      };
      await interaction.editReply(replaceHubCard(stripped));
    }
    bindHub(interaction.message!.id, state);
    if (interaction.message) armHubAutoDelete(interaction.message);
  } catch (err) {
    logScoutError("updateHub", err);
    // Prefer a live list over the soft-error chrome when Trending/Top fails.
    try {
      const rows = await ScoutService.presetTop(10);
      if (rows.length) {
        const list = await buildListView(
          state,
          "TOP · LIVE CCU",
          "Popular now",
          "Trending briefly hiccuped — showing live popular games",
          rows
        );
        // Avoid select menu on this recovery path.
        list.components = list.components?.slice(0, 2);
        await interaction.editReply(replaceHubCard(list));
        if (interaction.message) {
          bindHub(interaction.message.id, { ...state, view: "trending" });
          armHubAutoDelete(interaction.message);
        }
        return;
      }
    } catch (fallbackErr) {
      logScoutError("updateHub.fallback", fallbackErr);
    }
    const soft = softErrorView(state, toScoutUserError(err));
    await interaction.editReply(replaceHubCard(soft)).catch(() => {});
    if (interaction.message) {
      bindHub(interaction.message.id, state);
      armHubAutoDelete(interaction.message);
    }
  }
}

/* -------------------------------------------------------------- commands */

/** Popular games for empty / short autocomplete so `/scout` always suggests something. */
const SCOUT_GAME_PRESETS: Array<{ name: string; value: string }> = [
  { name: "Military Tycoon", value: String(MILITARY_TYCOON_UNIVERSE_ID) },
  { name: "Blox Fruits", value: "994732206" },
  { name: "Adopt Me!", value: "383310974" },
  { name: "Brookhaven RP", value: "1686885941" },
  { name: "Jailbreak", value: "245662005" },
  { name: "Pet Simulator 99", value: "3317771874" },
  { name: "Doors", value: "2440500124" },
  { name: "Arsenal", value: "111958650" },
  { name: "Murder Mystery 2", value: "66654135" },
  { name: "Tower Defense Simulator", value: "1176784616" },
];

export async function handleScoutAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const q = String(focused.value ?? "").trim();
  try {
    if (focused.name === "game" || focused.name === "game_a" || focused.name === "game_b" || focused.name === "focus") {
      if (q.length < 2) {
        const presets = SCOUT_GAME_PRESETS.filter((p) =>
          q ? p.name.toLowerCase().includes(q.toLowerCase()) : true
        ).slice(0, 10);
        await interaction.respond(presets);
        return;
      }
      const hits = await ScoutService.search(q, 8);
      if (!hits.length) {
        await interaction.respond(
          SCOUT_GAME_PRESETS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
        );
        return;
      }
      await interaction.respond(
        hits.map((h) => ({
          name: `${h.name} · ${ScoutService.formatCount(h.playing)} playing`.slice(0, 100),
          value: String(h.universeId),
        }))
      );
      return;
    }
    if (focused.name === "genre") {
      const seeds = [
        "tycoon",
        "simulator",
        "rpg",
        "fps",
        "obby",
        "horror",
        "fighting",
        "adventure",
        "social",
        "tower-defense",
        "anime",
        "racing",
      ];
      const filtered = seeds.filter((s) => !q || s.includes(q.toLowerCase())).slice(0, 20);
      await interaction.respond(
        (filtered.length ? filtered : [q || "tycoon"]).map((s) => ({ name: s, value: s }))
      );
      return;
    }
    await interaction.respond([]);
  } catch (err) {
    logScoutError("autocomplete", err);
    await interaction.respond(SCOUT_GAME_PRESETS.slice(0, 8)).catch(() => {});
  }
}

/**
 * True hub: one slash command. Optional game jumps to that card; browse/compare
 * via buttons. Legacy subcommands still resolve if Discord caches an old schema.
 * Bare `/scout` opens Top 10 trending so the hub always shows results immediately.
 */
export async function handleScoutCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const ownerId = interaction.user.id;
  let sub: string | null = null;
  try {
    sub = interaction.options.getSubcommand(false);
  } catch {
    sub = null;
  }
  const gameOpt =
    interaction.options.getString("game") ??
    interaction.options.getString("keyword") ??
    null;

  try {
    if (gameOpt && (!sub || sub === "game" || sub === "search" || sub === "hub")) {
      // Keyword search vs universe resolve: pure numbers / known IDs → game card.
      if (/^\d+$/.test(gameOpt.trim()) || sub === "game") {
        const game = await ScoutService.resolveGame(gameOpt);
        return replyHub(
          interaction,
          freshState(ownerId, { view: "game", universeId: game.universeId })
        );
      }
      return replyHub(
        interaction,
        freshState(ownerId, { view: "search", keyword: gameOpt.trim() })
      );
    }

    // Legacy subcommand deep-links (still work if an old command tree is cached).
    if (sub === "trending") {
      return replyHub(
        interaction,
        freshState(ownerId, { view: "trending", genre: interaction.options.getString("genre") })
      );
    }
    if (sub === "top") {
      const genre = interaction.options.getString("genre") ?? "tycoon";
      return replyHub(interaction, freshState(ownerId, { view: "top", genre }));
    }
    if (sub === "upcoming") {
      return replyHub(interaction, freshState(ownerId, { view: "upcoming" }));
    }
    if (sub === "compare") {
      const aRaw = interaction.options.getString("game_a");
      const bRaw = interaction.options.getString("game_b");
      if (aRaw && bRaw) {
        const a = await ScoutService.resolveGame(aRaw);
        const b = await ScoutService.resolveGame(bRaw);
        return replyHub(
          interaction,
          freshState(ownerId, {
            view: "compare",
            compareIds: [a.universeId, b.universeId],
            universeId: a.universeId,
          })
        );
      }
      return replyHub(interaction, freshState(ownerId, { view: "compare" }));
    }
    if (sub === "devex") {
      const robux = interaction.options.getInteger("robux");
      return replyHub(interaction, freshState(ownerId, { view: "devex", robux }));
    }
    if (sub === "group") {
      return replyHub(interaction, freshState(ownerId, { view: "group" }));
    }
    if (sub === "snapshot" || sub === "history" || sub === "revenue") {
      const raw = interaction.options.getString("game");
      const game = raw
        ? await ScoutService.resolveGame(raw)
        : await ScoutService.getGame(MILITARY_TYCOON_UNIVERSE_ID);
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: sub as ScoutView,
          universeId: game.universeId,
        })
      );
    }

    // Default: show Top 10 live trending so the hub opens with real results.
    return replyHub(interaction, freshState(ownerId, { view: "trending" }));
  } catch (err) {
    logScoutError("handleScoutCommand", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(clearHubCard(toScoutUserError(err)));
    } else {
      await interaction.reply({ content: toScoutUserError(err), flags: 64 });
    }
  }
}

export async function handleScoutButton(interaction: ButtonInteraction): Promise<void> {
  const { action, arg } = parseId(interaction.customId);
  if (action === "search") {
    const modal = new ModalBuilder()
      .setCustomId(SCT_SEARCH_MODAL)
      .setTitle("Search Roblox games")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("keyword")
            .setLabel("Game name or keyword")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80)
        )
      );
    await interaction.showModal(modal);
    return;
  }
  if (action === "genreModal") {
    const modal = new ModalBuilder()
      .setCustomId(SCT_GENRE_MODAL)
      .setTitle("Genre")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("genre")
            .setLabel("Genre (tycoon, simulator, rpg…)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40)
        )
      );
    await interaction.showModal(modal);
    return;
  }
  if (action === "compareModal") {
    const modal = new ModalBuilder()
      .setCustomId(SCT_COMPARE_MODAL)
      .setTitle("Compare games")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("game_a")
            .setLabel("Game A (name or universe ID)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("game_b")
            .setLabel("Game B (name or universe ID)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }
  if (action === "devexModal") {
    const modal = new ModalBuilder()
      .setCustomId(SCT_DEVEX_MODAL)
      .setTitle("DevEx calculator")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("robux")
            .setLabel("Robux amount")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(12)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  const access = accessOwnedState(hubs, interaction.message.id, interaction.user.id, {
    ttlMs: HUB_TTL_MS,
    reclaim: () => freshState(interaction.user.id),
  });
  if (!access.ok) {
    await denyHubInteraction(interaction, "scout", access.reason);
    return;
  }
  const st = access.state;
  if (access.reclaimed) {
    await interaction.deferUpdate().catch(() => null);
    await updateHub(interaction, st);
    await interaction
      .followUp({
        content:
          "Your Scout Hub session was reset after a bot refresh — continue from Home (you're still the owner).",
        flags: 64,
      })
      .catch(() => null);
    return;
  }

  await interaction.deferUpdate().catch(() => null);
  if (!interaction.deferred && !interaction.replied) return;

  if (action === "refresh") {
    return updateHub(interaction, st);
  }
  if (action === "back") {
    st.view = st.returnView ?? "home";
    st.returnView = null;
    return updateHub(interaction, st);
  }
  if (action === "page") {
    if (arg === "prev") st.page = Math.max(0, st.page - 1);
    if (arg === "next") st.page += 1;
    return updateHub(interaction, st);
  }
  if (action === "snap") {
    st.view = "snapshot";
    st.universeId = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
    return updateHub(interaction, st);
  }
  if (action === "nav" && arg) {
    st.page = 0;
    if (arg === "top" || arg === "creators" || arg === "report") {
      st.genre = st.genre ?? "tycoon";
    }
    if (arg === "history" || arg === "vsGenre" || arg === "revenue" || arg === "snapshot") {
      st.universeId = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
    }
    if (arg === "devex") st.robux = st.robux ?? 100_000;
    st.view = arg as ScoutView;
    return updateHub(interaction, st);
  }
}

export async function handleScoutSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const { action } = parseId(interaction.customId);
  const access = accessOwnedState(hubs, interaction.message.id, interaction.user.id, {
    ttlMs: HUB_TTL_MS,
    reclaim: () => freshState(interaction.user.id),
  });
  if (!access.ok) {
    await denyHubInteraction(interaction, "scout", access.reason);
    return;
  }
  const st = access.state;
  if (access.reclaimed) {
    await interaction.deferUpdate().catch(() => null);
    await updateHub(interaction, st);
    await interaction
      .followUp({
        content:
          "Your Scout Hub session was reset after a bot refresh — continue from Home (you're still the owner).",
        flags: 64,
      })
      .catch(() => null);
    return;
  }
  await interaction.deferUpdate().catch(() => null);
  if (!interaction.deferred && !interaction.replied) return;
  if (action === "tools") {
    const view = interaction.values[0] as ScoutView | undefined;
    if (view) {
      st.page = 0;
      if (view === "top" || view === "creators" || view === "report") {
        st.genre = st.genre ?? "tycoon";
      }
      if (view === "history" || view === "vsGenre" || view === "revenue" || view === "snapshot") {
        st.universeId = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
      }
      if (view === "devex") st.robux = st.robux ?? 100_000;
      st.view = view;
    }
    return updateHub(interaction, st);
  }
  if (action === "pickGame") {
    const id = Number(interaction.values[0]);
    if (Number.isFinite(id)) {
      st.universeId = id;
      st.view = "game";
      st.page = 0;
    }
  }
  return updateHub(interaction, st);
}

export async function handleScoutModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { action } = parseId(interaction.customId);

  // Modals from buttons may not have message yet bound the same way — prefer message id when present
  const messageId = interaction.message?.id;
  let st: ScoutState | null = messageId ? getHub(messageId, interaction.user.id) : null;

  await interaction.deferUpdate().catch(async () => {
    await interaction.deferReply({ flags: 64 });
  });

  try {
    if (!st) {
      st = freshState(interaction.user.id);
    }

    if (action === "searchModal") {
      st.keyword = interaction.fields.getTextInputValue("keyword").trim();
      st.view = "search";
      st.page = 0;
    } else if (action === "genreModal") {
      st.genre = interaction.fields.getTextInputValue("genre").trim();
      if (st.view !== "creators" && st.view !== "report" && st.view !== "top" && st.view !== "vsGenre") {
        st.view = "top";
      }
      st.page = 0;
    } else if (action === "compareModal") {
      const a = await ScoutService.resolveGame(interaction.fields.getTextInputValue("game_a"));
      const b = await ScoutService.resolveGame(interaction.fields.getTextInputValue("game_b"));
      st.compareIds = [a.universeId, b.universeId];
      st.universeId = a.universeId;
      st.view = "compare";
    } else if (action === "devexModal") {
      const robux = Number(interaction.fields.getTextInputValue("robux").replace(/[,_\s]/g, ""));
      if (!Number.isFinite(robux) || robux < 0) {
        await interaction.editReply(clearHubCard("Enter a valid Robux amount."));
        return;
      }
      st.robux = Math.floor(robux);
      st.view = "devex";
    }

    const payload = await buildView(st);
    const msg = await interaction.editReply(replaceHubCard(payload));
    bindHub(msg.id, st);
    armHubAutoDelete(msg);
  } catch (err) {
    logScoutError("handleScoutModal", err);
    const state = st ?? freshState(interaction.user.id);
    const soft = softErrorView(state, toScoutUserError(err));
    try {
      const msg = await interaction.editReply(replaceHubCard(soft));
      bindHub(msg.id, state);
      armHubAutoDelete(msg);
    } catch {
      /* ignored */
    }
  }
}
