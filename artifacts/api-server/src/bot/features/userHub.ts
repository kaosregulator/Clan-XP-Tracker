import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type AutocompleteInteraction,
} from "discord.js";
import type { Clan, ClanMember } from "@workspace/db";
import { getClan, isOfficer, getMember } from "../services/config";
import { listActive, listHistory, countLifetime } from "../services/warnings";
import { listRecentReminders } from "../services/reminders";
import { listMemberNotes } from "../services/notes";
import { memberHistory, formatProgress, statusOf } from "../services/progress";
import { calendarFor, periodTotals } from "../services/xpLedger";
import { formatInZone, weekRangeLabel, activityDate, relative } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";
import { buildDashboardPayload } from "./dashboard";
import { buildDisputePicker } from "./disputes";
import { openDisputeTicket, findOpenDisputeForUser } from "../services/disputes";
import { cleanRankOf, handleMemberSearchAutocomplete } from "./leaderboard";
import { replaceHubCard, clearHubCard } from "../ui/hubMessage";
import {
  hubDispute,
  hubDisputeModal,
  hubCalendar,
  hubHistory,
  hubRefresh,
  warnRemoveSelect,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * The /warnings hub. Officers with no target get the warning dashboard.
 * Everyone else gets a clean standing canvas (active + lifetime history,
 * clean points, dual Discord/Roblox avatars when linked).
 */

interface HubTarget {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

function targetFromMember(m: ClanMember): HubTarget {
  return {
    id: m.userId,
    username: m.username,
    displayName: m.displayName || m.username,
    avatarUrl: m.avatarUrl || "",
  };
}

async function resolveTarget(
  interaction: ButtonInteraction,
  userId: string
): Promise<HubTarget> {
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  if (user) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarUrl: user.displayAvatarURL({ size: 256, extension: "png" }),
    };
  }
  const member = await getMember(interaction.guildId!, userId);
  return member
    ? targetFromMember(member)
    : { id: userId, username: "member", displayName: "member", avatarUrl: "" };
}

