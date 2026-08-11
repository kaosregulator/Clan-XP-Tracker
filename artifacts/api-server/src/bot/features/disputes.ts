import {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ModalActionRowComponentBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan, Dispute } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { listActive, removeWarning } from "../services/warnings";
import { createDispute, listDisputes, getDispute, decideDispute } from "../services/disputes";
import { createTicket } from "../services/tickets";
import { formatInZone, relative } from "../services/time";
import { memberSummary } from "./commandCenter";
import {
  DISPUTE_PICK,
  DISPUTE_REVIEW_PICK,
  disputeReasonModal,
  disputeAccept,
  disputeDeny,
  disputeInfo,
  disputeTicket,
  disputeRemoveWarning,
  disputeMember,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * Disputes. Members contest their OWN warnings (ownership enforced in the
 * service); staff accept / deny / ask for info / open a ticket / remove the
 * warning. Deciding a dispute never removes enforcement on its own — that is a
 * separate, explicit staff action.
 */

const STATUS_BADGE: Record<string, string> = {
  pending: "🟡 Pending",
  info_requested: "🔵 Info requested",
  accepted: "✅ Accepted",
  denied: "❌ Denied",
  resolved: "☑️ Resolved",
};

/* ------------------------------------------------------------ member flow */

/** /dispute — a member opens a dispute against one of their active warnings. */
export async function openDisputePicker(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  const warns = await listActive(clan.guildId, interaction.user.id);
  if (!warns.length) {
    await interaction.editReply({ content: "You have no active warnings to dispute. ✅" });
    return;
  }
  await interaction.editReply({
    content: "Pick the warning you want to dispute. You can only dispute your own warnings.",
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(DISPUTE_PICK)
          .setPlaceholder("Choose a warning to dispute…")
          .addOptions(
            warns.slice(0, 25).map((w) => ({
              label: `#${w.id} — ${w.reason.slice(0, 80)}`,
              description: `Issued ${formatInZone(w.issuedAt, clan)} by ${w.issuedByUsername}`.slice(0, 100),
              value: String(w.id),
            }))
          )
      ),
    ],
  });
}

/** Member selected a warning → open the reason modal (no defer before modal). */
export async function handleDisputePickSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const warningId = Number(interaction.values[0]);
  if (!warningId) return;
  const modal = new ModalBuilder()
    .setCustomId(disputeReasonModal(warningId))
    .setTitle(`Dispute warning #${warningId}`)
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Why should this warning be reconsidered?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      ),
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("proof")
          .setLabel("Proof link (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
  await interaction.showModal(modal);
}

export async function handleDisputeReasonModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(false));
    return;
  }
  const { arg } = parseId(interaction.customId);
  const warningId = Number(arg);
  const reason = interaction.fields.getTextInputValue("reason").trim();
  const proof = interaction.fields.getTextInputValue("proof").trim() || null;

  const res = await createDispute({
    clan,
    warningId,
    user: { id: interaction.user.id, username: interaction.user.username },
    reason,
    proofUrl: proof,
  });
  await interaction.editReply({
    content: res.ok
      ? `✅ Dispute opened for warning #${warningId}. Staff have been notified and will review it. This does not remove the warning.`
      : `⚠️ ${res.error}`,
  });
}

/* ------------------------------------------------------------- staff flow */

async function officerGuard(
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
    const content = "Dispute review is officer-only. Members open disputes with /dispute.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

function disputeLine(d: Dispute): string {
  return `${STATUS_BADGE[d.status] ?? d.status} · **#${d.id}** ${d.username} — warning #${d.warningId} · ${relative(d.createdAt)}`;
}

export async function buildDisputeReview(clan: Clan): Promise<BaseMessageOptions> {
  const open = await listDisputes(clan.guildId, "open", 25);
  const embed = new EmbedBuilder()
    .setColor(open.length ? 0xfaa61a : 0x3ba55d)
    .setTitle(`⚖️ Disputes — ${clan.clanName}`)
    .setDescription(
      open.length
        ? `**${open.length}** awaiting a decision:\n\n${open.map(disputeLine).join("\n")}`
        : "✨ No disputes awaiting a decision."
    )
    .setFooter({ text: "Deciding a dispute never removes a warning by itself — use Remove warning for that." });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (open.length) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(DISPUTE_REVIEW_PICK)
          .setPlaceholder("Open a dispute…")
          .addOptions(
            open.slice(0, 25).map((d) => ({
              label: `#${d.id} — ${d.username}`.slice(0, 100),
              description: `warning #${d.warningId} · ${d.status}`.slice(0, 100),
              value: String(d.id),
            }))
          )
      )
    );
  }
  return { embeds: [embed], components: rows };
}

