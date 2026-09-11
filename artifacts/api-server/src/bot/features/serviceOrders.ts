import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
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
  type ServiceOrderAction,
} from "../services/serviceOrders";
import { resolveServiceKey, staffQuickReplyByKey } from "../services/serviceOrderHelpers";
import { logger } from "../../lib/logger";
import {
  NS,
  parseId,
  SVC_PLACE,
  SVC_SERVICE_PICK,
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
    const payload = serviceOrderPanelPayload();
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

  await interaction.editReply({
    content:
      "Unknown subcommand. Try **/leveling panel**, **/leveling queue**, **/leveling order**, or **/leveling setup**.",
  });
}

/* -------------------------------------------------------- place-order UX */

async function beginPlaceOrder(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }

  const ready = serviceOrdersReady(clan);
  if (!ready.ok) {
    await interaction.reply({ content: `⚠️ ${ready.error}`, flags: 64 });
    return;
  }

  if (!canPlaceServiceOrder(interaction.member, interaction.user.id, clan)) {
    await interaction.reply({ content: SERVICE_ORDER_ACCESS_DENIED, flags: 64 });
    return;
  }

  const existing = await findOpenOrderForCustomer(clan.guildId, interaction.user.id);
  if (existing) {
    const where = existing.channelId ? ` — see <#${existing.channelId}>` : "";
    await interaction.reply({
      content: `You already have an open order (**${existing.publicId}**)${where}.`,
      flags: 64,
    });
    return;
  }

  const options = Object.entries(SERVICE_CATALOG).map(([key, meta]) => ({
    label: meta.label.slice(0, 100),
    description: meta.blurb.slice(0, 100),
    value: key,
    emoji: meta.emoji,
  }));

  await interaction.reply({
    content: "What do you need? Pick a service:",
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SVC_SERVICE_PICK)
          .setPlaceholder("Choose a service…")
          .addOptions(options)
      ),
    ],
    flags: 64,
  });
}

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

export async function handleServiceOrderButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (parseId(interaction.customId).ns !== NS.svc) return;

  const { action, arg } = parseId(interaction.customId);

  if (action === "place" || interaction.customId === SVC_PLACE) {
    await beginPlaceOrder(interaction);
    return;
  }

  const orderId = Number(arg);
  if (!orderId) {
    await interaction.reply({ content: "Invalid order reference.", flags: 64 });
    return;
  }

  if (action === "syncFiles") {
    await runSyncFiles(interaction, orderId);
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

  if (action === "quickReply") {
    const orderId = Number(arg);
    if (!orderId) {
      await interaction.reply({ content: "Invalid order reference.", flags: 64 });
      return;
    }
    await runQuickReply(interaction, orderId);
    return;
  }

  await interaction.reply({ content: "Unknown service-order menu.", flags: 64 });
}

export async function handleServiceOrderModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { ns, action } = parseId(interaction.customId);
  if (ns !== NS.svc) return;

  if (action === "details") {
    await submitPlaceOrder(interaction);
    return;
  }

  await interaction.reply({ content: "Unknown service-order form.", flags: 64 });
}
