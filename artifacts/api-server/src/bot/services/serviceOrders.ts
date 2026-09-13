/**
 * Leveling / service-order queue — DB + Discord ticket/board orchestration.
 */
import {
  db,
  serviceOrdersTable,
  SERVICE_ORDER_QUEUE_STATUSES,
  type Clan,
  type ServiceOrder,
  type ServiceOrderStatus,
  type ServiceKey,
  type ServiceOrderAttachment,
} from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
  type User,
  type MessageActionRowComponentBuilder,
  type MessageEditOptions,
  type MessageCreateOptions,
} from "discord.js";
import { getMember, updateClan, isOfficer } from "./config";
import { buildDisputeOverwrites, disputeStaffRoleIds } from "./disputeHelpers";
import { createNotification } from "./notifications";
import { logAction, sendLog } from "./logging";
import { logger } from "../../lib/logger";
import { renderOffThread } from "../canvas/render-pool";
import {
  SERVICE_CATALOG,
  STATUS_LABEL,
  STATUS_EMOJI,
  STATUS_COLOR,
  formatPublicId,
  serviceOrderChannelName,
  parseAttachmentsJson,
  serializeAttachments,
  denseQueuePositions,
  ordersAhead,
  queueHeadline,
  statusTone,
  isTerminalStatus,
  canPlaceServiceOrderAccess,
  SERVICE_ORDER_ACCESS_DENIED,
  SERVICE_ORDER_PATIENCE_NOTICE,
  STAFF_QUICK_REPLIES,
  CUSTOMER_QUICK_REPLIES,
  serviceOrderChannelTopic,
  parseServiceOrderDetails,
  queuePlaceMessage,
} from "./serviceOrderHelpers";
import {
  svcClaim,
  svcStart,
  svcHold,
  svcComplete,
  svcReject,
  svcCancel,
  svcQueue,
  svcUp,
  svcDown,
  svcSyncFiles,
  svcQuickReply,
  svcCustomerCancel,
  svcRequestDelete,
  svcRequestClose,
  svcCustomerQuickReply,
  svcDelete,
  SVC_PLACE,
} from "../ui/ids";
import { scheduleOrderTrackerRefresh } from "./orderTracker";

export {
  SERVICE_CATALOG,
  STATUS_LABEL,
  STATUS_EMOJI,
  STATUS_COLOR,
  formatPublicId,
  queueHeadline,
  ordersAhead,
  isTerminalStatus,
  parseAttachmentsJson,
  SERVICE_ORDER_ACCESS_DENIED,
  SERVICE_ORDER_PATIENCE_NOTICE,
  STAFF_QUICK_REPLIES,
};

/* ------------------------------------------------------------------ ready */

export function serviceTeamRoleIds(clan: Clan): string[] {
  if (clan.serviceOrderTeamRoleId) return [clan.serviceOrderTeamRoleId];
  return disputeStaffRoleIds(clan);
}

export function canManageServiceOrders(member: GuildMember | null, clan: Clan): boolean {
  if (isOfficer(member, clan)) return true;
  if (!member || !clan.serviceOrderTeamRoleId) return false;
  return member.roles.cache.has(clan.serviceOrderTeamRoleId);
}

export function canPlaceServiceOrder(member: GuildMember | null, userId: string, clan: Clan): boolean {
  return canPlaceServiceOrderAccess({
    userId,
    memberRoleIds: member ? [...member.roles.cache.keys()] : [],
    whitelistUserIds: clan.serviceOrderWhitelistUserIds ?? [],
    whitelistRoleIds: clan.serviceOrderWhitelistRoleIds ?? [],
    blacklistUserIds: clan.serviceOrderBlacklistUserIds ?? [],
    blacklistRoleIds: clan.serviceOrderBlacklistRoleIds ?? [],
  });
}

