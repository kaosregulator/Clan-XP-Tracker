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
  XP_ACCOUNTS,
  XP_VACATION,
  ADMIN_QUEUE,
  ADMIN_MISSING,
  ADMIN_LEADERBOARD,
  ADMIN_REFRESH,
  ADMIN_DASHBOARDS,
  ADMIN_EXPORT,
  XPADMIN_WARN,
  XPADMIN_REMIND,
  XPADMIN_REMIND_ROLE,
  reviewApprove,
  reviewReject,
  reviewRemind,
  reviewWarn,
  reviewHistory,
} from "./ids";

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...buttons,
  );
}

const DEFAULT_GAME_URL = "https://www.roblox.com";

/**
 * Buttons for the /xp member hub.
 *
 * When `staff` is true (the invoker is clan staff), two extra rows of admin
 * actions are appended — the "admin profile" surfaced right on the hub so
 * officers can warn/remind and jump into staff views without a second command.
 */
export function memberHubComponents(clan: Clan, staff = false): Row[] {
  const launch = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(`Open ${clan.gameName || "Game"}`)
    .setURL(clan.gameUrl || DEFAULT_GAME_URL);

  // Row 1: the actions. Row 2: navigation.
  const primary = [
    launch,
    new ButtonBuilder()
      .setCustomId(XP_SUBMIT)
      .setStyle(ButtonStyle.Success)
      .setLabel(`Submit ${clan.activityName || "XP"}`),
    new ButtonBuilder()
      .setCustomId(XP_VACATION)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Vacation"),
  ];
  const secondary = [
    new ButtonBuilder()
      .setCustomId(XP_PROGRESS)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("My Progress"),
    new ButtonBuilder()
      .setCustomId(XP_HISTORY)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("History"),
  ];
  if (clan.altAccountsEnabled) {
    secondary.push(
      new ButtonBuilder()
        .setCustomId(XP_ACCOUNTS)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("My Accounts"),
    );
  }

  const rows = [row(...primary), row(...secondary)];
  if (staff) rows.push(...staffHubRows());
  return rows;
}

/** The staff-only action rows appended to the member hub for admins. */
function staffHubRows(): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(XPADMIN_WARN)
        .setStyle(ButtonStyle.Danger)
        .setLabel("Warn Member"),
      new ButtonBuilder()
        .setCustomId(XPADMIN_REMIND)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Remind Member"),
      new ButtonBuilder()
        .setCustomId(XPADMIN_REMIND_ROLE)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Remind Role"),
    ),
    row(
      new ButtonBuilder()
        .setCustomId(ADMIN_QUEUE)
        .setStyle(ButtonStyle.Primary)
        .setLabel("Review Queue"),
      new ButtonBuilder()
        .setCustomId(ADMIN_MISSING)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Missing Today"),
      new ButtonBuilder()
        .setCustomId(ADMIN_LEADERBOARD)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Leaderboard"),
    ),
  ];
}

/** Buttons for the /xpadmin staff hub. */
export function adminHubComponents(): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(ADMIN_QUEUE)
        .setStyle(ButtonStyle.Primary)
        .setLabel("Review Queue"),
      new ButtonBuilder()
        .setCustomId(ADMIN_MISSING)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Missing Today"),
      new ButtonBuilder()
        .setCustomId(ADMIN_LEADERBOARD)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Leaderboard"),
      new ButtonBuilder()
        .setCustomId(ADMIN_DASHBOARDS)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Post Dashboards"),
      new ButtonBuilder()
        .setCustomId(ADMIN_REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Refresh"),
    ),
    row(
      new ButtonBuilder()
        .setCustomId(ADMIN_EXPORT)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Export Data (backup)"),
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
      .setLabel("Warn"),
  );

  const secondary = row(
    new ButtonBuilder()
      .setCustomId(reviewHistory(submission.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("User History"),
  );

  // Link straight to the screenshot when we have one ("View Screenshot").
  const proof = submission.proofImageUrls[0];
  if (proof) {
    secondary.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("View Screenshot")
        .setURL(proof),
    );
  }

  return [primary, secondary];
}
