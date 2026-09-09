/**
 * Clan Command Center — officer member editor.
 *
 * Replaces the old @mention spam list with:
 *  1) An overview card (needs attention X/Y style counts)
 *  2) One-at-a-time member profile cards with dual Discord+Roblox avatars,
 *     progress %, clean pts, and ◀ ▶ browse through the queue
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Clan, ClanMember } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import {
  listTracked,
  statusOf,
  formatProgress,
  currentProgress,
  effectiveGoal,
  reminderTargets,
  warningTargets,
} from "../services/progress";
import {
  weekKey,
  weekRangeLabel,
  nextWeeklyReset,
  formatInZone,
} from "../services/time";
import { cleanRankOf } from "./leaderboard";
import { renderOffThread } from "../canvas/render-pool";
import { DASH_FILTERS, type DashFilter, row } from "../ui/components";
import {
  parseId,
  DASH_REFRESH,
  DASH_FILTER,
  DASH_HOME,
  dashBrowse,
  dashPrev,
  dashNext,
  mpAddXp,
  mpComplete,
  mpRemind,
  mpWarn,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

function editorStatusLabel(clan: Clan, member: ClanMember): string {
  const s = statusOf(clan, member);
  if (s === "complete") return "Complete";
  if (s === "exempt") return "Exempt";
  if (s === "leave") return "On leave";
  if (s === "inProgress") return "In progress";
  return "Not started";
}

function filterMembers(clan: Clan, members: ClanMember[], filter: DashFilter): ClanMember[] {
  const wk = weekKey(clan);
  switch (filter) {
    case "all":
      return [...members].sort((a, b) =>
        (a.displayName || a.username).localeCompare(b.displayName || b.username)
      );
    case "complete":
      return members.filter((m) => statusOf(clan, m) === "complete");
    case "attention": {
      const targets = reminderTargets(clan, members);
      const eligible = new Set(warningTargets(clan, members).map((m) => m.id));
      return targets.sort((a, b) => {
        const ea = eligible.has(a.id) ? 1 : 0;
        const eb = eligible.has(b.id) ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return (b.weekKey === wk ? b.weekReminders : 0) - (a.weekKey === wk ? a.weekReminders : 0);
      });
    }
    case "reminded":
      return members.filter((m) => m.weekKey === wk && m.weekReminders > 0);
    case "warned":
      return members.filter((m) => m.weekKey === wk && m.weekWarnings > 0);
    case "exempt":
      return members.filter((m) => m.exempt);
    case "leave":
      return members.filter((m) => m.onLeave);
    case "clean":
      return members
        .filter((m) => !m.exempt && !m.onLeave && (m.lifetimeWarnings ?? 0) === 0)
        .sort((a, b) => b.cleanPoints - a.cleanPoints);
  }
}

function filterMeta(filter: DashFilter) {
  return DASH_FILTERS.find((f) => f.value === filter) ?? DASH_FILTERS[0]!;
}

function overviewComponents(counts: {
  attention: number;
  tracked: number;
  warned: number;
  clean: number;
  all: number;
}): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(dashBrowse("attention", 0))
        .setStyle(counts.attention ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setLabel(`Needs attention ${counts.attention}/${counts.tracked}`)
        .setDisabled(counts.attention === 0),
      new ButtonBuilder()
        .setCustomId(dashBrowse("warned", 0))
        .setStyle(counts.warned ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setLabel(`Warned ${counts.warned}`)
        .setDisabled(counts.warned === 0),
      new ButtonBuilder()
        .setCustomId(dashBrowse("clean", 0))
        .setStyle(ButtonStyle.Success)
        .setLabel(`Never warned ${counts.clean}`)
        .setDisabled(counts.clean === 0)
    ),
    row(
      new ButtonBuilder()
        .setCustomId(dashBrowse("all", 0))
        .setStyle(ButtonStyle.Primary)
        .setLabel(`Browse all ${counts.all}`),
      new ButtonBuilder()
        .setCustomId(dashBrowse("complete", 0))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Complete"),
      new ButtonBuilder()
        .setCustomId(dashBrowse("reminded", 0))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Reminded"),
      new ButtonBuilder().setCustomId(DASH_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh")
    ),
  ];
}

function browseComponents(
  filter: DashFilter,
  index: number,
  total: number,
  userId: string | null
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(DASH_FILTER)
    .setPlaceholder("Switch queue…")
    .addOptions(
      DASH_FILTERS.map((f) => ({
        value: f.value,
        label: f.label,
        emoji: f.emoji,
        default: f.value === filter,
      }))
    );

  const prev = Math.max(0, index - 1);
  const next = Math.min(Math.max(total - 1, 0), index + 1);

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    row(select),
    row(
      new ButtonBuilder()
        .setCustomId(dashPrev(filter, index))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("◀ Prev")
        .setDisabled(total === 0 || index <= 0),
      new ButtonBuilder().setCustomId(DASH_HOME).setStyle(ButtonStyle.Primary).setLabel("Overview"),
      new ButtonBuilder()
        .setCustomId(dashNext(filter, index))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Next ▶")
        .setDisabled(total === 0 || index >= total - 1),
      new ButtonBuilder()
        .setCustomId(dashBrowse(filter, index))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Refresh")
    ),
  ];

  if (userId) {
    rows.push(
      row(
        new ButtonBuilder()
          .setCustomId(mpRemind(userId))
          .setStyle(ButtonStyle.Primary)
          .setLabel("Remind"),
        new ButtonBuilder()
          .setCustomId(mpWarn(userId))
          .setStyle(ButtonStyle.Danger)
          .setLabel("Warn"),
        new ButtonBuilder()
          .setCustomId(mpComplete(userId))
          .setStyle(ButtonStyle.Success)
          .setLabel("Complete"),
        new ButtonBuilder()
          .setCustomId(mpAddXp(userId))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Add XP")
      )
    );
  }

  return rows;
}

/**
 * Open a filtered member-editor queue (one profile at a time).
 * Used by /panel category shortcuts (Manage / Attention / Warnings).
 * `_page` is treated as the starting queue index for back-compat with old callers.
 */
