import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type Guild,
  type Client,
  type User,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, isAdmin, getMember, identityFromUser } from "../services/config";
import { issueWarning, recentWarning, listActive } from "../services/warnings";
import { sendReminder, recentReminder } from "../services/reminders";
import {
  staffWarningReason,
  memberSafeWarningReason,
  sanitizeMemberReason,
  containsStaffAccounting,
  periodAdjective,
} from "../services/tracking";
import { statusOf, STATUS_LABEL } from "../services/progress";
import { discordRelative } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";
import {
  ENF_MODE,
  ENF_SELECT,
  ENF_NOTE,
  ENF_NOTE_MODAL,
  ENF_SEND,
  ENF_CLEAR,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import type { PickerMemberView } from "../canvas/cards/enforcementPickerCard";

/**
 * The unified XP enforcement picker — one panel that consolidates the old
 * `/xpwarn` (single) and `/xpremind` flows.
 *
 *   • A clear **mode toggle**: Reminder or Warning (same command handles both).
 *   • A native Discord **multi-user selector** so an officer picks many clan
 *     members in one operation instead of running the command over and over.
 *   • A live **canvas preview** that re-renders on every pick / toggle, showing
 *     who is selected and each member's standing (warnings + warning-role).
 *   • A single **Send** that dispatches the reminder / warning to everyone
 *     selected, reusing the existing sendReminder / issueWarning pipelines so
 *     canvas and embed output stay identical to the single-target commands.
 *
 * Panel state (mode / selection / note) lives in memory keyed by the panel's
 * ephemeral message id. Ephemeral panels are short-lived and single-process, so
 * an in-memory store with a TTL is the right tool — nothing to persist.
 */

type Mode = "warning" | "reminder";

interface PanelState {
  mode: Mode;
  userIds: string[];
  note: string | null;
  ownerId: string;
  ts: number;
}

const PANEL_TTL_MS = 15 * 60_000;
const MAX_SELECT = 10;
const panels = new Map<string, PanelState>();

function prunePanels() {
  const cutoff = Date.now() - PANEL_TTL_MS;
  for (const [key, st] of panels) if (st.ts < cutoff) panels.delete(key);
}

function getState(messageId: string): PanelState | null {
  prunePanels();
  const st = panels.get(messageId);
  if (st) st.ts = Date.now();
  return st ?? null;
}

/* --------------------------------------------------------------- rendering */

/** Build the per-member preview rows (warnings + warning-role standing). */
async function memberViews(
  client: Client,
  guild: Guild,
  clan: Clan,
  userIds: string[],
  mode: Mode
): Promise<PickerMemberView[]> {
  const warnRoleConfigured = clan.warningRoleIds.length > 0;
  const views: PickerMemberView[] = [];
  for (const userId of userIds) {
    const user = await client.users.fetch(userId).catch(() => null);
    const name = user?.username ?? "member";
    const avatarUrl = user?.displayAvatarURL({ size: 256, extension: "png" }) ?? null;
    const warnings = (await listActive(clan.guildId, userId)).length;
    let hasRole = false;
    if (warnRoleConfigured) {
      const gm = await guild.members.fetch(userId).catch(() => null);
      hasRole = !!gm && clan.warningRoleIds.some((r) => gm.roles.cache.has(r));
    }
    views.push({
      name,
      avatarUrl,
      warnings,
      hasRole,
      willAddRole: mode === "warning" && warnRoleConfigured && !hasRole,
    });
  }
  return views;
}

/** Render the panel body (content + preview image + components). */
async function buildPanel(
  client: Client,
  guild: Guild,
  clan: Clan,
  state: PanelState
): Promise<{
  content: string;
  files: AttachmentBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}> {
  const views = await memberViews(client, guild, clan, state.userIds, state.mode);
  const png = await renderOffThread("enforcementPicker", {
    mode: state.mode,
    communityName: clan.clanName,
    members: views,
    warnRoleConfigured: clan.warningRoleIds.length > 0,
  });

  const n = state.userIds.length;
  const modeLabel = state.mode === "warning" ? "Warning" : "Reminder";
  const header = state.mode === "warning" ? "⚠️ **XP Warning**" : "🔔 **XP Reminder**";
  const modeNote =
    state.mode === "warning"
      ? "admin-only · recorded with a dispute ticket #"
      : "friendly nudge · never a warning";
  const noteLine = state.note ? `\n📝 **Note:** ${state.note.slice(0, 150)}` : "";
  const content =
    `${header} — pick members, then **Send**.\n` +
    `**Mode:** ${modeLabel}  ·  _${modeNote}_  ·  **Selected:** ${n}\n` +
    "`1` choose members below (many at once)   `2` switch mode / add a note   `3` Send" +
    noteLine;

  const select = new UserSelectMenuBuilder()
    .setCustomId(ENF_SELECT)
    .setPlaceholder("Select clan members…")
    .setMinValues(0)
    .setMaxValues(MAX_SELECT);
  if (state.userIds.length) select.setDefaultUsers(state.userIds.slice(0, MAX_SELECT));

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ENF_MODE)
        .setStyle(state.mode === "warning" ? ButtonStyle.Danger : ButtonStyle.Primary)
        .setLabel(state.mode === "warning" ? "Switch to Reminder" : "Switch to Warning")
        .setEmoji(state.mode === "warning" ? "🔔" : "⚠️"),
      new ButtonBuilder()
        .setCustomId(ENF_NOTE)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(state.note ? "Edit note" : "Add note")
        .setEmoji("📝"),
      new ButtonBuilder()
        .setCustomId(ENF_CLEAR)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Clear")
        .setDisabled(n === 0)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ENF_SEND)
        .setStyle(state.mode === "warning" ? ButtonStyle.Danger : ButtonStyle.Success)
        .setLabel(
          state.mode === "warning" ? `Send Warning (${n})` : `Send Reminder (${n})`
        )
        .setEmoji(state.mode === "warning" ? "⚠️" : "🔔")
        .setDisabled(n === 0)
    ),
  ];

  return {
    content,
    files: [new AttachmentBuilder(png, { name: "enforcement-preview.png" })],
    components: rows,
  };
}

