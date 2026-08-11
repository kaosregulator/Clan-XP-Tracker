import {
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, isAdmin, identityFromUser, getMember } from "../services/config";
import {
  applyProgress,
  setMemberFlag,
  setMemberNote,
  setGoalOverride,
  bulkApply,
  formatProgress,
  statusOf,
  STATUS_LABEL,
  memberHistory,
  effectiveGoal,
  currentProgress,
  listTracked,
  type ProgressChange,
} from "../services/progress";
import { sendReminder, sendBulkReminders, recentReminder } from "../services/reminders";
import {
  issueWarning,
  sendBulkWarnings,
  postWarningAnnouncement,
  recentWarning,
  type WarnDelivery,
} from "../services/warnings";
import { roleMemberIdentities } from "../services/roles";
import {
  recordEntry,
  calendarFor,
  periodTotals,
  membersMissingToday,
  type EntryMode,
} from "../services/xpLedger";
import { openReview } from "./review";
import { openDashboard } from "./dashboard";
import { openManager } from "./manager";
import { openMemberView } from "./memberView";
import { relative, weekRangeLabel, nextWeeklyReset, discordRelative, activityDate } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";

export function notConfiguredMessage(officer: boolean): { content: string } {
  return {
    content: officer
      ? "This server isn't configured yet — run **/setup** to choose a weekly goal, tracking mode and roles."
      : "XP tracking isn't configured on this server yet. Ask an admin to run **/setup**.",
  };
}

/** Officer guard shared by every /xp management action. */
async function officerGuard(
  interaction: ChatInputCommandInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only officers can manage XP. Progress is updated by officers after verifying it in-game.",
    });
    return null;
  }
  return clan;
}

const officer = (i: ChatInputCommandInteraction) => ({
  id: i.user.id,
  username: i.user.username,
});

/** Map the `destination` warn option to explicit delivery flags. */
function warnDelivery(destination: string | null): WarnDelivery | undefined {
  switch (destination) {
    case "channel":
      return { channel: true, dm: false };
    case "dm":
      return { channel: false, dm: true };
    case "both":
      return { channel: true, dm: true };
    default:
      return undefined; // fall back to clan defaults
  }
}

/** Human label for the chosen destination, for reply confirmations. */
function destinationLabel(destination: string | null): string {
  switch (destination) {
    case "dm":
      return " via DM";
    case "both":
      return " in the warn channel and via DM";
    case "channel":
      return " in the warn channel";
    default:
      return "";
  }
}

/* -------------------------------------------------------------- dispatch */

