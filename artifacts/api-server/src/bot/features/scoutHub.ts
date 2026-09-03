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

function navRows(st: ScoutState): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const primary = row(
    btn("Home", SCT_NAV("home"), st.view === "home" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    btn("Trending", SCT_NAV("trending")),
    btn("Top genre", SCT_NAV("top")),
    btn("Upcoming", SCT_NAV("upcoming")),
    btn("Search", SCT_SEARCH)
  );
  const secondary = row(
    btn("MT snapshot", SCT_NAV("snapshot")),
    btn("History", SCT_NAV("history")),
    btn("Creators", SCT_NAV("creators")),
    btn("Report", SCT_NAV("report")),
    btn("Tracked", SCT_NAV("tracked"))
  );
  const tools = row(
    btn("Compare", SCT_NAV("compare")),
    btn("vs Genre", SCT_NAV("vsGenre")),
    btn("DevEx", SCT_NAV("devex")),
    btn("Revenue", SCT_NAV("revenue")),
    btn("Refresh", SCT_REFRESH, ButtonStyle.Primary)
  );
  return [primary, secondary, tools];
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
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(SCT_PICK_GAME)
      .setPlaceholder("Open a game…")
      .addOptions(
        slice.slice(0, 25).map((g) => ({
          label: g.name.slice(0, 100),
          description: `${ScoutService.formatCount(g.playing)} playing`.slice(0, 100),
          value: String(g.universeId),
        }))
      )
  );
}

/* --------------------------------------------------------------- builders */