/* ----------------------------------------------------------------- command */

/** /xpwarn — open the unified warning/reminder picker. */
export async function openEnforcementPicker(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only officers can send XP reminders and warnings.",
    });
    return;
  }

  // /xpwarn opens on Warning by default (its namesake action); officers can
  // switch to Reminder in the panel. An explicit `mode:` option wins.
  const requested = (interaction.options.getString("mode") ?? "warning").toLowerCase();
  const mode: Mode = requested === "reminder" ? "reminder" : "warning";

  const state: PanelState = {
    mode,
    userIds: [],
    note: null,
    ownerId: interaction.user.id,
    ts: Date.now(),
  };

  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  const message = await interaction.editReply(panel);
  panels.set(message.id, state);
}

/* ----------------------------------------------------------------- routing */

/** Ownership guard shared by every panel component. */
function ownsPanel(interaction: ButtonInteraction | UserSelectMenuInteraction, state: PanelState | null): boolean {
  return !!state && state.ownerId === interaction.user.id;
}

/** Native multi-user selection changed → restash and re-render the preview. */
export async function handleEnforcementSelect(interaction: UserSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const state = getState(interaction.message.id);
  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({ content: "This panel isn't yours (or it expired — rerun /xpwarn).", flags: 64 });
    return;
  }
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  // Drop bots — they're never tracked.
  state.userIds = interaction.values.filter((id) => !interaction.users.get(id)?.bot).slice(0, MAX_SELECT);
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({ ...panel, attachments: [] });
}

/** Panel buttons: mode toggle, note, clear, send. */
export async function handleEnforcementButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action } = parseId(interaction.customId);
  const state = getState(interaction.message.id);

  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content: "This panel isn't yours (or it expired — rerun /xpwarn).",
      flags: 64,
    });
    return;
  }

  // The note button opens a modal, which must be the first ack (no defer).
  if (action === "note") {
    const modal = new ModalBuilder().setCustomId(ENF_NOTE_MODAL).setTitle("Optional note");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Message to include (leave blank to clear)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(state.note ?? "")
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "send") return void (await dispatchSend(interaction, state));

  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;

  if (action === "mode") {
    state.mode = state.mode === "warning" ? "reminder" : "warning";
  } else if (action === "clear") {
    state.userIds = [];
  }
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({ ...panel, attachments: [] });
}

