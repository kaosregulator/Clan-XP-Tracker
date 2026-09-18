import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  FileUploadBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type Attachment,
} from "discord.js";
import type { Clan, ServiceOrder, ServiceOrderStatus } from "@workspace/db";
import { getClan, isAdmin, isOfficer } from "../services/config";
import {
  serviceOrdersReady,
  placeServiceOrder,
  applyServiceOrderAction,
  syncOrderAttachments,
  getServiceOrder,
  listActiveServiceOrders,
  listServiceOrders,
  findOpenOrderForCustomer,
  canManageServiceOrders,
  canPlaceServiceOrder,
  serviceOrderPanelPayload,
  SERVICE_CATALOG,
  STATUS_LABEL,
  STATUS_EMOJI,
  queueHeadline,
  ordersAhead,
  SERVICE_ORDER_ACCESS_DENIED,
  deleteServiceOrderChannel,
  captureServiceOrderTranscript,
  parseAttachmentsJson,
  type ServiceOrderAction,
} from "../services/serviceOrders";
import {
  handleServiceOrderReviewButton,
  handleServiceOrderReviewModal,
} from "../services/serviceOrderReviews";
import {
  resolveServiceKey,
  staffQuickReplyByKey,
  customerQuickReplyByKey,
  CUSTOMER_QUICK_REPLY_COOLDOWN_MS,
  formatServiceOrderDetails,
  parseTagsField,
  isImageAttachment,
  SERVICE_ORDER_MAX_PHOTOS,
  SERVICE_ORDER_MIN_PHOTOS,
  parseLevelInput,
} from "../services/serviceOrderHelpers";
import {
  buildOrderTags,
  calculateServiceQuote,
  findCatalogService,
  formatQuoteAmount,
  getServiceCatalog,
  speedAddonLabel,
  type SpeedAddonKey,
  type ServiceOrderMeta,
} from "../services/serviceCatalog";
import {
  buildWizardPayload,
  clearPlaceDraft,
  ensurePlaceDraft,
  formatQuoteSummary,
  getPlaceDraft,
  savePlaceDraft,
} from "../services/placeOrderWizard";
import {
  postOrderTracker,
  refreshOrderTrackerNow,
} from "../services/orderTracker";
import { logger } from "../../lib/logger";
import {
  NS,
  parseId,
  SVC_PLACE,
  SVC_PLACE_FORM,
  SVC_SERVICE_PICK,
  SVC_TRACKER_REFRESH,
  SVC_WIZ_CANCEL,
  SVC_WIZ_CONTINUE,
  SVC_WIZ_SERVICE,
  svcDetailsModal,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import { relative } from "../services/time";

/**
 * Leveling / Service Order queue — slash `/leveling` + panel button/select/modal
 * and staff ticket actions (claim / start / hold / complete / …).
 */

const STAFF_ACTIONS = new Set<ServiceOrderAction>([
  "claim",
  "start",
  "hold",
  "complete",
  "reject",
  "cancel",
  "queue",
  "up",
  "down",
]);

function yesNo(v: boolean | null | undefined): string {
  return v ? "✅" : "❌";
}

function channelMention(id: string | null | undefined): string {
  return id ? `<#${id}>` : "_not set_";
}

function roleMention(id: string | null | undefined): string {
  return id ? `<@&${id}>` : "_not set (falls back to dispute staff)_";
}

function orderEmbed(order: ServiceOrder): EmbedBuilder {
  const status = order.status as ServiceOrderStatus;
  return new EmbedBuilder()
    .setColor(0x3f51e0)
    .setTitle(
      `${STATUS_EMOJI[status] ?? "🛠️"} ${order.publicId} · ${order.serviceLabel}`
    )
    .setDescription(queueHeadline(order))
    .addFields(
      { name: "Customer", value: `<@${order.customerId}>`, inline: true },
      {
        name: "Status",
        value: `${STATUS_EMOJI[status] ?? ""} ${STATUS_LABEL[status] ?? order.status}`.trim(),
        inline: true,
      },
      {
        name: "Queue",
        value:
          order.queuePosition != null
            ? `#${order.queuePosition} (${ordersAhead(order.queuePosition)} ahead)`
            : "—",
        inline: true,
      },
      {
        name: "Staff",
        value: order.staffId ? `<@${order.staffId}>` : "_unclaimed_",
        inline: true,
      },
      {
        name: "Ticket",
        value: order.channelId ? `<#${order.channelId}>` : "_none_",
        inline: true,
      },
      {
        name: "Attachments",
        value: String(order.attachmentCount ?? 0),
        inline: true,
      },
      { name: "Important information", value: order.details.slice(0, 1024) },
      ...(order.statusNote
        ? [{ name: "Note", value: order.statusNote.slice(0, 1024) }]
        : [])
    )
    .setFooter({ text: `Opened ${relative(order.createdAt)}` })
    .setTimestamp(order.createdAt);
}

function queueEmbed(clan: Clan, orders: ServiceOrder[]): EmbedBuilder {
  const lines = orders.length
    ? orders
        .slice(0, 25)
        .map((o) => {
          const status = o.status as ServiceOrderStatus;
          const ch = o.channelId ? ` · <#${o.channelId}>` : "";
          const staff = o.staffUsername ? ` · 👤 ${o.staffUsername}` : "";
          return (
            `${STATUS_EMOJI[status] ?? "•"} **#${o.queuePosition ?? "—"}** ` +
            `**${o.publicId}** · ${o.serviceLabel} · <@${o.customerId}>${staff}${ch}`
          );
        })
        .join("\n")
    : "✨ No active service orders.";

  return new EmbedBuilder()
    .setColor(orders.length ? 0x3498db : 0x3ba55d)
    .setTitle(`🛠️ Leveling queue — ${clan.clanName}`)
    .setDescription(
      orders.length ? `**${orders.length}** active:\n\n${lines}` : lines
    )
    .setFooter({
      text: "Staff manage orders from the ticket / board message buttons.",
    });
}

function setupEmbed(clan: Clan): EmbedBuilder {
  const ready = serviceOrdersReady(clan);
  return new EmbedBuilder()
    .setColor(ready.ok ? 0x3ba55d : 0xfaa61a)
    .setTitle(`🛠️ Leveling Service setup — ${clan.clanName}`)
    .setDescription(
      ready.ok
        ? "Service orders are ready. Post a member panel with **/leveling panel**."
        : `⚠️ ${ready.error}`
    )
    .addFields(
      {
        name: "Enabled",
        value: yesNo(clan.serviceOrdersEnabled),
        inline: true,
      },
      {
        name: "Orders board",
        value: channelMention(clan.serviceOrderChannelId),
        inline: true,
      },
      {
        name: "Ticket category",
        value: channelMention(clan.serviceOrderCategoryId),
        inline: true,
      },
      {
        name: "Team role",
        value: roleMention(clan.serviceOrderTeamRoleId),
        inline: true,
      },
      {
        name: "DM customer",
        value: yesNo(clan.serviceOrderDmCustomer),
        inline: true,
      },
      {
        name: "DM queue shifts",
        value: yesNo(clan.serviceOrderDmQueue),
        inline: true,
      },
      {
        name: "Next public ID",
        value: `LV-${String(clan.serviceOrderNextNumber ?? 1).padStart(4, "0")}`,
        inline: true,
      },
      {
        name: "Tips",
        value:
          "• Configure channels & roles in **/setup → Leveling Service**\n" +
          "• **/leveling panel** posts the Place Order button\n" +
          "• **/leveling queue** lists the live FIFO queue\n" +
          "• Staff use Claim / Start / Hold / Complete on ticket messages",
      }
    );
}

async function findOrderByPublicId(
  guildId: string,
  publicId: string
): Promise<ServiceOrder | null> {
  const needle = publicId.trim().toUpperCase();
  if (!needle) return null;
  const recent = await listServiceOrders(guildId, 100);
  return recent.find((o) => o.publicId.toUpperCase() === needle) ?? null;
}

/* -------------------------------------------------------------- /leveling */

export async function openLevelingCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;

  let sub: string | null = null;
  try {
    sub = interaction.options.getSubcommand(false);
  } catch {
    sub = null;
  }
  if (!sub) {
    sub = interaction.options.getString("action") ?? "queue";
  }

  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  if (sub === "panel") {
    if (!isAdmin(interaction.member, clan)) {
      await interaction.editReply({
        content: "Only admins can post the Leveling Service panel.",
      });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.editReply({
        content: "Post the panel from a server text channel.",
      });
      return;
    }
    const payload = serviceOrderPanelPayload(clan);
    await channel.send(payload);
    await interaction.editReply({
      content: "✅ Leveling Service panel posted in this channel.",
    });
    return;
  }

  if (sub === "queue") {
    if (!isOfficer(interaction.member, clan)) {
      await interaction.editReply({
        content: "The leveling queue is officer-only. Members place orders from the panel.",
      });
      return;
    }
    const active = await listActiveServiceOrders(clan.guildId);
    await interaction.editReply({ embeds: [queueEmbed(clan, active)] });
    return;
  }

  if (sub === "order") {
    const publicId = interaction.options.getString("public_id", true);
    const order = await findOrderByPublicId(clan.guildId, publicId);
    if (!order) {
      await interaction.editReply({
        content: `No order found for **${publicId.trim()}**.`,
      });
      return;
    }
    const staff =
      isOfficer(interaction.member, clan) ||
      canManageServiceOrders(interaction.member, clan);
    if (!staff && order.customerId !== interaction.user.id) {
      await interaction.editReply({
        content: "You can only look up your own service orders.",
      });
      return;
    }
    await interaction.editReply({ embeds: [orderEmbed(order)] });
    return;
  }

  if (sub === "setup") {
    if (!isAdmin(interaction.member, clan)) {
      await interaction.editReply({
        content:
          "Leveling setup is admin-only. Use **/setup → Leveling Service** if you have access.",
      });
      return;
    }
    await interaction.editReply({ embeds: [setupEmbed(clan)] });
    return;
  }

  if (sub === "tracker") {
    if (!isAdmin(interaction.member, clan)) {
      await interaction.editReply({
        content: "Only admins can post the live order tracker.",
      });
      return;
    }
    const chosen = interaction.options.getChannel("channel");
    const channelId = chosen?.id ?? interaction.channelId;
    const res = await postOrderTracker(clan, channelId);
    if (!res.ok) {
      await interaction.editReply({ content: `⚠️ ${res.reason}` });
      return;
    }
    await interaction.editReply({
      content: `✅ Live order tracker posted in <#${channelId}>. It refreshes when the queue changes.`,
    });
    return;
  }

  await interaction.editReply({
    content:
      "Unknown subcommand. Try **/leveling panel**, **/leveling queue**, **/leveling order**, **/leveling setup**, or **/leveling tracker**.",
  });
}

