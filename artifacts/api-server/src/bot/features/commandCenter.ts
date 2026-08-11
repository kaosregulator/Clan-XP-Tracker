import {
  EmbedBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, getMember } from "../services/config";
import {
  listTracked,
  statusOf,
  STATUS_LABEL,
  formatProgress,
  effectiveGoal,
  currentProgress,
  reminderTargets,
  warningTargets,
} from "../services/progress";
import { membersMissingToday } from "../services/xpLedger";
import { listActive } from "../services/warnings";
import { listMemberNotes } from "../services/notes";
import { disputesForUser } from "../services/disputes";
import { periodTotals } from "../services/xpLedger";
import { nextWeeklyReset, discordRelative, relative } from "../services/time";
import {
  postCommandCenter,
  buildCommandCenterPayload,
  refreshDashboardNow,
} from "../services/commandCenter";
import { buildDashboardPayload } from "./dashboard";
import { buildReviewPayload } from "./review";
import { buildNotificationCenter } from "./notifications";
import { buildDisputeReview } from "./disputes";
import { buildTicketList } from "./tickets";
import { parseId, CC_SEARCH_SELECT } from "../ui/ids";
import type { DashFilter } from "../ui/components";
import { notConfiguredMessage } from "./xp";

/**
 * The persistent live command center: the /panel command that posts it, and
 * the navigation router that fans staff out into the existing hubs. Nothing
 * here duplicates command logic — every button reuses a service or hub builder.
 */

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | UserSelectMenuInteraction,
  deferred: boolean
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    const msg = notConfiguredMessage(isOfficer(interaction.member, null));
    if (deferred) await interaction.editReply(msg);
    else await interaction.reply({ ...msg, flags: 64 });
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    const content = "The XP command center is officer-only.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/** /panel — post (or re-post) the persistent live command center. */
export async function openCommandCenter(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;

  // Post into the explicitly chosen channel, else the configured staff
  // dashboard channel, else right here.
  const chosen = interaction.options.getChannel("channel", false, [ChannelType.GuildText]);
  const channelId = chosen?.id ?? clan.staffDashboardChannelId ?? interaction.channelId;

  const messageId = await postCommandCenter(clan, channelId);
  if (!messageId) {
    await interaction.editReply({
      content: `Couldn't post the command center in <#${channelId}> — check I can view & send messages there.`,
    });
    return;
  }
  await interaction.editReply({
    content:
      `🛰️ Live command center posted in <#${channelId}>. ` +
      `It survives restarts and refreshes automatically as XP, reminders and warnings change.`,
  });
}

/* --------------------------------------------------------------- buttons */

export async function handleCommandCenterButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action, arg } = parseId(interaction.customId);

  // Refresh edits the public panel in place; everything else opens a private
  // (ephemeral) view so the shared message stays clean.
  if (action === "refresh") {
    await interaction.deferUpdate();
    const clan = await getClan(interaction.guildId);
    if (!clan || !isOfficer(interaction.member, clan)) return;
    await interaction.editReply(await buildCommandCenterPayload(clan));
    // Keep the debounce state consistent after a manual refresh.
    void refreshDashboardNow(interaction.guildId).catch(() => {});
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;

  switch (action) {
    case "manage":
      await interaction.editReply(await buildDashboardPayload(clan, "all", 0));
      return;
    case "warnings":
      await interaction.editReply(await buildDashboardPayload(clan, "warned", 0));
      return;
    case "cat": {
      if (arg === "missed") {
        await interaction.editReply(await missedReply(clan));
        return;
      }
      const filter = (arg ?? "attention") as DashFilter;
      await interaction.editReply(await buildDashboardPayload(clan, filter, 0));
      return;
    }
    case "notifs":
      await interaction.editReply(await buildNotificationCenter(clan));
      return;
    case "disputes":
      await interaction.editReply(await buildDisputeReview(clan));
      return;
    case "tickets":
      await interaction.editReply(await buildTicketList(clan));
      return;
    case "reports":
      await interaction.editReply(await buildReviewPayload(interaction, clan));
      return;
    case "calendar":
      await interaction.editReply({
        content:
          "📅 Open a member's calendar with **/calendar @member** (add `month:YYYY-MM` for a past month). " +
          "Members can run **/calendar** to see their own.",
      });
      return;
    case "search":
      await interaction.editReply({
        content: "🔎 Pick a member to open their progress:",
        components: [
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(CC_SEARCH_SELECT)
              .setPlaceholder("Search members…")
              .setMinValues(1)
              .setMaxValues(1)
          ),
        ],
      });
      return;
  }
}

/** The member picked in the Search flow → open their progress summary. */
export async function handleCommandCenterSelect(interaction: UserSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const userId = interaction.values[0];
  if (!userId) {
    await interaction.editReply({ content: "No member selected." });
    return;
  }
  await interaction.editReply(await memberSummary(clan, userId));
}

/* ------------------------------------------------------------ sub-views */

/** Who still owes XP today — the live "missed" list. */
async function missedReply(clan: Clan) {
  const members = await listTracked(clan);
  const missing = await membersMissingToday(clan, members);
  if (!missing.length) {
    return {
      content: `✅ Everyone has hit today's target${clan.dailyTarget > 0 ? ` of **${clan.dailyTarget.toLocaleString()} ${clan.activityName}**` : ""}.`,
    };
  }
  const lines = missing
    .slice(0, 40)
    .map(
      (m) =>
        `• <@${m.member.userId}> — **${m.todayAmount.toLocaleString()}** / ${clan.dailyTarget > 0 ? clan.dailyTarget.toLocaleString() : "—"}`
    );
  return {
    content:
      `🕐 **${missing.length}** member(s) haven't hit today's target:\n${lines.join("\n")}` +
      (missing.length > 40 ? `\n…and ${missing.length - 40} more` : ""),
    allowedMentions: { parse: [] as never[] },
  };
}

