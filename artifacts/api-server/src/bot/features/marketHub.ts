/**
 * Marketplace Hub (/market) — Roblox avatar item shop.
 * Button-driven: categories, price, sort, search, item detail.
 * NOT Creator Store (that would be a separate /creator hub).
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
  MKT_NAV,
  MKT_CAT,
  MKT_PRICE,
  MKT_SORT,
  MKT_PAGE,
  MKT_REFRESH,
  MKT_SEARCH,
  MKT_SEARCH_MODAL,
  MKT_CREATOR_MODAL,
  MKT_PICK,
  MKT_BACK,
  MKT_MORE,
} from "../ui/ids";
import {
  searchMarketplace,
  getMarketItem,
  getBundleDetail,
  getBundleRecommendations,
  getAssetFavoriteCount,
  priceLabel,
  itemTypeLabel,
  marketItemUrl,
  creatorUrl,
  formatCount,
  CATEGORY_LABELS,
  PRICE_LABELS,
  SORT_LABELS,
  type MarketCategory,
  type MarketPriceFilter,
  type MarketSort,
  type MarketItem,
  type MarketItemType,
} from "../services/roblox/catalog";
import { toUserError, logRobloxError } from "../services/roblox/errors";

/* ------------------------------------------------------------------ state */

type MarketView = "home" | "browse" | "item" | "bundle" | "similar";

interface MarketState {
  ownerId: string;
  view: MarketView;
  category: MarketCategory;
  price: MarketPriceFilter;
  sort: MarketSort;
  keyword: string | null;
  creatorName: string | null;
  creatorType: 1 | 2 | null;
  creatorTargetId: number | null;
  cursor: string | null;
  cursorStack: Array<string | null>;
  nextCursor: string | null;
  selectedId: number | null;
  selectedType: MarketItemType | null;
  /** Cached last browse page for pick-without-refetch */
  lastItems: MarketItem[];
  returnView: MarketView | null;
  ts: number;
}

const HUB_TTL_MS = 20 * 60_000;
const hubs = new Map<string, MarketState>();

function prune() {
  const cutoff = Date.now() - HUB_TTL_MS;
  for (const [k, v] of hubs) if (v.ts < cutoff) hubs.delete(k);
}
function touch(st: MarketState) {
  st.ts = Date.now();
}
function getHub(messageId: string, userId: string): MarketState | null {
  prune();
  const st = hubs.get(messageId);
  if (!st || st.ownerId !== userId) return null;
  touch(st);
  return st;
}
function bindHub(messageId: string, state: MarketState) {
  prune();
  hubs.set(messageId, state);
}
function freshState(ownerId: string, patch: Partial<MarketState> = {}): MarketState {
  return {
    ownerId,
    view: "home",
    category: "all",
    price: "all",
    sort: "relevance",
    keyword: null,
    creatorName: null,
    creatorType: null,
    creatorTargetId: null,
    cursor: null,
    cursorStack: [],
    nextCursor: null,
    selectedId: null,
    selectedType: null,
    lastItems: [],
    returnView: null,
    ts: Date.now(),
    ...patch,
  };
}
function resetPaging(st: MarketState) {
  st.cursor = null;
  st.cursorStack = [];
  st.nextCursor = null;
}

function row(...components: MessageActionRowComponentBuilder[]) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}
function btn(label: string, customId: string, style: ButtonStyle = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 80))
    .setStyle(style)
    .setDisabled(disabled);
}

