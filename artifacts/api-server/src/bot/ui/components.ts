import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan, XpSubmission } from "@workspace/db";
import {
  XP_SUBMIT,
  XP_PROGRESS,
  XP_HISTORY,
  ADMIN_QUEUE,
  ADMIN_MISSING,
  ADMIN_LEADERBOARD,
  ADMIN_REFRESH,
  reviewApprove,
  reviewReject,
  reviewRemind,
  reviewWarn,
  reviewHistory,
} from "./ids";

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons);
}

const DEFAULT_GAME_URL = "https://www.roblox.com";

/** Buttons for the /xp member hub. */
export function memberHubComponents(clan: Clan): Row[] {
  const launch = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(`Open ${clan.gameName || "Game"}`)
    .setURL(clan.gameUrl || DEFAULT_GAME_URL);

  return [
    row(
      launch,
      new ButtonBuilder()
        .setCustomId(XP_SUBMIT)
        .setStyle(ButtonStyle.Success)
        .setLabel(`Submit ${clan.activityName || "XP"}`),
      new ButtonBuilder()
        .setCustomId(XP_PROGRESS)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("My Progress"),
      new ButtonBuilder()
        .setCustomId(XP_HISTORY)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("History")
    ),
  ];
}

/** Buttons for the /xpadmin staff hub. */
export function adminHubComponents(): Row[] {
  return [
    row(
      new ButtonBuilder().setCustomId(ADMIN_QUEUE).setStyle(ButtonStyle.Primary).setLabel("Review Queue"),
      new ButtonBuilder().setCustomId(ADMIN_MISSING).setStyle(ButtonStyle.Secondary).setLabel("Missing Today"),
      new ButtonBuilder()
        .setCustomId(ADMIN_LEADERBOARD)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Leaderboard"),
      new ButtonBuilder().setCustomId(ADMIN_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh")
    ),
  ];
}

/** Buttons for a review-queue moderation card. */
export function reviewCardComponents(submission: XpSubmission): Row[] {
  const decided = submission.status !== "pending";
  const primary = row(
    new ButtonBuilder()
      .setCustomId(reviewApprove(submission.id))
      .setStyle(ButtonStyle.Success)
      .setLabel("Approve")
      .setDisabled(decided),
    new ButtonBuilder()
      .setCustomId(reviewReject(submission.id))
      .setStyle(ButtonStyle.Danger)
      .setLabel("Reject")
      .setDisabled(decided),
    new ButtonBuilder()
      .setCustomId(reviewRemind(submission.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Remind"),
    new ButtonBuilder()
      .setCustomId(reviewWarn(submission.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Warn")
  );

  const secondary = row(
    new ButtonBuilder()
      .setCustomId(reviewHistory(submission.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("User History")
  );

  // Link straight to the screenshot when we have one ("View Screenshot").
  const proof = submission.proofImageUrls[0];
  if (proof) {
    secondary.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("View Screenshot").setURL(proof)
    );
  }

  return [primary, secondary];
}