export async function buildDashboardPayload(
  clan: Clan,
  filter: DashFilter = "attention",
  page = 0
): Promise<BaseMessageOptions> {
  return buildMemberBrowsePayload(clan, filter, page);
}

/** Overview Command Center — counts first, no @mention lists. */
export async function buildOverviewPayload(clan: Clan): Promise<BaseMessageOptions> {
  const members = await listTracked(clan);
  const tracked = members.filter((m) => !m.exempt && !m.onLeave).length;
  const attention = reminderTargets(clan, members).length;
  const warnEligible = warningTargets(clan, members).length;
  const wk = weekKey(clan);
  const warned = members.filter((m) => m.weekKey === wk && m.weekWarnings > 0).length;
  const complete = members.filter((m) => statusOf(clan, m) === "complete").length;
  const clean = members.filter(
    (m) => !m.exempt && !m.onLeave && (m.lifetimeWarnings ?? 0) === 0
  ).length;
  const pct = tracked > 0 ? Math.round((complete / tracked) * 100) : 0;

  const png = await renderOffThread("commandCenter", {
    communityName: clan.clanName,
    weekRange: weekRangeLabel(wk),
    deadline: `resets ${formatInZone(nextWeeklyReset(clan), clan, "ddd HH:mm")}`,
    completionPct: pct,
    completed: complete,
    active: tracked,
    needsActionLabel:
      attention > 0
        ? `Needs attention ${attention} / ${tracked} tracked`
        : "All clear — nobody needs attention",
    tiles: [
      { label: "Attention", value: attention, tone: attention ? "warn" : "good" },
      { label: "Warn-ready", value: warnEligible, tone: warnEligible ? "bad" : "neutral" },
      { label: "Warned", value: warned, tone: warned ? "bad" : "neutral" },
      { label: "Complete", value: complete, tone: "good" },
      { label: "Never warned", value: clean, tone: "good" },
      { label: "Exempt", value: members.filter((m) => m.exempt).length, tone: "neutral" },
      { label: "On leave", value: members.filter((m) => m.onLeave).length, tone: "neutral" },
      { label: "Tracked", value: members.length, tone: "neutral" },
    ],
    footer: "Tap a queue below · one clean member profile at a time · no @mention lists",
  });

  return {
    content: "",
    embeds: [],
    files: [new AttachmentBuilder(png, { name: "command-center.png" })],
    components: overviewComponents({
      attention,
      tracked: Math.max(tracked, 1),
      warned,
      clean,
      all: members.length,
    }),
  };
}

