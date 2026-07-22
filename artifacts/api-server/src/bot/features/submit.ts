import {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Message,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import type { Clan, XpSubmission } from "@workspace/db";
import { logger } from "../../lib/logger";
import { getClan, identityFromUser, ensureMember, type MemberIdentity } from "../services/config";
import {
  createSubmission,
  createPendingSubmission,
  latestPendingAwaitingProof,
  latestTodayAwaitingProof,
  setProof,
  getSubmission,
} from "../services/submissions";
import { recomputeMemberStats } from "../services/members";
import { listAccounts } from "../services/accounts";
import { logAction, sendLog } from "../services/logging";
import { runExtraction, extractionEnabled } from "../services/extraction";
import { discordRelative, nextReset } from "../services/time";
import { postReviewCard } from "./review";
import { submitAccountPicker } from "./accounts";
import { scheduleTrackerRefresh } from "./tracker";
import { XP_SUBMIT_MODAL } from "../ui/ids";

const PROOF_LINK_WINDOW_MS = 30 * 60_000;
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/* --------------------------------------------------------------- helpers */

function submitModal(clan: Clan): ModalBuilder {
  const activity = clan.activityName || "XP";
  return new ModalBuilder()
    .setCustomId(XP_SUBMIT_MODAL)
    .setTitle(`Submit ${activity}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("notes")
          .setLabel("Notes (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder("Anything to add about today's session…")
      )
    );
}

function logEmbed(clan: Clan, sub: XpSubmission, auto: boolean): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(auto ? 0x3ba55d : 0xfaa61a)
    .setAuthor({ name: `${sub.username} • ${clan.activityName || "XP"}`, iconURL: sub.avatarUrl ?? undefined })
    .setTitle(auto ? "✅ Submitted" : "⏳ Submitted for review")
    .addFields(
      { name: "Member", value: `<@${sub.userId}>`, inline: true },
      { name: "For", value: sub.activityDate, inline: true }
    )
    .setTimestamp();
  if (sub.notes) embed.addFields({ name: "Note", value: sub.notes.slice(0, 1024) });
  if (sub.proofImageUrls[0]) embed.setImage(sub.proofImageUrls[0]);
  return embed;
}

/** Finalize a brand-new submission: recompute stats, log, refresh tracker. */
async function finalize(client: Message["client"], clan: Clan, sub: XpSubmission, auto: boolean) {
  if (auto) {
    await recomputeMemberStats(clan, sub.userId);
    await sendLog(client, clan, logEmbed(clan, sub, true));
    scheduleTrackerRefresh(client, clan);
  } else {
    await postReviewCard(client, clan, sub);
  }
  await logAction(clan.guildId, {
    action: auto ? "submission_recorded" : "submission_created",
    targetUserId: sub.userId,
    targetUsername: sub.username,
    details: { submissionId: sub.id, auto },
  });
}

async function runExtractionIfEnabled(clan: Clan, sub: XpSubmission): Promise<XpSubmission> {
  if (!extractionEnabled() || !sub.proofImageUrls.length) return sub;
  await runExtraction({ clan, submission: sub, imageUrls: sub.proofImageUrls, activityName: clan.activityName || "XP" });
  return (await getSubmission(sub.id)) ?? sub;
}

/* --------------------------------------------------------------- button */

/**
 * Submit button. Opens a notes modal (Discord modals can't hold images, so the
 * screenshot is an optional follow-up). With alt accounts enabled it first
 * offers an account picker.
 */
export async function handleSubmitButton(interaction: ButtonInteraction, clan: Clan) {
  if (clan.altAccountsEnabled && interaction.inCachedGuild()) {
    const accounts = await listAccounts(clan.guildId, interaction.user.id);
    if (accounts.length > 1) {
      await interaction.reply({ ...(await submitAccountPicker(clan, interaction.user.id)), flags: 64 });
      return;
    }
  }
  await interaction.showModal(submitModal(clan));
}

export async function handleSubmitModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ content: "This server isn't set up yet.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });

  const identity = identityFromUser(interaction.user, interaction.member.displayName);
  await ensureMember(clan.guildId, identity);
  const notes = interaction.fields.getTextInputValue("notes")?.trim().slice(0, 1000) || null;

  const auto = clan.autoApprove;
  const sub = await createSubmission({
    clan,
    identity,
    notes,
    status: auto ? "approved" : "pending",
  });
  await finalize(interaction.client, clan, sub, auto);

  const activity = clan.activityName || "XP";
  const proofHint =
    ` You can drop a screenshot in ${clan.submissionChannelId ? `<#${clan.submissionChannelId}>` : "the submission channel"} to attach proof.`;
  await interaction.editReply(
    auto
      ? `✅ **${activity} recorded** for today — your streak is updated. Next reset ${discordRelative(nextReset(clan))}.${proofHint}`
      : `⏳ **Submitted for review.**${proofHint}`
  );
}

/* -------------------------------------------------------------- messages */

/**
 * Screenshots posted in the submission channel. Attaches to a just-created
 * submission (from the modal flow) when possible; otherwise records a new one,
 * honouring the clan's auto-approve setting.
 */
export async function handleSubmissionMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;

  const clan = await getClan(message.guildId);
  if (!clan || !clan.submissionChannelId) return;
  if (message.channelId !== clan.submissionChannelId) return;

  const images = [...message.attachments.values()].filter(
    (a) => (a.contentType?.startsWith("image/") ?? false) || IMAGE_RE.test(a.name ?? "")
  );
  if (!images.length) return;

  try {
    const identity: MemberIdentity = identityFromUser(message.author, message.member?.displayName);
    await ensureMember(clan.guildId, identity);
    const note = message.content?.trim().slice(0, 1000) || null;
    const urls = images.map((a) => a.url);

    // 1) Attach to an alt-account pending submission started via the picker.
    const altPending = await latestPendingAwaitingProof(clan.guildId, message.author.id);
    // 2) Or attach to any submission today still missing its screenshot (modal flow).
    const awaiting =
      altPending && Date.now() - altPending.submittedAt.getTime() <= PROOF_LINK_WINDOW_MS
        ? altPending
        : await latestTodayAwaitingProof(clan, message.author.id);

    let submission: XpSubmission | null = null;
    let brandNew = false;

    if (awaiting && Date.now() - awaiting.submittedAt.getTime() <= PROOF_LINK_WINDOW_MS) {
      await setProof(awaiting.id, urls);
      submission = await getSubmission(awaiting.id);
    } else {
      submission = await createSubmission({
        clan,
        identity,
        notes: note,
        proofImageUrls: urls,
        status: clan.autoApprove ? "approved" : "pending",
      });
      brandNew = true;
    }
    if (!submission) return;

    submission = await runExtractionIfEnabled(clan, submission);

    if (brandNew) {
      await finalize(message.client, clan, submission, clan.autoApprove);
    } else if (submission.status === "pending") {
      // Newly-proofed pending submission needs its review card.
      await postReviewCard(message.client, clan, submission);
    } else {
      // Approved already (modal auto-approve) — just refresh the tracker.
      scheduleTrackerRefresh(message.client, clan);
    }

    await message.react("📨").catch(() => {});
    await message
      .reply({
        content: clan.autoApprove
          ? `📨 Thanks <@${message.author.id}>! Your ${clan.activityName || "XP"} is recorded.`
          : `📨 Thanks <@${message.author.id}>! Your ${clan.activityName || "XP"} submission is in the review queue.`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  } catch (err) {
    logger.error({ err }, "Failed to process submission message");
  }
}
