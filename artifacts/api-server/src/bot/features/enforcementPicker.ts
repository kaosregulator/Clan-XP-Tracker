import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type Guild,
  type Client,
  type User,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, isAdmin, getMember } from "../services/config";
import {
  issueWarning,
  recentWarning,
  listActive,
  isImmuneFromEnforcement,
  cardAvatarPair,
} from "../services/warnings";
import { sendReminder, recentReminder } from "../services/reminders";
import {
  staffWarningReason,
  memberSafeWarningReason,
  sanitizeMemberReason,
  containsStaffAccounting,
  periodAdjective,
  activityMissedReason,
} from "../services/tracking";
import { statusOf, STATUS_LABEL } from "../services/progress";
import { discordRelative } from "../services/time";
import { renderOffThread } from "../canvas/render-pool";
import {
  ENF_MODE,
  ENF_SELECT,
  ENF_CATEGORY,
  ENF_NOTE,
  ENF_NOTE_MODAL,
  ENF_SEND,
  ENF_CLEAR,
  ENF_FORCE_CONFIRM,
  ENF_FORCE_CANCEL,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import {
  ensureDefaultCategories,
  categoryActivityLabel,
  getCategory,
} from "../services/activity";
import type { PickerMemberView } from "../canvas/cards/enforcementPickerCard";

/**
 * Unified XP enforcement picker — warnings and reminders in one panel.
 *
 * Re-warn / re-remind for the same activity category asks for confirmation
 * (who + when) instead of hard-skipping. Switching categories starts a fresh
 * cooldown. Panel titles lead with the chosen activity name.
 */

type Mode = "warning" | "reminder";

interface PendingRecent {
  userId: string;
  /** Nick (@username) when available, otherwise username. */
  label: string;
  by: string;
  when: string;
}

interface PanelState {
  mode: Mode;
  userIds: string[];
  categoryKey: string;
  note: string | null;
  ownerId: string;
  ts: number;
  pendingRecent: PendingRecent[] | null;
  forceUserIds: string[];
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

function clearForceState(state: PanelState) {
  state.pendingRecent = null;
  state.forceUserIds = [];
}

/** Discord nick (@username) when the nick differs; otherwise the username. */
async function memberLabel(guild: Guild, user: User): Promise<string> {
  const gm = await guild.members.fetch(user.id).catch(() => null);
  const nick = gm?.nickname || gm?.displayName || null;
  if (nick && nick !== user.username) return `${nick} (@${user.username})`;
  return user.username;
}

/** Resolve the selected activity title for panel / member copy. */
async function selectedCategoryTitle(
  guildId: string,
  categoryKey: string
): Promise<{ key: string; label: string; emoji: string }> {
  if (categoryKey === "custom") {
    return { key: "custom", label: "Custom", emoji: "✏️" };
  }
  const cat = await getCategory(guildId, categoryKey);
  if (cat) {
    return {
      key: cat.key,
      label: categoryActivityLabel(cat),
      emoji: cat.emoji || "📁",
    };
  }
  return { key: categoryKey, label: categoryActivityLabel(categoryKey), emoji: "📁" };
}

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
    const discordUrl = user?.displayAvatarURL({ size: 256, extension: "png" }) ?? null;
    const member = await getMember(clan.guildId, userId);
    const faces = cardAvatarPair(member, discordUrl);
    const warnings = (await listActive(clan.guildId, userId)).length;
    let hasRole = false;
    if (warnRoleConfigured) {
      const gm = await guild.members.fetch(userId).catch(() => null);
      hasRole = !!gm && clan.warningRoleIds.some((r) => gm.roles.cache.has(r));
    }
    views.push({
      name,
      avatarUrl: faces.primaryAvatarUrl,
      discordAvatarUrl: faces.discordAvatarUrl,
      robloxAvatarUrl: faces.robloxAvatarUrl,
      warnings,
      hasRole,
      willAddRole: mode === "warning" && warnRoleConfigured && !hasRole,
    });
  }
  return views;
}

