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
        accent: "#57f287",
        lines: [
          `You never submit ${activity} — officers verify it in-game`,
          `/xp progress  —  where you stand this week`,
          `/calendar  —  your ${activity} calendar & daily history`,
          `/xp history  —  your past weeks`,
          `/warnings  —  your active ${activity} warnings`,
          `/dispute (or the button on /warnings)  —  contest a warning; have your proof ready`,
          `/roblox  —  Roblox player hub · /military  —  Military Tycoon`,
          `/scout  —  Game Intelligence (trends, snapshots, DevEx)`,
        ],
      },
    ];
  if (officer) {
    sections.push(
      {
        title: "Command center",
        accent: "#a855f7",
        lines: [
          `/panel  —  post the live dashboard (survives restarts, auto-refreshes)`,
          `Category counts are buttons — jump into Attention, Missed, Warnings`,
          `Notifications · Reports · Calendar · Search built in`,
        ],
      },
      {
        title: "Logging XP",
        accent: "#5865f2",
        lines: [
          `/entry @user <amount> [date]  —  log ${activity} (rolls up + backfills past days)`,
          `/xp set | add | remove | complete | reset @user`,
          `/xp goal | exempt | leave | note @user  —  per-member settings`,
          `/xp audit @user  —  full history (before → after, who, when)`,
          `/xp role add | reset | remind | warn | entry  —  bulk by role`,
        ],
      },
      {
        title: "Reminders & enforcement",
        accent: "#faa61a",
        lines: [
          `/xpwarn  —  pick Warning or Reminder, select many members, preview & send (admins warn)`,
          `/missing  —  who hasn't hit today's target`,
          `/xp review  —  weekly card: bulk remind / warn / reset`,
          `/xp dashboard  —  filterable roster of who needs attention`,
        ],
      },
      {
        title: "Notifications, disputes & tickets",
        accent: "#a855f7",
        lines: [
          `/notifications  —  the staff attention feed (read / clear / resolve)`,
          `/disputes  —  review member warning disputes`,
          `/tickets  —  track staff issues to resolution`,
          `/xp note @user [notify]  —  add a staff note (optionally DM it)`,
        ],
      },
      {
        title: "Setup",
        accent: "#22d3ee",
        lines: [
          `/setup  —  goal, tracking mode, schedule, channels, roles, enforcement`,
          `/calendar @user  —  any member's month time-card`,
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