/* -------------------------------------------------------- place-order UX */

async function assertCanBeginPlace(
  interaction: ButtonInteraction | StringSelectMenuInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return null;
  }

  const ready = serviceOrdersReady(clan);
  if (!ready.ok) {
    await interaction.reply({ content: `⚠️ ${ready.error}`, flags: 64 });
    return null;
  }

  if (!canPlaceServiceOrder(interaction.member, interaction.user.id, clan)) {
    await interaction.reply({ content: SERVICE_ORDER_ACCESS_DENIED, flags: 64 });
    return null;
  }

  const existing = await findOpenOrderForCustomer(clan.guildId, interaction.user.id);
  if (existing) {
    const where = existing.channelId ? ` — see <#${existing.channelId}>` : "";
    await interaction.reply({
      content: `You already have an open order (**${existing.publicId}**)${where}.`,
      flags: 64,
    });
    return null;
  }
  return clan;
}

async function beginPlaceOrder(interaction: ButtonInteraction) {
  const clan = await assertCanBeginPlace(interaction);
  if (!clan) return;

  const catalog = getServiceCatalog(clan);
  const draft = ensurePlaceDraft(clan.guildId, interaction.user.id, catalog);
  const payload = buildWizardPayload(clan, draft);

  await interaction.reply({
    ...payload,
    flags: 64,
  });
}

