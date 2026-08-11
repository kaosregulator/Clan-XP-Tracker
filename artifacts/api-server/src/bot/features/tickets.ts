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
import type { Clan, Ticket } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { listTickets, getTicket, updateTicket } from "../services/tickets";
import { relative } from "../services/time";
import { TICKET_PICK, ticketProgress, ticketResolve, ticketClose, ticketAssign, parseId } from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * Tickets — a staff-only record view. No Discord channels are created; a ticket
 * is a tracked record with an assignee, status and resolution. Staff advance it
 * open → in progress → resolved / closed.
 */

const STATUS_BADGE: Record<string, string> = {
  open: "🟡 Open",
  in_progress: "🔵 In progress",
  resolved: "✅ Resolved",
  closed: "⬛ Closed",
};

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
    const content = "Tickets are officer-only.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

function ticketLine(t: Ticket): string {
  const who = t.assignedToUsername ? ` · 👤 ${t.assignedToUsername}` : "";
  return `${STATUS_BADGE[t.status] ?? t.status} · **#${t.id}** ${t.username} — ${t.issue.slice(0, 70)}${who} · ${relative(t.createdAt)}`;
}

export async function buildTicketList(clan: Clan): Promise<BaseMessageOptions> {
  const open = await listTickets(clan.guildId, "open", 25);
  const embed = new EmbedBuilder()
    .setColor(open.length ? 0xfaa61a : 0x3ba55d)
    .setTitle(`🎫 Tickets — ${clan.clanName}`)
    .setDescription(
      open.length
        ? `**${open.length}** open:\n\n${open.map(ticketLine).join("\n")}`
        : "✨ No open tickets."
    );

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (open.length) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_PICK)
          .setPlaceholder("Open a ticket…")
          .addOptions(
            open.slice(0, 25).map((t) => ({
              label: `#${t.id} — ${t.username}`.slice(0, 100),
              description: `${t.status} · ${t.issue}`.slice(0, 100),
              value: String(t.id),
            }))
          )
      )
    );
  }
  return { embeds: [embed], components: rows };
}

export async function openTickets(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildTicketList(clan));
}

async function ticketDetail(clan: Clan, t: Ticket): Promise<BaseMessageOptions> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎫 Ticket #${t.id} — ${t.username}`)
    .setDescription(t.issue.slice(0, 4000))
    .addFields(
      { name: "Status", value: STATUS_BADGE[t.status] ?? t.status, inline: true },
      { name: "Assigned", value: t.assignedToUsername ? `<@${t.assignedTo}>` : "_unassigned_", inline: true },
      { name: "Opened", value: relative(t.createdAt), inline: true },
      ...(t.relatedWarningId ? [{ name: "Warning", value: `#${t.relatedWarningId}`, inline: true }] : []),
      ...(t.relatedDisputeId ? [{ name: "Dispute", value: `#${t.relatedDisputeId}`, inline: true }] : []),
      ...(t.resolution ? [{ name: "Resolution", value: t.resolution.slice(0, 1024) }] : [])
    );
  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(ticketAssign(t.id)).setLabel("Assign to me").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(ticketProgress(t.id)).setLabel("In progress").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(ticketResolve(t.id)).setLabel("Resolve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(ticketClose(t.id)).setLabel("Close").setStyle(ButtonStyle.Danger)
    ),
  ];
  return { embeds: [embed], components: rows };
}

export async function handleTicketSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;
  const id = Number(interaction.values[0]);
  const t = id ? await getTicket(clan.guildId, id) : null;
  if (!t) {
    await interaction.followUp({ content: "That ticket no longer exists.", flags: 64 });
    return;
  }
  await interaction.followUp({ ...(await ticketDetail(clan, t)), flags: 64 });
}

export async function handleTicketButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  const tid = Number(arg);
  if (!tid) return;
  const staff = { id: interaction.user.id, username: interaction.user.username };

  switch (action) {
    case "assign":
      await updateTicket({ clan, ticketId: tid, assignedTo: staff.id, assignedToUsername: staff.username, status: "in_progress", staffId: staff.id, staffUsername: staff.username });
      await interaction.editReply({ content: `👤 Ticket #${tid} assigned to you and marked in progress.` });
      return;
    case "progress":
      await updateTicket({ clan, ticketId: tid, status: "in_progress", staffId: staff.id, staffUsername: staff.username });
      await interaction.editReply({ content: `🔵 Ticket #${tid} marked in progress.` });
      return;
    case "resolve":
      await updateTicket({ clan, ticketId: tid, status: "resolved", staffId: staff.id, staffUsername: staff.username });
      await interaction.editReply({ content: `✅ Ticket #${tid} resolved.` });
      return;
    case "close":
      await updateTicket({ clan, ticketId: tid, status: "closed", staffId: staff.id, staffUsername: staff.username });
      await interaction.editReply({ content: `⬛ Ticket #${tid} closed.` });
      return;
  }
}
