import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { AuditLog, Clan } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { auditForUser } from "../services/logging";
import { formatInZone } from "../services/time";
import { audPage, parseId } from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * The XP history / audit viewer. Reads the immutable audit_logs trail for one
 * member and renders it — action, before → after, staff, note, timestamp —
 * with pagination. Historical rows are never destroyed when XP is edited, so
 * this is the durable record; backdated entries are flagged from the log
 * details.
 */

const PAGE_SIZE = 10;

const ACTION_ICON: Record<string, string> = {
  xp_add: "➕",
  xp_set: "✍️",
  xp_remove: "➖",
  xp_complete: "✅",
  xp_uncomplete: "↩️",
  xp_reset: "♻️",
  xp_entry: "📒",
  warning_issued: "⚠️",
  warning_removed: "✅",
  reminder_sent: "🔔",
  exempt_set: "🛡️",
  exempt_cleared: "🛡️",
  onLeave_set: "🌙",
  onLeave_cleared: "🌙",
  note_set: "📝",
  member_note_added: "🗒️",
  goal_override_set: "🎯",
  dispute_created: "⚖️",
  dispute_decided: "⚖️",
  ticket_opened: "🎫",
  ticket_updated: "🎫",
};

const ACTION_LABEL: Record<string, string> = {
  xp_add: "XP added",
  xp_set: "XP set",
  xp_remove: "XP removed",
  xp_complete: "Marked complete",
  xp_uncomplete: "Completion undone",
  xp_reset: "Progress reset",
  xp_entry: "Daily XP logged",
  warning_issued: "Warning issued",
  warning_removed: "Warning removed",
  reminder_sent: "Reminder sent",
  exempt_set: "Marked exempt",
  exempt_cleared: "Exempt cleared",
  onLeave_set: "Marked on leave",
  onLeave_cleared: "Back from leave",
  note_set: "Quick note updated",
  member_note_added: "Staff note added",
  goal_override_set: "Goal override set",
  dispute_created: "Dispute opened",
  dispute_decided: "Dispute decided",
  ticket_opened: "Ticket opened",
  ticket_updated: "Ticket updated",
};

function n(v: unknown): string | null {
  return typeof v === "number" ? v.toLocaleString() : null;
}

/** Render one audit row as a single line with before → after where present. */
function auditLine(clan: Clan, r: AuditLog): string {
  const icon = ACTION_ICON[r.action] ?? "•";
  const label = ACTION_LABEL[r.action] ?? r.action.replace(/_/g, " ");
  const d = (r.details ?? {}) as Record<string, unknown>;
  const parts: string[] = [];

  const before = n(d.before);
  const after = n(d.after);
  if (before !== null && after !== null) parts.push(`${before} → **${after}**`);
  else if (n(d.amount) !== null) parts.push(`${n(d.amount)}`);
  if (n(d.dayTotal) !== null) parts.push(`day ${n(d.dayTotal)}`);
  if (typeof d.date === "string") {
    const backfilled = typeof d.inCurrentWeek === "boolean" && d.inCurrentWeek === false;
    parts.push(`for ${d.date}${backfilled ? " ⏪ backdated" : ""}`);
  }
  if (typeof d.status === "string") parts.push(String(d.status));
  if (typeof d.reason === "string" && d.reason) parts.push(`“${String(d.reason).slice(0, 60)}”`);
  if (typeof d.note === "string" && d.note) parts.push(`note: ${String(d.note).slice(0, 60)}`);

  const meta = parts.length ? ` — ${parts.join(" · ")}` : "";
  const who = r.moderatorUsername ? ` · by ${r.moderatorUsername}` : "";
  return `${icon} **${label}**${meta}${who} · ${formatInZone(r.createdAt, clan)}`;
}

export async function buildAuditPayload(
  clan: Clan,
  userId: string,
  username: string,
  page: number
): Promise<BaseMessageOptions> {
  const { rows, total } = await auditForUser(clan.guildId, userId, PAGE_SIZE, page * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📜 XP history — ${username}`)
    .setDescription(
      rows.length
        ? rows.map((r) => auditLine(clan, r)).join("\n")
        : "_No recorded actions yet._"
    )
    .setFooter({ text: `${total} record(s) · page ${clamped + 1}/${pageCount} · history is never overwritten` });

  const nav = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(audPage(userId, clamped - 1))
      .setLabel("◀ Newer")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clamped <= 0),
    new ButtonBuilder()
      .setCustomId(audPage(userId, clamped + 1))
      .setLabel("Older ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clamped >= pageCount - 1)
  );

  return { embeds: [embed], components: [nav] };
}

/** /xp audit @user — officers (or a member viewing themselves). */
export async function openAudit(interaction: ChatInputCommandInteraction) {
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
  await interaction.editReply(await buildAuditPayload(clan, target.id, target.username, 0));
}

export async function handleAuditButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const { arg } = parseId(interaction.customId);
  const sep = (arg ?? "").lastIndexOf("-");
  const userId = sep >= 0 ? (arg ?? "").slice(0, sep) : (arg ?? "");
  const page = sep >= 0 ? parseInt((arg ?? "").slice(sep + 1), 10) || 0 : 0;
  // Officers see anyone; members only themselves.
  if (userId !== interaction.user.id && !isOfficer(interaction.member, clan)) return;
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  await interaction.editReply(await buildAuditPayload(clan, userId, user?.username ?? "member", page));
}
