import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan, StaffNotification } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import {
  refreshNotifications,
  getNotification,
  markRead,
  markCleared,
  clearAll,
} from "../services/notifications";
import { buildManagerHome } from "./manager";
import {
  NOTIF_REFRESH,
  NOTIF_CLEAR_ALL,
  NOTIF_PICK,
  notifAction,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * 🔔 The staff notification panel. Lists what needs attention, with Read /
 * Clear per item and a direct "View Members" jump to the right Manager tab.
 * Read = acknowledged (stops the DM nudge); Clear = dealt with / dismissed.
 */

function itemLine(n: StaffNotification): string {
  const dot = n.status === "unread" ? "🔴" : "⚪";
  return `${dot} **${n.title}** — ${n.body}`;
}

export async function buildNotificationsView(clan: Clan): Promise<BaseMessageOptions> {
  const items = await refreshNotifications(clan);
  const unread = items.filter((i) => i.status === "unread").length;

  const embed = new EmbedBuilder()
    .setColor(items.length ? 0xfaa61a : 0x3ba55d)
    .setTitle("🔔 XP MANAGER — Notifications")
    .setDescription(
      items.length
        ? `You have **${items.length}** thing${items.length === 1 ? "" : "s"} that need attention` +
            (unread ? ` · **${unread}** unread` : "") +
            `\n\n${items.map(itemLine).join("\n")}`
        : "✅ All caught up — nothing needs attention right now."
    )
    .setFooter({ text: items.length ? "Pick a notification to Read, Clear, or jump to the members." : "" });

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (items.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(NOTIF_PICK)
      .setPlaceholder("Open a notification…")
      .addOptions(
        items.slice(0, 25).map((n) => ({
          label: n.title.slice(0, 90),
          description: n.body.slice(0, 90),
          value: String(n.id),
        }))
      );
    components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
  }
  components.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(NOTIF_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh").setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(NOTIF_CLEAR_ALL)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Clear All")
        .setEmoji("✅")
        .setDisabled(items.length === 0)
    )
  );
  return { embeds: [embed], components };
}

function itemDetail(n: StaffNotification): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(n.title)
    .setDescription(n.body)
    .setFooter({ text: n.status === "unread" ? "Unread" : n.status === "read" ? "Read" : "Cleared" });
  const rows: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(notifAction("read", n.id)).setStyle(ButtonStyle.Primary).setLabel("Read").setEmoji("👁️").setDisabled(n.status !== "unread"),
    new ButtonBuilder().setCustomId(notifAction("clear", n.id)).setStyle(ButtonStyle.Success).setLabel("Clear").setEmoji("✅"),
  ];
  if (n.category) {
    rows.push(
      new ButtonBuilder().setCustomId(notifAction("view", n.id)).setStyle(ButtonStyle.Secondary).setLabel("View Members").setEmoji("👥")
    );
  }
  rows.push(new ButtonBuilder().setCustomId(NOTIF_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("← Back"));
  return { embeds: [embed], components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...rows)] };
}

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  deferred = false
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    const msg = notConfiguredMessage(isOfficer(interaction.member, null));
    if (deferred) await interaction.editReply(msg);
    else await interaction.reply({ ...msg, flags: 64 });
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    const content = "Notifications are officer-only.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/** /xp notifications (officers). */
export async function openNotifications(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildNotificationsView(clan));
}

export async function handleNotifButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  const mod = { id: interaction.user.id, username: interaction.user.username };

  if (action === "refresh") {
    return void (await interaction.editReply(await buildNotificationsView(clan)));
  }
  if (action === "clearAll") {
    await clearAll(clan.guildId, mod.id, mod.username);
    return void (await interaction.editReply(await buildNotificationsView(clan)));
  }
  if (action === "read" && arg) {
    await markRead(clan.guildId, Number(arg), mod.id, mod.username);
    const n = await getNotification(clan.guildId, Number(arg));
    return void (await interaction.editReply(n ? itemDetail(n) : await buildNotificationsView(clan)));
  }
  if (action === "clear" && arg) {
    await markCleared(clan.guildId, Number(arg), mod.id, mod.username);
    return void (await interaction.editReply(await buildNotificationsView(clan)));
  }
  if (action === "view" && arg) {
    const n = await getNotification(clan.guildId, Number(arg));
    // Reading implies acknowledgement.
    if (n && n.status === "unread") await markRead(clan.guildId, n.id, mod.id, mod.username);
    const category = (n?.category ?? "all") as string;
    return void (await interaction.editReply(await buildManagerHome(clan, interaction.guild, category as never, 0)));
  }
}

export async function handleNotifSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const { action } = parseId(interaction.customId);
  if (action === "pick") {
    const n = await getNotification(clan.guildId, Number(interaction.values[0]));
    await interaction.editReply(n ? itemDetail(n) : await buildNotificationsView(clan));
  }
}
