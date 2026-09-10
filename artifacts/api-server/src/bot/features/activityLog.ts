/**
 * Staff Activity Log — multi-member picker + category + points.
 *
 * Officers pick several members once, choose a saved activity category
 * (Combat Support, Communication, Events, …), enter points, and submit.
 * The bot never auto-guesses Combat Support from chat — staff records it.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type Guild,
  type Client,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, identityFromUser } from "../services/config";
import {
  ensureDefaultCategories,
  getCategory,
  logActivityForMember,
} from "../services/activity";
import {
  ACT_SELECT,
  ACT_CATEGORY,
  ACT_POINTS,
  ACT_POINTS_MODAL,
  ACT_CLEAR,
  ACT_SUBMIT,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

interface PanelState {
  userIds: string[];
  categoryKey: string;
  points: number;
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

async function buildPanel(
  _client: Client,
  _guild: Guild,
  clan: Clan,
  state: PanelState
): Promise<{
  content: string;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}> {
  const cats = await ensureDefaultCategories(clan.guildId);
  const cat = cats.find((c) => c.key === state.categoryKey) ?? cats[0] ?? null;
  if (cat && state.categoryKey !== cat.key) state.categoryKey = cat.key;

  const n = state.userIds.length;
  const membersLine = n
    ? `**Members:** ${n} selected`
    : "**Members:** _(none selected)_";
  const catLine = cat
    ? `**Category:** ${cat.emoji} ${cat.name}`
    : "**Category:** _(pick one)_";
  const content =
    `📋 **Log Activity** — pick members, category, points, then **Submit**.\n` +
    `${membersLine}\n` +
    `${catLine}  ·  **Points:** ${state.points}\n` +
    `_Staff-logged only — the bot does not guess Combat Support from chat._`;

  const select = new UserSelectMenuBuilder()
    .setCustomId(ACT_SELECT)
    .setPlaceholder("Select clan members…")
    .setMinValues(0)
    .setMaxValues(MAX_SELECT);
  if (state.userIds.length) select.setDefaultUsers(state.userIds.slice(0, MAX_SELECT));

  const catSelect = new StringSelectMenuBuilder()
    .setCustomId(ACT_CATEGORY)
    .setPlaceholder("Activity category…")
    .addOptions(
      cats.slice(0, 25).map((c) => ({
        label: c.name.slice(0, 100),
        value: c.key,
        description: (c.description || `Default ${c.defaultPoints} pts`).slice(0, 100),
        emoji: c.emoji.length <= 8 ? c.emoji : undefined,
        default: c.key === state.categoryKey,
      }))
    );

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(catSelect),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ACT_POINTS)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(`Points: ${state.points}`)
        .setEmoji("🔢"),
      new ButtonBuilder()
        .setCustomId(ACT_CLEAR)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Clear")
        .setDisabled(n === 0),
      new ButtonBuilder()
        .setCustomId(ACT_SUBMIT)
        .setStyle(ButtonStyle.Success)
        .setLabel(`Submit (${n})`)
        .setEmoji("✅")
        .setDisabled(n === 0 || !cat)
    ),
  ];

  return { content, components: rows };
}

/** /activity — open the staff multi-member activity log panel. */
export async function openActivityLog(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can log activity." });
    return;
  }

  const cats = await ensureDefaultCategories(clan.guildId);
  const defaultCat = cats.find((c) => c.key === "combat_support") ?? cats[0];
  const state: PanelState = {
    userIds: [],
    categoryKey: defaultCat?.key ?? "combat_support",
    points: defaultCat?.defaultPoints ?? 10,
    ownerId: interaction.user.id,
    ts: Date.now(),
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

export async function handleActivityUserSelect(interaction: UserSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const state = getState(interaction.message.id);
  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content: "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/activity` again.",
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
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply(panel);
}

export async function handleActivityCategorySelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const state = getState(interaction.message.id);
  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content: "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/activity` again.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const key = interaction.values[0];
  if (!key) return;
  state.categoryKey = key;
  const cat = await getCategory(clan.guildId, key);
  if (cat) state.points = cat.defaultPoints;
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply(panel);
}

export async function handleActivityButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action } = parseId(interaction.customId);
  const state = getState(interaction.message.id);

  if (!ownsPanel(interaction, state) || !state) {
    await interaction.reply({
      content: "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/activity` again.",
      flags: 64,
    });
    return;
  }

  if (action === "points") {
    const modal = new ModalBuilder().setCustomId(ACT_POINTS_MODAL).setTitle("Activity points");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("points")
          .setLabel("Points / value to award each member")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6)
          .setValue(String(state.points))
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "submit") return void (await dispatchSubmit(interaction, state));

  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  if (action === "clear") state.userIds = [];
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply(panel);
}

export async function handleActivityPointsModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild() || !interaction.isFromMessage()) return;
  const state = getState(interaction.message.id);
  if (!state || state.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "This panel session expired or isn't yours. If you opened it, the bot likely refreshed — run `/activity` again.", flags: 64 });
    return;
  }
  await interaction.deferUpdate();
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const raw = interaction.fields.getTextInputValue("points").trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) state.points = Math.min(1_000_000, parsed);
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild!, clan, state);
  await interaction.editReply(panel);
}

async function dispatchSubmit(interaction: ButtonInteraction<"cached">, state: PanelState) {
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply(notConfiguredMessage(false));
    return;
  }
  if (!state.userIds.length) {
    await interaction.reply({ content: "Select at least one member first.", flags: 64 });
    return;
  }

  await interaction.deferUpdate();
  const cat = await getCategory(clan.guildId, state.categoryKey);
  if (!cat) {
    await interaction.followUp({ content: "Pick a valid activity category first.", flags: 64 });
    return;
  }

  const officer = { id: interaction.user.id, username: interaction.user.username };
  const results: string[] = [];
  let done = 0;
  let skipped = 0;

  for (const userId of state.userIds) {
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user || user.bot) {
      skipped++;
      continue;
    }
    await logActivityForMember({
      clan,
      identity: identityFromUser(user),
      category: cat,
      points: state.points,
      officer,
    });
    results.push(`✅ ${user.username} — ${cat.emoji} ${cat.name} +${state.points}`);
    done++;
  }

  const summary =
    `✅ **Logged activity for ${done}** member${done === 1 ? "" : "s"}` +
    ` · ${cat.emoji} **${cat.name}** · **${state.points}** pts` +
    (skipped ? ` · skipped ${skipped}` : "") +
    `\n${results.join("\n")}`.slice(0, 1800);

  state.userIds = [];
  state.ts = Date.now();
  const panel = await buildPanel(interaction.client, interaction.guild, clan, state);
  await interaction.editReply({
    content: `${summary}\n\n${panel.content}`.slice(0, 2000),
    components: panel.components,
  });
}