/** One-member profile browser for a filter queue. */
export async function buildMemberBrowsePayload(
  clan: Clan,
  filter: DashFilter,
  index: number
): Promise<BaseMessageOptions> {
  const members = await listTracked(clan);
  const queue = filterMembers(clan, members, filter);
  const meta = filterMeta(filter);

  if (!queue.length) {
    const wk = weekKey(clan);
    const png = await renderOffThread("commandCenter", {
      communityName: clan.clanName,
      weekRange: weekRangeLabel(wk),
      deadline: `${meta.label} · empty`,
      completionPct: 100,
      completed: 0,
      active: 0,
      needsActionLabel: `No members in “${meta.label}” right now`,
      tiles: [
        { label: "Attention", value: reminderTargets(clan, members).length, tone: "warn" },
        { label: "All tracked", value: members.length, tone: "neutral" },
        { label: "Complete", value: members.filter((m) => statusOf(clan, m) === "complete").length, tone: "good" },
        { label: "Clean", value: members.filter((m) => (m.lifetimeWarnings ?? 0) === 0).length, tone: "good" },
        { label: "Warned", value: 0, tone: "neutral" },
        { label: "Exempt", value: members.filter((m) => m.exempt).length, tone: "neutral" },
        { label: "Leave", value: members.filter((m) => m.onLeave).length, tone: "neutral" },
        { label: "Queue", value: 0, tone: "good" },
      ],
      footer: "Pick another queue from Overview",
    });
    return {
      content: "",
      embeds: [],
      files: [new AttachmentBuilder(png, { name: "command-center.png" })],
      components: [
        row(
          new ButtonBuilder().setCustomId(DASH_HOME).setStyle(ButtonStyle.Primary).setLabel("Overview"),
          new ButtonBuilder()
            .setCustomId(dashBrowse("all", 0))
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Browse all")
        ),
      ],
    };
  }

  const clamped = Math.min(Math.max(0, index), queue.length - 1);
  const member = queue[clamped]!;
  const goal = effectiveGoal(clan, member);
  const progress = currentProgress(clan, member);
  const pct = goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : progress > 0 ? 100 : 0;
  const rank = await cleanRankOf(clan, member.userId);

  const png = await renderOffThread("memberEditorCard", {
    communityName: clan.clanName,
    queueLabel: meta.label,
    queueIndex: clamped,
    queueTotal: queue.length,
    username: member.username,
    displayName: member.displayName || member.username,
    discordAvatarUrl: member.avatarUrl,
    robloxAvatarUrl: member.robloxAvatarUrl,
    robloxUsername: member.gameUsername,
    statusLabel: editorStatusLabel(clan, member),
    progressPct: pct,
    progressLabel: formatProgress(clan, member),
    cleanPoints: member.cleanPoints ?? 0,
    cleanRank: rank,
    activeWarnings: member.warningsCount ?? 0,
    lifetimeWarnings: member.lifetimeWarnings ?? 0,
    weekReminders: member.weekKey === weekKey(clan) ? member.weekReminders : 0,
    notesPreview: member.notes ? member.notes.slice(0, 80) : null,
  });

  return {
    content: "",
    embeds: [],
    files: [new AttachmentBuilder(png, { name: "member-editor.png" })],
    components: browseComponents(filter, clamped, queue.length, member.userId),
  };
}

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "The Command Center is officer-only." });
    return null;
  }
  return clan;
}

/** /xp dashboard + /warnings (no target) — open Command Center overview. */
export async function openDashboard(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction);
  if (!clan) return;
  await interaction.editReply(await buildOverviewPayload(clan));
}

function parseFilterIndex(arg: string | undefined): { filter: DashFilter; index: number } {
  if (!arg) return { filter: "attention", index: 0 };
  const sep = arg.lastIndexOf("-");
  const filter = (sep >= 0 ? arg.slice(0, sep) : arg) as DashFilter;
  const index = sep >= 0 ? parseInt(arg.slice(sep + 1), 10) || 0 : 0;
  const known = DASH_FILTERS.some((f) => f.value === filter);
  return { filter: known ? filter : "attention", index };
}

export async function handleDashButton(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);

  if (action === "refresh" || action === "home") {
    await interaction.editReply({
      ...(await buildOverviewPayload(clan)),
      attachments: [],
    });
    return;
  }

  if (action === "browse" || action === "page") {
    const { filter, index } = parseFilterIndex(arg);
    await interaction.editReply({
      ...(await buildMemberBrowsePayload(clan, filter, index)),
      attachments: [],
    });
    return;
  }

  if (action === "prev" || action === "next") {
    const { filter, index } = parseFilterIndex(arg);
    const delta = action === "next" ? 1 : -1;
    await interaction.editReply({
      ...(await buildMemberBrowsePayload(clan, filter, index + delta)),
      attachments: [],
    });
  }
}

export async function handleDashSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction);
  if (!clan) return;
  const filter = (interaction.values[0] ?? "attention") as DashFilter;
  await interaction.editReply({
    ...(await buildMemberBrowsePayload(clan, filter, 0)),
    attachments: [],
  });
}