export async function buildMemberHub(
  clan: Clan,
  target: HubTarget,
  opts: { officerView: boolean }
): Promise<BaseMessageOptions> {
  const [warns, history, reminders, allNotes, member, rank, lifetime] = await Promise.all([
    listActive(clan.guildId, target.id),
    listHistory(clan.guildId, target.id, 8),
    listRecentReminders(clan.guildId, target.id, 5),
    listMemberNotes(clan.guildId, target.id, 10),
    getMember(clan.guildId, target.id),
    cleanRankOf(clan, target.id),
    countLifetime(clan.guildId, target.id),
  ]);
  const notes = opts.officerView ? allNotes : allNotes.filter((n) => n.notifyMember && n.delivered);

  const status = member ? statusOf(clan, member) : "notStarted";
  const statusLabel =
    warns.length > 0
      ? `${warns.length} active warning${warns.length === 1 ? "" : "s"}`
      : status === "complete"
        ? "Complete · clean"
        : status === "exempt"
          ? "Exempt"
          : status === "leave"
            ? "On leave"
            : "Good standing";

  const png = await renderOffThread("standingCard", {
    communityName: clan.clanName,
    username: target.username,
    displayName: target.displayName,
    discordAvatarUrl: target.avatarUrl || member?.avatarUrl || null,
    robloxAvatarUrl: member?.robloxAvatarUrl ?? null,
    robloxUsername: member?.gameUsername ?? null,
    activeCount: warns.length,
    lifetimeCount: Math.max(lifetime, member?.lifetimeWarnings ?? 0),
    cleanPoints: member?.cleanPoints ?? 0,
    cleanRank: rank,
    progressLabel: member ? formatProgress(clan, member) : "—",
    statusLabel,
    officerView: opts.officerView,
    warnings: history.map((w) => ({
      id: w.id,
      reason: w.reason.slice(0, 80),
      when: relative(w.issuedAt),
      by: w.issuedByUsername,
      removed: Boolean(w.removedAt),
    })),
  });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (opts.officerView) {
    if (warns.length) {
      rows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(warnRemoveSelect(target.id))
            .setPlaceholder("Remove a warning…")
            .addOptions(
              warns.slice(0, 25).map((w) => ({
                label: `#${w.id} — ${w.reason.slice(0, 80)}`,
                value: String(w.id),
              }))
            )
        )
      );
    }
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(hubCalendar(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Calendar"),
        new ButtonBuilder()
          .setCustomId(hubHistory(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("XP history"),
        new ButtonBuilder()
          .setCustomId(hubRefresh(target.id))
          .setStyle(ButtonStyle.Primary)
          .setLabel("Refresh")
      )
    );
  } else {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(hubDispute(target.id))
          .setStyle(ButtonStyle.Danger)
          .setLabel("Open dispute"),
        new ButtonBuilder()
          .setCustomId(hubCalendar(target.id))
          .setStyle(ButtonStyle.Primary)
          .setLabel("Calendar"),
        new ButtonBuilder()
          .setCustomId(hubHistory(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("XP history"),
        new ButtonBuilder()
          .setCustomId(hubRefresh(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Refresh")
      )
    );
  }

  // Light officer note strip under the card (canvas stays focused on history).
  const embeds: EmbedBuilder[] = [];
  if (opts.officerView && (notes.length || reminders.length)) {
    const e = new EmbedBuilder().setColor(0x2b2d31);
    if (reminders.length) {
      e.addFields({
        name: "Recent reminders",
        value: reminders
          .map(
            (r) =>
              `${formatInZone(r.createdAt, clan)} — ${r.auto ? "automatic" : `by ${r.sentByUsername ?? "staff"}`}`
          )
          .join("\n")
          .slice(0, 1024),
      });
    }
    if (notes.length) {
      e.addFields({
        name: "Staff notes",
        value: notes
          .slice(0, 4)
          .map((n) => `${formatInZone(n.createdAt, clan)} — ${n.body.slice(0, 120)}`)
          .join("\n")
          .slice(0, 1024),
      });
    }
    embeds.push(e);
  }

  return {
    files: [new AttachmentBuilder(png, { name: "standing.png" })],
    embeds,
    components: rows,
  };
}

export async function handleWarnings(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const requested = interaction.options.getUser("user");
  const memberId = interaction.options.getString("member");
  const officer = isOfficer(interaction.member, clan);
  const subjectId = memberId || requested?.id || null;

  if (subjectId && subjectId !== interaction.user.id && !officer) {
    await interaction.editReply({ content: "Only officers can view other members' warnings." });
    return;
  }

  if (officer && !subjectId) {
    await interaction.editReply(await buildDashboardPayload(clan, "attention", 0));
    return;
  }

  const subject =
    subjectId
      ? await interaction.client.users.fetch(subjectId).catch(() => null)
      : interaction.user;
  if (!subject) {
    await interaction.editReply(clearHubCard("Couldn't find that member."));
    return;
  }

  const officerView = officer && subject.id !== interaction.user.id;
  await interaction.editReply(
    replaceHubCard(
      await buildMemberHub(
        clan,
        {
          id: subject.id,
          username: subject.username,
          displayName: subject.displayName ?? subject.username,
          avatarUrl: subject.displayAvatarURL({ size: 256, extension: "png" }),
        },
        { officerView }
      )
    )
  );
}

export async function handleWarningsAutocomplete(interaction: AutocompleteInteraction) {
  return handleMemberSearchAutocomplete(interaction);
}

async function renderCalendarCard(clan: Clan, member: ClanMember, displayName: string) {
  const today = activityDate(clan);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const view = await calendarFor(clan, member, year, month);
  const totals = await periodTotals(clan, member.userId);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return renderOffThread("calendarCard", {
    communityName: clan.clanName,
    memberName: displayName,
    activityName: clan.activityName,
    monthLabel: view.monthLabel,
    target: view.target,
    firstWeekday,
    days: view.days.map((d) => ({ day: d.day, amount: d.amount, status: d.status })),
    doneCount: view.doneCount,
    missedCount: view.missedCount,
    monthTotal: view.total,
    week: totals.week,
    allTime: totals.allTime,
  });
}

function historyEmbed(clan: Clan, target: HubTarget, rows: Awaited<ReturnType<typeof memberHistory>>) {
  void clan;
  const lines = rows.map((h) => {
    const flag = h.exempt ? "🛡️" : h.onLeave ? "🌙" : h.completed ? "✅" : "❌";
    const extras: string[] = [];
    if (h.remindersSent > 0) extras.push(`${h.remindersSent} reminder(s)`);
    if (h.warningsIssued > 0) extras.push(`${h.warningsIssued} warning(s)`);
    return (
      `${flag} **${weekRangeLabel(h.weekKey)}** — ${h.progress.toLocaleString()} / ${h.goal.toLocaleString()}` +
      (extras.length ? ` · ${extras.join(" · ")}` : "")
    );
  });
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: `${target.displayName} — weekly history`,
      iconURL: target.avatarUrl || undefined,
    })
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Most recent first · archived at each weekly reset" });
}