async function fileFrom(fn: string, params: unknown, name: string) {
  const png = await renderOffThread(fn, params);
  return new AttachmentBuilder(png, { name });
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function restrictionBadge(item: MarketItem): string | null {
  if (item.itemRestrictions.includes("LimitedUnique")) return "Limited U";
  if (item.itemRestrictions.includes("Limited")) return "Limited";
  if (item.itemRestrictions.includes("Collectible")) return "Collectible";
  if (item.itemType === "Bundle") return "Bundle";
  return null;
}

/* --------------------------------------------------------------- chrome */

function categoryRow(st: MarketState) {
  const cats: MarketCategory[] = ["all", "clothing", "accessories", "bodies", "collectibles"];
  return row(
    ...cats.map((c) =>
      btn(CATEGORY_LABELS[c], MKT_CAT(c), st.category === c ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
}

function categoryRow2(st: MarketState) {
  const cats: MarketCategory[] = ["animations", "gear", "military"];
  return row(
    ...cats.map((c) =>
      btn(CATEGORY_LABELS[c], MKT_CAT(c), st.category === c ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
    btn("Search", MKT_SEARCH, ButtonStyle.Success),
    btn("Creator", MKT_NAV("creator"), ButtonStyle.Success)
  );
}

function priceRow(st: MarketState) {
  const prices: MarketPriceFilter[] = ["all", "free", "under50", "under100", "over100"];
  return row(
    ...prices.map((p) =>
      btn(
        p === "all" ? "Any $" : PRICE_LABELS[p].replace(" R$", ""),
        MKT_PRICE(p),
        st.price === p ? ButtonStyle.Primary : ButtonStyle.Secondary
      )
    )
  );
}

function sortCycle(st: MarketState): MarketSort {
  const order: MarketSort[] = ["relevance", "favorites", "sales", "updated", "priceAsc", "priceDesc"];
  const i = order.indexOf(st.sort);
  return order[(i + 1) % order.length]!;
}

function pageRow(st: MarketState, hasPrev: boolean, hasNext: boolean) {
  return row(
    btn("◀ Prev", MKT_PAGE("prev"), ButtonStyle.Secondary, !hasPrev),
    btn(`Sort: ${SORT_LABELS[st.sort]}`, MKT_SORT("cycle"), ButtonStyle.Secondary),
    btn("Refresh", MKT_REFRESH, ButtonStyle.Primary),
    btn("Home", MKT_NAV("home")),
    btn("Next ▶", MKT_PAGE("next"), ButtonStyle.Secondary, !hasNext)
  );
}

function homeNav() {
  return [
    row(
      btn("Browse all", MKT_CAT("all"), ButtonStyle.Primary),
      btn("Military", MKT_CAT("military"), ButtonStyle.Primary),
      btn("Collectibles", MKT_CAT("collectibles")),
      btn("Clothing", MKT_CAT("clothing")),
      btn("Accessories", MKT_CAT("accessories"))
    ),
    row(
      btn("Bodies", MKT_CAT("bodies")),
      btn("Animations", MKT_CAT("animations")),
      btn("Gear", MKT_CAT("gear")),
      btn("Search", MKT_SEARCH, ButtonStyle.Success),
      btn("By creator", MKT_NAV("creator"), ButtonStyle.Success)
    ),
  ];
}

/* --------------------------------------------------------------- builders */

async function buildHome(st: MarketState): Promise<BaseMessageOptions> {
  const file = await fileFrom(
    "marketHome",
    { subtitle: "Tap a category below — filters and sorting are buttons, not slash commands." },
    "market-home.png"
  );
  return { files: [file], components: homeNav() };
}

async function buildBrowse(st: MarketState): Promise<BaseMessageOptions> {
  const page = await searchMarketplace({
    keyword: st.keyword,
    category: st.category,
    price: st.price,
    sort: st.sort,
    creatorName: st.creatorName,
    creatorType: st.creatorType,
    creatorTargetId: st.creatorTargetId,
    cursor: st.cursor,
    limit: 28,
  });
  st.lastItems = page.items;

  const titleParts = [CATEGORY_LABELS[st.category]];
  if (st.keyword) titleParts.push(`“${st.keyword}”`);
  if (st.creatorName) titleParts.push(`by ${st.creatorName}`);

  const file = await fileFrom(
    "marketGrid",
    {
      title: titleParts.join(" · "),
      subtitle: `${PRICE_LABELS[st.price]} · ${SORT_LABELS[st.sort]} · ${page.items.length} items`,
      rows: page.items.slice(0, 12).map((it) => ({
        name: it.name,
        meta: `${itemTypeLabel(it)} · ${it.creatorName}`,
        price: priceLabel(it),
        iconUrl: it.iconUrl,
        badge: restrictionBadge(it),
      })),
    },
    "market-browse.png"
  );

  const components = [
    categoryRow(st),
    categoryRow2(st),
    priceRow(st),
  ];

  if (page.items.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(MKT_PICK)
          .setPlaceholder("Open an item…")
          .addOptions(
            page.items.slice(0, 25).map((it) => ({
              label: it.name.slice(0, 100),
              description: `${priceLabel(it)} · ${itemTypeLabel(it)}`.slice(0, 100),
              value: `${it.itemType}:${it.id}`,
            }))
          )
      )
    );
  }

  components.push(
    pageRow(st, st.cursorStack.length > 0, Boolean(page.nextCursor))
  );

  st.nextCursor = page.nextCursor;

  return { files: [file], components };
}

async function buildItem(st: MarketState): Promise<BaseMessageOptions> {
  const id = st.selectedId;
  const type = st.selectedType ?? "Asset";
  if (!id) return buildHome(st);

  let item =
    st.lastItems.find((i) => i.id === id && i.itemType === type) ??
    (await getMarketItem(id, type).catch(() => null));

  if (!item && type === "Asset") {
    // Try from last browse without type match
    item = st.lastItems.find((i) => i.id === id) ?? null;
  }
  if (!item) {
    return {
      content: "⚠️ That marketplace item couldn't be loaded.",
      files: [],
      components: [row(btn("Back", MKT_BACK), btn("Home", MKT_NAV("home")))],
    };
  }

  if (item.itemType === "Bundle") {
    st.view = "bundle";
    return buildBundle(st, item.id);
  }

  // Enrich favorites if thin
  if (!item.favoriteCount) {
    const fav = await getAssetFavoriteCount(item.id);
    if (fav != null) item = { ...item, favoriteCount: fav };
  }

  const file = await fileFrom(
    "marketItem",
    {
      name: item.name,
      typeLabel: itemTypeLabel(item),
      price: priceLabel(item),
      creator: item.creatorName,
      favorites: formatCount(item.favoriteCount),
      description: item.description,
      iconUrl: item.iconUrl,
      restrictions: item.itemRestrictions,
      quantityLine:
        item.totalQuantity && item.totalQuantity > 0
          ? `Qty ${formatCount(item.totalQuantity)}${
              item.unitsAvailable != null ? ` · Remaining ${formatCount(item.unitsAvailable)}` : ""
            }`
          : null,
      createdLabel: whenLabel(item.createdUtc),
      itemId: item.id,
    },
    "market-item.png"
  );

  return {
    files: [file],
    components: [
      row(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("View on Roblox").setURL(marketItemUrl(item)),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Creator")
          .setURL(creatorUrl(item.creatorType, item.creatorTargetId)),
        btn("Search similar", MKT_MORE, ButtonStyle.Primary),
        btn("Back", MKT_BACK),
        btn("Home", MKT_NAV("home"))
      ),
    ],
  };
}

async function buildBundle(st: MarketState, bundleId?: number): Promise<BaseMessageOptions> {
  const id = bundleId ?? st.selectedId;
  if (!id) return buildHome(st);
  const detail = await getBundleDetail(id);
  st.selectedId = id;
  st.selectedType = "Bundle";

  const file = await fileFrom(
    "marketItem",
    {
      name: detail.name,
      typeLabel: `Bundle · ${detail.bundleType}`,
      price: detail.isFree || detail.price === 0 ? "Free" : detail.price != null ? `${formatCount(detail.price)} R$` : "Offsale",
      creator: detail.creatorName,
      favorites: detail.favoriteCount != null ? formatCount(detail.favoriteCount) : "—",
      description:
        detail.description ||
        `Includes ${detail.items.length} items: ${detail.items
          .slice(0, 6)
          .map((i) => i.name)
          .join(", ")}`,
      iconUrl: detail.iconUrl,
      restrictions: ["Bundle"],
      quantityLine: `${detail.items.length} included items`,
      createdLabel: null,
      itemId: detail.id,
    },
    "market-bundle.png"
  );

  return {
    files: [file],
    components: [
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("View on Roblox")
          .setURL(marketItemUrl({ id: detail.id, itemType: "Bundle", name: detail.name })),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Creator")
          .setURL(creatorUrl(detail.creatorType, detail.creatorId)),
        btn("More like this", MKT_MORE, ButtonStyle.Primary),
        btn("Back", MKT_BACK),
        btn("Home", MKT_NAV("home"))
      ),
    ],
  };
}

async function buildSimilar(st: MarketState): Promise<BaseMessageOptions> {
  if (st.selectedType === "Bundle" && st.selectedId) {
    const recs = await getBundleRecommendations(st.selectedId);
    st.lastItems = recs;
    const file = await fileFrom(
      "marketGrid",
      {
        title: "More like this",
        subtitle: "Bundle recommendations",
        rows: recs.slice(0, 12).map((it) => ({
          name: it.name,
          meta: `${itemTypeLabel(it)} · ${it.creatorName}`,
          price: priceLabel(it),
          iconUrl: it.iconUrl,
          badge: "Bundle",
        })),
      },
      "market-similar.png"
    );
    const components = [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(MKT_PICK)
          .setPlaceholder("Open a recommended bundle…")
          .addOptions(
            recs.slice(0, 25).map((it) => ({
              label: it.name.slice(0, 100),
              description: priceLabel(it).slice(0, 100),
              value: `Bundle:${it.id}`,
            }))
          )
      ),
      row(btn("Back", MKT_BACK), btn("Home", MKT_NAV("home"))),
    ];
    return { files: [file], components };
  }

  // Asset: re-search using item name keywords
  const seed =
    st.lastItems.find((i) => i.id === st.selectedId)?.name ??
    st.keyword ??
    "avatar";
  const words = seed
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(" ");
  st.keyword = words || seed.slice(0, 40);
  st.view = "browse";
  resetPaging(st);
  return buildBrowse(st);
}

async function buildView(st: MarketState): Promise<BaseMessageOptions> {
  switch (st.view) {
    case "home":
      return buildHome(st);
    case "browse":
      return buildBrowse(st);
    case "item":
      return buildItem(st);
    case "bundle":
      return buildBundle(st);
    case "similar":
      return buildSimilar(st);
    default:
      return buildHome(st);
  }
}

async function replyHub(interaction: ChatInputCommandInteraction, state: MarketState) {
  await interaction.deferReply({ flags: 64 });
  try {
    const payload = await buildView(state);
    const msg = await interaction.editReply(payload);
    bindHub(msg.id, state);
  } catch (err) {
    logRobloxError("marketReplyHub", err);
    await interaction.editReply({ content: toUserError(err), components: [], files: [] });
  }
}

async function updateHub(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  state: MarketState
) {
  try {
    const payload = await buildView(state);
    await interaction.editReply(payload);
    bindHub(interaction.message!.id, state);
  } catch (err) {
    logRobloxError("marketUpdateHub", err);
    await interaction.editReply({ content: toUserError(err), components: [], files: [] });
  }
}

/* -------------------------------------------------------------- commands */

/** Single slash entry — optional query opens browse. Everything else is buttons. */
export async function handleMarketCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString("query");
  const ownerId = interaction.user.id;
  if (query?.trim()) {
    return replyHub(
      interaction,
      freshState(ownerId, {
        view: "browse",
        keyword: query.trim(),
        category: "all",
      })
    );
  }
  return replyHub(interaction, freshState(ownerId));
}

export async function handleMarketButton(interaction: ButtonInteraction): Promise<void> {
  const { action, arg } = parseId(interaction.customId);

  if (action === "search") {
    const modal = new ModalBuilder()
      .setCustomId(MKT_SEARCH_MODAL)
      .setTitle("Search Marketplace")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("query")
            .setLabel("Item name or keyword")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80)
            .setPlaceholder("military helmet, tactical vest…")
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "nav" && arg === "creator") {
    const modal = new ModalBuilder()
      .setCustomId(MKT_CREATOR_MODAL)
      .setTitle("Browse by creator")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("creator")
            .setLabel("Creator username or group name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This Market Hub belongs to someone else — run `/market` to open yours.",
      flags: 64,
    });
    return;
  }

  await interaction.deferUpdate();

  if (action === "nav" && arg === "home") {
    Object.assign(st, freshState(st.ownerId));
    return updateHub(interaction, st);
  }
  if (action === "back") {
    st.view = st.returnView ?? "browse";
    st.returnView = null;
    return updateHub(interaction, st);
  }
  if (action === "refresh") {
    return updateHub(interaction, st);
  }
  if (action === "cat" && arg) {
    st.category = arg as MarketCategory;
    st.view = "browse";
    // Military category injects keyword when none set
    if (st.category === "military" && !st.keyword) {
      /* keyword comes from categoryParams KeywordHint */
    }
    resetPaging(st);
    return updateHub(interaction, st);
  }
  if (action === "price" && arg) {
    st.price = arg as MarketPriceFilter;
    st.view = "browse";
    resetPaging(st);
    return updateHub(interaction, st);
  }
  if (action === "sort" && arg) {
    if (arg === "cycle") st.sort = sortCycle(st);
    else st.sort = arg as MarketSort;
    st.view = "browse";
    resetPaging(st);
    return updateHub(interaction, st);
  }
  if (action === "page") {
    if (arg === "next" && st.nextCursor) {
      st.cursorStack.push(st.cursor);
      st.cursor = st.nextCursor;
    } else if (arg === "prev" && st.cursorStack.length) {
      st.cursor = st.cursorStack.pop() ?? null;
    }
    st.view = "browse";
    return updateHub(interaction, st);
  }
  if (action === "more") {
    st.returnView = st.view;
    st.view = "similar";
    return updateHub(interaction, st);
  }
}

