/**
 * Live leveling-order tracker panel — one durable Discord message (dashboards
 * type "tracker") with a canvas board + mini embeds for each active order.
 */
import {
  db,
  dashboardsTable,
  type Clan,
  type ServiceOrder,
  type ServiceOrderStatus,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import { getMember } from "./config";
import { listActiveServiceOrders } from "./serviceOrders";
import {
  STATUS_COLOR,
  STATUS_EMOJI,
  STATUS_LABEL,
  ordersAhead,
  statusTone,
} from "./serviceOrderHelpers";
import { renderOffThread } from "../canvas/render-pool";
import { SVC_TRACKER_REFRESH } from "../ui/ids";
import { logger } from "../../lib/logger";

const DASH_TYPE = "tracker";

let trackerClient: Client | null = null;

export function setOrderTrackerClient(client: Client): void {
  trackerClient = client;
}

export async function getOrderTracker(guildId: string): Promise<{
  guildId: string;
  channelId: string;
  messageId: string | null;
} | null> {
  const [row] = await db
    .select()
    .from(dashboardsTable)
    .where(and(eq(dashboardsTable.guildId, guildId), eq(dashboardsTable.type, DASH_TYPE)));
  return row
    ? { guildId: row.guildId, channelId: row.channelId, messageId: row.messageId }
    : null;
}

async function saveOrderTracker(
  guildId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  await db
    .insert(dashboardsTable)
    .values({ guildId, type: DASH_TYPE, channelId, messageId })
    .onConflictDoUpdate({
      target: [dashboardsTable.guildId, dashboardsTable.type],
      set: { channelId, messageId, updatedAt: new Date() },
    });
}

async function avatarForOrder(client: Client, order: ServiceOrder): Promise<string | null> {
  const member = await getMember(order.guildId, order.customerId);
  const user = await client.users.fetch(order.customerId).catch(() => null);
  const discord =
    user?.displayAvatarURL({ size: 128, extension: "png" }) ?? member?.avatarUrl ?? null;
  return member?.robloxAvatarUrl || discord;
}

export async function buildOrderTrackerPayload(
  client: Client,
  clan: Clan
): Promise<MessageCreateOptions> {
  const active = await listActiveServiceOrders(clan.guildId);
  const rowViews = [];
  for (const order of active.slice(0, 8)) {
    const status = order.status as ServiceOrderStatus;
    rowViews.push({
      queuePosition: order.queuePosition ?? 0,
      publicId: order.publicId,
      customerName: order.customerDisplayName || order.customerUsername,
      serviceLabel: order.serviceLabel,
      statusLabel: `${STATUS_EMOJI[status] ?? ""} ${STATUS_LABEL[status] ?? status}`.trim(),
      statusTone: statusTone(status),
      avatarUrl: await avatarForOrder(client, order),
    });
  }

  const updatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  let files: AttachmentBuilder[] | undefined;
  try {
    const png = await renderOffThread("orderTrackerCard", {
      communityName: clan.clanName,
      activeCount: active.length,
      rows: rowViews,
      updatedAt,
    });
    files = [new AttachmentBuilder(png, { name: "order-tracker.png" })];
  } catch (err) {
    logger.warn({ err, guildId: clan.guildId }, "orderTrackerCard render failed");
  }

  const hero = new EmbedBuilder()
    .setColor(0x3f51e0)
    .setTitle("🛠️ Live Order Tracker")
    .setDescription(
      active.length
        ? `**${active.length}** active order${active.length === 1 ? "" : "s"} · watch the queue here.\nTicket updates still send — this board is the quiet live view.`
        : "Queue is clear. New orders show up here automatically."
    )
    .setFooter({ text: "Live tracker · refreshes when the queue changes" })
    .setTimestamp();
  if (files?.length) hero.setImage("attachment://order-tracker.png");

  const embeds: EmbedBuilder[] = [hero];

  // Mini embeds spaced under the canvas so each slot feels part of the board.
  for (const order of active.slice(0, 9)) {
    const status = order.status as ServiceOrderStatus;
    const avatar = await avatarForOrder(client, order);
    const mini = new EmbedBuilder()
      .setColor(STATUS_COLOR[status] ?? 0x3498db)
      .setAuthor({
        name: `#${order.queuePosition ?? "—"} · ${order.customerDisplayName || order.customerUsername}`,
        iconURL: avatar ?? undefined,
      })
      .setDescription(
        [
          `**${order.publicId}** · ${order.serviceLabel}`,
          `${STATUS_EMOJI[status] ?? ""} ${STATUS_LABEL[status] ?? status}`,
          order.queuePosition != null
            ? `${ordersAhead(order.queuePosition)} ahead`
            : null,
          order.channelId ? `Ticket: <#${order.channelId}>` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
    embeds.push(mini);
  }

  const components = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SVC_TRACKER_REFRESH)
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];

  return { embeds, files, components };
}

export type PostOrderTrackerResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: string };

