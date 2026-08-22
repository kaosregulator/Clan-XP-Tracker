import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan, ClanMember } from "@workspace/db";
import { getClan, isOfficer, getMember } from "../services/config";
import { listActive } from "../services/warnings";
import { listRecentReminders } from "../services/reminders";
import { listMemberNotes } from "../services/notes";
import { memberHistory } from "../services/progress";
import { calendarFor, periodTotals } from "../services/xpLedger";
import { formatInZone, weekRangeLabel, activityDate } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";
import { buildDashboardPayload } from "./dashboard";
import { buildDisputePicker } from "./disputes";
import {
  hubDispute,
  hubCalendar,
  hubHistory,
  hubRefresh,
  warnRemoveSelect,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * The /warnings hub. One command, two audiences — reusing the pieces that
 * already exist:
 *
 *  • An **officer** running `/warnings` with no target gets the live warning
 *    **dashboard** (the same view as `/xp dashboard`, which still stands).
 *  • An **officer** running `/warnings @member` gets that member's enforcement
 *    record with the quick **remove-warning** dropdown plus calendar/history.
 *  • A **member** running `/warnings` gets their own record — active warnings,
 *    recent reminders and any staff notes left for them, each stamped with when
 *    and by whom — and safeguarded buttons to **dispute**, or open their
 *    **calendar** / **history**.
 *
 * Every button carries the subject's user id and re-checks ownership before it
 * acts, so a member can never drive another member's controls.
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

/** Resolve a hub subject by id, preferring live Discord identity. */
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

/* ------------------------------------------------------------- hub payload */

/**
 * Build a member's enforcement record. `officerView` shows every staff note and
 * a remove-warning dropdown; the member's own view shows only notes staff chose
 * to share with them and offers the dispute button instead.
 */
export async function buildMemberHub(
  clan: Clan,
  target: HubTarget,
  opts: { officerView: boolean }
): Promise<BaseMessageOptions> {
  const [warns, reminders, allNotes] = await Promise.all([
    listActive(clan.guildId, target.id),
    listRecentReminders(clan.guildId, target.id, 5),
    listMemberNotes(clan.guildId, target.id, 10),
  ]);
  // Members only see notes staff explicitly delivered to them; officers see all.
  const notes = opts.officerView ? allNotes : allNotes.filter((n) => n.notifyMember && n.delivered);

  const embed = new EmbedBuilder()
    .setColor(warns.length ? 0xed4245 : 0x3ba55d)
    .setAuthor({
      name: opts.officerView
        ? `XP record — ${target.username}`
        : `Your XP standing — ${target.username}`,
      iconURL: target.avatarUrl || undefined,
    });

  embed.addFields({
    name: `⚠️ Active warnings (${warns.length})`,
    value: warns.length
      ? warns
          .slice(0, 6)
          .map(
            (w) =>
              `**#${w.id}** · ${formatInZone(w.issuedAt, clan)}\n> ${w.reason.slice(0, 160)}\n_by ${w.issuedByUsername}_`
          )
          .join("\n\n")
          .slice(0, 1024)
      : "✅ No active warnings — good standing.",
  });

  if (reminders.length) {
    embed.addFields({
      name: "🔔 Recent reminders",
      value: reminders
        .map(
          (r) =>
            `${formatInZone(r.createdAt, clan)} — ${r.auto ? "automatic reminder" : `by ${r.sentByUsername ?? "staff"}`}${r.delivered ? "" : " (undelivered)"}`
        )
        .join("\n")
        .slice(0, 1024),
    });
  }

  if (notes.length) {
    embed.addFields({
      name: opts.officerView ? "📝 Staff notes" : "📝 Notes from staff",
      value: notes
        .slice(0, 5)
        .map(
          (n) =>
            `${formatInZone(n.createdAt, clan)} — ${n.body.slice(0, 160)}\n_by ${n.authorUsername}_`
        )
        .join("\n\n")
        .slice(0, 1024),
    });
  }

  embed.setFooter({
    text: opts.officerView
      ? "Officer view · remove a warning below, or open the member's calendar / history."
      : `Your ${clan.activityName} enforcement record — if something looks wrong, open a dispute.`,
  });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (opts.officerView) {
    // Officer looking at a member: quick remove + the same viewers the member has.
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
          .setLabel("📅 Calendar"),
        new ButtonBuilder()
          .setCustomId(hubHistory(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("🗂 History"),
        new ButtonBuilder()
          .setCustomId(hubRefresh(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Refresh")
      )
    );
  } else {
    // The member's own hub: dispute + calendar + history.
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(hubDispute(target.id))
          .setStyle(ButtonStyle.Danger)
          .setLabel("⚖️ Open dispute"),
        new ButtonBuilder()
          .setCustomId(hubCalendar(target.id))
          .setStyle(ButtonStyle.Primary)
          .setLabel("📅 Calendar"),
        new ButtonBuilder()
          .setCustomId(hubHistory(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("🗂 History")
      ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(hubRefresh(target.id))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Refresh")
      )
    );
  }

  return { embeds: [embed], components: rows };
}

/* --------------------------------------------------------------- command */

/** /warnings — dashboard for officers, personal record for members. */
export async function handleWarnings(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const requested = interaction.options.getUser("user");
  const officer = isOfficer(interaction.member, clan);

  if (requested && requested.id !== interaction.user.id && !officer) {
    await interaction.editReply({ content: "Only officers can view other members' warnings." });
    return;
  }

  // Officer, no specific member → the live warning dashboard (the admin hub).
  if (officer && !requested) {
    await interaction.editReply(await buildDashboardPayload(clan, "attention", 0));
    return;
  }

  const subject = requested ?? interaction.user;
  const officerView = officer && subject.id !== interaction.user.id;
  await interaction.editReply(
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
  );
}

/* --------------------------------------------------------------- buttons */

/** Render a member's calendar card for the current month (reuses the ledger). */
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
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(false), flags: 64 });
    return;
  }

  const isOwner = interaction.user.id === userId;
  const officer = isOfficer(interaction.member, clan);
  // Safeguard: only the member the hub belongs to — or an officer — may act.
  if (!isOwner && !officer) {
    await interaction.reply({ content: "These controls aren't yours to use.", flags: 64 });
    return;
  }

  switch (action) {
    case "dispute": {
      // Disputing is a personal action: only the member can dispute their own.
      if (!isOwner) {
        await interaction.reply({
          content: "Only the member can dispute their own warnings. Officers review from /disputes.",
          flags: 64,
        });
        return;
      }
      await interaction.reply({ ...(await buildDisputePicker(clan, userId)), flags: 64 });
      return;
    }
    case "calendar": {
      await interaction.deferReply({ flags: 64 });
      const member = await getMember(clan.guildId, userId);
      if (!member) {
        await interaction.editReply({ content: "No tracked XP yet — nothing to show on the calendar." });
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
      await interaction.deferReply({ flags: 64 });
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
      await interaction.deferUpdate();
      const target = await resolveTarget(interaction, userId);
      await interaction.editReply(
        await buildMemberHub(clan, target, { officerView: officer && !isOwner })
      );
      return;
    }
  }
}
