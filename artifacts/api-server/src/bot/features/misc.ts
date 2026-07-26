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
import { renderOffThread } from "../canvas/render-pool";
import { buildMemberHub, notConfiguredMessage } from "./hub";
import { warnRemoveSelect } from "../ui/ids";

/** /profile [user] — canvas profile card + recent submission history. */
export async function handleProfile(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply();
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isStaff(interaction.member, null)));
    return;
  }

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

/** /leaderboard — streak leaderboard as a canvas card. */
export async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply();
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isStaff(interaction.member, null)));
    return;
  }

  const rows = await streakLeaderboard(clan.guildId, 10);
  const png = await renderOffThread("leaderboardCard", {
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    subtitle: "Ranked by current streak",
    rows: rows.map((r) => ({ name: r.displayName, streak: r.currentStreak, approved: r.approvedCount })),
  });
  await interaction.editReply({ files: [new AttachmentBuilder(png, { name: "leaderboard.png" })] });
}

/** /warnings [user] — view active warnings; staff can remove via a menu. */
export async function handleWarnings(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isStaff(interaction.member, null)));
    return;
  }

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

/** /help — a quick how-it-works canvas for members and staff. */
export async function handleHelp(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This command only works inside a server.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  const activity = clan?.activityName || "XP";
  const game = clan?.gameName || "Roblox";
  const staff = isStaff(interaction.member, clan ?? null);

  const memberLines = [
    `/xp  —  open your hub (streak, warnings, daily goal)`,
    `Submit ${activity}  —  quick box${clan?.altAccountsEnabled ? " (+ your alt count)" : ""}, records instantly`,
    `Open ${game}  —  launch the game and do your ${activity}`,
    `My Progress / History  —  see your record`,
    `Vacation  —  can't play today? Log it (counts as a miss)`,
  ];

  const sections = [
    { title: "For members", accent: "#57f287", lines: memberLines },
  ];
  if (staff) {
    sections.push({
      title: "For staff",
      accent: "#5865f2",
      lines: [
        `/setup  —  wizard: goal, capacity, schedule, channels, roles, boards`,
        `/xpadmin  —  ops hub · Post Dashboards publishes the boards`,
        `Tracker board  —  progress + Show Users / Remind / Refresh`,
        `/warnings  /leaderboard  /report  /profile @user`,
        `Warnings & reminders log to your logs channel`,
      ],
    });
  }

  const png = await renderOffThread("helpCard", {
    communityName: clan?.clanName ?? "ClanXP",
    activityName: activity,
    sections,
  });
  await interaction.editReply({ files: [new AttachmentBuilder(png, { name: "help.png" })] });
}

/** /report [period] — staff weekly/monthly activity report card. */
export async function handleReport(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply();
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isStaff(interaction.member, null)));
    return;
  }
  if (!isStaff(interaction.member, clan)) {
    await interaction.editReply({ content: "Reports are for staff only." });
    return;
  }

  const period = interaction.options.getString("period") ?? "week";
  const days = period === "month" ? 30 : 7;
  const report = await periodReport(clan, days);

  const since = new Date(Date.now() - days * 86_400_000);
  const png = await renderOffThread("reportCard", {
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
  // Defer first — getClan + removeWarning (DB writes + role sync) can exceed 3 seconds.
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan || !isStaff(interaction.member, clan)) {
    await interaction.editReply({ content: "Only staff can remove warnings." });
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
