import {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type Client,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import type { Clan, XpSubmission } from "@workspace/db";
import { logger } from "../../lib/logger";
import { getClan, isStaff } from "../services/config";
import {
  getSubmission,
  setStatus,
  setReviewMessage,
  recentForUser,
} from "../services/submissions";
import { recomputeMemberStats } from "../services/members";
import { sendReminder } from "../services/reminders";
import { issueWarning, listActive } from "../services/warnings";
import { logAction, sendLog } from "../services/logging";
import { formatInZone } from "../services/time";
import { reviewCardComponents } from "../ui/components";
import { reviewRejectModal, reviewWarnModal, parseId } from "../ui/ids";

const STATUS_COLOR = { pending: 0xfaa61a, approved: 0x3ba55d, rejected: 0xed4245 } as const;
const STATUS_LABEL = { pending: "⏳ Pending", approved: "✅ Approved", rejected: "⛔ Rejected" } as const;

/** Build the moderation card embed for a submission. */
export function buildReviewEmbed(clan: Clan, sub: XpSubmission): EmbedBuilder {
  const status = sub.status as keyof typeof STATUS_COLOR;
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLOR[status] ?? STATUS_COLOR.pending)
    .setAuthor({ name: `${sub.username} • ${clan.activityName || "XP"} submission`, iconURL: sub.avatarUrl ?? undefined })
    .setTitle(STATUS_LABEL[status] ?? STATUS_LABEL.pending)
    .addFields(
      { name: "Member", value: `<@${sub.userId}>`, inline: true },
      { name: "Account", value: sub.accountLabel || "Main", inline: true },
      { name: "For", value: sub.activityDate, inline: true }
    )
    .setFooter({ text: `Submission #${sub.id} • ${formatInZone(sub.submittedAt, clan)}` });

  if (sub.notes) embed.addFields({ name: "Note", value: sub.notes.slice(0, 1024) });
  if (sub.proofImageUrls[0]) embed.setImage(sub.proofImageUrls[0]);
  if (sub.reviewedByUsername) {
    embed.addFields({
      name: sub.status === "approved" ? "Approved by" : "Reviewed by",
      value: `${sub.reviewedByUsername}${sub.reviewNote ? ` — ${sub.reviewNote}` : ""}`,
    });
  }
  return embed;
}

/** Post a fresh review card into the review channel and remember its message id. */
export async function postReviewCard(client: Client, clan: Clan, sub: XpSubmission): Promise<void> {
  const channelId = clan.reviewChannelId;
  if (!channelId) {
    logger.warn({ guild: clan.guildId }, "No review channel configured; skipping review card");
    return;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    const msg = await channel.send({
      embeds: [buildReviewEmbed(clan, sub)],
      components: reviewCardComponents(sub),
    });
    await setReviewMessage(sub.id, msg.id);
  } catch (err) {
    logger.error({ err }, "Failed to post review card");
  }
}

/* --------------------------------------------------------------- guards */

async function loadForReview(
  interaction: ButtonInteraction | ModalSubmitInteraction
): Promise<{ clan: Clan; sub: XpSubmission } | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) return null;
  if (!isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "You don't have permission to review submissions.", flags: 64 });
    return null;
  }
  const { arg } = parseId(interaction.customId);
  const sub = arg ? await getSubmission(Number(arg)) : null;
  if (!sub) {
    await interaction.reply({ content: "That submission no longer exists.", flags: 64 });
    return null;
  }
  return { clan, sub };
}

async function refreshCard(interaction: ButtonInteraction | ModalSubmitInteraction, clan: Clan, subId: number) {
  const fresh = await getSubmission(subId);
  if (!fresh || !interaction.message) return;
  await interaction.message
    .edit({ embeds: [buildReviewEmbed(clan, fresh)], components: reviewCardComponents(fresh) })
    .catch(() => {});
}

/* --------------------------------------------------------------- actions */

export async function handleApprove(interaction: ButtonInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx) return;
  const { clan, sub } = ctx;
  if (sub.status !== "pending") {
    await interaction.reply({ content: "Already reviewed.", flags: 64 });
    return;
  }
  await interaction.deferUpdate();

  await setStatus(sub.id, "approved", {
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
  });
  await recomputeMemberStats(clan, sub.userId);
  await refreshCard(interaction, clan, sub.id);

  await logAction(clan.guildId, {
    action: "submission_approved",
    targetUserId: sub.userId,
    targetUsername: sub.username,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    details: { submissionId: sub.id },
  });
  await sendLog(interaction.client, clan, buildReviewEmbed(clan, (await getSubmission(sub.id))!));

  if (clan.dmOnApprove) {
    const user = await interaction.client.users.fetch(sub.userId).catch(() => null);
    await user
      ?.send(`✅ Your ${clan.activityName || "XP"} submission in **${clan.clanName}** was approved. Nice work!`)
      .catch(() => {});
  }
}