async function refreshWizard(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  clan: Clan
) {
  const catalog = getServiceCatalog(clan);
  const draft = ensurePlaceDraft(clan.guildId, interaction.user.id, catalog);
  const payload = buildWizardPayload(clan, draft);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.update(payload);
  }
}

async function handleWizardServicePick(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  if (!canPlaceServiceOrder(interaction.member, interaction.user.id, clan)) {
    await interaction.reply({ content: SERVICE_ORDER_ACCESS_DENIED, flags: 64 });
    return;
  }

  const catalog = getServiceCatalog(clan);
  const draft = ensurePlaceDraft(clan.guildId, interaction.user.id, catalog);
  const picked = interaction.values[0] ?? draft.serviceKey;
  const known = findCatalogService(catalog, picked);
  draft.serviceKey = known?.key ?? resolveServiceKey(picked);
  // Reset custom target when switching to a non-level service.
  const svc = findCatalogService(catalog, draft.serviceKey);
  if (svc && svc.usesLevels === false) draft.customTarget = false;
  savePlaceDraft(draft);
  await refreshWizard(interaction, clan);
}

async function handleWizardSpeed(interaction: ButtonInteraction, speedRaw: string) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  const catalog = getServiceCatalog(clan);
  const draft = ensurePlaceDraft(clan.guildId, interaction.user.id, catalog);
  const allowed = new Set(
    catalog.addons.filter((a) => a.group === "speed").map((a) => a.key)
  );
  if (allowed.has(speedRaw)) {
    draft.speedKey = speedRaw as SpeedAddonKey;
    savePlaceDraft(draft);
  }
  await refreshWizard(interaction, clan);
}

async function handleWizardCustom(interaction: ButtonInteraction, on: boolean) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  const catalog = getServiceCatalog(clan);
  const draft = ensurePlaceDraft(clan.guildId, interaction.user.id, catalog);
  draft.customTarget = on;
  savePlaceDraft(draft);
  await refreshWizard(interaction, clan);
}

async function handleWizardCancel(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  clearPlaceDraft(interaction.guildId, interaction.user.id);
  await interaction.update({
    content: "❌ Order cancelled — press **Place Service Order** anytime to start again.",
    embeds: [],
    components: [],
  });
}

