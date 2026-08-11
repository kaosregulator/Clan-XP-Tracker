import {
  EmbedBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { getClan, isOfficer } from "../services/config";
import { listActive, removeWarning } from "../services/warnings";
import { formatInZone } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";
import { warnRemoveSelect } from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/** /warnings [user] — view active XP warnings; officers can remove via a menu. */
export async function handleWarnings(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const target = interaction.options.getUser("user") ?? interaction.user;
  const officer = isOfficer(interaction.member, clan);
  if (target.id !== interaction.user.id && !officer) {
    await interaction.editReply({ content: "Only officers can view other members' warnings." });
    return;
  }

  const warns = await listActive(clan.guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(warns.length ? 0xed4245 : 0x3ba55d)
    .setAuthor({
      name: `XP warnings — ${target.username}`,
      iconURL: target.displayAvatarURL(),
    })
    .setDescription(
      warns.length
        ? warns
            .map(
              (w) =>
                `**#${w.id}** · ${formatInZone(w.issuedAt, clan)}\n> ${w.reason}\n_by ${w.issuedByUsername}_`
            )
            .join("\n\n")
        : "✅ No active warnings."
    )
    .setFooter({
      text: `These are ${clan.activityName} enforcement warnings, not moderation warnings.`,
    });

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (officer && warns.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(warnRemoveSelect(target.id))
      .setPlaceholder("Remove a warning…")
      .addOptions(
        warns.slice(0, 25).map((w) => ({
          label: `#${w.id} — ${w.reason.slice(0, 80)}`,
          value: String(w.id),
        }))
      );
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)
    );
  }

  await interaction.editReply({ embeds: [embed], components });
}

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
        `/xp progress  —  MY XP: your week, calendar, warnings, history`,
        `❓ Something Wrong?  —  dispute a warning from your /xp`,
      ],
    },
  ];
  if (officer) {
    sections.push({
      title: "For officers — the hubs",
      accent: "#5865f2",
      lines: [
        `/xp manage  —  ⚔️ XP MANAGER: roster tabs + member panel`,
        `/xp notifications  —  🔔 what needs attention (Read / Clear)`,
        `/xp warnings  —  ⚠️ Warnings & Enforcement (disputes, tickets)`,
        `/xp reports  —  📊 weekly summary + export`,
        `/xp setup  —  ⚙️ tracking role, goal, channels, thresholds`,
        `Quick actions still work: /entry /remind /warn /calendar /missing`,
        `Bulk by role: /xp role add | reset | remind | warn | entry`,
      ],
    });
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