/** /disputes — staff review hub. */
export async function openDisputeReview(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildDisputeReview(clan));
}

export async function openDisputeReviewFromButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildDisputeReview(clan));
}

async function disputeDetail(clan: Clan, d: Dispute): Promise<BaseMessageOptions> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚖️ Dispute #${d.id} — ${d.username}`)
    .setDescription(d.reason.slice(0, 4000))
    .addFields(
      { name: "Status", value: STATUS_BADGE[d.status] ?? d.status, inline: true },
      { name: "Warning", value: `#${d.warningId}`, inline: true },
      { name: "Opened", value: relative(d.createdAt), inline: true },
      ...(d.proofUrl ? [{ name: "Proof", value: d.proofUrl.slice(0, 1024) }] : []),
      ...(d.staffResponse ? [{ name: "Staff response", value: d.staffResponse.slice(0, 1024) }] : [])
    );

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(disputeAccept(d.id)).setLabel("Accept").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(disputeDeny(d.id)).setLabel("Deny").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(disputeInfo(d.id)).setLabel("Ask for info").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(disputeTicket(d.id)).setLabel("Open ticket").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(disputeRemoveWarning(d.id)).setLabel("Remove warning").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(disputeMember(d.userId)).setLabel("View member").setStyle(ButtonStyle.Primary)
    ),
  ];
  return { embeds: [embed], components: rows };
}

export async function handleDisputeReviewSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const id = Number(interaction.values[0]);
  const d = id ? await getDispute(clan.guildId, id) : null;
  if (!d) {
    await interaction.followUp({ content: "That dispute no longer exists.", flags: 64 });
    return;
  }
  await interaction.followUp({ ...(await disputeDetail(clan, d)), flags: 64 });
}

/** Router for the string-selects under NS.disp (member pick vs staff review). */
export async function handleDisputeSelect(interaction: StringSelectMenuInteraction) {
  const { action } = parseId(interaction.customId);
  if (action === "pick") return void (await handleDisputePickSelect(interaction));
  if (action === "review") return void (await handleDisputeReviewSelect(interaction));
}

export async function handleDisputeButton(interaction: ButtonInteraction) {
  const { action, arg } = parseId(interaction.customId);

  if (action === "member") {
    await interaction.deferReply({ flags: 64 });
    const clan = await officerGuard(interaction, true);
    if (!clan) return;
    await interaction.editReply(await memberSummary(clan, String(arg)));
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const did = Number(arg);
  const d = did ? await getDispute(clan.guildId, did) : null;
  if (!d) {
    await interaction.editReply({ content: "That dispute no longer exists." });
    return;
  }
  const staff = { id: interaction.user.id, username: interaction.user.username };

  switch (action) {
    case "accept":
      await decideDispute({ clan, disputeId: did, status: "accepted", staffId: staff.id, staffUsername: staff.username, response: "Dispute accepted." });
      await interaction.editReply({ content: `✅ Dispute #${did} accepted. If enforcement should be lifted, use **Remove warning** or /warnings.` });
      return;
    case "deny":
      await decideDispute({ clan, disputeId: did, status: "denied", staffId: staff.id, staffUsername: staff.username, response: "Dispute denied." });
      await interaction.editReply({ content: `❌ Dispute #${did} denied. The warning stands.` });
      return;
    case "info":
      await decideDispute({ clan, disputeId: did, status: "info_requested", staffId: staff.id, staffUsername: staff.username, response: "More information requested." });
      await interaction.editReply({ content: `🔵 Marked dispute #${did} as needing more info. Follow up with <@${d.userId}>.` });
      return;
    case "ticket": {
      const ticket = await createTicket({
        clan,
        userId: d.userId,
        username: d.username,
        issue: `Dispute #${d.id} on warning #${d.warningId}: ${d.reason.slice(0, 200)}`,
        relatedWarningId: d.warningId,
        relatedDisputeId: d.id,
        createdBy: staff.id,
        createdByUsername: staff.username,
      });
      await interaction.editReply({ content: `🎫 Opened ticket #${ticket.id} for this dispute.` });
      return;
    }
    case "remwarn": {
      const removed = await removeWarning({
        guild: interaction.guild!,
        clan,
        warningId: d.warningId,
        moderatorId: staff.id,
        moderatorUsername: staff.username,
      });
      // Removing the warning also resolves the dispute.
      await decideDispute({ clan, disputeId: did, status: "resolved", staffId: staff.id, staffUsername: staff.username, result: "Warning removed." });
      await interaction.editReply({
        content: removed
          ? `✅ Removed warning #${d.warningId} and resolved dispute #${did}.`
          : `Warning #${d.warningId} was already removed; dispute #${did} resolved.`,
      });
      return;
    }
  }
}