async function handleWizardContinue(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  if (!canPlaceServiceOrder(interaction.member, interaction.user.id, clan)) {
    await interaction.reply({ content: SERVICE_ORDER_ACCESS_DENIED, flags: 64 });
    return;
  }

  const catalog = getServiceCatalog(clan);
  const draft = getPlaceDraft(clan.guildId, interaction.user.id);
  if (!draft) {
    await interaction.reply({
      content: "⏱️ Wizard expired — press **Place Service Order** again.",
      flags: 64,
    });
    return;
  }

  const service =
    findCatalogService(catalog, draft.serviceKey) ?? catalog.services[0]!;
  const usesLevels = service.usesLevels !== false;
  const noun = catalog.itemNoun;
  const nounCap = noun.charAt(0).toUpperCase() + noun.slice(1);

  const modal = new ModalBuilder()
    .setCustomId(SVC_PLACE_FORM)
    .setTitle(`${service.emoji} ${service.label}`.slice(0, 45));

  const labels: LabelBuilder[] = [
    new LabelBuilder()
      .setLabel(`1. ${nounCap} name (required)`)
      .setDescription(`What should we work on? Example: M1 Abrams, F-22…`)
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("vehicle")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(200)
          .setPlaceholder(`Enter ${noun} name…`)
      ),
  ];

  if (usesLevels) {
    labels.push(
      new LabelBuilder()
        .setLabel("2. Current level right now (required)")
        .setDescription(`Where is this ${noun} today? Just a number — e.g. 1, 12, 80.`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("currentLevel")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(7)
            .setPlaceholder("e.g. 12")
        )
    );
    if (draft.customTarget) {
      // Destination was chosen on the wizard — only ask the stop level here.
      labels.push(
        new LabelBuilder()
          .setLabel("3. Stop at level (required)")
          .setDescription(
            `Destination — not your current level. Where should we stop? (below max ${catalog.maxLevel})`
          )
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("targetLevel")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(7)
              .setPlaceholder("e.g. 50")
          )
      );
    }
    // Max destination: no target field — already decided on the wizard.
  } else {
    labels.push(
      new LabelBuilder()
        .setLabel("2. Extra notes (optional)")
        .setDescription("Trade details, preferences, anything staff should know.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("notes")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500)
            .setPlaceholder("Optional notes…")
        )
    );
  }

  const photoStep = usesLevels ? (draft.customTarget ? "4" : "3") : "3";
  labels.push(
    new LabelBuilder()
      .setLabel(`${photoStep}. Add photos (required, max 5)`)
      .setDescription("Upload 1–5 screenshots from your device. Required.")
      .setFileUploadComponent(
        new FileUploadBuilder()
          .setCustomId("image")
          .setRequired(true)
          .setMinValues(1)
          .setMaxValues(5)
      )
  );

  // Discord modal: max 5 Label components
  modal.addLabelComponents(...labels.slice(0, 5));
  await interaction.showModal(modal);
}

/** Legacy path: service pick → free-text details modal (old panel messages). */
async function openDetailsModal(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  if (!canPlaceServiceOrder(interaction.member, interaction.user.id, clan)) {
    await interaction.reply({ content: SERVICE_ORDER_ACCESS_DENIED, flags: 64 });
    return;
  }

  const raw = interaction.values[0] ?? "other";
  const serviceKey = resolveServiceKey(raw);
  const catalog = SERVICE_CATALOG[serviceKey];

  const modal = new ModalBuilder()
    .setCustomId(svcDetailsModal(serviceKey))
    .setTitle(catalog.label.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("details")
        .setLabel("Important information")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(1800)
        .setPlaceholder(
          "Vehicle name, current level, target level, trade details, notes…"
        )
    )
  );
  await interaction.showModal(modal);
}

function parseLevelsField(raw: string): { current: number; target: number } | null {
  // Legacy single-box "12 → 80" / "1-100" support for older clients.
  const m = raw.trim().match(/(\d+)\s*(?:→|->|to|-|–)\s*(\d+)/i);
  if (!m) return null;
  const current = Number(m[1]);
  const target = Number(m[2]);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return null;
  if (current < 1 || target < current) return null;
  return { current, target };
}

function isSpeedKey(v: string): v is SpeedAddonKey {
  return v === "regular" || v === "rushed" || v === "priority_now";
}

