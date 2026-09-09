import {
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { getClan, isOfficer } from "../services/config";
import { removeWarning } from "../services/warnings";
import { renderOffThread } from "../canvas/render-pool";

/**
 * /help and the warning-removal select handler. The `/warnings` command itself
 * now lives in features/userHub.ts (member record vs. officer dashboard); the
 * remove-warning dropdown it renders is still handled here under NS.warn.
 */

/** /help — how the officer-managed workflow works. */
export async function handleHelp(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This command only works inside a server.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  const activity = clan?.activityName || "XP";
  const officer = isOfficer(interaction.member, clan ?? null);

  const sections = [
      {
        title: "For members",
        accent: "#2e9e57",
        lines: [
          `Officers verify ${activity} in-game — you never submit it`,
          `/warnings  —  your standing card (history, clean points, avatars)`,
          `/leaderboard  —  who can go without warnings (top 3 + board)`,
          `/calendar  —  your ${activity} month calendar`,
          `/dispute  —  contest a warning (or use the button on /warnings)`,
          `/roblox · /scout · /market  —  Roblox hubs (menus & buttons inside)`,
        ],
      },
    ];
  if (officer) {
    sections.push(
      {
        title: "Command center",
        accent: "#3f51e0",
        lines: [
          `/panel  —  live staff board (survives restarts)`,
          `/warnings  —  Command Center member editor (no target)`,
          `/warnings member:…  —  standing card with lifetime history`,
          `/link  —  assign Roblox avatars to member cards (role walkthrough)`,
        ],
      },
      {
        title: "Logging & enforcement",
        accent: "#c9820a",
        lines: [
          `/entry @user <amount>  —  log ${activity}`,
          `/xp set | add | remove | complete | review`,
          `/xpwarn  —  warn or remind many members with a live preview`,
          `/missing  —  who hasn't hit today's target`,
        ],
      },
      {
        title: "Tickets & setup",
        accent: "#0e9cbb",
        lines: [
          `/disputes · /notifications · /tickets  —  also on /panel`,
          `/setup  —  goals, channels, roles, enforcement`,
          `/leaderboard  —  clean standing & never-warned bracket`,
        ],
      }
    );
  }

  const png = await renderOffThread("helpCard", {
    communityName: clan?.clanName ?? "ClanXP",
    activityName: activity,
    sections,
  });
  await interaction.editReply({
    files: [new AttachmentBuilder(png, { name: "help.png" })],
  });
}

/** Handle removal selection from /warnings. */
export async function handleWarnRemoveSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan || !isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can remove warnings." });
    return;
  }
  const warningId = Number(interaction.values[0]);
  const removed = await removeWarning({
    guild: interaction.guild,
    clan,
    warningId,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
  });
  await interaction.editReply({
    content: removed ? `✅ Removed warning #${warningId}.` : "That warning was already removed.",
  });
}