/** A live "what needs action" feed — the closest thing to a notification center. */
async function notificationsReply(clan: Clan) {
  const members = await listTracked(clan);
  const attention = reminderTargets(clan, members);
  const warnable = warningTargets(clan, members);
  const missing = await membersMissingToday(clan, members);

  const embed = new EmbedBuilder()
    .setColor(attention.length || warnable.length || missing.length ? 0xfaa61a : 0x3ba55d)
    .setTitle(`🔔 Attention feed — ${clan.clanName}`)
    .setDescription(
      attention.length || warnable.length || missing.length
        ? "Everything below still needs a decision. Use the buttons on the panel to act."
        : "✨ Nothing needs attention right now."
    )
    .addFields(
      {
        name: `🚨 Warning-eligible (${warnable.length})`,
        value: warnable.length
          ? warnable
              .slice(0, 8)
              .map((m) => `• <@${m.userId}> — ${formatProgress(clan, m)} · ${m.weekReminders} reminder(s)`)
              .join("\n") + (warnable.length > 8 ? `\n…and ${warnable.length - 8} more` : "")
          : "_None._",
        inline: false,
      },
      {
        name: `🔴 Needs progress (${attention.length})`,
        value: attention.length
          ? attention
              .slice(0, 8)
              .map((m) => `• <@${m.userId}> — ${formatProgress(clan, m)}`)
              .join("\n") + (attention.length > 8 ? `\n…and ${attention.length - 8} more` : "")
          : "_None._",
        inline: false,
      },
      {
        name: `🕐 Missed today (${missing.length})`,
        value: missing.length
          ? missing
              .slice(0, 8)
              .map((m) => `• <@${m.member.userId}> — ${m.todayAmount.toLocaleString()}`)
              .join("\n") + (missing.length > 8 ? `\n…and ${missing.length - 8} more` : "")
          : "_None._",
        inline: false,
      }
    )
    .setFooter({ text: "Resolved items clear themselves — this feed always reflects live state." });

  return { embeds: [embed], allowedMentions: { parse: [] as never[] } };
}

/** A compact member command-center summary shown from Search. */
export async function memberSummary(clan: Clan, userId: string) {
  const member = await getMember(clan.guildId, userId);
  if (!member) {
    return { content: `<@${userId}> isn't tracked yet — an officer can start them with \`/xp set\`.` };
  }
  const status = statusOf(clan, member);
  const warns = await listActive(clan.guildId, userId);
  const totals = await periodTotals(clan, userId);
  const notes = await listMemberNotes(clan.guildId, userId, 3);
  const disputes = await disputesForUser(clan.guildId, userId, 3);
  const openDisputes = disputes.filter((d) => d.status === "pending" || d.status === "info_requested").length;
  const goal = effectiveGoal(clan, member);
  const progress = currentProgress(clan, member);
  const pct = Math.min(100, Math.round((progress / goal) * 100));

  const embed = new EmbedBuilder()
    .setColor(status === "complete" ? 0x3ba55d : status === "notStarted" ? 0xed4245 : 0xfaa61a)
    .setAuthor({ name: `${member.displayName} — member panel`, iconURL: member.avatarUrl ?? undefined })
    .addFields(
      { name: "Progress", value: formatProgress(clan, member), inline: true },
      { name: "Status", value: STATUS_LABEL[status], inline: true },
      { name: "This week", value: `🔔 ${member.weekReminders} · ⚠️ ${member.weekWarnings}`, inline: true },
      { name: "Active warnings", value: `**${warns.length}**`, inline: true },
      { name: "Open disputes", value: `**${openDisputes}**`, inline: true },
      { name: "Today / Week", value: `${totals.today.toLocaleString()} / ${totals.week.toLocaleString()}`, inline: true }
    );
  if (notes.length) {
    embed.addFields({
      name: "🗒️ Recent staff notes",
      value: notes
        .map((n) => `• ${n.body.slice(0, 80)} — _${n.authorUsername}, ${relative(n.createdAt)}_${n.notifyMember ? (n.delivered ? " · 📨 sent" : " · ✉️ pending") : ""}`)
        .join("\n")
        .slice(0, 1024),
    });
  }
  if (clan.trackingMode !== "complete") {
    embed.setDescription(`\`${"█".repeat(Math.round((pct / 100) * 12))}${"░".repeat(12 - Math.round((pct / 100) * 12))}\` **${pct}%**`);
  }
  if (member.notes) embed.addFields({ name: "Officer note", value: member.notes.slice(0, 1024) });
  if (member.progressUpdatedAt) {
    embed.setFooter({
      text: `Last updated ${relative(member.progressUpdatedAt)}${member.lastUpdatedByUsername ? ` by ${member.lastUpdatedByUsername}` : ""}`,
    });
  }

  const actions = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("noop").setLabel("Use /xp, /remind, /warn, /calendar for actions").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );

  return { embeds: [embed], components: [actions], allowedMentions: { parse: [] as never[] } };
}
