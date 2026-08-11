import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { getClan, isOfficer } from "../services/config";
import { weeklySnapshot } from "../services/progress";
import { weekRangeLabel, weekKey, discordRelative, nextWeeklyReset } from "../services/time";
import { REVIEW_EXPORT } from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * 📊 REPORTS — a plain management summary, never a leaderboard. Just the shape
 * of the week: how many are complete, need attention, missed, on leave or
 * exempt, plus a one-tap full export (reuses the weekly-review export button).
 */
export async function openReports(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Reports are officer-only." });
    return;
  }

  const snap = await weeklySnapshot(clan);
  const pct = snap.active > 0 ? Math.round(snap.completionRate * 100) : 0;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 XP REPORT — ${clan.clanName}`)
    .setDescription(
      `Week of **${weekRangeLabel(weekKey(clan))}** · closes ${discordRelative(nextWeeklyReset(clan))}`
    )
    .addFields(
      { name: "👥 Tracked", value: `${snap.tracked}`, inline: true },
      { name: "🟢 Complete", value: `${snap.completed}`, inline: true },
      { name: "🟡 Attention", value: `${snap.inProgress}`, inline: true },
      { name: "⚠️ Missed", value: `${snap.notStarted}`, inline: true },
      { name: "🌙 Leave", value: `${snap.onLeave}`, inline: true },
      { name: "🛡️ Exempt", value: `${snap.exempt}`, inline: true },
      { name: "🔵 Excused", value: `${snap.excused}`, inline: true },
      { name: "🔔 Reminders", value: `${snap.remindersThisWeek}`, inline: true },
      { name: "⚠️ Warnings", value: `${snap.warningsThisWeek}`, inline: true }
    )
    .setFooter({ text: `Completion: ${pct}% of active members` });

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(REVIEW_EXPORT).setStyle(ButtonStyle.Secondary).setLabel("Export Full Report").setEmoji("📊")
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
