import type { ButtonInteraction, Message } from "discord.js";
import type { Clan } from "@workspace/db";
import { logger } from "../../lib/logger";
import { getClan, identityFromUser, ensureMember } from "../services/config";
import {
  createPendingSubmission,
  hasSubmissionToday,
} from "../services/submissions";
import { logAction } from "../services/logging";
import { postReviewCard } from "./review";

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/**
 * The Submit button is a guide, not the upload itself: Discord modals cannot
 * carry file attachments, so members submit by posting a screenshot in the
 * submission channel, which `handleSubmissionMessage` turns into a review card.
 */
export async function handleSubmitButton(interaction: ButtonInteraction, clan: Clan) {
  const activity = clan.activityName || "XP";
  if (!clan.submissionChannelId) {
    await interaction.reply({
      content:
        `📸 To submit your ${activity}, post your screenshot in the submission channel. ` +
        `No submission channel is configured yet — ask an admin to run **/setup**.`,
      flags: 64,
    });
    return;
  }

  const already = await hasSubmissionToday(clan, interaction.user.id);
  const prefix = already
    ? `✅ You've already submitted today — you can resubmit if a screenshot was rejected.\n\n`
    : "";

  await interaction.reply({
    content:
      `${prefix}📸 **Submit your ${activity}**\n` +
      `Post your screenshot in <#${clan.submissionChannelId}> (add an optional note as the message text). ` +
      `Staff will review it and your profile updates automatically.`,
    flags: 64,
  });
}

/**
 * Turn an image posted in the submission channel into a pending submission and
 * forward a review card. Called for every message; cheaply ignores non-matches.
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
    const identity = identityFromUser(message.author, message.member?.displayName);
    await ensureMember(clan.guildId, identity);

    const note = message.content?.trim().slice(0, 1000) || null;
    const submission = await createPendingSubmission({
      clan,
      identity,
      notes: note,
      proofImageUrls: images.map((a) => a.url),
    });

    await postReviewCard(message.client, clan, submission);

    await logAction(clan.guildId, {
      action: "submission_created",
      targetUserId: message.author.id,
      targetUsername: message.author.username,
      details: { submissionId: submission.id, images: images.length },
    });

    await message.react("📨").catch(() => {});
    await message
      .reply({
        content: `📨 Thanks <@${message.author.id}>! Your ${clan.activityName || "XP"} submission is in the review queue.`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  } catch (err) {
    logger.error({ err }, "Failed to process submission message");
  }
}