export function serviceOrdersReady(clan: Clan): { ok: true } | { ok: false; error: string } {
  if (!clan.serviceOrdersEnabled) {
    return {
      ok: false,
      error:
        "Leveling service isn't enabled yet. An admin can turn it on in **/setup → Leveling Service**.",
    };
  }
  if (!clan.serviceOrderChannelId) {
    return {
      ok: false,
      error: "No **Leveling Orders** board channel is configured. Ask an admin to finish setup.",
    };
  }
  if (!clan.serviceOrderCategoryId) {
    return {
      ok: false,
      error: "No ticket **category** is configured for service orders. Ask an admin to finish setup.",
    };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- queries */

export async function getServiceOrder(guildId: string, id: number): Promise<ServiceOrder | null> {
  const [row] = await db
    .select()
    .from(serviceOrdersTable)
    .where(and(eq(serviceOrdersTable.guildId, guildId), eq(serviceOrdersTable.id, id)));
  return row ?? null;
}

export async function listActiveServiceOrders(guildId: string): Promise<ServiceOrder[]> {
  return db
    .select()
    .from(serviceOrdersTable)
    .where(
      and(
        eq(serviceOrdersTable.guildId, guildId),
        inArray(serviceOrdersTable.status, [...SERVICE_ORDER_QUEUE_STATUSES])
      )
    )
    .orderBy(asc(serviceOrdersTable.queuePosition), asc(serviceOrdersTable.createdAt));
}

export async function listServiceOrders(guildId: string, limit = 25): Promise<ServiceOrder[]> {
  return db
    .select()
    .from(serviceOrdersTable)
    .where(eq(serviceOrdersTable.guildId, guildId))
    .orderBy(desc(serviceOrdersTable.createdAt))
    .limit(limit);
}

export async function findOpenOrderForCustomer(
  guildId: string,
  customerId: string
): Promise<ServiceOrder | null> {
  const [row] = await db
    .select()
    .from(serviceOrdersTable)
    .where(
      and(
        eq(serviceOrdersTable.guildId, guildId),
        eq(serviceOrdersTable.customerId, customerId),
        inArray(serviceOrdersTable.status, [...SERVICE_ORDER_QUEUE_STATUSES])
      )
    )
    .orderBy(desc(serviceOrdersTable.createdAt))
    .limit(1);
  return row ?? null;
}

export async function recomputeQueue(guildId: string): Promise<ServiceOrder[]> {
  const active = await listActiveServiceOrders(guildId);
  active.sort((a, b) => {
    const ap = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
    const bp = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const positions = denseQueuePositions(active);
  for (const order of active) {
    const next = positions.get(order.id) ?? null;
    if (order.queuePosition !== next) {
      await db
        .update(serviceOrdersTable)
        .set({ queuePosition: next })
        .where(eq(serviceOrdersTable.id, order.id));
    }
  }
  return listActiveServiceOrders(guildId);
}

/* ----------------------------------------------------------------- create */

export interface PlaceServiceOrderInput {
  client: Client;
  guild: Guild;
  clan: Clan;
  customer: User;
  customerDisplayName: string;
  serviceKey: ServiceKey;
  details: string;
  /** Screenshots from the place-order modal file upload. */
  attachments?: ServiceOrderAttachment[];
}

export async function placeServiceOrder(
  input: PlaceServiceOrderInput
): Promise<{ ok: true; order: ServiceOrder; channelId: string } | { ok: false; error: string }> {
  const ready = serviceOrdersReady(input.clan);
  if (!ready.ok) return ready;

  const member =
    input.guild.members.cache.get(input.customer.id) ??
    (await input.guild.members.fetch(input.customer.id).catch(() => null));
  if (!canPlaceServiceOrder(member, input.customer.id, input.clan)) {
    return { ok: false, error: SERVICE_ORDER_ACCESS_DENIED };
  }

  const details = input.details.trim();
  if (!details) return { ok: false, error: "Please include important information for staff." };
  if (details.length > 1800) {
    return { ok: false, error: "Important information is too long (max 1800 characters)." };
  }

  const existing = await findOpenOrderForCustomer(input.clan.guildId, input.customer.id);
  if (existing) {
    const where = existing.channelId ? ` — see <#${existing.channelId}>` : "";
    return {
      ok: false,
      error: `You already have an open order (**${existing.publicId}**)${where}.`,
    };
  }

  const botId = input.client.user?.id;
  if (!botId) return { ok: false, error: "Bot is not ready — try again in a moment." };

  const catalog = SERVICE_CATALOG[input.serviceKey];
  const seq = input.clan.serviceOrderNextNumber ?? 1;
  await updateClan(input.clan.guildId, { serviceOrderNextNumber: seq + 1 });
  const publicId = formatPublicId(seq);

  const active = await listActiveServiceOrders(input.clan.guildId);
  const queuePosition = active.length + 1;

  const [created] = await db
    .insert(serviceOrdersTable)
    .values({
      guildId: input.clan.guildId,
      publicId,
      serviceKey: input.serviceKey,
      serviceLabel: catalog.label,
      details,
      attachmentsJson: input.attachments?.length
        ? serializeAttachments(input.attachments)
        : null,
      attachmentCount: input.attachments?.length ?? 0,
      status: "queued",
      queuePosition,
      customerId: input.customer.id,
      customerUsername: input.customer.username,
      customerDisplayName: input.customerDisplayName,
    })
    .returning();

  if (!created) return { ok: false, error: "Could not create the order record." };

  let channel: TextChannel;
  try {
    const parent = await input.guild.channels
      .fetch(input.clan.serviceOrderCategoryId!)
      .catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
      await db.delete(serviceOrdersTable).where(eq(serviceOrdersTable.id, created.id));
      return {
        ok: false,
        error: "The configured service-order category is missing. Ask an admin to re-run setup.",
      };
    }

    channel = await input.guild.channels.create({
      name: serviceOrderChannelName({
        username: input.customer.username,
        displayName: input.customerDisplayName,
        sequence: seq,
      }),
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: `${serviceOrderChannelTopic({
        username: input.customer.username,
        displayName: input.customerDisplayName,
        sequence: seq,
      })} · ${catalog.label} · ${publicId}`,
      permissionOverwrites: buildDisputeOverwrites({
        guildId: input.guild.id,
        memberId: input.customer.id,
        botId,
        staffRoleIds: serviceTeamRoleIds(input.clan),
      }),
      reason: `Service order ${publicId}`,
    });
  } catch (err) {
    logger.error({ err, guildId: input.clan.guildId }, "Failed to create service-order channel");
    await db.delete(serviceOrdersTable).where(eq(serviceOrdersTable.id, created.id));
    return {
      ok: false,
      error:
        "Couldn't create the private order channel. Check that the bot can Manage Channels in the ticket category.",
    };
  }

  const [order] = await db
    .update(serviceOrdersTable)
    .set({ channelId: channel.id })
    .where(eq(serviceOrdersTable.id, created.id))
    .returning();
  const row = order ?? { ...created, channelId: channel.id };

  const ticketCard = await buildOrderPayload(input.client, input.clan, row, "ticket");
  const boardCard = await buildOrderPayload(input.client, input.clan, row, "board");
  const staffPing = serviceTeamRoleIds(input.clan)
    .map((r) => `<@&${r}>`)
    .join(" ");

  try {
    const ticketMsg = await channel.send({
      content: [
        staffPing,
        `<@${input.customer.id}>`,
        "",
        `**Order ${row.publicId} received.** Drop screenshots or files **in this channel** (Discord upload — no image URLs).`,
        `Queue: **#${row.queuePosition ?? 1}** · ${ordersAhead(row.queuePosition)} ahead of you.`,
      ]
        .filter(Boolean)
        .join("\n"),
      embeds: ticketCard.embeds,
      files: ticketCard.files,
      components: ticketCard.components,
      allowedMentions: {
        users: [input.customer.id],
        roles: serviceTeamRoleIds(input.clan),
      },
    });
    await db
      .update(serviceOrdersTable)
      .set({ ticketMessageId: ticketMsg.id })
      .where(eq(serviceOrdersTable.id, row.id));
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, "Service order ticket intro failed");
  }

  try {
    
  // Re-post modal uploads into the ticket so staff can see them immediately.
  if (input.attachments?.length) {
    try {
      await channel.send({
        content: `📎 **${input.attachments.length}** file(s) attached with this order:`,
        files: input.attachments.slice(0, 10).map((a) => ({
          attachment: a.url,
          name: a.name || "upload.png",
        })),
      });
    } catch (err) {
      logger.warn({ err, channelId: channel.id }, "Service order attachment repost failed");
    }
  }

  const board = await input.guild.channels
      .fetch(input.clan.serviceOrderChannelId!)
      .catch(() => null);
    if (board?.isTextBased()) {
      const boardMsg = await board.send({
        content: `🆕 **${row.publicId}** · ${catalog.label} · <@${input.customer.id}> · Queue #${row.queuePosition ?? "?"}`,
        embeds: boardCard.embeds,
        files: boardCard.files,
        components: boardCard.components,
      });
      await db
        .update(serviceOrdersTable)
        .set({ boardMessageId: boardMsg.id, boardChannelId: board.id })
        .where(eq(serviceOrdersTable.id, row.id));
    }
  } catch (err) {
    logger.warn({ err }, "Service order board post failed");
  }

  await createNotification({
    guildId: input.clan.guildId,
    type: "service_order",
    title: `${row.publicId} — new ${catalog.label} order`,
    body: `${input.customerDisplayName}: ${details.slice(0, 240)}`,
    targetUserId: input.customer.id,
    targetUsername: input.customer.username,
    relatedId: row.id,
    createdBy: input.customer.id,
    createdByUsername: input.customer.username,
  });

  await logAction(input.clan.guildId, {
    action: "service_order_placed",
    targetUserId: input.customer.id,
    targetUsername: input.customer.username,
    moderatorId: input.customer.id,
    moderatorUsername: input.customer.username,
    details: {
      orderId: row.id,
      publicId: row.publicId,
      serviceKey: input.serviceKey,
      channelId: channel.id,
    },
  });

  await notifyCustomer(input.client, input.clan, row, {
    title: `${STATUS_EMOJI.received} Order received`,
    body: `**${row.publicId}** is in the queue at position **#${row.queuePosition ?? 1}**.\nTicket: <#${channel.id}>`,
    force: true,
  });

  await sendLog(
    input.client,
    input.clan,
    new EmbedBuilder()
      .setColor(STATUS_COLOR.queued)
      .setTitle(`🛠️ Service order · ${row.publicId}`)
      .setDescription(`<@${input.customer.id}> placed a **${catalog.label}** order.`)
      .addFields(
        { name: "Channel", value: `<#${channel.id}>`, inline: true },
        { name: "Queue", value: `#${row.queuePosition ?? 1}`, inline: true },
        { name: "Details", value: details.slice(0, 1024) }
      )
      .setTimestamp()
  );

  scheduleOrderTrackerRefresh(input.clan.guildId);
  const fresh = (await getServiceOrder(input.clan.guildId, row.id)) ?? row;
  return { ok: true, order: fresh, channelId: channel.id };
}

/* ----------------------------------------------------------- staff actions */

export type ServiceOrderAction =
  | "claim"
  | "start"
  | "hold"
  | "complete"
  | "reject"
  | "cancel"
  | "queue"
  | "up"
  | "down";

export async function applyServiceOrderAction(opts: {
  client: Client;
  guild: Guild;
  clan: Clan;
  orderId: number;
  action: ServiceOrderAction;
  actorId: string;
  actorUsername: string;
  note?: string | null;
}): Promise<{ ok: true; order: ServiceOrder } | { ok: false; error: string }> {
  const order = await getServiceOrder(opts.clan.guildId, opts.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isTerminalStatus(order.status) && opts.action !== "queue") {
    return { ok: false, error: `Order **${order.publicId}** is already ${order.status}.` };
  }

  const beforePos = order.queuePosition;
  const beforeStatus = order.status;
  const priorActive = await listActiveServiceOrders(opts.clan.guildId);
  const priorPositions = new Map(priorActive.map((o) => [o.id, o.queuePosition]));

  if (opts.action === "up" || opts.action === "down") {
    const active = await listActiveServiceOrders(opts.clan.guildId);
    const idx = active.findIndex((o) => o.id === order.id);
    if (idx < 0) return { ok: false, error: "Order is not in the active queue." };
    const swapWith = opts.action === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= active.length) {
      return { ok: false, error: "Already at the edge of the queue." };
    }
    const a = active[idx]!;
    const b = active[swapWith]!;
    const aPos = a.queuePosition ?? idx + 1;
    const bPos = b.queuePosition ?? swapWith + 1;
    await db
      .update(serviceOrdersTable)
      .set({ queuePosition: bPos })
      .where(eq(serviceOrdersTable.id, a.id));
    await db
      .update(serviceOrdersTable)
      .set({ queuePosition: aPos })
      .where(eq(serviceOrdersTable.id, b.id));
  } else {
    const patch: Record<string, unknown> = {};
    switch (opts.action) {
      case "claim":
        patch.status = "claimed";
        patch.staffId = opts.actorId;
        patch.staffUsername = opts.actorUsername;
        patch.claimedAt = new Date();
        break;
      case "start":
        patch.status = "in_progress";
        patch.staffId = order.staffId ?? opts.actorId;
        patch.staffUsername = order.staffUsername ?? opts.actorUsername;
        patch.startedAt = new Date();
        patch.claimedAt = order.claimedAt ?? new Date();
        break;
      case "hold":
        patch.status = "on_hold";
        if (opts.note) patch.statusNote = opts.note.slice(0, 500);
        break;
      case "complete":
        patch.status = "completed";
        patch.completedAt = new Date();
        patch.queuePosition = null;
        patch.staffId = order.staffId ?? opts.actorId;
        patch.staffUsername = order.staffUsername ?? opts.actorUsername;
        break;
      case "reject":
        patch.status = "rejected";
        patch.completedAt = new Date();
        patch.queuePosition = null;
        if (opts.note) patch.statusNote = opts.note.slice(0, 500);
        patch.staffId = order.staffId ?? opts.actorId;
        patch.staffUsername = order.staffUsername ?? opts.actorUsername;
        break;
      case "cancel":
        patch.status = "cancelled";
        patch.completedAt = new Date();
        patch.queuePosition = null;
        if (opts.note) patch.statusNote = opts.note.slice(0, 500);
        break;
      case "queue":
        patch.status = "queued";
        patch.completedAt = null;
        break;
    }
    await db.update(serviceOrdersTable).set(patch).where(eq(serviceOrdersTable.id, order.id));
  }

  await recomputeQueue(opts.clan.guildId);
  const updated = (await getServiceOrder(opts.clan.guildId, order.id)) ?? order;

  const statusChanged = beforeStatus !== updated.status;
  const posChanged = beforePos !== updated.queuePosition;

  if (statusChanged || posChanged) {
    const title = statusChanged
      ? `${STATUS_EMOJI[updated.status as ServiceOrderStatus] ?? "🔔"} ${STATUS_LABEL[updated.status as ServiceOrderStatus] ?? updated.status}`
      : "🔔 Queue update";
    const body = statusChanged
      ? customerBodyForAction(updated, opts.action, opts.note)
      : queueShiftBody(beforePos, updated.queuePosition);
    await notifyCustomer(opts.client, opts.clan, updated, {
      title,
      body,
      force: statusChanged,
      queueShift: !statusChanged && posChanged,
    });
  }

  // Only ping others when their position actually moved (avoids repeating the same #).
  if (
    isTerminalStatus(updated.status) ||
    opts.action === "queue" ||
    opts.action === "up" ||
    opts.action === "down"
  ) {
    const after = await listActiveServiceOrders(opts.clan.guildId);
    for (const o of after) {
      if (o.id === order.id) continue;
      const prev = priorPositions.get(o.id);
      if (prev === o.queuePosition) continue;
      await notifyCustomer(opts.client, opts.clan, o, {
        title: "🔔 Queue update",
        body: queueShiftBody(prev ?? null, o.queuePosition),
        queueShift: true,
      });
      await refreshOrderMessages(opts.client, opts.clan, o);
    }
  }

  await refreshOrderMessages(opts.client, opts.clan, updated);
  scheduleOrderTrackerRefresh(opts.clan.guildId);

  await logAction(opts.clan.guildId, {
    action: `service_order_${opts.action}`,
    targetUserId: updated.customerId,
    targetUsername: updated.customerUsername,
    moderatorId: opts.actorId,
    moderatorUsername: opts.actorUsername,
    details: {
      orderId: updated.id,
      publicId: updated.publicId,
      status: updated.status,
      queuePosition: updated.queuePosition,
    },
  });

  return { ok: true, order: updated };
}

function customerBodyForAction(
  order: ServiceOrder,
  action: ServiceOrderAction,
  note?: string | null
): string {
  const noteLine = note ? `\n${note}` : "";
  switch (action) {
    case "claim":
      return `**${order.publicId}** was claimed by **${order.staffUsername ?? "staff"}**.`;
    case "start":
      return `Work on **${order.publicId}** has started.`;
    case "hold":
      return `**${order.publicId}** was put on hold.${noteLine}`;
    case "complete":
      return `**${order.publicId}** is finished. Thanks for using the leveling service!`;
    case "reject":
      return `**${order.publicId}** was rejected.${noteLine}`;
    case "cancel":
      return `**${order.publicId}** was cancelled.${noteLine}`;
    case "queue":
      return `**${order.publicId}** was moved back into the queue at **#${order.queuePosition ?? "—"}**.`;
    default:
      return queueHeadline(order);
  }
}

/* -------------------------------------------------------- attachments sync */

export async function syncOrderAttachments(opts: {
  guild: Guild;
  clan: Clan;
  order: ServiceOrder;
  client: Client;
}): Promise<ServiceOrder> {
  if (!opts.order.channelId) return opts.order;
  const channel = await opts.guild.channels.fetch(opts.order.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return opts.order;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return opts.order;

  const found: ServiceOrderAttachment[] = [];
  const seen = new Set<string>();
  for (const msg of messages.values()) {
    if (msg.author.bot) continue;
    for (const att of msg.attachments.values()) {
      if (seen.has(att.url)) continue;
      seen.add(att.url);
      found.push({
        url: att.url,
        name: att.name,
        contentType: att.contentType,
        size: att.size,
      });
    }
  }

  const [updated] = await db
    .update(serviceOrdersTable)
    .set({
      attachmentsJson: serializeAttachments(found),
      attachmentCount: found.length,
    })
    .where(eq(serviceOrdersTable.id, opts.order.id))
    .returning();

  const row = updated ?? opts.order;
  await refreshOrderMessages(opts.client, opts.clan, row);
  return row;
}

/* -------------------------------------------------------------- messaging */

function queueShiftBody(
  fromPos: number | null | undefined,
  toPos: number | null | undefined
): string {
  const from = fromPos != null ? `#${fromPos}` : "—";
  const to = toPos != null ? `#${toPos}` : "—";
  if (from === to) {
    return `You're **${to}** in the queue (${ordersAhead(toPos)} ahead).`;
  }
  return `Queue moved **${from} → ${to}** (${ordersAhead(toPos)} ahead).`;
}

async function resolveCustomerAvatar(
  client: Client,
  clan: Clan,
  order: ServiceOrder
): Promise<string | null> {
  const member = await getMember(clan.guildId, order.customerId);
  const discordUser = await client.users.fetch(order.customerId).catch(() => null);
  const discordAvatar =
    discordUser?.displayAvatarURL({ size: 128, extension: "png" }) ?? member?.avatarUrl ?? null;
  return member?.robloxAvatarUrl || discordAvatar;
}

async function notifyCustomer(
  client: Client,
  clan: Clan,
  order: ServiceOrder,
  opts: { title: string; body: string; force?: boolean; queueShift?: boolean }
): Promise<void> {
  // Queue-shift pings are independent of the general customer-DM toggle.
  // They still @mention in the ticket so the member gets a true Discord ping.
  if (opts.queueShift) {
    if (!clan.serviceOrderDmQueue) return;
  } else if (!opts.force && !clan.serviceOrderDmCustomer) {
    return;
  }

  const avatar = await resolveCustomerAvatar(client, clan, order);
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLOR[(order.status as ServiceOrderStatus)] ?? 0x3498db)
    .setAuthor({
      name: order.customerDisplayName || order.customerUsername,
      iconURL: avatar ?? undefined,
    })
    .setTitle(opts.title.slice(0, 256))
    .setDescription(opts.body.slice(0, 2000))
    .addFields(
      {
        name: "Queue",
        value:
          order.queuePosition != null
            ? `#${order.queuePosition}`
            : "—",
        inline: true,
      },
      {
        name: "Order",
        value: order.publicId,
        inline: true,
      }
    )
    .setFooter({ text: "Leveling service" })
    .setTimestamp();

  if (order.channelId) {
    embed.addFields({ name: "Ticket", value: `<#${order.channelId}>`, inline: true });
  }

  try {
    const user = await client.users.fetch(order.customerId);
    await user.send({ embeds: [embed] });
  } catch {
    /* DMs closed */
  }

  if (order.channelId) {
    try {
      const ch = await client.channels.fetch(order.channelId);
      if (ch?.isTextBased() && ch.isSendable()) {
        await ch.send({
          content: `<@${order.customerId}>`,
          embeds: [embed],
          allowedMentions: { users: [order.customerId] },
        });
      }
    } catch {
      /* ignore */
    }
  }
}

function staffRows(orderId: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(svcClaim(orderId)).setLabel("Claim").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(svcStart(orderId)).setLabel("Start").setEmoji("▶️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(svcHold(orderId)).setLabel("Hold").setEmoji("⏸️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(svcComplete(orderId)).setLabel("Complete").setEmoji("🏁").setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(svcUp(orderId)).setLabel("Move Up").setEmoji("⬆️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(svcDown(orderId)).setLabel("Move Down").setEmoji("⬇️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(svcQueue(orderId)).setLabel("To Queue").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(svcSyncFiles(orderId)).setLabel("Sync Files").setEmoji("📎").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(svcReject(orderId)).setLabel("Reject").setEmoji("❌").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(svcCancel(orderId)).setLabel("Cancel").setEmoji("🚫").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(svcDelete(orderId)).setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(svcQuickReply(orderId))
        .setPlaceholder("Staff quick reply (labeled — don't type)…")
        .addOptions(
          STAFF_QUICK_REPLIES.map((r) => ({
            label: r.label.slice(0, 100),
            value: r.key,
            description: r.message.slice(0, 100),
          }))
        )
    ),
  ];
}

function ticketCustomerRows(orderId: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(svcCustomerQuickReply(orderId))
        .setPlaceholder("Quick message to staff…")
        .addOptions(
          CUSTOMER_QUICK_REPLIES.map((r) => ({
            label: r.label.slice(0, 100),
            value: r.key,
            description: r.message.slice(0, 100),
          }))
        )
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(svcCustomerCancel(orderId))
        .setLabel("Cancel Order")
        .setEmoji("🚫")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(svcRequestDelete(orderId))
        .setLabel("Request to Delete")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}


function componentsForAudience(
  orderId: number,
  audience: "ticket" | "board"
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (audience === "board") return staffRows(orderId);
  // Ticket canvas: customer-only controls (never staff board buttons).
  return ticketCustomerRows(orderId);
}


export async function buildOrderPayload(
  client: Client,
  clan: Clan,
  order: ServiceOrder,
  audience: "ticket" | "board" = "board"
): Promise<{
  embeds: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}> {
  const member = await getMember(clan.guildId, order.customerId);
  const discordUser = await client.users.fetch(order.customerId).catch(() => null);
  const discordAvatar =
    discordUser?.displayAvatarURL({ size: 256, extension: "png" }) ?? member?.avatarUrl ?? null;
  const avatarUrl = member?.robloxAvatarUrl || discordAvatar;

  const status = order.status as ServiceOrderStatus;
  
  const parsed = parseServiceOrderDetails(order.details);
  const placeMessage = queuePlaceMessage(order.queuePosition, parsed.vehicleCount);
let files: AttachmentBuilder[] | undefined;
  try {
    const png = await renderOffThread("serviceOrderCard", {
      communityName: clan.clanName,
      publicId: order.publicId,
      serviceLabel: order.serviceLabel,
      statusLabel: `${STATUS_EMOJI[status] ?? ""} ${STATUS_LABEL[status] ?? status}`.trim(),
      statusTone: statusTone(status),
      customerName: order.customerDisplayName,
      customerHandle: order.customerUsername,
      avatarUrl,
      details: order.details,
      queuePosition: order.queuePosition,
      ordersAhead: isTerminalStatus(status) ? null : ordersAhead(order.queuePosition),
      attachmentCount: order.attachmentCount,
      staffName: order.staffUsername,
      placeMessage,
      vehicleCount: parsed.vehicleCount,
      vehicleText: parsed.vehicleText || null,
      currentLevel: parsed.currentLevel,
      targetLevel: parsed.targetLevel,
      tags: parsed.tags,
      orderedAt: order.createdAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    });
    files = [new AttachmentBuilder(png, { name: `order-${order.publicId}.png` })];
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "serviceOrderCard render failed");
  }

  const embed = new EmbedBuilder()
    .setColor(STATUS_COLOR[status] ?? 0x5865f2)
    .setTitle(`${STATUS_EMOJI[status] ?? "🛠️"} ${order.publicId} · ${order.serviceLabel}`)
    .setDescription(queueHeadline(order))
    .addFields(
      { name: "Customer", value: `<@${order.customerId}>`, inline: true },
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
        name: "Your place",
        value: placeMessage,
        inline: false,
      },
      {
        name: "Vehicle name",
        value: parsed.vehicleText
          ? parsed.vehicleText.slice(0, 200)
          : "_none listed_",
        inline: false,
      },
      {
        name: "Current level",
        value: parsed.currentLevel != null ? String(parsed.currentLevel) : "—",
        inline: true,
      },
      {
        name: "Target level",
        value: parsed.targetLevel != null ? String(parsed.targetLevel) : "—",
        inline: true,
      },
      {
        name: "Tags",
        value: parsed.tags.length ? parsed.tags.join(", ") : "_none_",
        inline: true,
      },
      {
        name: "Important information",
        value: order.details.slice(0, 1024),
      },
      {
        name: "Attachments",
        value: order.attachmentCount
          ? `${order.attachmentCount} file(s) — use **Sync Files** after uploads`
          : "_Drop screenshots in the ticket channel_",
        inline: true,
      }
    )
    .setTimestamp(order.createdAt);

  if (files?.length) {
    embed.setImage(`attachment://order-${order.publicId}.png`);
  }

  return {
    embeds: [embed],
    files,
    components: isTerminalStatus(status) ? [] : componentsForAudience(order.id, audience),
  };
}