export async function handleXpCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  // Everyday actions are exposed both as `/xp <sub>` and as plain top-level
  // commands (/remind, /warn, /calendar, /entry, /missing). For the aliases
  // there is no subcommand — the command name *is* the action.
  const isAlias = interaction.commandName !== "xp";
  const group = isAlias ? null : interaction.options.getSubcommandGroup(false);
  const sub = isAlias ? interaction.commandName : interaction.options.getSubcommand();

  // Views open to everyone (self) come first.
  if (!group && sub === "progress") return handleProgress(interaction);
  if (!group && sub === "history") return handleHistory(interaction);
  if (!group && sub === "calendar") return handleCalendar(interaction);
  if (!group && sub === "manage") return openManager(interaction);
  if (!group && sub === "review") return openReview(interaction);
  if (!group && sub === "dashboard") return openDashboard(interaction);

  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction);
  if (!clan) return;

  if (group === "role") return handleRoleAction(interaction, clan, sub);

  // Officer actions without a required user option.
  if (sub === "missing") return handleMissing(interaction, clan);

  const target = interaction.options.getUser("user", true);
  if (target.bot) {
    await interaction.editReply({ content: "Bots aren't tracked." });
    return;
  }
  const identity = identityFromUser(target);

  const change = ((): ProgressChange | null => {
    switch (sub) {
      case "set":
        return { kind: "set", amount: interaction.options.getInteger("amount", true) };
      case "add":
        return { kind: "add", amount: interaction.options.getInteger("amount", true) };
      case "remove":
        return { kind: "remove", amount: interaction.options.getInteger("amount", true) };
      case "complete":
        return interaction.options.getBoolean("undo") ? { kind: "uncomplete" } : { kind: "complete" };
      case "reset":
        return { kind: "reset" };
      default:
        return null;
    }
  })();

  if (change) {
    const res = await applyProgress(clan, identity, change, officer(interaction));
    const line = formatProgress(clan, res.member);
    await interaction.editReply({
      content:
        `${res.completedNow ? "🎉" : "✅"} **${target.displayName ?? target.username}** — ${line}` +
        (res.completedNow ? " · goal reached!" : "") +
        (change.kind === "set" || change.kind === "add" || change.kind === "remove"
          ? ` _(was ${res.before.toLocaleString()})_`
          : ""),
    });
    return;
  }

  switch (sub) {
    case "note": {
      const note = interaction.options.getString("text") ?? "";
      await setMemberNote(clan, identity, note, officer(interaction));
      await interaction.editReply({
        content: note.trim()
          ? `📝 Note saved for **${target.username}**.`
          : `📝 Note cleared for **${target.username}**.`,
      });
      return;
    }
    case "goal": {
      const amount = interaction.options.getInteger("amount");
      await setGoalOverride(clan, identity, amount, officer(interaction));
      await interaction.editReply({
        content: amount
          ? `🎯 **${target.username}** now has a personal goal of **${amount.toLocaleString()} ${clan.activityName}**.`
          : `🎯 **${target.username}** is back on the server goal (**${clan.weeklyGoal.toLocaleString()} ${clan.activityName}**).`,
      });
      return;
    }
    case "exempt": {
      const enabled = interaction.options.getBoolean("enabled") ?? true;
      await setMemberFlag(clan, identity, "exempt", enabled, officer(interaction));
      await interaction.editReply({
        content: enabled
          ? `🛡️ **${target.username}** is now exempt from the weekly requirement.`
          : `🛡️ **${target.username}** is no longer exempt.`,
      });
      return;
    }
    case "leave": {
      const enabled = interaction.options.getBoolean("enabled") ?? true;
      await setMemberFlag(clan, identity, "onLeave", enabled, officer(interaction));
      await interaction.editReply({
        content: enabled
          ? `🌙 **${target.username}** is marked on leave — reminders & warnings will skip them.`
          : `🌙 **${target.username}** is back from leave.`,
      });
      return;
    }
    case "remind": {
      const member = await getMember(clan.guildId, target.id);
      const status = member ? statusOf(clan, member) : "notStarted";
      if (status === "complete" || status === "exempt" || status === "leave") {
        await interaction.editReply({
          content: `**${target.username}** is ${STATUS_LABEL[status].toLowerCase()} — no reminder needed.`,
        });
        return;
      }
      // Guard against double-pinging: skip if reminded in the last ~20 hours.
      const priorReminder = await recentReminder(clan, target.id);
      if (priorReminder) {
        const who = priorReminder.auto
          ? "automatically"
          : `by ${priorReminder.sentByUsername ?? "an officer"}`;
        await interaction.editReply({
          content: `🔕 **${target.username}** was already reminded ${discordRelative(priorReminder.createdAt)} ${who} — not sending another to avoid double-pinging.`,
        });
        return;
      }
      const { delivered } = await sendReminder({
        client: interaction.client,
        clan,
        target,
        member,
        auto: false,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
      });
      await interaction.editReply({
        content: delivered
          ? `🔔 Reminder sent to **${target.username}**.`
          : `🔔 Reminder recorded, but it couldn't be delivered (DMs closed and no reminder channel).`,
      });
      return;
    }
    case "warn": {
      if (!isAdmin(interaction.member, clan)) {
        await interaction.editReply({
          content: "Only admins can issue warnings. Officers can send reminders with **/remind**.",
        });
        return;
      }
      // Guard against double-pinging: skip if warned in the last ~20 hours.
      const priorWarning = await recentWarning(clan.guildId, target.id);
      if (priorWarning) {
        await interaction.editReply({
          content: `🛑 **${target.username}** was already warned ${discordRelative(priorWarning.issuedAt)} by ${priorWarning.issuedByUsername} — not issuing a duplicate. Use **/warnings @${target.username}** to review.`,
        });
        return;
      }
      const message = interaction.options.getString("message")?.trim();
      const destination = interaction.options.getString("destination");
      const deliver = warnDelivery(destination);
      const member = await getMember(clan.guildId, target.id);
      const reason =
        message ||
        (member
          ? `Missed the weekly ${clan.activityName} goal (${currentProgress(clan, member).toLocaleString()} / ${effectiveGoal(clan, member).toLocaleString()}).`
          : `Missed the weekly ${clan.activityName} goal.`);
      const { activeCount } = await issueWarning({
        client: interaction.client,
        clan,
        guild: interaction.guild,
        target,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
        reason,
        deliver,
      });
      const wantsChannel = deliver?.channel ?? true;
      await interaction.editReply({
        content:
          `⚠️ Warned **${target.username}**${destinationLabel(destination)} — now **${activeCount}** active warning(s).` +
          (clan.warningRoleIds.length
            ? `\n🔗 Applied warning role: ${clan.warningRoleIds.map((r) => `<@&${r}>`).join(" ")}`
            : "\n_Tip: pick a **Warning role** in **/setup → Notifications** to auto-assign one on warn._") +
          (wantsChannel && !clan.warningChannelId
            ? "\n_Tip: set an XP warn channel in **/setup** so warnings post publicly._"
            : "") +
          (activeCount >= clan.escalationThreshold
            ? `\n🚨 At ${clan.escalationThreshold}+ active warnings — flag for leadership review.`
            : ""),
      });
      return;
    }
    case "entry": {
      const amount = interaction.options.getInteger("amount", true);
      const mode: EntryMode = interaction.options.getBoolean("set") ? "set" : "add";
      const note = interaction.options.getString("note");
      const parsed = parseEntryDate(clan, interaction.options.getString("date"));
      if ("error" in parsed) {
        await interaction.editReply({ content: parsed.error });
        return;
      }
      const res = await recordEntry(clan, identity, { date: parsed.date, amount, mode, note }, officer(interaction));
      const totals = await periodTotals(clan, target.id);
      const dayLabel = parsed.date === activityDate(clan) ? "today" : `**${parsed.date}**`;
      await interaction.editReply({
        content:
          `📒 Logged **${res.dayTotal.toLocaleString()} ${clan.activityName}** for **${target.username}** on ${dayLabel}` +
          `${mode === "set" ? " (set)" : ` (+${amount.toLocaleString()})`}.\n` +
          `Totals — today **${totals.today.toLocaleString()}**, week **${totals.week.toLocaleString()}**, month **${totals.month.toLocaleString()}**, all-time **${totals.allTime.toLocaleString()}**.` +
          (clan.dailyTarget > 0
            ? `\nDaily target: **${clan.dailyTarget.toLocaleString()}** — ${res.dayTotal >= clan.dailyTarget ? "✅ met" : "✗ short"} for ${dayLabel}.`
            : ""),
      });
      return;
    }
  }
}

