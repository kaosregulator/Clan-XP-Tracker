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
import type { Clan, Notification } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import {
  listNotifications,
  setNotificationStatus,
  transitionAll,
} from "../services/notifications";
import { relative } from "../services/time";
import { memberSummary } from "./commandCenter";
import {
  NOTIF_REFRESH,
  NOTIF_READ_ALL,
  NOTIF_CLEAR_READ,
  NOTIF_PICK,
  notifRead,
  notifClear,
  notifResolve,
  notifMember,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * The notification center — the staff feed of what happened and what still
 * needs a decision. Items move unread → read → cleared; resolving the record
 * behind a notification clears it automatically elsewhere.
 */

const TYPE_ICON: Record<string, string> = {
  warning: "⚠️",
  dispute: "⚖️",
  escalation: "🚨",
  note: "📝",
  ticket: "🎫",
  system: "🔔",
};

function statusIcon(status: string): string {
  return status === "unread" ? "🔵" : status === "read" ? "⚪" : "✅";
}

function line(n: Notification): string {
  return (
    `${statusIcon(n.status)} ${TYPE_ICON[n.type] ?? "🔔"} **${n.title}** — ${n.body.slice(0, 90)}` +
    ` · ${relative(n.createdAt)}`
  );
}

export async function buildNotificationCenter(clan: Clan): Promise<BaseMessageOptions> {
  const items = await listNotifications(clan.guildId, "active", 15);
  const unread = items.filter((i) => i.status === "unread").length;

  const embed = new EmbedBuilder()
    .setColor(unread ? 0xfaa61a : 0x3ba55d)
    .setTitle(`🔔 Notification Center — ${clan.clanName}`)
    .setDescription(
      items.length
        ? `${unread} unread · ${items.length} active\n\n${items.map(line).join("\n")}`
        : "✨ No active notifications — everything is handled."
    )
    .setFooter({ text: "Pick an item to act on it · resolved items clear automatically" });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (items.length) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(NOTIF_PICK)
          .setPlaceholder("Open a notification…")
          .addOptions(
            items.slice(0, 25).map((n) => ({
              label: `${n.title}`.slice(0, 100),
              description: `${n.type} · ${n.status}`.slice(0, 100),
              value: String(n.id),
              emoji: TYPE_ICON[n.type] ?? "🔔",
            }))
          )
      )
    );
  }
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(NOTIF_READ_ALL).setLabel("Mark all read").setStyle(ButtonStyle.Secondary).setDisabled(unread === 0),
      new ButtonBuilder().setCustomId(NOTIF_CLEAR_READ).setLabel("Clear read").setStyle(ButtonStyle.Secondary).setDisabled(items.length === 0),
      new ButtonBuilder().setCustomId(NOTIF_REFRESH).setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary)
    )
  );
  return { embeds: [embed], components: rows };
}

async function guard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  deferred: boolean
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
    const content = "The notification center is officer-only.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/** /notifications — open the center. */
export async function openNotifications(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildNotificationCenter(clan));
}

/** Entry from the command center button — always a fresh ephemeral view. */
export async function openNotificationsFromButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildNotificationCenter(clan));
}

export async function handleNotifButton(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  const nid = Number(arg);

  switch (action) {
    case "refresh":
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "readAll":
      await transitionAll(clan.guildId, ["unread"], "read");
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "clearRead":
      await transitionAll(clan.guildId, ["unread", "read"], "cleared");
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "read":
      if (nid) await setNotificationStatus(clan.guildId, nid, "read");
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "clear":
      if (nid) await setNotificationStatus(clan.guildId, nid, "cleared");
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "resolve":
      if (nid) await setNotificationStatus(clan.guildId, nid, "resolved");
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "member":
      // A follow-up ephemeral message with the member panel.
      await interaction.followUp({ ...(await memberSummary(clan, String(arg))), flags: 64 });
      return;
  }
}

/** Selecting a notification marks it read and shows its detail with actions. */
export async function handleNotifSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;
  const nid = Number(interaction.values[0]);
  if (!nid) return;

  // Opening an item reads it.
  await setNotificationStatus(clan.guildId, nid, "read");
  const items = await listNotifications(clan.guildId, "active", 50);
  const n = items.find((i) => i.id === nid);

  if (!n) {
    // It may have been cleared/resolved — just refresh the list.
    await interaction.editReply(await buildNotificationCenter(clan));
    await interaction.followUp({ content: "That notification is no longer active.", flags: 64 });
    return;
  }

  const detail = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${TYPE_ICON[n.type] ?? "🔔"} ${n.title}`)
    .setDescription(n.body.slice(0, 4000))
    .addFields(
      { name: "Type", value: n.type, inline: true },
      { name: "When", value: relative(n.createdAt), inline: true },
      ...(n.targetUsername ? [{ name: "Member", value: `<@${n.targetUserId}> (${n.targetUsername})`, inline: true }] : [])
    );

  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(notifClear(n.id)).setLabel("Clear").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(notifResolve(n.id)).setLabel("Resolve").setStyle(ButtonStyle.Success),
  ];
  if (n.targetUserId) {
    buttons.push(
      new ButtonBuilder().setCustomId(notifMember(n.targetUserId)).setLabel("View member").setStyle(ButtonStyle.Primary)
    );
  }
  // Keep the list message; put the detail + actions in a follow-up so the
  // center stays visible.
  await interaction.followUp({
    embeds: [detail],
    components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons)],
    flags: 64,
  });
  await interaction.editReply(await buildNotificationCenter(clan));
}