export async function refreshOrderMessages(
  client: Client,
  clan: Clan,
  order: ServiceOrder
): Promise<void> {
  const content = `${STATUS_EMOJI[order.status as ServiceOrderStatus] ?? ""} **${order.publicId}** · ${queueHeadline(order)}`;

  const edit = async (
    channelId: string | null,
    messageId: string | null,
    audience: "ticket" | "board"
  ) => {
    if (!channelId || !messageId) return;
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return;
      const msg = await ch.messages.fetch(messageId).catch(() => null);
      if (!msg) return;
      const payload = await buildOrderPayload(client, clan, order, audience);
      const editPayload: MessageEditOptions = {
        content,
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
      };
      await msg.edit(editPayload);
    } catch (err) {
      logger.warn({ err, orderId: order.id, channelId }, "order message refresh failed");
    }
  };

  await edit(order.channelId, order.ticketMessageId, "ticket");
  await edit(order.boardChannelId, order.boardMessageId, "board");
}

/** Staff: cancel if still open, then delete the private ticket channel. */
export async function deleteServiceOrderChannel(opts: {
  client: Client;
  guild: Guild;
  clan: Clan;
  orderId: number;
  actorId: string;
  actorUsername: string;
}): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const order = await getServiceOrder(opts.clan.guildId, opts.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.channelId) return { ok: false, error: "This order has no ticket channel left." };

  if (!isTerminalStatus(order.status)) {
    const cancelled = await applyServiceOrderAction({
      client: opts.client,
      guild: opts.guild,
      clan: opts.clan,
      orderId: order.id,
      action: "cancel",
      actorId: opts.actorId,
      actorUsername: opts.actorUsername,
      note: "Channel deleted by staff",
    });
    if (!cancelled.ok) return cancelled;
  }

  let deleted = false;
  try {
    const ch = await opts.guild.channels.fetch(order.channelId).catch(() => null);
    if (ch) {
      await ch.delete(`Service order ${order.publicId} deleted by ${opts.actorUsername}`);
      deleted = true;
    }
  } catch (err) {
    logger.error({ err, channelId: order.channelId }, "Failed to delete service-order channel");
    return {
      ok: false,
      error: "Discord refused to delete the channel. Check Manage Channels permission.",
    };
  }

  await db
    .update(serviceOrdersTable)
    .set({ channelId: null, ticketMessageId: null })
    .where(eq(serviceOrdersTable.id, order.id));

  scheduleOrderTrackerRefresh(opts.clan.guildId);
  return { ok: true, deleted };
}