export async function handleMarketSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const { action } = parseId(interaction.customId);
  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This Market Hub belongs to someone else — run `/market` to open yours.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  if (action === "pick") {
    const raw = interaction.values[0] ?? "";
    const [type, idStr] = raw.split(":");
    const id = Number(idStr);
    if (Number.isFinite(id)) {
      st.selectedId = id;
      st.selectedType = type === "Bundle" ? "Bundle" : "Asset";
      st.returnView = "browse";
      st.view = type === "Bundle" ? "bundle" : "item";
    }
  }
  return updateHub(interaction, st);
}

export async function handleMarketModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { action } = parseId(interaction.customId);
  const messageId = interaction.message?.id;
  let st = messageId ? getHub(messageId, interaction.user.id) : null;

  await interaction.deferUpdate().catch(async () => {
    await interaction.deferReply({ flags: 64 });
  });

  try {
    if (!st) st = freshState(interaction.user.id);

    if (action === "searchModal") {
      st.keyword = interaction.fields.getTextInputValue("query").trim();
      st.creatorName = null;
      st.creatorType = null;
      st.creatorTargetId = null;
      st.view = "browse";
      resetPaging(st);
    } else if (action === "creatorModal") {
      st.creatorName = interaction.fields.getTextInputValue("creator").trim();
      st.creatorType = null;
      st.creatorTargetId = null;
      st.keyword = null;
      st.view = "browse";
      resetPaging(st);
    }

    const payload = await buildView(st);
    const msg = await interaction.editReply(payload);
    bindHub(msg.id, st);
  } catch (err) {
    logRobloxError("handleMarketModal", err);
    await interaction.editReply({ content: toUserError(err), components: [], files: [] });
  }
}