export async function postOrderTracker(
  clan: Clan,
  channelId: string
): Promise<PostOrderTrackerResult> {
  const client = trackerClient;
  if (!client) {
    return { ok: false, reason: "The bot is still starting up — try again in a moment." };
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    channel = null;
  }
  if (!channel?.isTextBased() || !("send" in channel)) {
    return { ok: false, reason: `<#${channelId}> isn't a text channel I can post in.` };
  }

  if ("permissionsFor" in channel && "guild" in channel) {
    try {
      const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
      const perms = channel.permissionsFor(me);
      const missing: string[] = [];
      if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push("View Channel");
      if (!perms?.has(PermissionFlagsBits.SendMessages)) missing.push("Send Messages");
      if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missing.push("Embed Links");
      if (missing.length) {
        return {
          ok: false,
          reason: `I'm missing **${missing.join(", ")}** in <#${channelId}>.`,
        };
      }
    } catch {
      /* fall through */
    }
  }

  const payload = await buildOrderTrackerPayload(client, clan);
  try {
    const msg = await channel.send(payload);
    await saveOrderTracker(clan.guildId, channelId, msg.id);
    return { ok: true, messageId: msg.id };
  } catch (err) {
    logger.warn({ err, guildId: clan.guildId, channelId }, "Failed to post order tracker");
    const message = err instanceof Error ? err.message : "unknown error";
    return { ok: false, reason: `Discord rejected the post — ${message}` };
  }
}

async function doRefresh(guildId: string): Promise<void> {
  const client = trackerClient;
  if (!client) return;
  const dash = await getOrderTracker(guildId);
  if (!dash?.messageId) return;

  const { getClan } = await import("./config");
  const clan = await getClan(guildId);
  if (!clan) return;

  try {
    const ch = await client.channels.fetch(dash.channelId);
    if (!ch?.isTextBased() || !("messages" in ch)) return;
    const payload = await buildOrderTrackerPayload(client, clan);
    // attachments: [] replaces the previous canvas instead of stacking.
    const editPayload = { ...payload, attachments: [] } as MessageEditOptions;
    await ch.messages.edit(dash.messageId, editPayload);
  } catch (err) {
    logger.warn({ err, guildId }, "order tracker refresh failed");
  }
}

const pending = new Map<string, { timer: NodeJS.Timeout; first: number }>();
const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 8000;

export function scheduleOrderTrackerRefresh(guildId: string): void {
  if (!trackerClient) return;
  const now = Date.now();
  const existing = pending.get(guildId);
  if (existing) {
    if (now - existing.first >= MAX_WAIT_MS) return;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => {
      pending.delete(guildId);
      void doRefresh(guildId);
    }, DEBOUNCE_MS);
    return;
  }
  pending.set(guildId, {
    first: now,
    timer: setTimeout(() => {
      pending.delete(guildId);
      void doRefresh(guildId);
    }, DEBOUNCE_MS),
  });
}

export async function refreshOrderTrackerNow(guildId: string): Promise<void> {
  const existing = pending.get(guildId);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(guildId);
  }
  await doRefresh(guildId);
}