/** Note modal submit → store the note and re-render the panel in place. */
export async function handleEnforcementNoteModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild() || !interaction.isFromMessage()) return;
  const state = getState(interaction.message.id);
  if (!state || state.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "This panel isn't yours (or it expired).", flags: 64 });
    return;
  }
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const raw = interaction.fields.getTextInputValue("note").trim();
  state.note = raw || null;
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild!, clan, state);
  await interaction.editReply({ ...panel, attachments: [] });
}

/* ----------------------------------------------------------------- sending */

async function dispatchSend(interaction: ButtonInteraction<"cached">, state: PanelState) {
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply(notConfiguredMessage(false));
    return;
  }
  if (!state.userIds.length) {
    await interaction.reply({ content: "Select at least one member first.", flags: 64 });
    return;
  }
  if (state.mode === "warning" && !isAdmin(interaction.member, clan)) {
    await interaction.reply({
      content: "Only admins can issue warnings. Switch to **Reminder** to send a nudge instead.",
      flags: 64,
    });
    return;
  }

  await interaction.deferUpdate();
  const moderatorId = interaction.user.id;
  const moderatorUsername = interaction.user.username;
  const customNote = state.note && !containsStaffAccounting(state.note) ? state.note : null;

  const results: string[] = [];
  let done = 0;
  let skipped = 0;

  for (const userId of state.userIds) {
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user || user.bot) {
      skipped++;
      continue;
    }
    const member = await getMember(clan.guildId, userId);

    if (state.mode === "reminder") {
      // Skip anyone already at/over their goal, or reminded very recently.
      const status = member ? statusOf(clan, member) : "notStarted";
      if (status === "complete" || status === "exempt" || status === "leave") {
        results.push(`⏭️ ${user.username} — ${STATUS_LABEL[status].toLowerCase()}`);
        skipped++;
        continue;
      }
      if (await recentReminder(clan, userId)) {
        results.push(`🔕 ${user.username} — reminded recently`);
        skipped++;
        continue;
      }
      const { delivered } = await sendReminder({
        client: interaction.client,
        clan,
        target: user,
        member,
        auto: false,
        moderatorId,
        moderatorUsername,
        note: customNote,
      });
      results.push(`${delivered ? "🔔" : "📭"} ${user.username}`);
      done++;
    } else {
      const prior = await recentWarning(clan.guildId, userId);
      if (prior) {
        results.push(`🛑 ${user.username} — already warned ${discordRelative(prior.issuedAt)}`);
        skipped++;
        continue;
      }
      const reason =
        customNote ||
        (member
          ? staffWarningReason(clan, member)
          : `Missed the ${periodAdjective(clan)} ${clan.activityName} goal.`);
      const { activeCount } = await issueWarning({
        client: interaction.client,
        clan,
        guild: interaction.guild,
        target: user,
        moderatorId,
        moderatorUsername,
        reason,
        memberReason: customNote ? sanitizeMemberReason(customNote) : memberSafeWarningReason(clan),
      });
      results.push(`⚠️ ${user.username} — ${activeCount} active`);
      done++;
    }
  }

  const verb = state.mode === "warning" ? "Warned" : "Reminded";
  const summary =
    `✅ **${verb} ${done}** member${done === 1 ? "" : "s"}` +
    (skipped ? ` · skipped ${skipped}` : "") +
    `\n${results.join("\n")}`.slice(0, 1800);

  // Reset the selection so the panel is ready for the next batch, and show the
  // outcome above a refreshed (now-empty) preview.
  state.userIds = [];
  state.note = null;
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({
    content: `${summary}\n\n${panel.content}`.slice(0, 2000),
    files: panel.files,
    components: panel.components,
    attachments: [],
  });
}