export async function handleRejectButton(interaction: ButtonInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx) return;
  const { sub } = ctx;
  const modal = new ModalBuilder().setCustomId(reviewRejectModal(sub.id)).setTitle("Reject submission");
  modal.addComponents(
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason (shared with the member)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder("e.g. Screenshot unclear — please resubmit.")
    )
  );
  await interaction.showModal(modal);
}

export async function handleRejectModal(interaction: ModalSubmitInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx) return;
  const { clan, sub } = ctx;
  if (sub.status !== "pending") {
    await interaction.reply({ content: "Already reviewed.", flags: 64 });
    return;
  }
  const reason = interaction.fields.getTextInputValue("reason") || null;
  await interaction.deferUpdate();

  await setStatus(sub.id, "rejected", {
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    note: reason,
  });
  await recomputeMemberStats(clan, sub.userId);
  await refreshCard(interaction, clan, sub.id);

  await logAction(clan.guildId, {
    action: "submission_rejected",
    targetUserId: sub.userId,
    targetUsername: sub.username,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    details: { submissionId: sub.id, reason },
  });

  const user = await interaction.client.users.fetch(sub.userId).catch(() => null);
  await user
    ?.send(
      `⛔ Your ${clan.activityName || "XP"} submission in **${clan.clanName}** was rejected.` +
        (reason ? `\n> ${reason}` : "") +
        `\nYou can submit again with a clearer screenshot.`
    )
    .catch(() => {});
}

export async function handleRemind(interaction: ButtonInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx) return;
  const { clan, sub } = ctx;
  const user = await interaction.client.users.fetch(sub.userId).catch(() => null);
  if (!user) {
    await interaction.reply({ content: "Could not find that user.", flags: 64 });
    return;
  }
  const { delivered } = await sendReminder({
    clan,
    target: user,
    auto: false,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
  });
  await interaction.reply({
    content: delivered
      ? `👋 Friendly reminder sent to <@${sub.userId}>.`
      : `Reminder logged, but <@${sub.userId}> has DMs closed.`,
    flags: 64,
  });
}

export async function handleWarnButton(interaction: ButtonInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx) return;
  const { sub } = ctx;
  const modal = new ModalBuilder().setCustomId(reviewWarnModal(sub.id)).setTitle("Warn member");
  modal.addComponents(
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Warning reason")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Why is this member being warned?")
    )
  );
  await interaction.showModal(modal);
}

export async function handleWarnModal(interaction: ModalSubmitInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx || !interaction.inCachedGuild()) return;
  const { clan, sub } = ctx;
  const reason = interaction.fields.getTextInputValue("reason");
  await interaction.deferReply({ flags: 64 });

  const target = await interaction.client.users.fetch(sub.userId).catch(() => null);
  if (!target) {
    await interaction.editReply("Could not find that user.");
    return;
  }
  const { activeCount } = await issueWarning({
    client: interaction.client,
    clan,
    guild: interaction.guild,
    target,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    reason,
  });
  await interaction.editReply(`⚠️ Warned <@${sub.userId}> (now ${activeCount} active warning(s)).`);
}

export async function handleHistory(interaction: ButtonInteraction) {
  const ctx = await loadForReview(interaction);
  if (!ctx) return;
  const { clan, sub } = ctx;
  await interaction.deferReply({ flags: 64 });

  const [subs, warns] = await Promise.all([
    recentForUser(clan.guildId, sub.userId, 8),
    listActive(clan.guildId, sub.userId),
  ]);

  const glyph = { approved: "✅", rejected: "⛔", pending: "⏳" } as Record<string, string>;
  const lines = subs.length
    ? subs
        .map((s) => `${glyph[s.status] ?? "•"} ${s.activityDate} — ${s.status}${s.accountLabel ? ` (${s.accountLabel})` : ""}`)
        .join("\n")
    : "No submissions yet.";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `${sub.username} — history`, iconURL: sub.avatarUrl ?? undefined })
    .addFields(
      { name: "Recent submissions", value: lines },
      { name: "Active warnings", value: warns.length ? warns.map((w) => `• ${w.reason}`).join("\n").slice(0, 1024) : "None" }
    );
  await interaction.editReply({ embeds: [embed] });
}