/** Validate/normalise an optional YYYY-MM-DD entry date (default: today). */
function parseEntryDate(clan: Clan, raw: string | null): { date: string } | { error: string } {
  if (!raw) return { date: activityDate(clan) };
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { error: "Date must be in **YYYY-MM-DD** format (e.g. 2026-08-01)." };
  }
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { error: `**${trimmed}** isn't a real date.` };
  if (trimmed > activityDate(clan)) return { error: "You can't log XP for a future day." };
  return { date: trimmed };
}

/* ------------------------------------------------------------- bulk role */

async function handleRoleAction(
  interaction: ChatInputCommandInteraction<"cached">,
  clan: Clan,
  sub: string
) {
  const role = interaction.options.getRole("role", true);
  const identities = await roleMemberIdentities(interaction.guild, role.id);
  if (!identities.length) {
    await interaction.editReply({ content: `<@&${role.id}> has no members to update.` });
    return;
  }

  switch (sub) {
    case "add": {
      const amount = interaction.options.getInteger("amount", true);
      const res = await bulkApply(clan, identities, { kind: "add", amount }, officer(interaction));
      await interaction.editReply({
        content: `✅ Added **${amount.toLocaleString()} ${clan.activityName}** to **${res.updated}** member(s) of <@&${role.id}>${res.completedNow ? ` · 🎉 ${res.completedNow} reached the goal` : ""}.`,
      });
      return;
    }
    case "complete": {
      const res = await bulkApply(clan, identities, { kind: "complete" }, officer(interaction));
      await interaction.editReply({
        content: `✅ Marked **${res.updated}** member(s) of <@&${role.id}> complete for this week.`,
      });
      return;
    }
    case "reset": {
      const res = await bulkApply(clan, identities, { kind: "reset" }, officer(interaction));
      await interaction.editReply({
        content: `♻️ Reset weekly progress for **${res.updated}** member(s) of <@&${role.id}>.`,
      });
      return;
    }
    case "track": {
      // Importing a role = zero-progress rows for anyone not yet tracked.
      const res = await bulkApply(clan, identities, { kind: "add", amount: 0 }, officer(interaction));
      await interaction.editReply({
        content: `📋 Now tracking **${res.updated}** member(s) of <@&${role.id}>.`,
      });
      return;
    }
    case "entry": {
      const amount = interaction.options.getInteger("amount", true);
      const mode: EntryMode = interaction.options.getBoolean("set") ? "set" : "add";
      const parsed = parseEntryDate(clan, interaction.options.getString("date"));
      if ("error" in parsed) {
        await interaction.editReply({ content: parsed.error });
        return;
      }
      for (const identity of identities) {
        await recordEntry(clan, identity, { date: parsed.date, amount, mode }, officer(interaction));
      }
      const dayLabel = parsed.date === activityDate(clan) ? "today" : `**${parsed.date}**`;
      await interaction.editReply({
        content: `📒 Logged **${amount.toLocaleString()} ${clan.activityName}** ${mode === "set" ? "(set) " : ""}for **${identities.length}** member(s) of <@&${role.id}> on ${dayLabel}.`,
      });
      return;
    }
    case "remind": {
      const members = [];
      for (const identity of identities) {
        const m = await getMember(clan.guildId, identity.userId);
        if (!m) continue;
        const s = statusOf(clan, m);
        if (s === "inProgress" || s === "notStarted") members.push(m);
      }
      if (!members.length) {
        await interaction.editReply({
          content: `Everyone in <@&${role.id}> is complete, exempt or on leave — nothing to remind.`,
        });
        return;
      }
      const res = await sendBulkReminders({
        client: interaction.client,
        clan,
        targets: members,
        auto: false,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
        skipIfRemindedToday: true,
      });
      await interaction.editReply({
        content: `🔔 <@&${role.id}> — sent **${res.sent}** reminder(s)${res.skipped ? ` · skipped ${res.skipped} reminded in the last day` : ""}.`,
      });
      return;
    }
    case "warn": {
      if (!isAdmin(interaction.member, clan)) {
        await interaction.editReply({
          content: "Only admins can issue warnings. Officers can send reminders with **/xp role remind** or **/remind**.",
        });
        return;
      }
      const message = interaction.options.getString("message")?.trim();
      const mode = interaction.options.getString("mode") ?? "individual";

      // "Ping the whole role once" — a single announcement, no per-member
      // warnings recorded.
      if (mode === "announce") {
        const reason =
          message || `Members of this role are behind on the weekly ${clan.activityName} goal.`;
        const posted = await postWarningAnnouncement({
          client: interaction.client,
          clan,
          roleId: role.id,
          reason,
          moderatorUsername: interaction.user.username,
        });
        await interaction.editReply({
          content: posted
            ? `⚠️ Pinged <@&${role.id}> in the warn channel.`
            : "No XP warn channel is set — configure one in **/setup** to post role announcements.",
        });
        return;
      }

      // "Warn each member" — issue an individual warning to everyone behind.
      const destination = interaction.options.getString("destination");
      const deliver = warnDelivery(destination);
      const members = [];
      for (const identity of identities) {
        const m = await getMember(clan.guildId, identity.userId);
        if (!m) continue;
        const s = statusOf(clan, m);
        if (s === "inProgress" || s === "notStarted") members.push(m);
      }
      if (!members.length) {
        await interaction.editReply({
          content: `Everyone in <@&${role.id}> is complete, exempt or on leave — nothing to warn.`,
        });
        return;
      }
      const res = await sendBulkWarnings({
        client: interaction.client,
        clan,
        guild: interaction.guild,
        targets: members,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
        deliver,
        skipIfWarnedRecently: true,
        reason: (m) =>
          message ||
          `Missed the weekly ${clan.activityName} goal (${currentProgress(clan, m).toLocaleString()} / ${effectiveGoal(clan, m).toLocaleString()}).`,
      });
      await interaction.editReply({
        content:
          `⚠️ <@&${role.id}> — issued **${res.issued}** warning(s)${destinationLabel(destination)}${res.skipped ? ` · skipped ${res.skipped} warned in the last day` : ""}.` +
          (res.escalated.length
            ? `\n🚨 **Leadership review** — at ${clan.escalationThreshold}+ active warnings: ${res.escalated.join(", ")}`
            : ""),
      });
      return;
    }
  }
}

