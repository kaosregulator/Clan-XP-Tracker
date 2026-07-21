import {
  EmbedBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isStaff } from "../services/config";
import { recentForUser } from "../services/submissions";
import { listActive, removeWarning } from "../services/warnings";
import { streakLeaderboard, periodReport } from "../services/stats";
import { formatInZone } from "../services/time";
import { renderReportCard } from "../canvas/cards/reportCard";
import { buildMemberHub, notConfiguredMessage } from "./hub";
import { warnRemoveSelect } from "../ui/ids";

async function requireClan(interaction: ChatInputCommandInteraction): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(isStaff(interaction.member, null)), flags: 64 });
    return null;
  }
  return clan;
}

/** /profile [user] — canvas profile card + recent submission history. */
export async function handleProfile(interaction: ChatInputCommandInteraction) {
  const clan = await requireClan(interaction);
  if (!clan) return;
  await interaction.deferReply();

  const target = interaction.options.getUser("user") ?? interaction.user;
  const hub = await buildMemberHub(clan, target);
  const recent = await recentForUser(clan.guildId, target.id, 6);

  const glyph = { approved: "✅", rejected: "⛔", pending: "⏳" } as Record<string, string>;
  const history = recent.length
    ? recent
        .map(
          (s) =>
            `${glyph[s.status] ?? "•"} **${s.activityDate}** — ${s.status}${s.accountLabel ? ` · ${s.accountLabel}` : ""} · ${formatInZone(s.submittedAt, clan)}`
        )
        .join("\n")
    : "_No submissions yet._";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Recent activity — ${target.displayName ?? target.username}`)
    .setDescription(history);

  await interaction.editReply({ ...hub, embeds: [embed] });
}

/** /leaderboard — streak leaderboard. */
export async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  const clan = await requireClan(interaction);
  if (!clan) return;
  await interaction.deferReply();

  const rows = await streakLeaderboard(clan.guildId, 10);
  if (!rows.length) {
    await interaction.editReply("No activity yet — be the first to submit!");
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const body = rows
    .map((r, i) => {
      const prefix = medals[i] ?? `**${i + 1}.**`;
      return `${prefix} <@${r.userId}> — 🔥 **${r.currentStreak}** day streak · ${r.approvedCount} approved`;
    })
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(`${clan.clanName} — ${clan.activityName || "XP"} Leaderboard`)
    .setDescription(body)
    .setFooter({ text: "Ranked by current streak" });

  await interaction.editReply({ embeds: [embed] });
}

/** /warnings [user] — view active warnings; staff can remove via a menu. */
export async function handleWarnings(interaction: ChatInputCommandInteraction) {
  const clan = await requireClan(interaction);
  if (!clan || !interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const target = interaction.options.getUser("user") ?? interaction.user;
  const staff = isStaff(interaction.member, clan);
  if (target.id !== interaction.user.id && !staff) {
    await interaction.editReply("Only staff can view other members' warnings.");
    return;
  }

  const warns = await listActive(clan.guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(warns.length ? 0xed4245 : 0x3ba55d)
    .setAuthor({ name: `Warnings — ${target.username}`, iconURL: target.displayAvatarURL() })
    .setDescription(
      warns.length
        ? warns
            .map((w) => `**#${w.id}** · ${formatInZone(w.issuedAt, clan)}\n> ${w.reason}\n_by ${w.issuedByUsername}_`)
            .join("\n\n")
        : "✅ No active warnings."
    );

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (staff && warns.length) {
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

/** /report [period] — staff weekly/monthly activity report card. */
export async function handleReport(interaction: ChatInputCommandInteraction) {
  const clan = await requireClan(interaction);
  if (!clan || !interaction.inCachedGuild()) return;
  if (!isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "Reports are for staff only.", flags: 64 });
    return;
  }
  await interaction.deferReply();

  const period = interaction.options.getString("period") ?? "week";
  const days = period === "month" ? 30 : 7;
  const report = await periodReport(clan, days);

  const since = new Date(Date.now() - days * 86_400_000);
  const png = renderReportCard({
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    periodLabel: period === "month" ? "Monthly" : "Weekly",
    rangeLabel: `${formatInZone(since, clan, "MMM D")} – ${formatInZone(new Date(), clan, "MMM D")}`,
    submissions: report.submissions,
    approved: report.approved,
    approvalRate: report.approvalRate,
    activeMembers: report.activeMembers,
    reminders: report.reminders,
    warnings: report.warnings,
    top: report.top,
  });

  await interaction.editReply({ files: [new AttachmentBuilder(png, { name: "report.png" })] });
}

/** Handle removal selection from /warnings. */
export async function handleWarnRemoveSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "Only staff can remove warnings.", flags: 64 });
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
  await interaction.reply({
    content: removed ? `✅ Removed warning #${warningId}.` : "That warning was already removed.",
    flags: 64,
  });
}