function buildConfirmPanel(
  selectedLabel: string,
  state: PanelState
): {
  content: string;
  files: AttachmentBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const verb = state.mode === "warning" ? "warned" : "reminded";
  const actionNoun = state.mode === "warning" ? "warn" : "remind";
  const lines = (state.pendingRecent ?? []).map(
    (p) => `• **${p.label}** — ${verb} by **${p.by}** ${p.when}`
  );
  const content = (
    `⚠️ **Are you sure?** These members were already ${verb} for **${selectedLabel}** recently:\n` +
    `${lines.join("\n")}\n\n` +
    `Confirm to ${actionNoun} them again for this category, or cancel.`
  ).slice(0, 2000);

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ENF_FORCE_CONFIRM)
        .setStyle(state.mode === "warning" ? ButtonStyle.Danger : ButtonStyle.Success)
        .setLabel(state.mode === "warning" ? "Yes, warn again" : "Yes, remind again")
        .setEmoji(state.mode === "warning" ? "⚠️" : "🔔"),
      new ButtonBuilder()
        .setCustomId(ENF_FORCE_CANCEL)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Cancel")
    ),
  ];

  return { content, files: [], components: rows };
}

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
  const selected = await selectedCategoryTitle(clan.guildId, state.categoryKey);

  if (state.pendingRecent?.length) {
    return buildConfirmPanel(selected.label, state);
  }

  const views = await memberViews(client, guild, clan, state.userIds, state.mode);
  const png = await renderOffThread("enforcementPicker", {
    mode: state.mode,
    communityName: clan.clanName,
    members: views,
    warnRoleConfigured: clan.warningRoleIds.length > 0,
    categoryLabel: selected.label,
  });

  const n = state.userIds.length;
  const modeLabel = state.mode === "warning" ? "Warning" : "Reminder";
  const header =
    state.mode === "warning"
      ? `⚠️ **${selected.label}** Warning`
      : `🔔 **${selected.label}** Reminder`;
  const modeNote =
    state.mode === "warning"
      ? "admin-only · recorded with a dispute ticket #"
      : "friendly nudge · never a warning";
  const noteLine = state.note ? `\n📝 **Note:** ${state.note.slice(0, 150)}` : "";

  const select = new UserSelectMenuBuilder()
    .setCustomId(ENF_SELECT)
    .setPlaceholder("Select clan members…")
    .setMinValues(0)
    .setMaxValues(MAX_SELECT);
  if (state.userIds.length) select.setDefaultUsers(state.userIds.slice(0, MAX_SELECT));

  const cats = await ensureDefaultCategories(clan.guildId);
  const catSelect = new StringSelectMenuBuilder()
    .setCustomId(ENF_CATEGORY)
    .setPlaceholder(
      state.mode === "warning"
        ? "Warning category (required activity)…"
        : "Category (optional for reminders)…"
    )
    .addOptions([
      ...cats.slice(0, 24).map((c) => ({
        label: c.name.slice(0, 100),
        value: c.key,
        description: (c.description || "Required activity category").slice(0, 100),
        emoji: c.emoji.length <= 8 ? c.emoji : undefined,
        default: c.key === state.categoryKey,
      })),
      {
        label: "Custom / Other",
        value: "custom",
        description: "Use the note as the reason",
        emoji: "✏️",
        default: state.categoryKey === "custom",
      },
    ]);

  const cat = cats.find((c) => c.key === state.categoryKey);
  const catLine = cat
    ? `\n📂 **Category:** ${cat.emoji} ${cat.name}`
    : state.categoryKey === "custom"
      ? `\n📂 **Category:** Custom`
      : "";

  const content =
    `${header} — pick members, then **Send**.\n` +
    `**Mode:** ${modeLabel}  ·  _${modeNote}_  ·  **Selected:** ${n}\n` +
    "`1` choose members below (many at once)   `2` pick category / add a note   `3` Send" +
    catLine +
    noteLine;

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(catSelect),
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
        .setLabel(state.mode === "warning" ? `Send Warning (${n})` : `Send Reminder (${n})`)
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

  const requested = (interaction.options.getString("mode") ?? "warning").toLowerCase();
  const mode: Mode = requested === "reminder" ? "reminder" : "warning";

  const cats = await ensureDefaultCategories(clan.guildId);
  const defaultCat = cats.find((c) => c.key === "xp") ?? cats[0];
  const state: PanelState = {
    mode,
    userIds: [],
    categoryKey: defaultCat?.key ?? "xp",
    note: null,
    ownerId: interaction.user.id,
    ts: Date.now(),
    pendingRecent: null,
    forceUserIds: [],
  };

  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply(panel);
  const message = await interaction.fetchReply();
  panels.set(message.id, state);
}

function ownsPanel(
  interaction: ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction,
  state: PanelState | null
): boolean {
  return !!state && state.ownerId === interaction.user.id;
}

export async function handleEnforcementSelect(interaction: UserSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const state = getState(interaction.message.id);
  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content:
        "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/xpwarn` again.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  state.userIds = interaction.values
    .filter((id) => !interaction.users.get(id)?.bot)
    .slice(0, MAX_SELECT);
  clearForceState(state);
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({ ...panel, attachments: [] });
}

export async function handleEnforcementCategorySelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const state = getState(interaction.message.id);
  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content:
        "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/xpwarn` again.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const key = interaction.values[0];
  if (key) state.categoryKey = key;
  clearForceState(state);
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({ ...panel, attachments: [] });
}

