import {
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
import { logAction } from "../services/logging";
import { runExtraction, extractionEnabled } from "../services/extraction";
import { discordRelative, nextReset } from "../services/time";
import { isOverflowNow, clanCapacity } from "../services/contributions";
import { postReviewCard } from "./review";
import { scheduleTrackerRefresh } from "./tracker";
import { postXpCard } from "./xpcard";
import { XP_SUBMIT_MODAL, submitModalForGuild, parseId } from "../ui/ids";

const PROOF_LINK_WINDOW_MS = 30 * 60_000;
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/* --------------------------------------------------------------- helpers */

function submitModal(clan: Clan, fromGuildId?: string): ModalBuilder {
  const activity = clan.activityName || "XP";
  // From a DM (reminder button) the modal must carry the guild id so the
  // handler knows which server to record for.
  const customId = fromGuildId ? submitModalForGuild(fromGuildId) : XP_SUBMIT_MODAL;
  const modal = new ModalBuilder().setCustomId(customId).setTitle(`Submit ${activity}`.slice(0, 45));
  const rows: ActionRowBuilder<ModalActionRowComponentBuilder>[] = [];

  // Patriots enter how many alt accounts they also completed.
  if (clan.altAccountsEnabled) {
    rows.push(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("alts")
          .setLabel("Alt accounts completed (0 if none)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue("0")
          .setPlaceholder("e.g. 6")
      )
    );
  }
  rows.push(
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Notes (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder("Anything to add about today's session…")
    )
  );
  return modal.addComponents(...rows);
}

/** Finalize a brand-new submission: recompute stats, post the XP card, refresh tracker. */
async function finalize(client: Message["client"], clan: Clan, sub: XpSubmission, auto: boolean) {
  if (auto) {
    await recomputeMemberStats(clan, sub.userId);
    await postXpCard(client, clan, sub); // the visible "xp card" embed
    scheduleTrackerRefresh(client, clan);
  } else {
    await postReviewCard(client, clan, sub);
  }
  await logAction(clan.guildId, {
    action: auto ? "submission_recorded" : "submission_created",
    targetUserId: sub.userId,
    targetUsername: sub.username,
    details: { submissionId: sub.id, auto, contributions: sub.contributions, overflow: sub.overflow },
  });
}

async function runExtractionIfEnabled(clan: Clan, sub: XpSubmission): Promise<XpSubmission> {
  if (!extractionEnabled() || !sub.proofImageUrls.length) return sub;
  await runExtraction({ clan, submission: sub, imageUrls: sub.proofImageUrls, activityName: clan.activityName || "XP" });
  return (await getSubmission(sub.id)) ?? sub;
}

/* --------------------------------------------------------------- button */

/**
 * Submit button. Opens a modal (notes + alts for patriots). Discord modals
 * can't hold images, so the screenshot is an optional follow-up.
 */
export async function handleSubmitButton(interaction: ButtonInteraction, clan: Clan) {
  await interaction.showModal(submitModal(clan));
}

/**
 * Reminder DM buttons ("I did it — log now" / "Submit"): open the submit modal
 * for the reminder's guild so a member can log XP they forgot to submit.
 */
export async function handleRemindAck(interaction: ButtonInteraction) {
  const { arg: guildId } = parseId(interaction.customId);
  if (!guildId) return;
  const clan = await getClan(guildId);
  if (!clan) {
    await interaction.reply({ content: "That server isn't set up anymore." });
    return;
  }
  await interaction.showModal(submitModal(clan, guildId));
}

function parseAlts(raw: string | null | undefined): number {
  const n = parseInt((raw ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 0;
}

export async function handleSubmitModal(interaction: ModalSubmitInteraction) {
  // guildId comes from the modal id (DM flow) or the interaction (in-guild flow).
  const guildId = parseId(interaction.customId).arg ?? interaction.guildId ?? undefined;
  if (!guildId) return;
  const clan = await getClan(guildId);
  if (!clan) {
    await interaction.reply({ content: "This server isn't set up yet." });
    return;
  }
  const inGuild = interaction.inGuild();
  await interaction.deferReply(inGuild ? { flags: 64 } : {});

  const displayName = interaction.inCachedGuild() ? interaction.member.displayName : undefined;
  const identity = identityFromUser(interaction.user, displayName);
  await ensureMember(clan.guildId, identity);
  const notes = interaction.fields.getTextInputValue("notes")?.trim().slice(0, 1000) || null;
  const alts = clan.altAccountsEnabled ? parseAlts(interaction.fields.getTextInputValue("alts")) : 0;
  const contributions = 1 + alts;

  const overflow = await isOverflowNow(clan);
  const auto = clan.autoApprove;
  const sub = await createSubmission({
    clan,
    identity,
    notes,
    contributions,
    overflow,
    status: auto ? "approved" : "pending",
  });
  await finalize(interaction.client, clan, sub, auto);

  await interaction.editReply(await confirmText(clan, contributions, overflow, auto));
}

/** Build the ephemeral confirmation, capacity- and overflow-aware. */
async function confirmText(clan: Clan, contributions: number, overflow: boolean, auto: boolean): Promise<string> {
  const activity = clan.activityName || "XP";
  const altNote = contributions > 1 ? ` (you + ${contributions - 1} alt${contributions - 1 === 1 ? "" : "s"})` : "";
  const proofHint = ` You can drop a screenshot in ${clan.submissionChannelId ? `<#${clan.submissionChannelId}>` : "the submission channel"} to attach proof.`;

  if (!auto) return `⏳ **Submitted for review.**${altNote}${proofHint}`;

  if (overflow) {
    return (
      `🌊 **${activity} recorded as overflow**${altNote} — the clan is already maxed for today, so this doesn't add to the clan, ` +
      `but you're **credited** and safe from an XP warning. Please post a screenshot as proof.${proofHint}`
    );
  }

  const cap = await clanCapacity(clan);
  const capLine =
    cap.limitXp > 0
      ? ` Clan: **${cap.filledXp.toLocaleString()}/${cap.limitXp.toLocaleString()} ${activity}** (${cap.pct}%)${cap.maxed ? " — MAXED 🔴" : ""}.`
      : "";
  return `✅ **${activity} recorded**${altNote} for today — streak updated. Next reset ${discordRelative(nextReset(clan))}.${capLine}${proofHint}`;
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
        overflow: await isOverflowNow(clan),
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