/* ----------------------------------------------------------------- views */

/** /xp progress [user] — anyone can view their own; officers can view anyone. */
async function handleProgress(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  const target = interaction.options.getUser("user") ?? interaction.user;
  if (target.id !== interaction.user.id && !isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can view other members' progress." });
    return;
  }

  // A member viewing themselves gets the friendly MY XP card (+ staff-note
  // delivery + dispute button). Officers viewing others keep the detail embed.
  if (target.id === interaction.user.id) {
    return openMemberView(interaction, clan);
  }

  const member = await getMember(clan.guildId, target.id);
  if (!member) {
    await interaction.editReply({
      content: `**${target.username}** isn't tracked yet. An officer can start tracking them with \`/xp set\`.`,
    });
    return;
  }

  const status = statusOf(clan, member);
  const goal = effectiveGoal(clan, member);
  const progress = currentProgress(clan, member);
  const pct = Math.min(100, Math.round((progress / goal) * 100));
  const embed = new EmbedBuilder()
    .setColor(status === "complete" ? 0x3ba55d : status === "notStarted" ? 0xed4245 : 0xfaa61a)
    .setAuthor({
      name: `${target.displayName ?? target.username} — weekly ${clan.activityName}`,
      iconURL: target.displayAvatarURL(),
    })
    .addFields(
      { name: "Progress", value: formatProgress(clan, member), inline: true },
      { name: "Status", value: STATUS_LABEL[status], inline: true },
      {
        name: "Week closes",
        value: discordRelative(nextWeeklyReset(clan)),
        inline: true,
      },
      {
        name: "This week",
        value: `Reminders: **${member.weekReminders}** · Warnings: **${member.weekWarnings}**`,
        inline: true,
      },
      {
        name: "Last updated",
        value: member.progressUpdatedAt
          ? `${relative(member.progressUpdatedAt)}${member.lastUpdatedByUsername ? ` by **${member.lastUpdatedByUsername}**` : ""}`
          : "never",
        inline: true,
      }
    );
  if (clan.trackingMode !== "complete") {
    embed.setDescription(progressBarText(pct));
  }
  if (member.gameUsername) {
    embed.addFields({ name: `${clan.gameName} account`, value: member.gameUsername, inline: true });
  }
  if (member.notes && isOfficer(interaction.member, clan)) {
    embed.addFields({ name: "Officer note", value: member.notes.slice(0, 1024) });
  }
  await interaction.editReply({ embeds: [embed] });
}