export async function ensureServiceOrderCategory(
  guild: Guild,
  clan: Clan,
  botId: string
): Promise<{ categoryId: string; clan: Clan }> {
  if (clan.serviceOrderCategoryId) {
    const existing = await guild.channels.fetch(clan.serviceOrderCategoryId).catch(() => null);
    if (existing && existing.type === ChannelType.GuildCategory) {
      return { categoryId: existing.id, clan };
    }
  }

  const category = await guild.channels.create({
    name: "LEVELING ORDERS",
    type: ChannelType.GuildCategory,
    permissionOverwrites: buildDisputeOverwrites({
      guildId: guild.id,
      memberId: botId,
      botId,
      staffRoleIds: serviceTeamRoleIds(clan),
    }),
    reason: "Leveling service ticket category",
  });

  const updated =
    (await updateClan(clan.guildId, {
      serviceOrderCategoryId: category.id,
      serviceOrdersEnabled: true,
    })) ?? clan;

  return { categoryId: category.id, clan: updated };
}

/** Public panel payload — Place Service Order button. */
export function serviceOrderPanelPayload(): MessageCreateOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x3f51e0)
        .setTitle("🛠️ Leveling Service")
        .setDescription(
          "Need a **Military Tycoon** vehicle leveled or traded?\n\n" +
            "1. Press **Place Service Order**\n" +
            "2. Pick service, vehicle, levels, tags, and attach a screenshot\n" +
            "3. Get a private ticket with your queue card\n" +
            "4. Use **Cancel Order** / **Request to Delete** / quick messages in your ticket\n\n" +
            `${SERVICE_ORDER_PATIENCE_NOTICE}\n\n` +
            "_No external websites — everything stays in Discord._"
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SVC_PLACE)
          .setLabel("Place Service Order")
          .setEmoji("🛠️")
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}