/** Route every NS.hub button. Buttons are safeguarded to the subject/officers. */
export async function handleHubButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action, arg } = parseId(interaction.customId);
  const userId = String(arg ?? "");

  if (action === "dispute") return void (await startHubDispute(interaction, userId));

  const updatesSourceMessage = action === "refresh";
  if (updatesSourceMessage) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: 64 });
  }

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(false));
    return;
  }

  const isOwner = interaction.user.id === userId;
  const officer = isOfficer(interaction.member, clan);
  if (!isOwner && !officer) {
    await interaction.editReply({ content: "These controls aren't yours to use." });
    return;
  }

  switch (action) {
    case "calendar": {
      const member = await getMember(clan.guildId, userId);
      if (!member) {
        await interaction.editReply({
          content: "No tracked XP yet — nothing to show on the calendar.",
        });
        return;
      }
      const target = await resolveTarget(interaction, userId);
      const png = await renderCalendarCard(clan, member, target.displayName);
      await interaction.editReply({
        content: `📅 **${target.displayName}** — this month`,
        files: [new AttachmentBuilder(png, { name: `calendar-${userId}.png` })],
      });
      return;
    }
    case "history": {
      const rows = await memberHistory(clan, userId, 10);
      if (!rows.length) {
        await interaction.editReply({
          content: "No archived weeks yet — history is written at each weekly reset.",
        });
        return;
      }
      const target = await resolveTarget(interaction, userId);
      await interaction.editReply({ embeds: [historyEmbed(clan, target, rows)] });
      return;
    }
    case "refresh": {
      const target = await resolveTarget(interaction, userId);
      await interaction.editReply(
        replaceHubCard(await buildMemberHub(clan, target, { officerView: officer && !isOwner }))
      );
      return;
    }
  }
}

async function startHubDispute(interaction: ButtonInteraction, userId: string) {
  if (!interaction.inCachedGuild()) return;

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: "Only the member can dispute their own warnings. Officers review from /disputes.",
      flags: 64,
    });
    return;
  }

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(false), flags: 64 });
    return;
  }

  const open = await findOpenDisputeForUser(clan.guildId, userId);
  if (open?.channelId) {
    await interaction.reply({
      content: `You already have an open dispute — continue in <#${open.channelId}>.`,
      flags: 64,
    });
    return;
  }

  if (!clan.disputeCategoryId) {
    await interaction.reply({ ...(await buildDisputePicker(clan, userId)), flags: 64 });
    return;
  }

  const warns = await listActive(clan.guildId, userId);
  const modal = new ModalBuilder()
    .setCustomId(hubDisputeModal(userId))
    .setTitle("Dispute a warning");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("warning_id")
        .setLabel("Warning number (from your warnings list)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(12)
        .setValue(warns[0] ? String(warns[0].id) : "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("explanation")
        .setLabel("Why should this be reconsidered?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    )
  );
  await interaction.showModal(modal);
}

export async function handleHubModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { arg } = parseId(interaction.customId);
  const userId = String(arg ?? "");
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "This dispute form isn't yours.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(false));
    return;
  }

  const explanation = interaction.fields.getTextInputValue("explanation").trim();
  if (!explanation) {
    await interaction.editReply({
      content: "Please include an explanation of why this should be reconsidered.",
    });
    return;
  }
  const rawId = interaction.fields.getTextInputValue("warning_id").trim();
  const warningId = /^\d+$/.test(rawId) ? Number(rawId) : null;

  const res = await openDisputeTicket({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    disputeType: "warning",
    reason: explanation,
    warningId,
    evidence: [],
  });

  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  await interaction.editReply({
    content:
      `✅ Dispute **#${res.dispute.id}** opened — continue in <#${res.channelId}>.\n` +
      `📎 **Attach your XP proof/screenshot in that channel** so staff can review it.`,
  });
}