async function submitPlaceOrderForm(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const catalog = getServiceCatalog(clan);
  const draft = getPlaceDraft(clan.guildId, interaction.user.id);

  // Prefer wizard draft; fall back to modal select (older all-in-one modal).
  let serviceKey = draft?.serviceKey ?? "vehicle_leveling";
  let speedKey: SpeedAddonKey = draft?.speedKey ?? "regular";
  let preferCustom = draft?.customTarget ?? false;

  try {
    const serviceValues = interaction.fields.getStringSelectValues("service");
    if (serviceValues[0]) serviceKey = resolveServiceKey(serviceValues[0]);
  } catch {
    /* wizard path — no service select in modal */
  }

  const service =
    findCatalogService(catalog, serviceKey) ??
    findCatalogService(catalog, resolveServiceKey(serviceKey)) ??
    catalog.services[0]!;
  serviceKey = service.key;
  if (!isSpeedKey(speedKey)) speedKey = "regular";

  const vehicle = interaction.fields.getTextInputValue("vehicle").trim();
  if (!vehicle) {
    await interaction.editReply({
      content: `Please enter the ${catalog.itemNoun} name.`,
    });
    return;
  }

  let notes = "";
  try {
    notes = interaction.fields.getTextInputValue("notes").trim();
  } catch {
    notes = "";
  }

  const usesLevels = service.usesLevels !== false;
  let currentLevel: number | null = null;
  let targetLevel: number | null = null;
  let targetMaxed = !preferCustom;

  if (usesLevels) {
    try {
      const currentRaw = interaction.fields.getTextInputValue("currentLevel");
      if (preferCustom) {
        let targetRaw = "";
        try {
          targetRaw = interaction.fields.getTextInputValue("targetLevel");
        } catch {
          targetRaw = "";
        }
        const cur = parseLevelInput(currentRaw);
        const tgt = parseLevelInput(targetRaw);
        if (typeof cur !== "number" || typeof tgt !== "number" || tgt < cur) {
          await interaction.editReply({
            content:
              "Enter **current level** and **stop-at level** as simple numbers (stop ≥ current). " +
              "Stop-at is where you want leveling to end — not the same as current.",
          });
          return;
        }
        currentLevel = cur;
        targetLevel = tgt;
        targetMaxed = false;
        if (tgt >= catalog.maxLevel) {
          targetMaxed = true;
          targetLevel = null;
        }
      } else {
        // Wizard already chose Max destination — only current level on the form.
        const cur = parseLevelInput(currentRaw);
        if (typeof cur !== "number") {
          await interaction.editReply({
            content:
              "Enter your **current level** as a simple number (e.g. `12`). No leading zeros.",
          });
          return;
        }
        currentLevel = cur;
        targetLevel = null;
        targetMaxed = true;
      }
    } catch {
      // Older modal still posting a combined "levels" field.
      let levelsRaw = "";
      try {
        levelsRaw = interaction.fields.getTextInputValue("levels").trim();
      } catch {
        levelsRaw = "";
      }
      const legacy = parseLevelsField(levelsRaw);
      if (!legacy) {
        await interaction.editReply({
          content:
            "Enter **current level** as a simple number" +
            (preferCustom ? " and your **stop-at** level." : "."),
        });
        return;
      }
      currentLevel = legacy.current;
      targetLevel = legacy.target;
      targetMaxed = false;
    }
  }

  let tags: string[] = [];
  try {
    tags = parseTagsField(interaction.fields.getTextInputValue("tags"));
  } catch {
    tags = [];
  }

  const quote =
    usesLevels &&
    service.usesPricing !== false &&
    currentLevel != null
      ? calculateServiceQuote({
          catalog,
          serviceKey,
          currentLevel,
          targetMaxed,
          targetLevel,
          speedKey,
        })
      : null;

  const autoTags = buildOrderTags({
    catalog,
    serviceKey,
    serviceLabel: service.label,
    speedKey,
    targetMaxed,
    targetLevel,
    quote,
  });
  const allTags = [...autoTags, ...tags.filter((t) => !autoTags.includes(t))].slice(0, 8);

  const speedLabel = speedAddonLabel(catalog, speedKey);
  const quoteLine = quote ? formatQuoteSummary(catalog, quote.total) : null;
  const itemLabel = `${catalog.itemNoun.charAt(0).toUpperCase()}${catalog.itemNoun.slice(1)}(s)`;

  const details = formatServiceOrderDetails({
    serviceLabel: service.label,
    itemLabel,
    vehicleText: vehicle,
    currentLevel,
    targetLevel,
    targetMaxed,
    speedLabel,
    quoteLine,
    tags: allTags,
    notes,
  });

  const orderMeta: ServiceOrderMeta = {
    catalogBrand: catalog.brandName,
    itemNoun: catalog.itemNoun,
    itemName: vehicle,
    currentLevel,
    targetLevel,
    targetMaxed,
    speedKey,
    speedLabel,
    tags: allTags,
    quoteTotal: quote?.total ?? null,
    quoteCurrency: quote?.currencyLabel ?? null,
    quoteCurrencyEmoji: quote?.currencyEmoji ?? null,
    quoteLines: quote?.lines,
    estimate: quote?.estimate ?? false,
  };

  let attachments: { url: string; name: string; contentType: string | null; size: number }[] = [];
  try {
    const uploaded = interaction.fields.getUploadedFiles("image", true);
    if (uploaded) {
      const list: Attachment[] = Array.isArray(uploaded)
        ? uploaded
        : [...uploaded.values()];
      attachments = list
        .map((a) => ({
          url: a.url,
          name: a.name || "upload.png",
          contentType: a.contentType ?? null,
          size: a.size ?? 0,
        }))
        .filter((a) => isImageAttachment(a))
        .slice(0, SERVICE_ORDER_MAX_PHOTOS);
    }
  } catch {
    attachments = [];
  }

  if (attachments.length < SERVICE_ORDER_MIN_PHOTOS) {
    await interaction.editReply({
      content: `📷 **At least ${SERVICE_ORDER_MIN_PHOTOS} photo** is required (max ${SERVICE_ORDER_MAX_PHOTOS}). Upload screenshots from your device and try again.`,
    });
    return;
  }

  const res = await placeServiceOrder({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    customer: interaction.user,
    customerDisplayName:
      interaction.member?.displayName ?? interaction.user.displayName,
    serviceKey,
    details,
    attachments,
    orderMeta,
  });

  clearPlaceDraft(clan.guildId, interaction.user.id);

  if (!res.ok) {
    if (res.error === SERVICE_ORDER_ACCESS_DENIED) {
      await interaction.editReply({ content: res.error });
      return;
    }
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  const pos = res.order.queuePosition ?? 1;
  const ahead = ordersAhead(pos);
  const quoteBit = quote
    ? `\n💎 Estimated quote: **${formatQuoteAmount(catalog, quote.total)}** (staff confirms).`
    : "";
  await interaction.editReply({
    content:
      `✅ Order **${res.order.publicId}** placed with **${attachments.length}** photo(s).\n` +
      `${service.emoji} ${service.label} · ${speedLabel}` +
      (usesLevels && currentLevel != null
        ? ` · Lv ${currentLevel}→${targetMaxed ? "maxed" : targetLevel}`
        : "") +
      `\nQueue position **#${pos}**` +
      (ahead === 0 ? " — you're next." : ` (${ahead} ahead).`) +
      quoteBit +
      `\nPrivate ticket: <#${res.channelId}> — photos are on your order card.`,
  });
}

async function submitPlaceOrder(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { arg } = parseId(interaction.customId);
  const serviceKey = resolveServiceKey(String(arg ?? "other"));
  const details = interaction.fields.getTextInputValue("details").trim();

  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const res = await placeServiceOrder({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    customer: interaction.user,
    customerDisplayName:
      interaction.member?.displayName ?? interaction.user.displayName,
    serviceKey,
    details,
  });

  if (!res.ok) {
    if (res.error === SERVICE_ORDER_ACCESS_DENIED) {
      await interaction.editReply({ content: res.error });
      return;
    }
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  const pos = res.order.queuePosition ?? 1;
  const ahead = ordersAhead(pos);
  await interaction.editReply({
    content:
      `✅ Order **${res.order.publicId}** placed.\n` +
      `Queue position **#${pos}**` +
      (ahead === 0 ? " — you're next." : ` (${ahead} ahead).`) +
      `\nPrivate ticket: <#${res.channelId}> — drop screenshots there.`,
  });
}


/* ----------------------------------------------------------- staff buttons */

async function runStaffAction(
  interaction: ButtonInteraction,
  action: ServiceOrderAction,
  orderId: number
) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!canManageServiceOrders(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only leveling staff / officers can manage service orders.",
    });
    return;
  }

  const res = await applyServiceOrderAction({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    orderId,
    action,
    actorId: interaction.user.id,
    actorUsername: interaction.user.username,
  });

  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  const status = res.order.status as ServiceOrderStatus;
  await interaction.editReply({
    content:
      `✅ **${res.order.publicId}** → ` +
      `${STATUS_EMOJI[status] ?? ""} ${STATUS_LABEL[status] ?? res.order.status}`.trim() +
      (res.order.queuePosition != null ? ` · queue #${res.order.queuePosition}` : ""),
  });
}

