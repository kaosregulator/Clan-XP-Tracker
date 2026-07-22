import {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ModalActionRowComponentBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { logger } from "../../lib/logger";
import { ensureClan, updateClan, isStaff, getClan } from "../services/config";
import { parseHm } from "../services/time";
import { refreshDashboards } from "./dashboard";
import { refreshTracker } from "./tracker";
import {
  SETUP_IDENTITY,
  SETUP_GAME,
  SETUP_SCHEDULE,
  SETUP_CAPACITY,
  SETUP_CAPACITY_MODAL,
  SETUP_CHANNELS,
  SETUP_ROLES,
  SETUP_CREATE_CHANNELS,
  SETUP_FINISH,
  SETUP_BACK,
  SETUP_IDENTITY_MODAL,
  SETUP_GAME_MODAL,
  SETUP_SCHEDULE_MODAL,
  SETUP_SUB_CHANNEL,
  SETUP_REVIEW_CHANNEL,
  SETUP_LOG_CHANNEL,
  SETUP_STAFF_ROLES,
  SETUP_WARN_ROLES,
  SETUP_DASHBOARDS,
  SETUP_STAFF_DASH,
  SETUP_CLAN_DASH,
  SETUP_PATRIOT_DASH,
  SETUP_TRACKER_CHANNEL,
  SETUP_LEADERBOARD_DASH,
  SETUP_REQUIRED_ROLE,
  parseId,
} from "../ui/ids";

/* ------------------------------------------------------------- rendering */

function check(v: unknown): string {
  return v ? "✅" : "⬜";
}

function summaryEmbed(clan: Clan): EmbedBuilder {
  const channels = clan.submissionChannelId && clan.reviewChannelId;
  return new EmbedBuilder()
    .setColor(clan.setupComplete ? 0x3ba55d : 0x5865f2)
    .setTitle(`🧩 Setup — ${clan.clanName}`)
    .setDescription(
      "Configure your tracker below. Use the buttons for details and the menus to pick channels & roles."
    )
    .addFields(
      {
        name: `${check(clan.clanName)} Identity & Goal`,
        value:
          `Community **${clan.clanName}** · Activity **${clan.activityName}** · Daily goal **${clan.dailyGoal || "—"}**` +
          `\nClan cap: **${clan.clanDailyLimit > 0 ? `${clan.clanDailyLimit.toLocaleString()} ${clan.activityName}` : "none"}** @ **${clan.contributionValue.toLocaleString()}/contribution**` +
          `\nAlt accounts: **${clan.altAccountsEnabled ? (clan.maxAltAccounts ? `max ${clan.maxAltAccounts}` : "unlimited") : "off"}** · Submissions: **${clan.autoApprove ? "auto-approved" : "staff review"}**`,
        inline: false,
      },
      {
        name: `${check(clan.gameUrl)} Game Link`,
        value: `**${clan.gameName}** → ${clan.gameUrl ? `<${clan.gameUrl}>` : "_not set_"}`,
        inline: false,
      },
      {
        name: `${check(true)} Schedule`,
        value:
          `Timezone **${clan.timezone}** · Reset **${clan.resetTime}**` +
          `\nAuto reminders: **${clan.remindersEnabled ? (clan.reminderTimes[0] ? `on @ ${clan.reminderTimes[0]}` : "on (no time set)") : "OFF (safety)"}**` +
          `${clan.reminderTimes.length > 1 ? ` · manual: ${clan.reminderTimes.slice(1).join(", ")}` : ""}`,
        inline: false,
      },
      {
        name: `${check(channels)} Channels`,
        value: [
          `Submissions: ${clan.submissionChannelId ? `<#${clan.submissionChannelId}>` : "_not set_"}`,
          `Review: ${clan.reviewChannelId ? `<#${clan.reviewChannelId}>` : "_not set_"}`,
          `Logs: ${clan.logChannelId ? `<#${clan.logChannelId}>` : "_not set_"}`,
          `Tracker: ${clan.trackerChannelId ? `<#${clan.trackerChannelId}>` : "_not set_"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${check(clan.staffRoleIds.length)} Roles`,
        value: [
          `Staff: ${clan.staffRoleIds.map((r) => `<@&${r}>`).join(" ") || "_admins only_"}`,
          `Warning: ${clan.warningRoleIds.map((r) => `<@&${r}>`).join(" ") || "_none_"}`,
          `Required: ${clan.requiredRoleId ? `<@&${clan.requiredRoleId}>` : "_everyone tracked_"}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: clan.setupComplete
        ? "Setup complete — you can tweak anything anytime."
        : "Set at least the submission & review channels, then press Finish.",
    });
}

function mainButtons(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const b = (cid: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(cid).setLabel(label).setStyle(style);
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_IDENTITY, "Identity & Goal"),
      b(SETUP_GAME, "Game Link"),
      b(SETUP_SCHEDULE, "Schedule"),
      b(SETUP_CAPACITY, "Clan Capacity")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_CHANNELS, "Channels", ButtonStyle.Primary),
      b(SETUP_ROLES, "Roles", ButtonStyle.Primary),
      b(SETUP_DASHBOARDS, "Dashboards", ButtonStyle.Primary)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_CREATE_CHANNELS, "Auto-create channels"),
      b(SETUP_FINISH, "Finish", ButtonStyle.Success)
    ),
  ];
}

export function setupMainPayload(clan: Clan): BaseMessageOptions {
  return { embeds: [summaryEmbed(clan)], components: mainButtons() };
}

function backRow() {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(SETUP_BACK).setLabel("← Back").setStyle(ButtonStyle.Secondary)
  );
}

function channelsPayload(clan: Clan): BaseMessageOptions {
  const menu = (cid: string, placeholder: string, current?: string | null) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(cid)
        .setPlaceholder(placeholder)
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
        .setDefaultChannels(current ? [current] : [])
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📥 Channels")
        .setDescription(
          "**Submissions** — where members post screenshots.\n**Review** — private staff queue.\n**Logs** — audit trail.\n**Tracker** — the live admin progress board."
        ),
    ],
    components: [
      menu(SETUP_SUB_CHANNEL, "Submission channel", clan.submissionChannelId),
      menu(SETUP_REVIEW_CHANNEL, "Review channel", clan.reviewChannelId),
      menu(SETUP_LOG_CHANNEL, "Log channel", clan.logChannelId),
      menu(SETUP_TRACKER_CHANNEL, "Admin tracker channel", clan.trackerChannelId),
      backRow(),
    ],
  };
}

function dashboardsPayload(clan: Clan): BaseMessageOptions {
  const menu = (cid: string, placeholder: string, current?: string | null) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(cid)
        .setPlaceholder(placeholder)
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
        .setDefaultChannels(current ? [current] : [])
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📊 Dashboards")
        .setDescription(
          "Auto-updating canvas boards that live in their channel (refreshed every few minutes).\n**Clan** — public progress & top streaks.\n**Leaderboard** — public streak ranking.\n**Staff** — private operations board.\n**Patriot** — alt-account board (optional).\n_(The admin Tracker channel is on the Channels page.)_"
        ),
    ],
    components: [
      menu(SETUP_CLAN_DASH, "Clan (public) dashboard channel", clan.clanDashboardChannelId),
      menu(SETUP_LEADERBOARD_DASH, "Leaderboard channel", clan.leaderboardChannelId),
      menu(SETUP_STAFF_DASH, "Staff dashboard channel", clan.staffDashboardChannelId),
      menu(SETUP_PATRIOT_DASH, "Patriot dashboard channel", clan.patriotDashboardChannelId),
      backRow(),
    ],
  };
}

function rolesPayload(clan: Clan): BaseMessageOptions {
  const menu = (cid: string, placeholder: string, current: string[], max = 5) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(cid)
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(max)
        .setDefaultRoles(current)
    );
  const singleRole = (cid: string, placeholder: string, current?: string | null) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(cid)
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(1)
        .setDefaultRoles(current ? [current] : [])
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🛡️ Roles")
        .setDescription(
          "**Staff** — can review & use /xpadmin.\n**Warning** — auto-assigned on warn.\n**Required** — members who must submit (the tracker's denominator)."
        ),
    ],
    components: [
      menu(SETUP_STAFF_ROLES, "Staff roles", clan.staffRoleIds),
      menu(SETUP_WARN_ROLES, "Warning roles", clan.warningRoleIds),
      singleRole(SETUP_REQUIRED_ROLE, "Required role (must submit)", clan.requiredRoleId),
      backRow(),
    ],
  };
}

/* --------------------------------------------------------------- modals */

function identityModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_IDENTITY_MODAL)
    .setTitle("Identity & Goal")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("clanName")
          .setLabel("Community name")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.clanName)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("activityName")
          .setLabel("Activity name (XP, Attendance, Missions…)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.activityName)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("dailyGoal")
          .setLabel("Daily goal number (0 = just submit daily)")
          .setStyle(TextInputStyle.Short)
          .setValue(String(clan.dailyGoal))
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("altAccounts")
          .setLabel("Alt accounts (blank=off, 0=unlimited, N=max)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.altAccountsEnabled ? String(clan.maxAltAccounts ?? 0) : "")
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("autoApprove")
          .setLabel("Auto-approve? yes = instant, no = staff review")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.autoApprove ? "yes" : "no")
          .setRequired(false)
      )
    );
}

function gameModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_GAME_MODAL)
    .setTitle("Game Link")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("gameName")
          .setLabel("Game name")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.gameName)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("gameUrl")
          .setLabel("Game / clan link (the Open button opens this)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.gameUrl ?? "")
          .setPlaceholder("https://www.roblox.com/games/…")
          .setRequired(false)
      )
    );
}

function capacityModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_CAPACITY_MODAL)
    .setTitle("Clan Capacity")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("clanDailyLimit")
          .setLabel("Daily clan XP limit (0 = no cap)")
          .setStyle(TextInputStyle.Short)
          .setValue(String(clan.clanDailyLimit))
          .setPlaceholder("e.g. 112500")
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("contributionValue")
          .setLabel("XP per contribution (each member & alt)")
          .setStyle(TextInputStyle.Short)
          .setValue(String(clan.contributionValue))
          .setPlaceholder("e.g. 1500")
          .setRequired(false)
      )
    );
}

function scheduleModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_SCHEDULE_MODAL)
    .setTitle("Schedule")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("timezone")
          .setLabel("Timezone (IANA, e.g. America/New_York)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.timezone)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("resetTime")
          .setLabel("Daily reset time (HH:mm, 24h)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.resetTime)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("reminderTimes")
          .setLabel("Reminder times (1st is auto, rest manual)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.reminderTimes.join(", "))
          .setPlaceholder("22:00  (extra times = staff Remind button)")
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("remindersEnabled")
          .setLabel("Auto reminders on? (yes / no safety switch)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.remindersEnabled ? "yes" : "no")
          .setRequired(false)
      )
    );
}

/* ------------------------------------------------------------- handlers */

async function guard(
  interaction: ButtonInteraction | ModalSubmitInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "Only staff can change setup.", flags: 64 });
    return null;
  }
  return clan;
}

/** Entry point for the /setup command. */
export async function openSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need the Manage Server permission to run setup.", flags: 64 });
    return;
  }
  const clan = await ensureClan(interaction.guildId, interaction.guild.name);
  await interaction.reply({ ...setupMainPayload(clan), flags: 64 });
}

export async function handleSetupButton(interaction: ButtonInteraction) {
  const clan = await guard(interaction);
  if (!clan) return;
  const { action } = parseId(interaction.customId);

  switch (action) {
    case "identity":
      return interaction.showModal(identityModal(clan));
    case "game":
      return interaction.showModal(gameModal(clan));
    case "schedule":
      return interaction.showModal(scheduleModal(clan));
    case "capacity":
      return interaction.showModal(capacityModal(clan));
    case "channels":
      return interaction.update(channelsPayload(clan));
    case "roles":
      return interaction.update(rolesPayload(clan));
    case "dashboards":
      return interaction.update(dashboardsPayload(clan));
    case "back":
      return interaction.update(setupMainPayload(clan));
    case "createChannels":
      return autoCreateChannels(interaction, clan);
    case "finish":
      return finishSetup(interaction, clan);
    default:
      return;
  }
}

export async function handleSetupModal(interaction: ModalSubmitInteraction) {
  const clan = await guard(interaction);
  if (!clan) return;
  const { action } = parseId(interaction.customId);
  const f = (k: string) => interaction.fields.getTextInputValue(k);

  let patch: Partial<typeof import("@workspace/db").clansTable.$inferInsert> = {};
  if (action === "identityModal") {
    const goal = parseInt(f("dailyGoal").replace(/[^0-9]/g, ""), 10);
    const altRaw = f("altAccounts").trim();
    const altEnabled = altRaw !== "";
    const altMax = altEnabled ? parseInt(altRaw.replace(/[^0-9]/g, ""), 10) || 0 : 0;
    const autoRaw = f("autoApprove").trim().toLowerCase();
    const autoApprove = !(autoRaw === "no" || autoRaw === "n" || autoRaw === "false" || autoRaw === "review");
    patch = {
      clanName: f("clanName").trim() || clan.clanName,
      activityName: f("activityName").trim() || "XP",
      dailyGoal: Number.isFinite(goal) ? goal : 0,
      altAccountsEnabled: altEnabled,
      maxAltAccounts: altEnabled && altMax > 0 ? altMax : null,
      autoApprove,
    };
  } else if (action === "capacityModal") {
    const limit = parseInt(f("clanDailyLimit").replace(/[^0-9]/g, ""), 10);
    const value = parseInt(f("contributionValue").replace(/[^0-9]/g, ""), 10);
    patch = {
      clanDailyLimit: Number.isFinite(limit) ? limit : 0,
      contributionValue: Number.isFinite(value) && value > 0 ? value : 1500,
    };
  } else if (action === "gameModal") {
    const url = f("gameUrl").trim();
    patch = {
      gameName: f("gameName").trim() || "Roblox",
      gameUrl: url ? normalizeUrl(url) : null,
    };
  } else if (action === "scheduleModal") {
    const reminders = f("reminderTimes")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const { hour, minute } = parseHm(s);
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      });
    const { hour, minute } = parseHm(f("resetTime"));
    const remRaw = f("remindersEnabled").trim().toLowerCase();
    const remindersEnabled = !(remRaw === "no" || remRaw === "n" || remRaw === "off" || remRaw === "false");
    patch = {
      timezone: f("timezone").trim() || "UTC",
      resetTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      reminderTimes: reminders,
      remindersEnabled,
    };
  }

  const updated = (await updateClan(clan.guildId, patch)) ?? clan;
  // Modals opened from the wizard message can update it in place; otherwise reply.
  if (interaction.isFromMessage()) {
    await interaction.update(setupMainPayload(updated));
  } else {
    await interaction.reply({ ...setupMainPayload(updated), flags: 64 });
  }
}

export async function handleSetupSelect(
  interaction: ChannelSelectMenuInteraction | RoleSelectMenuInteraction
) {
  const clan = await guard(interaction);
  if (!clan) return;
  const { action } = parseId(interaction.customId);

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    const map: Record<string, keyof typeof import("@workspace/db").clansTable.$inferInsert> = {
      subChannel: "submissionChannelId",
      reviewChannel: "reviewChannelId",
      logChannel: "logChannelId",
      trackerChannel: "trackerChannelId",
      staffDash: "staffDashboardChannelId",
      clanDash: "clanDashboardChannelId",
      patriotDash: "patriotDashboardChannelId",
      leaderboardDash: "leaderboardChannelId",
    };
    const key = map[action];
    if (key) await updateClan(clan.guildId, { [key]: channelId });
    const fresh = (await getClan(clan.guildId)) ?? clan;
    const dashActions = ["staffDash", "clanDash", "patriotDash", "leaderboardDash"];
    await interaction.update(dashActions.includes(action) ? dashboardsPayload(fresh) : channelsPayload(fresh));
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    const roleIds = [...interaction.values];
    if (action === "staffRoles") await updateClan(clan.guildId, { staffRoleIds: roleIds });
    if (action === "warnRoles") await updateClan(clan.guildId, { warningRoleIds: roleIds });
    if (action === "requiredRole") await updateClan(clan.guildId, { requiredRoleId: roleIds[0] ?? null });
    const fresh = (await getClan(clan.guildId)) ?? clan;
    await interaction.update(rolesPayload(fresh));
  }
}

async function finishSetup(interaction: ButtonInteraction, clan: Clan) {
  // A submission channel is always needed. A review channel is only needed
  // when submissions require staff review (auto-approve doesn't use one).
  if (!clan.submissionChannelId) {
    await interaction.reply({
      content: "Please set at least a **Submission** channel first (Channels button).",
      flags: 64,
    });
    return;
  }
  if (!clan.autoApprove && !clan.reviewChannelId) {
    await interaction.reply({
      content: "Staff review is on, so please also set a **Review** channel (Channels button) — or switch to auto-approve in Identity & Goal.",
      flags: 64,
    });
    return;
  }
  const updated = (await updateClan(clan.guildId, { setupComplete: true })) ?? clan;
  await interaction.update(setupMainPayload(updated));
  // Post the configured dashboards + tracker right away so they appear now
  // instead of on the next scheduler cycle.
  void refreshDashboards(interaction.client, updated);
  void refreshTracker(interaction.client, updated);
}

async function autoCreateChannels(interaction: ButtonInteraction, clan: Clan) {
  if (!interaction.inCachedGuild()) return;
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: "I need the **Manage Channels** permission to create channels.",
      flags: 64,
    });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  try {
    const category = await interaction.guild.channels.create({
      name: `${clan.activityName || "XP"} Tracker`,
      type: ChannelType.GuildCategory,
    });
    const staffOverwrites = clan.staffRoleIds.map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel],
    }));
    const mk = (name: string, staffOnly = false) =>
      interaction.guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: staffOnly
          ? [
              { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
              ...staffOverwrites,
            ]
          : undefined,
      });

    const submissions = await mk("submissions");
    const review = await mk("review-queue", true);
    const logs = await mk("logs", true);
    const tracker = await mk("xp-tracker", true);

    const updated =
      (await updateClan(clan.guildId, {
        submissionChannelId: submissions.id,
        reviewChannelId: review.id,
        logChannelId: logs.id,
        trackerChannelId: tracker.id,
      })) ?? clan;

    await interaction.editReply({
      content: `✅ Created ${submissions}, ${review}, ${logs} and ${tracker}. Reopen /setup to see the summary.`,
    });
    // Also refresh the original wizard message if possible.
    await interaction.message?.edit(setupMainPayload(updated)).catch(() => {});
  } catch (err) {
    logger.error({ err }, "Failed to auto-create channels");
    await interaction.editReply("Something went wrong creating channels. Check my permissions and try again.");
  }
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