function progressBarText(pct: number): string {
  const filled = Math.round((pct / 100) * 12);
  return `\`${"█".repeat(filled)}${"░".repeat(12 - filled)}\` **${pct}%**`;
}

/** /xp history [user] — archived weekly outcomes. */
async function handleHistory(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  const target = interaction.options.getUser("user") ?? interaction.user;
  if (target.id !== interaction.user.id && !isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can view other members' history." });
    return;
  }

  const rows = await memberHistory(clan, target.id, 10);
  if (!rows.length) {
    await interaction.editReply({
      content: `No archived weeks for **${target.username}** yet — history is written at each weekly reset.`,
    });
    return;
  }

  const lines = rows.map((h) => {
    const flag = h.exempt ? "🛡️" : h.onLeave ? "🌙" : h.completed ? "✅" : "❌";
    const extras: string[] = [];
    if (h.remindersSent > 0) extras.push(`${h.remindersSent} reminder(s)`);
    if (h.warningsIssued > 0) extras.push(`${h.warningsIssued} warning(s)`);
    if (h.notes) extras.push(`note: ${h.notes.slice(0, 60)}`);
    return (
      `${flag} **${weekRangeLabel(h.weekKey)}** — ${h.progress.toLocaleString()} / ${h.goal.toLocaleString()}` +
      (extras.length ? ` · ${extras.join(" · ")}` : "")
    );
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({
          name: `${target.displayName ?? target.username} — weekly history`,
          iconURL: target.displayAvatarURL(),
        })
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Most recent first · archived at each weekly reset" }),
    ],
  });
}