async function runSyncFiles(interaction: ButtonInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!canManageServiceOrders(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only leveling staff / officers can sync order files.",
    });
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }

  const updated = await syncOrderAttachments({
    guild: interaction.guild,
    clan,
    order,
    client: interaction.client,
  });

  await interaction.editReply({
    content: `📎 Synced **${updated.attachmentCount}** file(s) for **${updated.publicId}**.`,
  });
}

/* -------------------------------------------------------------- handlers */


async function runQuickReply(interaction: StringSelectMenuInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!canManageServiceOrders(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only leveling staff / officers can send quick replies.",
    });
    return;
  }

  const message = staffQuickReplyByKey(interaction.values[0] ?? "");
  if (!message) {
    await interaction.editReply({ content: "Unknown quick reply." });
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }
  if (!order.channelId) {
    await interaction.editReply({ content: "This order has no ticket channel yet." });
    return;
  }

  try {
    const ch = await interaction.client.channels.fetch(order.channelId);
    if (!ch?.isTextBased() || !("send" in ch)) {
      await interaction.editReply({ content: "Couldn't reach the ticket channel." });
      return;
    }
    await ch.send({
      content: `<@${order.customerId}> ${message}`,
      allowedMentions: { users: [order.customerId] },
    });
  } catch (err) {
    logger.warn({ err, orderId }, "service order quick reply failed");
    await interaction.editReply({ content: "Failed to post the quick reply in the ticket." });
    return;
  }

  await interaction.editReply({ content: "✅ Quick reply sent in the ticket." });
}


/* ------------------------------------------- customer ticket actions */

const customerQuickReplyCooldown = new Map<string, number>();