async function buildHome(st: ScoutState): Promise<BaseMessageOptions> {
  void ScoutService.ensureMilitarySnapshot().catch(() => {});
  const status = ScoutService.autoStatus();
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
      dbHint: status.running ? "auto-snapshots on" : "local SQLite",
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
        subtitle: `${g.creator}${g.genre ? ` · ${g.genre}` : ""}`,
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
        "Use `/scout compare` with two games, or open Compare and submit two universe IDs.",
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
  const status = ScoutService.autoStatus();
  const file = await fileFrom(
    "scoutList",
    {
      eyebrow: "TRACKED SNAPSHOTS",
      title: `${tracked.length} universes`,
      subtitle: status.running
        ? `Auto-snapshots running · ${status.dbPath}`
        : `Auto-snapshots idle · ${status.dbPath}`,
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
  }
  return { files: [file], components };
}

async function buildSnapshot(st: ScoutState): Promise<BaseMessageOptions> {
  const id = st.universeId ?? MILITARY_TYCOON_UNIVERSE_ID;
  const snap = await ScoutService.snapshot([id]);
  const g = snap.games[0] ?? (await ScoutService.getGame(id));
  const hist = await ScoutService.history(id, 3);
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
      deltaLabel:
        hist.latest && hist.previous
          ? `Saved ${whenLabel(snap.takenAt)} · ${ScoutService.formatDeltaPct(hist.latest.playingDeltaPct)} vs prior`
          : `Saved ${whenLabel(snap.takenAt)} · first snapshot`,
      accentLabel: "SNAPSHOT SAVED",
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
  switch (st.view) {
    case "home":
      return buildHome(st);
    case "search": {
      const rows = st.keyword ? await ScoutService.search(st.keyword, 25) : [];
      return buildListView(st, "SEARCH", st.keyword ?? "Search", null, rows);
    }
    case "trending": {
      const rows = await ScoutService.trending(25, st.genre ?? undefined);
      return buildListView(
        st,
        "TRENDING",
        st.genre ? `${st.genre} · live CCU` : "Hot right now",
        st.genre
          ? null
          : "Live CCU ranking (growth deltas appear after enough local snapshots)",
        rows
      );
    }
    case "top": {
      const genre = st.genre ?? "tycoon";
      const rows = await ScoutService.topByGenre(genre, 25);
      return buildListView(st, "TOP BY GENRE", genre, "Ranked by live players", rows);
    }
    case "upcoming": {
      const { rows, needHistory } = await ScoutService.upAndComing(25);
      if (needHistory) {
        return {
          content:
            "📈 Up-and-coming needs snapshot history. Snap a few games (or wait for MT auto-snapshots), then refresh.",
          files: [],
          components: [
            ...navRows(st),
            row(btn("Snap MT", SCT_SNAPSHOT, ButtonStyle.Success), btn("Tracked", SCT_NAV("tracked"))),
          ],
        };
      }
      return buildListView(
        st,
        "UP-AND-COMING",
        "Breakouts",
        "Small-baseline games with high growth in local snapshots",
        rows
      );
    }
    case "game":
      return buildGame(st);
    case "history":
      return buildHistory(st);
    case "compare":
      return buildCompare(st);
    case "vsGenre":
      return buildVsGenre(st);
    case "creators":
      return buildCreators(st);
    case "report":
      return buildReport(st);
    case "revenue":
      return buildRevenue(st);
    case "devex":
      return buildDevex(st);
    case "group":
      return buildGroup(st);
    case "tracked":
      return buildTracked(st);
    case "snapshot":
      return buildSnapshot(st);
    default:
      return buildHome(st);
  }
}

async function replyHub(
  interaction: ChatInputCommandInteraction,
  state: ScoutState
): Promise<void> {
  await interaction.deferReply({ flags: 64 });
  try {
    ScoutService.startAutoSnapshots();
    const payload = await buildView(state);
    const msg = await interaction.editReply(payload);
    bindHub(msg.id, state);
  } catch (err) {
    logScoutError("replyHub", err);
    await interaction.editReply({ content: toScoutUserError(err), components: [], files: [] });
  }
}

async function updateHub(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  state: ScoutState
): Promise<void> {
  try {
    const payload = await buildView(state);
    await interaction.editReply(payload);
    bindHub(interaction.message!.id, state);
  } catch (err) {
    logScoutError("updateHub", err);
    await interaction.editReply({ content: toScoutUserError(err), components: [], files: [] });
  }
}

/* -------------------------------------------------------------- commands */

export async function handleScoutAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const q = String(focused.value ?? "").trim();
  if (q.length < 2) {
    await interaction.respond([]);
    return;
  }
  try {
    if (focused.name === "game" || focused.name === "game_a" || focused.name === "game_b" || focused.name === "focus") {
      const hits = await ScoutService.search(q, 8);
      await interaction.respond(
        hits.map((h) => ({
          name: h.name.slice(0, 100),
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
      const filtered = seeds.filter((s) => s.includes(q.toLowerCase())).slice(0, 20);
      await interaction.respond(
        (filtered.length ? filtered : [q]).map((s) => ({ name: s, value: s }))
      );
      return;
    }
    await interaction.respond([]);
  } catch (err) {
    logScoutError("autocomplete", err);
    await interaction.respond([]).catch(() => {});
  }
}

export async function handleScoutCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(false);
  const ownerId = interaction.user.id;

  try {
    if (!sub || sub === "hub") {
      return replyHub(interaction, freshState(ownerId));
    }

    if (sub === "search") {
      const keyword = interaction.options.getString("keyword", true);
      return replyHub(interaction, freshState(ownerId, { view: "search", keyword }));
    }

    if (sub === "trending") {
      const genre = interaction.options.getString("genre");
      return replyHub(interaction, freshState(ownerId, { view: "trending", genre }));
    }

    if (sub === "top") {
      const genre = interaction.options.getString("genre", true);
      return replyHub(interaction, freshState(ownerId, { view: "top", genre }));
    }

    if (sub === "upcoming") {
      return replyHub(interaction, freshState(ownerId, { view: "upcoming" }));
    }

    if (sub === "game") {
      const q = interaction.options.getString("game", true);
      const game = await ScoutService.resolveGame(q);
      return replyHub(
        interaction,
        freshState(ownerId, { view: "game", universeId: game.universeId })
      );
    }

    if (sub === "compare") {
      const a = await ScoutService.resolveGame(interaction.options.getString("game_a", true));
      const b = await ScoutService.resolveGame(interaction.options.getString("game_b", true));
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: "compare",
          compareIds: [a.universeId, b.universeId],
          universeId: a.universeId,
        })
      );
    }

    if (sub === "genre") {
      const game = await ScoutService.resolveGame(interaction.options.getString("game", true));
      const genre = interaction.options.getString("genre");
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: "vsGenre",
          universeId: game.universeId,
          genre,
        })
      );
    }

    if (sub === "snapshot") {
      const raw = interaction.options.getString("game");
      const game = raw
        ? await ScoutService.resolveGame(raw)
        : await ScoutService.getGame(MILITARY_TYCOON_UNIVERSE_ID);
      return replyHub(
        interaction,
        freshState(ownerId, { view: "snapshot", universeId: game.universeId })
      );
    }

    if (sub === "history") {
      const raw = interaction.options.getString("game");
      const game = raw
        ? await ScoutService.resolveGame(raw)
        : await ScoutService.getGame(MILITARY_TYCOON_UNIVERSE_ID);
      return replyHub(
        interaction,
        freshState(ownerId, { view: "history", universeId: game.universeId })
      );
    }

    if (sub === "creators") {
      const genre = interaction.options.getString("genre", true);
      return replyHub(interaction, freshState(ownerId, { view: "creators", genre }));
    }

    if (sub === "group") {
      return replyHub(interaction, freshState(ownerId, { view: "group" }));
    }

    if (sub === "report") {
      const genre = interaction.options.getString("genre", true);
      const focusRaw = interaction.options.getString("focus");
      const focus = focusRaw ? await ScoutService.resolveGame(focusRaw) : null;
      return replyHub(
        interaction,
        freshState(ownerId, {
          view: "report",
          genre,
          universeId: focus?.universeId ?? MILITARY_TYCOON_UNIVERSE_ID,
        })
      );
    }

    if (sub === "revenue") {
      const raw = interaction.options.getString("game");
      const game = raw
        ? await ScoutService.resolveGame(raw)
        : await ScoutService.getGame(MILITARY_TYCOON_UNIVERSE_ID);
      return replyHub(
        interaction,
        freshState(ownerId, { view: "revenue", universeId: game.universeId })
      );
    }

    if (sub === "devex") {
      const robux = interaction.options.getInteger("robux", true);
      return replyHub(interaction, freshState(ownerId, { view: "devex", robux }));
    }

    return replyHub(interaction, freshState(ownerId));
  } catch (err) {
    logScoutError("handleScoutCommand", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: toScoutUserError(err) });
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

  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This Scout Hub belongs to someone else — run `/scout` to open yours.",
      flags: 64,
    });
    return;
  }

  await interaction.deferUpdate();

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
  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This Scout Hub belongs to someone else — run `/scout` to open yours.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
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
        await interaction.editReply({ content: "Enter a valid Robux amount." });
        return;
      }
      st.robux = Math.floor(robux);
      st.view = "devex";
    }

    const payload = await buildView(st);
    const msg = await interaction.editReply(payload);
    bindHub(msg.id, st);
  } catch (err) {
    logScoutError("handleScoutModal", err);
    await interaction.editReply({ content: toScoutUserError(err), components: [], files: [] });
  }
}