/** Validate an optional YYYY-MM month (default: current month). */
function parseMonth(
  clan: Clan,
  raw: string | null
): { year: number; month: number } | { error: string } {
  const today = activityDate(clan);
  if (!raw) return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const m = raw.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return { error: "Month must be in **YYYY-MM** format (e.g. 2026-08)." };
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return { error: "Month must be between 01 and 12." };
  return { year, month };
}

/** /xp calendar [user] [month] — a per-member time-card of daily XP. */
async function handleCalendar(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  const target = interaction.options.getUser("user") ?? interaction.user;
  if (target.id !== interaction.user.id && !isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can view other members' calendars." });
    return;
  }
  const member = await getMember(clan.guildId, target.id);
  if (!member) {
    await interaction.editReply({
      content: `**${target.username}** isn't tracked yet — log some XP with **/xp entry** first.`,
    });
    return;
  }
  const parsed = parseMonth(clan, interaction.options.getString("month"));
  if ("error" in parsed) {
    await interaction.editReply({ content: parsed.error });
    return;
  }
  const { year, month } = parsed;
  const view = await calendarFor(clan, member, year, month);
  const totals = await periodTotals(clan, target.id);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const buffer = await renderOffThread("calendarCard", {
    communityName: clan.clanName,
    memberName: target.displayName ?? target.username,
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

  await interaction.editReply({
    content: `📅 **${target.displayName ?? target.username}** — ${view.monthLabel}`,
    files: [
      new AttachmentBuilder(buffer, { name: `calendar-${target.id}-${year}-${month}.png` }),
    ],
  });
}

/** /xp missing [role] — who still owes XP today. */
async function handleMissing(interaction: ChatInputCommandInteraction<"cached">, clan: Clan) {
  const role = interaction.options.getRole("role");
  let members;
  if (role) {
    const ids = await roleMemberIdentities(interaction.guild, role.id);
    members = [];
    for (const id of ids) {
      const m = await getMember(clan.guildId, id.userId);
      if (m) members.push(m);
    }
  } else {
    members = await listTracked(clan);
  }

  const missing = await membersMissingToday(clan, members);
  const scope = role ? ` in <@&${role.id}>` : "";
  if (!missing.length) {
    await interaction.editReply({
      content: `✅ Everyone${scope} has hit today's target${clan.dailyTarget > 0 ? ` of **${clan.dailyTarget.toLocaleString()} ${clan.activityName}**` : ""}.`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const targetLabel =
    clan.dailyTarget > 0 ? `${clan.dailyTarget.toLocaleString()} ${clan.activityName}` : `any ${clan.activityName}`;
  const lines = missing
    .slice(0, 40)
    .map(
      (m) =>
        `• <@${m.member.userId}> — **${m.todayAmount.toLocaleString()}** / ${clan.dailyTarget > 0 ? clan.dailyTarget.toLocaleString() : "—"}`
    );
  await interaction.editReply({
    content:
      `🔎 **${missing.length}** member(s)${scope} haven't hit today's target (${targetLabel}):\n` +
      `${lines.join("\n")}${missing.length > 40 ? `\n…and ${missing.length - 40} more` : ""}`,
    allowedMentions: { parse: [] },
  });
}