async function runViewPics(interaction: ButtonInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }

  const isCustomer = order.customerId === interaction.user.id;
  const isStaff = canManageServiceOrders(interaction.member, clan);
  if (!isCustomer && !isStaff) {
    await interaction.editReply({ content: "Only the customer or staff can view order photos." });
    return;
  }

  const photos = parseAttachmentsJson(order.attachmentsJson)
    .filter((a) => isImageAttachment(a))
    .slice(0, SERVICE_ORDER_MAX_PHOTOS);

  if (!photos.length) {
    await interaction.editReply({
      content:
        "📷 No photos on this order yet. Upload images in the ticket, then staff can use **Sync Files**.",
    });
    return;
  }

  try {
    await interaction.editReply({
      content: `📷 **${photos.length}** photo(s) for **${order.publicId}** (ephemeral — only you see this):`,
      files: photos.map((a) => ({
        attachment: a.url,
        name: a.name || "order-photo.png",
      })),
    });
  } catch (err) {
    logger.warn({ err, orderId }, "view pics failed");
    await interaction.editReply({
      content:
        "⚠️ Couldn't attach the photos here (CDN may have expired). Scroll the ticket for the photo message, or ask staff to **Sync Files**.",
    });
  }
}

async function runRequestDelete(interaction: ButtonInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }
  if (order.customerId !== interaction.user.id && !canManageServiceOrders(interaction.member, clan)) {
    await interaction.editReply({ content: "Only the customer (or staff) can request a delete." });
    return;
  }

  if (order.channelId) {
    try {
      const ch = await interaction.client.channels.fetch(order.channelId);
      if (ch?.isTextBased() && "send" in ch) {
        const staffPing = clan.serviceOrderTeamRoleId
          ? `<@&${clan.serviceOrderTeamRoleId}>`
          : "Staff";
        await ch.send({
          content:
            `${staffPing} 🗑️ <@${order.customerId}> requested to **delete** order **${order.publicId}**.\n` +
            `Staff: use **Delete Order** / **Transcript** on the orders board.`,
          allowedMentions: {
            users: [order.customerId],
            roles: clan.serviceOrderTeamRoleId ? [clan.serviceOrderTeamRoleId] : [],
          },
        });
      }
    } catch (err) {
      logger.warn({ err, orderId }, "request delete ping failed");
    }
  }

  await interaction.editReply({
    content: "✅ Delete requested — staff have been pinged. Your order card stays until staff deletes the channel.",
  });
}

/** Legacy alias for older ticket buttons. */
async function runRequestClose(interaction: ButtonInteraction, orderId: number) {
  await runRequestDelete(interaction, orderId);
}

async function runCustomerCancel(interaction: ButtonInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }
  if (order.customerId !== interaction.user.id) {
    await interaction.editReply({ content: "Only the customer can cancel this order." });
    return;
  }

  const res = await applyServiceOrderAction({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    orderId,
    action: "cancel",
    actorId: interaction.user.id,
    actorUsername: interaction.user.username,
    note: "Cancelled by customer",
  });

  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  await interaction.editReply({
    content: `🚫 Order **${res.order.publicId}** cancelled. Staff can still delete this channel from the orders board.`,
  });
}


async function runCustomerQuickReply(interaction: StringSelectMenuInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }
  if (order.customerId !== interaction.user.id) {
    await interaction.editReply({ content: "Only the customer can use these quick replies." });
    return;
  }

  const key = `${order.id}:${interaction.user.id}`;
  const last = customerQuickReplyCooldown.get(key) ?? 0;
  const now = Date.now();
  const left = CUSTOMER_QUICK_REPLY_COOLDOWN_MS - (now - last);
  if (left > 0) {
    const secs = Math.ceil(left / 1000);
    await interaction.editReply({
      content: `⏳ Please wait **${secs}s** before another quick reply (anti-spam).`,
    });
    return;
  }

  const message = customerQuickReplyByKey(interaction.values[0] ?? "");
  if (!message) {
    await interaction.editReply({ content: "Unknown quick reply." });
    return;
  }
  if (!order.channelId) {
    await interaction.editReply({ content: "This order has no ticket channel." });
    return;
  }

  try {
    const ch = await interaction.client.channels.fetch(order.channelId);
    if (!ch?.isTextBased() || !("send" in ch)) {
      await interaction.editReply({ content: "Couldn't reach the ticket channel." });
      return;
    }
    const staffPing = clan.serviceOrderTeamRoleId ? `<@&${clan.serviceOrderTeamRoleId}>` : "Staff";
    await ch.send({
      content: `${staffPing} <@${order.customerId}> ${message}`,
      allowedMentions: {
        users: [order.customerId],
        roles: clan.serviceOrderTeamRoleId ? [clan.serviceOrderTeamRoleId] : [],
      },
    });
  } catch (err) {
    logger.warn({ err, orderId }, "customer quick reply failed");
    await interaction.editReply({ content: "Failed to post your quick reply." });
    return;
  }

  customerQuickReplyCooldown.set(key, now);
  await interaction.editReply({ content: "✅ Sent — staff will see it in this ticket." });
}

async function runDeleteChannel(interaction: ButtonInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!canManageServiceOrders(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only leveling staff / officers can delete order channels.",
    });
    return;
  }

  const res = await deleteServiceOrderChannel({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    orderId,
    actorId: interaction.user.id,
    actorUsername: interaction.user.username,
  });
  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }
  await interaction.editReply({
    content: res.deleted
      ? "✅ **Delete Order** — ticket channel removed. Order history + transcript were kept."
      : "✅ Order closed — channel was already gone. History kept.",
  });
}

