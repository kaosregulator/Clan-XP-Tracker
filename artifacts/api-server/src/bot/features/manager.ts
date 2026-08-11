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
  type Guild,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import type { Clan, ClanMember } from "@workspace/db";
import {
  getClan,
  isOfficer,
  isAdmin,
  ensureMember,
  getMember,
  identityFromUser,
  type MemberIdentity,
} from "../services/config";
import {
  statusOf,
  formatProgress,
  effectiveGoal,
  currentProgress,
  setMemberFlag,
  setMemberNote,
  adjustWarningPoints,
  applyProgress,
  listTracked,
  memberHistory,
  STATUS_LABEL,
  type MemberStatus,
} from "../services/progress";
import { countActive, listActive, issueWarning, removeWarning } from "../services/warnings";
import { sendReminder, recentReminder } from "../services/reminders";
import { recordEntry, calendarFor, periodTotals } from "../services/xpLedger";
import { roleMemberIdentities } from "../services/roles";
import { unreadCount } from "../services/notifications";
import { activityDate, weekKey, weekRangeLabel, discordRelative, nextWeeklyReset } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";
import {
  mgrCat,
  mgrPage,
  mgrPick,
  mgrMember,
  mgrAddXpModal,
  mgrRemXpModal,
  mgrNoteModal,
  mgrWarnModal,
  mgrRemoveWarnSelect,
  MGR_REFRESH,
  NOTIF_REFRESH,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * ⚔️ XP MANAGER — the V3 home. A spreadsheet-style roster of every tracked
 * member with category tabs (All / Complete / Attention / Missed / Reminded /
 * Leave / Exempt / Excused), pagination, and a click-through member panel that
 * fronts every existing service (progress, ledger, reminders, warnings, notes)
 * behind kid-simple buttons. Nothing here is a new XP/warning/reminder system —
 * it is a fast operator surface over the ones that already exist.
 */

const PAGE_SIZE = 10;

/* ------------------------------------------------------------- categories */

type ManagerFilter =
  | "all"
  | "complete"
  | "attention"
  | "missed"
  | "reminded"
  | "leave"
  | "exempt"
  | "excused";

interface CategoryDef {
  value: ManagerFilter;
  label: string;
  emoji: string;
  /** Whether a member belongs in this tab. */
  match: (clan: Clan, m: ClanMember) => boolean;
}

const wkReminders = (clan: Clan, m: ClanMember) =>
  m.weekKey === weekKey(clan) ? m.weekReminders : 0;

export const CATEGORIES: CategoryDef[] = [
  { value: "all", label: "All", emoji: "👥", match: () => true },
  { value: "complete", label: "Complete", emoji: "🟢", match: (c, m) => statusOf(c, m) === "complete" },
  { value: "attention", label: "Attention", emoji: "🟡", match: (c, m) => statusOf(c, m) === "inProgress" },
  { value: "missed", label: "Missed", emoji: "⚠️", match: (c, m) => statusOf(c, m) === "notStarted" },
  { value: "reminded", label: "Reminded", emoji: "🔔", match: (c, m) => wkReminders(c, m) > 0 },
  { value: "leave", label: "Leave", emoji: "🌙", match: (c, m) => statusOf(c, m) === "leave" },
  { value: "exempt", label: "Exempt", emoji: "🛡️", match: (c, m) => statusOf(c, m) === "exempt" },
  { value: "excused", label: "Excused", emoji: "🔵", match: (c, m) => statusOf(c, m) === "excused" },
];

const STATUS_EMOJI: Record<MemberStatus, string> = {
  complete: "🟢",
  inProgress: "🟡",
  notStarted: "⚠️",
  leave: "🌙",
  exempt: "🛡️",
  excused: "🔵",
};

/* ---------------------------------------------------------------- roster */

/**
 * The managed roster. When a tracking role is configured (the role that is
 * "supposed to earn XP"), the roster is exactly its current holders — so "42
 * members tracked" always matches the role — lazily creating member rows for
 * any holder not seen before. Otherwise it falls back to every tracked member.
 */
async function rosterFor(clan: Clan, guild: Guild | null): Promise<ClanMember[]> {
  const tracked = await listTracked(clan);
  if (!clan.requiredRoleId || !guild) return tracked;

  const identities = await roleMemberIdentities(guild, clan.requiredRoleId);
  if (!identities.length) return tracked;
  const byId = new Map(tracked.map((m) => [m.userId, m]));
  const roster: ClanMember[] = [];
  for (const idn of identities) {
    roster.push(byId.get(idn.userId) ?? (await ensureMember(clan.guildId, idn)));
  }
  return roster.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

interface RosterCounts {
  tracked: number;
  complete: number;
  attention: number;
  missed: number;
  reminded: number;
  leave: number;
  exempt: number;
  excused: number;
}

function countRoster(clan: Clan, members: ClanMember[]): RosterCounts {
  const c: RosterCounts = {
    tracked: members.length,
    complete: 0,
    attention: 0,
    missed: 0,
    reminded: 0,
    leave: 0,
    exempt: 0,
    excused: 0,
  };
  for (const m of members) {
    switch (statusOf(clan, m)) {
      case "complete": c.complete++; break;
      case "inProgress": c.attention++; break;
      case "notStarted": c.missed++; break;
      case "leave": c.leave++; break;
      case "exempt": c.exempt++; break;
      case "excused": c.excused++; break;
    }
    if (wkReminders(clan, m) > 0) c.reminded++;
  }
  return c;
}

/* ---------------------------------------------------------- home payload */

export async function buildManagerHome(
  clan: Clan,
  guild: Guild | null,
  filter: ManagerFilter,
  page: number
): Promise<BaseMessageOptions> {
  const members = await rosterFor(clan, guild);
  const counts = countRoster(clan, members);
  const cat = CATEGORIES.find((c) => c.value === filter) ?? CATEGORIES[0]!;
  const rows = members.filter((m) => cat.match(clan, m));

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  const slice = rows.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  const trackingLabel = clan.requiredRoleId
    ? `<@&${clan.requiredRoleId}>`
    : "all tracked members";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚔️  XP MANAGER — ${clan.clanName}`)
    .setDescription(
      `**${counts.tracked}** members tracked · ${trackingLabel}\n` +
        `Week of **${weekRangeLabel(weekKey(clan))}** · closes ${discordRelative(nextWeeklyReset(clan))}\n\n` +
        `🟢 ${counts.complete} Complete   🟡 ${counts.attention} Attention   ⚠️ ${counts.missed} Missed\n` +
        `🔔 ${counts.reminded} Reminded   🌙 ${counts.leave} Leave   🛡️ ${counts.exempt} Exempt   🔵 ${counts.excused} Excused`
    )
    .addFields({
      name: `${cat.emoji} ${cat.label} — ${rows.length} member(s)${pageCount > 1 ? ` · page ${clamped + 1}/${pageCount}` : ""}`,
      value: slice.length
        ? slice.map((m) => memberRosterLine(clan, m)).join("\n")
        : "_Nobody in this category._",
    })
    .setFooter({ text: "Pick a category tab, then choose a member to manage them." });

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    catRow(filter, ["all", "complete", "attention", "missed"], counts),
    catRow(filter, ["reminded", "leave", "exempt", "excused"], counts),
  ];

  if (slice.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(mgrPick(filter, clamped))
      .setPlaceholder("👤 Select a member to manage…")
      .addOptions(
        slice.map((m) => ({
          label: m.displayName.slice(0, 90) || m.username,
          description: rosterDescription(clan, m).slice(0, 90),
          value: m.userId,
          emoji: STATUS_EMOJI[statusOf(clan, m)],
        }))
      );
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)
    );
  }

  const nav: ButtonBuilder[] = [];
  if (pageCount > 1) {
    nav.push(
      new ButtonBuilder()
        .setCustomId(mgrPage(filter, clamped - 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("◀ Prev")
        .setDisabled(clamped <= 0),
      new ButtonBuilder()
        .setCustomId(mgrPage(filter, clamped + 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Next ▶")
        .setDisabled(clamped >= pageCount - 1)
    );
  }
  const unread = await unreadCount(clan.guildId);
  nav.push(
    new ButtonBuilder()
      .setCustomId(NOTIF_REFRESH)
      .setStyle(unread ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setLabel(`Notifications${unread ? ` (${unread})` : ""}`)
      .setEmoji("🔔"),
    new ButtonBuilder().setCustomId(MGR_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh").setEmoji("🔄")
  );
  components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...nav));

  return { embeds: [embed], components };
}

function catRow(
  active: ManagerFilter,
  values: ManagerFilter[],
  counts: RosterCounts
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const countFor = (v: ManagerFilter): number | null => {
    switch (v) {
      case "all": return counts.tracked;
      case "complete": return counts.complete;
      case "attention": return counts.attention;
      case "missed": return counts.missed;
      case "reminded": return counts.reminded;
      case "leave": return counts.leave;
      case "exempt": return counts.exempt;
      case "excused": return counts.excused;
      default: return null;
    }
  };
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...values.map((v) => {
      const def = CATEGORIES.find((c) => c.value === v)!;
      const n = countFor(v);
      return new ButtonBuilder()
        .setCustomId(mgrCat(v))
        .setStyle(v === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setLabel(`${def.label}${n !== null ? ` (${n})` : ""}`)
        .setEmoji(def.emoji);
    })
  );
}

function rosterDescription(clan: Clan, m: ClanMember): string {
  const status = statusOf(clan, m);
  if (status === "leave" || status === "exempt" || status === "excused") {
    return STATUS_LABEL[status];
  }
  return `${formatProgress(clan, m)} · ${STATUS_LABEL[status]}`;
}

function memberRosterLine(clan: Clan, m: ClanMember): string {
  const status = statusOf(clan, m);
  const meta: string[] = [];
  const rem = wkReminders(clan, m);
  if (rem) meta.push(`🔔${rem}`);
  if (m.warningPoints) meta.push(`⭐${m.warningPoints}`);
  if (m.notes) meta.push("📝");
  const body =
    status === "leave" || status === "exempt" || status === "excused"
      ? STATUS_LABEL[status]
      : `${formatProgress(clan, m)} · ${STATUS_LABEL[status]}`;
  return `${STATUS_EMOJI[status]} <@${m.userId}> — ${body}${meta.length ? `  ${meta.join(" ")}` : ""}`;
}

/* -------------------------------------------------------- member panel */

/** Encode/decode the "return here" roster context on member-panel component ids. */
function memberArg(userId: string, from: string): string {
  return `${userId}~${from}`;
}
function parseMemberArg(arg: string | undefined): { userId: string; from: string } {
  const [userId = "", from = "all-0"] = (arg ?? "").split("~");
  return { userId, from };
}
function parseFrom(from: string): { filter: ManagerFilter; page: number } {
  const sep = from.lastIndexOf("-");
  const filter = (from.slice(0, sep) || "all") as ManagerFilter;
  const page = parseInt(from.slice(sep + 1), 10) || 0;
  return { filter, page };
}

export async function buildMemberPanel(
  clan: Clan,
  guild: Guild,
  userId: string,
  from: string,
  admin: boolean
): Promise<BaseMessageOptions> {
  const member = (await getMember(clan.guildId, userId)) ?? null;
  const gm = await guild.members.fetch(userId).catch(() => null);
  const displayName = gm?.displayName ?? member?.displayName ?? member?.username ?? "Member";
  const avatar = gm?.user.displayAvatarURL({ size: 128 }) ?? member?.avatarUrl ?? undefined;

  const status: MemberStatus = member ? statusOf(clan, member) : "notStarted";
  const activeWarnings = await countActive(clan.guildId, userId);
  const rem = member ? wkReminders(clan, member) : 0;

  const embed = new EmbedBuilder()
    .setColor(
      status === "complete" ? 0x3ba55d : status === "notStarted" ? 0xed4245 : 0xfaa61a
    )
    .setAuthor({ name: `👤 ${displayName}`, iconURL: avatar })
    .setThumbnail(avatar ?? null)
    .addFields(
      { name: "XP", value: member ? formatProgress(clan, member) : "—", inline: true },
      { name: "Status", value: STATUS_LABEL[status], inline: true },
      { name: "​", value: "​", inline: true },
      { name: "Reminders", value: `${rem}`, inline: true },
      { name: "Warnings", value: `${activeWarnings}`, inline: true },
      { name: "Warning Points", value: `${member?.warningPoints ?? 0}`, inline: true }
    );
  if (member?.notes) {
    embed.addFields({ name: "📝 Note", value: member.notes.slice(0, 1024) });
  }

  const arg = (userId2: string) => memberArg(userId2, from);
  const b = (action: string, label: string, emoji: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(mgrMember(action, arg(userId)))
      .setStyle(style)
      .setLabel(label)
      .setEmoji(emoji);

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b("addxp", "Add XP", "➕", ButtonStyle.Success),
      b("remxp", "Remove XP", "➖"),
      b("cal", "Calendar", "📅"),
      b("hist", "History", "📜"),
      b("note", "Note", "📝")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b("remind", "Remind", "🔔"),
      b("warn", "Warn", "⚠️", ButtonStyle.Danger),
      b("remwarn", "Remove Warning", "🧹"),
      b("addwp", "Add WP", "⭐"),
      b("remwp", "Remove WP", "☆")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      statusBtn("complete", "Complete", "🟢", status),
      statusBtn("leave", "On Leave", "🌙", status),
      statusBtn("exempt", "Exempt", "🛡️", status),
      statusBtn("excused", "Excused", "🔵", status),
      statusBtn("reset", "Missed", "⚠️", status)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(mgrMember("back", arg(userId)))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("← Back to roster")
    ),
  ];

  // Encode the roster context on the status buttons too.
  function statusBtn(action: string, label: string, emoji: string, cur: MemberStatus): ButtonBuilder {
    const activeMap: Record<string, MemberStatus> = {
      complete: "complete",
      leave: "leave",
      exempt: "exempt",
      excused: "excused",
    };
    const isActive = activeMap[action] === cur;
    return new ButtonBuilder()
      .setCustomId(mgrMember(action, arg(userId)))
      .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setLabel(label)
      .setEmoji(emoji);
  }

  void admin; // warn button visible to all officers; issuance re-checks admin.
  return { embeds: [embed], components: rows };
}

/* ----------------------------------------------------------- entry point */

async function officerGuard(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  deferred = false
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
    const content = "The XP Manager is officer-only. Members can check their own XP with **/xp**.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/** `/xp manage` (officers) — open the spreadsheet-style manager. */
export async function openManager(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildManagerHome(clan, interaction.guild, "all", 0));
}

/* -------------------------------------------------------------- routing */

export async function handleManagerButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action, arg } = parseId(interaction.customId);

  // Actions that must open a modal cannot defer first.
  if (["addxp", "remxp", "note", "warn"].includes(action)) {
    const clan = await getClan(interaction.guildId);
    if (!clan || !isOfficer(interaction.member, clan)) {
      await interaction.reply({ content: "Officer-only.", flags: 64 });
      return;
    }
    const { userId, from } = parseMemberArg(arg);
    if (action === "warn" && !isAdmin(interaction.member, clan)) {
      await interaction.reply({
        content: "Only admins can issue warnings. Officers can 🔔 Remind instead.",
        flags: 64,
      });
      return;
    }
    return void (await interaction.showModal(memberModal(action, userId, from)));
  }

  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;

  // Home-level: category tabs, paging, refresh.
  if (action === "cat") {
    const filter = (arg ?? "all") as ManagerFilter;
    return void (await interaction.editReply(await buildManagerHome(clan, interaction.guild, filter, 0)));
  }
  if (action === "page" && arg) {
    const { filter, page } = parseFrom(arg);
    return void (await interaction.editReply(await buildManagerHome(clan, interaction.guild, filter, page)));
  }
  if (action === "refresh") {
    return void (await interaction.editReply(await buildManagerHome(clan, interaction.guild, "all", 0)));
  }

  // Member-panel actions carry "<userId>~<filter>-<page>".
  const { userId, from } = parseMemberArg(arg);
  const admin = isAdmin(interaction.member, clan);
  const officer = { id: interaction.user.id, username: interaction.user.username };

  if (action === "back") {
    const { filter, page } = parseFrom(from);
    return void (await interaction.editReply(await buildManagerHome(clan, interaction.guild, filter, page)));
  }

  const identity = await identityFor(clan, interaction.guild, userId);

  switch (action) {
    case "remind": {
      const member = await getMember(clan.guildId, userId);
      const prior = await recentReminder(clan, userId);
      if (!prior) {
        const user = await interaction.client.users.fetch(userId).catch(() => null);
        if (user) {
          await sendReminder({
            client: interaction.client,
            clan,
            target: user,
            member,
            auto: false,
            moderatorId: officer.id,
            moderatorUsername: officer.username,
          });
        }
      }
      break;
    }
    case "remwarn": {
      const warns = await listActive(clan.guildId, userId);
      if (warns.length) {
        return void (await interaction.editReply(await removeWarnPanel(clan, userId, from, warns)));
      }
      break;
    }
    case "addwp":
      await adjustWarningPoints(clan, identity, +1, officer);
      break;
    case "remwp":
      await adjustWarningPoints(clan, identity, -1, officer);
      break;
    case "complete":
      await applyProgress(clan, identity, { kind: "complete" }, officer);
      break;
    case "reset":
      await applyProgress(clan, identity, { kind: "reset" }, officer);
      break;
    case "leave":
      await toggleFlag(clan, identity, "onLeave", userId, officer);
      break;
    case "exempt":
      await toggleFlag(clan, identity, "exempt", userId, officer);
      break;
    case "excused":
      await toggleFlag(clan, identity, "excused", userId, officer);
      break;
    case "cal":
      return void (await sendCalendar(interaction, clan, userId));
    case "hist":
      return void (await sendHistory(interaction, clan, userId));
  }

  await interaction.editReply(await buildMemberPanel(clan, interaction.guild, userId, from, admin));
}

export async function handleManagerSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  const admin = isAdmin(interaction.member, clan);

  if (action === "pick") {
    const userId = interaction.values[0]!;
    const from = arg ?? "all-0";
    return void (await interaction.editReply(await buildMemberPanel(clan, interaction.guild, userId, from, admin)));
  }

  if (action === "removeWarn") {
    const { userId, from } = parseMemberArg(arg);
    const warningId = Number(interaction.values[0]);
    await removeWarning({
      guild: interaction.guild,
      clan,
      warningId,
      moderatorId: interaction.user.id,
      moderatorUsername: interaction.user.username,
    });
    return void (await interaction.editReply(await buildMemberPanel(clan, interaction.guild, userId, from, admin)));
  }
}

export async function handleManagerModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  const { userId, from } = parseMemberArg(arg);
  const admin = isAdmin(interaction.member, clan);
  const officer = { id: interaction.user.id, username: interaction.user.username };
  const identity = await identityFor(clan, interaction.guild, userId);
  const field = (k: string) => {
    try {
      return interaction.fields.getTextInputValue(k);
    } catch {
      return "";
    }
  };

  if (action === "addxpModal" || action === "remxpModal") {
    const amount = parseInt(field("amount").replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(amount) && amount > 0) {
      const dateRaw = field("date").trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && dateRaw <= activityDate(clan)
        ? dateRaw
        : activityDate(clan);
      const signed = action === "remxpModal" ? -amount : amount;
      await recordEntry(clan, identity, { date, amount: signed, mode: "add", note: field("reason").trim() || null }, officer);
    }
  } else if (action === "noteModal") {
    await setMemberNote(clan, identity, field("note"), officer);
  } else if (action === "warnModal") {
    if (admin) {
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (user) {
        const member = await getMember(clan.guildId, userId);
        const reason =
          field("reason").trim() ||
          (member
            ? `Missed the weekly ${clan.activityName} goal (${currentProgress(clan, member).toLocaleString()} / ${effectiveGoal(clan, member).toLocaleString()}).`
            : `Missed the weekly ${clan.activityName} goal.`);
        await issueWarning({
          client: interaction.client,
          clan,
          guild: interaction.guild,
          target: user,
          moderatorId: officer.id,
          moderatorUsername: officer.username,
          reason,
        });
      }
    }
  }

  await interaction.editReply(await buildMemberPanel(clan, interaction.guild, userId, from, admin));
}

/* -------------------------------------------------------------- helpers */

function memberModal(action: string, userId: string, from: string): ModalBuilder {
  const arg = memberArg(userId, from);
  const rowOf = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);

  if (action === "note") {
    return new ModalBuilder()
      .setCustomId(mgrNoteModal(arg))
      .setTitle("Note for member")
      .addComponents(
        rowOf(
          new TextInputBuilder()
            .setCustomId("note")
            .setLabel("Note (they see it once on /xp, then it clears)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500)
        )
      );
  }
  if (action === "warn") {
    return new ModalBuilder()
      .setCustomId(mgrWarnModal(arg))
      .setTitle("Warn member")
      .addComponents(
        rowOf(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Reason (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500)
        )
      );
  }
  // Add XP / Remove XP
  const isRemove = action === "remxp";
  return new ModalBuilder()
    .setCustomId(isRemove ? mgrRemXpModal(arg) : mgrAddXpModal(arg))
    .setTitle(isRemove ? "Remove XP" : "Add XP")
    .addComponents(
      rowOf(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Amount")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. 5")
      ),
      rowOf(
        new TextInputBuilder()
          .setCustomId("date")
          .setLabel("Date (YYYY-MM-DD, blank = today)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("2026-08-04 to backdate")
      ),
      rowOf(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason / note (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200)
      )
    );
}

async function identityFor(clan: Clan, guild: Guild, userId: string): Promise<MemberIdentity> {
  const gm = await guild.members.fetch(userId).catch(() => null);
  if (gm) return identityFromUser(gm.user, gm.displayName);
  const existing = await getMember(clan.guildId, userId);
  return {
    userId,
    username: existing?.username ?? userId,
    displayName: existing?.displayName ?? existing?.username ?? userId,
    avatarUrl: existing?.avatarUrl ?? null,
  };
}

async function toggleFlag(
  clan: Clan,
  identity: MemberIdentity,
  flag: "exempt" | "onLeave" | "excused",
  userId: string,
  officer: { id: string; username: string }
) {
  const member = await getMember(clan.guildId, userId);
  const current = member ? (member[flag] as boolean) : false;
  await setMemberFlag(clan, identity, flag, !current, officer);
}

async function removeWarnPanel(
  clan: Clan,
  userId: string,
  from: string,
  warns: Awaited<ReturnType<typeof listActive>>
): Promise<BaseMessageOptions> {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🧹 Remove a warning")
    .setDescription(
      warns
        .slice(0, 25)
        .map((w) => `**#${w.id}** — ${w.reason.slice(0, 80)} · _by ${w.issuedByUsername}_`)
        .join("\n")
    );
  const select = new StringSelectMenuBuilder()
    .setCustomId(mgrRemoveWarnSelect(memberArg(userId, from)))
    .setPlaceholder("Select the warning to remove…")
    .addOptions(warns.slice(0, 25).map((w) => ({ label: `#${w.id} — ${w.reason.slice(0, 80)}`, value: String(w.id) })));
  const back = new ButtonBuilder()
    .setCustomId(mgrMember("back", memberArg(userId, from)))
    .setStyle(ButtonStyle.Secondary)
    .setLabel("← Back");
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(back),
    ],
  };
}