export async function handleEnforcementButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action } = parseId(interaction.customId);
  const state = getState(interaction.message.id);

  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content:
        "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/xpwarn` again.",
      flags: 64,
    });
    return;
  }

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

  if (action === "forceConfirm") {
    state.forceUserIds = (state.pendingRecent ?? []).map((p) => p.userId);
    state.pendingRecent = null;
    return void (await dispatchSend(interaction, state));
  }

  if (action === "forceCancel") {
    await interaction.deferUpdate();
    const clan = await getClan(interaction.guildId);
    if (!clan) return;
    clearForceState(state);
    state.ts = Date.now();
    const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
    await interaction.editReply({ ...panel, attachments: [] });
    return;
  }

  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;

  if (action === "mode") {
    state.mode = state.mode === "warning" ? "reminder" : "warning";
    clearForceState(state);
  } else if (action === "clear") {
    state.userIds = [];
    clearForceState(state);
  }
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({ ...panel, attachments: [] });
}

export async function handleEnforcementNoteModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild() || !interaction.isFromMessage()) return;
  const state = getState(interaction.message.id);
  if (!state || state.ownerId !== interaction.user.id) {
    await interaction.reply({
      content:
        "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/xpwarn` again.",
      flags: 64,
    });
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
  const categoryKey = state.categoryKey === "custom" ? "custom" : state.categoryKey;
  const selected = await selectedCategoryTitle(clan.guildId, state.categoryKey);
  const categoryLabel = selected.label;
  const forceSet = new Set(state.forceUserIds);

  const needsConfirm: PendingRecent[] = [];
  for (const userId of state.userIds) {
    if (forceSet.has(userId)) continue;
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user || user.bot) continue;

    if (state.mode === "warning") {
      const prior = await recentWarning(clan.guildId, userId, undefined, categoryKey);
      if (prior) {
        needsConfirm.push({
          userId,
          label: await memberLabel(interaction.guild, user),
          by: prior.issuedByUsername || "an officer",
          when: discordRelative(prior.issuedAt),
        });
      }
    } else {
      const prior = await recentReminder(clan, userId, undefined, categoryKey);
      if (prior) {
        const by = prior.auto ? "auto" : prior.sentByUsername || "an officer";
        needsConfirm.push({
          userId,
          label: await memberLabel(interaction.guild, user),
          by,
          when: discordRelative(prior.createdAt),
        });
      }
    }
  }

  if (needsConfirm.length) {
    state.pendingRecent = needsConfirm;
    state.ts = Date.now();
    const panel = buildConfirmPanel(categoryLabel, state);
    await interaction.editReply({
      content: panel.content,
      files: [],
      components: panel.components,
      attachments: [],
    });
    return;
  }

  const results: string[] = [];
  let done = 0;
  let skipped = 0;

  for (const userId of state.userIds) {
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user || user.bot) {
      skipped++;
      continue;
    }
    const label = await memberLabel(interaction.guild, user);
    const member = await getMember(clan.guildId, userId);

    if (state.mode === "reminder") {
      const status = member ? statusOf(clan, member) : "notStarted";
      if (status === "complete" || status === "exempt" || status === "leave") {
        results.push(`⏭️ ${label} — ${STATUS_LABEL[status].toLowerCase()}`);
        skipped++;
        continue;
      }
      const immune = await isImmuneFromEnforcement(interaction.guild, clan, userId, member);
      if (immune.immune) {
        results.push(`🛡️ ${label} — immune (${immune.reason})`);
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
        categoryKey,
        categoryLabel,
      });
      results.push(`${delivered ? "🔔" : "📭"} ${label}`);
      done++;
    } else {
      const immune = await isImmuneFromEnforcement(interaction.guild, clan, userId, member);
      if (immune.immune) {
        results.push(`🛡️ ${label} — immune (${immune.reason})`);
        skipped++;
        continue;
      }
      const reason =
        customNote ||
        (member
          ? staffWarningReason(clan, member)
          : `Missed the ${periodAdjective(clan)} ${clan.activityName} goal.`);
      try {
        const { activeCount } = await issueWarning({
          client: interaction.client,
          clan,
          guild: interaction.guild,
          target: user,
          moderatorId,
          moderatorUsername,
          reason,
          memberReason: customNote
            ? sanitizeMemberReason(customNote)
            : categoryKey !== "custom"
              ? activityMissedReason(categoryLabel)
              : memberSafeWarningReason(clan),
          categoryKey,
          categoryLabel,
        });
        results.push(`⚠️ ${label} — ${activeCount} active`);
        done++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        results.push(`⏭️ ${label} — ${msg}`);
        skipped++;
      }
    }
  }

  const verb = state.mode === "warning" ? "Warned" : "Reminded";
  const summary =
    `✅ **${verb} ${done}** member${done === 1 ? "" : "s"}` +
    (skipped ? ` · skipped ${skipped}` : "") +
    `\n${results.join("\n")}`.slice(0, 1800);

  state.userIds = [];
  state.note = null;
  clearForceState(state);
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({
    content: `${summary}\n\n${panel.content}`.slice(0, 2000),
    files: panel.files,
    components: panel.components,
    attachments: [],
  });
}