async function runTranscript(interaction: ButtonInteraction, orderId: number) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!canManageServiceOrders(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only leveling staff / officers can save transcripts.",
    });
    return;
  }

  const order = await getServiceOrder(clan.guildId, orderId);
  if (!order) {
    await interaction.editReply({ content: "Order not found." });
    return;
  }

  const res = await captureServiceOrderTranscript({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    order,
    actorId: interaction.user.id,
    actorUsername: interaction.user.username,
  });
  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }
  await interaction.editReply({
    content:
      `📜 Transcript saved (**${res.messageCount}** messages)` +
      (clan.logChannelId ? ` → <#${clan.logChannelId}>.` : "."),
  });
}

async function runTrackerRefresh(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  await refreshOrderTrackerNow(clan.guildId);
}

export async function handleServiceOrderButton(interaction: ButtonInteraction) {
  const parsed = parseId(interaction.customId);
  if (parsed.ns !== NS.svc) return;

  // Review buttons work in guild tickets and DMs (fallback after channel delete).
  if (parsed.action.startsWith("review")) {
    const handled = await handleServiceOrderReviewButton(interaction);
    if (handled) return;
  }

  if (!interaction.inCachedGuild()) return;

  const { action, arg } = parsed;

  if (action === "place" || interaction.customId === SVC_PLACE) {
    await beginPlaceOrder(interaction);
    return;
  }

  if (action === "wizCancel" || interaction.customId === SVC_WIZ_CANCEL) {
    await handleWizardCancel(interaction);
    return;
  }

  if (action === "wizContinue" || interaction.customId === SVC_WIZ_CONTINUE) {
    await handleWizardContinue(interaction);
    return;
  }

  if (action === "wizSpeed") {
    await handleWizardSpeed(interaction, String(arg ?? "regular"));
    return;
  }

  if (action === "wizCustom") {
    await handleWizardCustom(interaction, String(arg ?? "0") === "1");
    return;
  }

  if (action === "trackerRefresh" || interaction.customId === SVC_TRACKER_REFRESH) {
    await runTrackerRefresh(interaction);
    return;
  }

  const orderId = Number(String(arg ?? "").split("-")[0]);
  if (!orderId) {
    await interaction.reply({ content: "Invalid order reference.", flags: 64 });
    return;
  }

  if (action === "syncFiles") {
    await runSyncFiles(interaction, orderId);
    return;
  }

  if (action === "viewPics") {
    await runViewPics(interaction, orderId);
    return;
  }

  if (action === "requestClose" || action === "requestDelete") {
    await runRequestDelete(interaction, orderId);
    return;
  }

  if (action === "customerCancel") {
    await runCustomerCancel(interaction, orderId);
    return;
  }

  if (action === "transcript") {
    await runTranscript(interaction, orderId);
    return;
  }

  if (action === "delete") {
    await runDeleteChannel(interaction, orderId);
    return;
  }

  if (STAFF_ACTIONS.has(action as ServiceOrderAction)) {
    await runStaffAction(interaction, action as ServiceOrderAction, orderId);
    return;
  }

  await interaction.reply({ content: "Unknown service-order action.", flags: 64 });
}

export async function handleServiceOrderSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { ns, action, arg } = parseId(interaction.customId);
  if (ns !== NS.svc) return;

  if (action === "servicePick" || interaction.customId === SVC_SERVICE_PICK) {
    await openDetailsModal(interaction);
    return;
  }

  if (action === "wizService" || interaction.customId === SVC_WIZ_SERVICE) {
    await handleWizardServicePick(interaction);
    return;
  }

  if (action === "quickReply") {
    const orderId = Number(arg);
    if (!orderId) {
      await interaction.reply({ content: "Invalid order reference.", flags: 64 });
      return;
    }
    await runQuickReply(interaction, orderId);
    return;
  }

  if (action === "customerQuickReply") {
    const orderId = Number(arg);
    if (!orderId) {
      await interaction.reply({ content: "Invalid order reference.", flags: 64 });
      return;
    }
    await runCustomerQuickReply(interaction, orderId);
    return;
  }

  await interaction.reply({ content: "Unknown service-order menu.", flags: 64 });
}

export async function handleServiceOrderModal(interaction: ModalSubmitInteraction) {
  const { ns, action } = parseId(interaction.customId);
  if (ns !== NS.svc) return;

  if (action === "reviewComment") {
    const handled = await handleServiceOrderReviewModal(interaction);
    if (handled) return;
  }

  if (!interaction.inCachedGuild()) return;

  if (action === "placeForm" || interaction.customId === SVC_PLACE_FORM) {
    await submitPlaceOrderForm(interaction);
    return;
  }

  if (action === "details") {
    await submitPlaceOrder(interaction);
    return;
  }

  await interaction.reply({ content: "Unknown service-order form.", flags: 64 });
}