async function sendCalendar(interaction: ButtonInteraction<"cached">, clan: Clan, userId: string) {
  const member = await getMember(clan.guildId, userId);
  if (!member) {
    await interaction.followUp({ content: "No entries yet for this member.", flags: 64 });
    return;
  }
  const today = activityDate(clan);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const view = await calendarFor(clan, member, year, month);
  const totals = await periodTotals(clan, userId);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const buffer = await renderOffThread("calendarCard", {
    communityName: clan.clanName,
    memberName: member.displayName,
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
  await interaction.followUp({
    content: `📅 **${member.displayName}** — ${view.monthLabel}`,
    files: [new AttachmentBuilder(buffer, { name: `calendar-${userId}.png` })],
    flags: 64,
  });
}

async function sendHistory(interaction: ButtonInteraction<"cached">, clan: Clan, userId: string) {
  const rows = await memberHistory(clan, userId, 10);
  if (!rows.length) {
    await interaction.followUp({ content: "No archived weeks yet — history is written at each weekly reset.", flags: 64 });
    return;
  }
  const lines = rows.map((h) => {
    const flag = h.exempt ? "🛡️" : h.onLeave ? "🌙" : h.completed ? "🟢" : "⚠️";
    return `${flag} **${weekRangeLabel(h.weekKey)}** — ${h.progress.toLocaleString()} / ${h.goal.toLocaleString()}`;
  });
  await interaction.followUp({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📜 Weekly history").setDescription(lines.join("\n"))],
    flags: 64,
  });
}
