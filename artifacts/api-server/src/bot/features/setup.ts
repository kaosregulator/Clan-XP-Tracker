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
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ModalActionRowComponentBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { ensureClan, updateClan, isAdmin, getClan } from "../services/config";
import { parseHm, weekRangeLabel, weekKey } from "../services/time";
import {
  SETUP_GOAL,
  SETUP_GOAL_MODAL,
  SETUP_MODE,
  SETUP_SCHEDULE,
  SETUP_SCHEDULE_MODAL,
  SETUP_CHANNELS,
  SETUP_ROLES,
  SETUP_NOTIFY,
  SETUP_BACK,
  SETUP_FINISH,
  SETUP_REMINDER_CHANNEL,
  SETUP_WARNING_CHANNEL,
  SETUP_LOG_CHANNEL,
  SETUP_OFFICER_ROLES,
  SETUP_ADMIN_ROLES,
  SETUP_EXEMPT_ROLES,
  SETUP_LEAVE_ROLES,
  setupToggle,
  parseId,
} from "../ui/ids";

/**
 * The configuration hub. Replaces the old static setup embeds: one compact
 * summary plus focused panels (goal, mode, schedule, channels, roles,
 * notifications) reached by buttons, each editing the same message in place.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const TRACKING_MODES = [
  {
    value: "exact",
    label: "Exact progress",
    description: "Numeric progress toward a goal — e.g. 4200 / 5000 XP",
    emoji: "📊",
  },
  {
    value: "complete",
    label: "Complete / Not complete",
    description: "A simple done-or-not flag each week",
    emoji: "✅",
  },
  {
    value: "custom",
    label: "Custom goal",
    description: "Small countable goals — e.g. 8 / 10 activities",
    emoji: "🎯",
  },
] as const;

function modeLabel(clan: Clan): string {
  return TRACKING_MODES.find((m) => m.value === clan.trackingMode)?.label ?? "Exact progress";
}

function goalLine(clan: Clan): string {
  if (clan.trackingMode === "complete") {
    return `Complete the weekly **${clan.activityName}** requirement`;
  }
  return `**${clan.weeklyGoal.toLocaleString()} ${clan.activityName}** per week`;
}

function check(v: unknown): string {
  return v ? "✅" : "⬜";
}

/* ------------------------------------------------------------- main panel */

function summaryEmbed(clan: Clan): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(clan.setupComplete ? 0x3ba55d : 0x5865f2)
    .setTitle(`⚙️ Configuration — ${clan.clanName}`)
    .setDescription(
      `Officers verify XP in **${clan.gameName}** and update the bot. Members never submit anything.\n` +
        `Current week: **${weekRangeLabel(weekKey(clan))}**`
    )
    .addFields(
      {
        name: `${check(clan.weeklyGoal || clan.trackingMode === "complete")} Weekly Requirement`,
        value: `${goalLine(clan)}\nTracking mode: **${modeLabel(clan)}**`,
        inline: false,
      },
      {
        name: `${check(true)} Schedule`,
        value:
          `Week starts **${DAY_NAMES[clan.weekStartDay] ?? "Monday"}** at **${clan.resetTime}** (${clan.timezone})\n` +
          `Auto reset: **${clan.autoWeeklyReset ? "on" : "off"}** · Archive history: **${clan.archiveWeeks ? "on" : "off"}**\n` +
          `Reminders: **${clan.remindersEnabled ? "on" : "OFF"}**` +
          (clan.remindersEnabled
            ? ` — ${clan.reminderDays.map((d) => DAY_NAMES[d]?.slice(0, 3)).filter(Boolean).join(", ") || "no days set"} at ${clan.reminderTimes[0] ?? "not set"}`
            : ""),
        inline: false,
      },
      {
        name: `${check(clan.warningThreshold)} Enforcement`,
        value:
          `Warning after **${clan.warningThreshold}** reminder(s) without hitting the goal\n` +
          `Leadership review at **${clan.escalationThreshold}** active warning(s)`,
        inline: false,
      },
      {
        name: `${check(clan.reminderChannelId || clan.logChannelId)} Channels`,
        value: [
          `Reminders: ${clan.reminderChannelId ? `<#${clan.reminderChannelId}>` : "_DM only_"}`,
          `Warnings: ${clan.warningChannelId ? `<#${clan.warningChannelId}>` : "_not set_"}`,
          `Logs: ${clan.logChannelId ? `<#${clan.logChannelId}>` : "_not set_"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${check(clan.staffRoleIds.length || clan.adminRoleIds.length)} Roles`,
        value: [
          `Officers: ${clan.staffRoleIds.map((r) => `<@&${r}>`).join(" ") || "_server managers only_"}`,
          `Admins: ${clan.adminRoleIds.map((r) => `<@&${r}>`).join(" ") || "_server managers only_"}`,
          `Exempt: ${clan.exemptRoleIds.map((r) => `<@&${r}>`).join(" ") || "_none_"}`,
          `On leave: ${clan.leaveRoleIds.map((r) => `<@&${r}>`).join(" ") || "_none_"}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: clan.setupComplete
        ? "Everything is live — tweak any section anytime."
        : "Set a weekly goal and officer roles, then press Finish.",
    });
}

function mainButtons(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const b = (cid: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(cid).setLabel(label).setStyle(style);
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_GOAL, "Weekly Goal", ButtonStyle.Primary),
      b(SETUP_MODE, "Tracking Mode", ButtonStyle.Primary),
      b(SETUP_SCHEDULE, "Schedule & Enforcement", ButtonStyle.Primary)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_CHANNELS, "Channels"),
      b(SETUP_ROLES, "Roles"),
      b(SETUP_NOTIFY, "Notifications"),
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

/* ------------------------------------------------------------- sub panels */

function modePayload(clan: Clan): BaseMessageOptions {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_MODE)
    .setPlaceholder("Choose how progress is tracked…")
    .addOptions(
      TRACKING_MODES.map((m) => ({
        value: m.value,
        label: m.label,
        description: m.description,
        emoji: m.emoji,
        default: m.value === clan.trackingMode,
      }))
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📊 Tracking Mode")
        .setDescription(
          "**Exact progress** — officers enter numbers, e.g. `4200 / 5000`.\n" +
            "**Complete / Not complete** — a simple weekly checkmark.\n" +
            "**Custom goal** — small countable targets, e.g. `8 / 10` activities.\n\n" +
            `Currently: **${modeLabel(clan)}**`
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
      backRow(),
    ],
  };
}

function channelsPayload(clan: Clan): BaseMessageOptions {
  const menu = (cid: string, placeholder: string, current?: string | null) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(cid)
        .setPlaceholder(placeholder)
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
        .setDefaultChannels(current ? [current] : [])
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📥 Channels")
        .setDescription(
          "**Reminders** — where progress nudges post (also the fallback when a member's DMs are closed).\n" +
            "**Warnings** — where XP enforcement warnings are announced.\n" +
            "**Logs** — the audit trail of every officer action."
        ),
    ],
    components: [
      menu(SETUP_REMINDER_CHANNEL, "Reminder channel", clan.reminderChannelId),
      menu(SETUP_WARNING_CHANNEL, "Warning channel", clan.warningChannelId),
      menu(SETUP_LOG_CHANNEL, "Log channel", clan.logChannelId),
      backRow(),
    ],
  };
}

function rolesPayload(clan: Clan): BaseMessageOptions {
  const menu = (cid: string, placeholder: string, current: string[]) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(cid)
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(5)
        .setDefaultRoles(current)
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🛡️ Roles")
        .setDescription(
          "**Officers** — update progress, remind, warn, run the review.\n" +
            "**Admins** — everything officers can do, plus configuration.\n" +
            "**Exempt / On leave** — members holding these roles are skipped by reminders, warnings and completion-rate math."
        ),
    ],
    components: [
      menu(SETUP_OFFICER_ROLES, "Officer roles", clan.staffRoleIds),
      menu(SETUP_ADMIN_ROLES, "Admin roles", clan.adminRoleIds),
      menu(SETUP_EXEMPT_ROLES, "Exempt roles", clan.exemptRoleIds),
      menu(SETUP_LEAVE_ROLES, "Leave roles", clan.leaveRoleIds),
      backRow(),
    ],
  };
}

const TOGGLES = [
  { key: "remindersEnabled", label: "Auto reminders" },
  { key: "dmReminders", label: "DM reminders" },
  { key: "pingReminders", label: "Ping in channel" },
  { key: "dmOnWarn", label: "DM on warning" },
  { key: "autoWeeklyReset", label: "Auto weekly reset" },
  { key: "archiveWeeks", label: "Archive history" },
] as const;

type ToggleKey = (typeof TOGGLES)[number]["key"];

function notifyPayload(clan: Clan): BaseMessageOptions {
  const buttons = TOGGLES.map((t) =>
    new ButtonBuilder()
      .setCustomId(setupToggle(t.key))
      .setLabel(`${clan[t.key] ? "✅" : "⬜"} ${t.label}`)
      .setStyle(clan[t.key] ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🔔 Notifications & Automation")
        .setDescription(
          "Tap any switch to toggle it.\n\n" +
            "**Auto reminders** — the master switch for scheduled reminders.\n" +
            "**DM reminders** — send nudges by direct message.\n" +
            "**Ping in channel** — mention members in the reminder channel.\n" +
            "**Auto weekly reset** — archive & reset progress at the week boundary.\n" +
            "**Archive history** — keep per-member weekly snapshots for `/xp history`."
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons.slice(0, 3)),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons.slice(3)),
      backRow(),
    ],
  };
}

/* ---------------------------------------------------------------- modals */

function goalModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_GOAL_MODAL)
    .setTitle("Weekly Requirement")
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
          .setLabel("What you track (XP, Activities, Missions…)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.activityName)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("weeklyGoal")
          .setLabel("Weekly goal number")
          .setStyle(TextInputStyle.Short)
          .setValue(String(clan.weeklyGoal))
          .setPlaceholder("e.g. 5000 XP, or 10 activities")
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("gameName")
          .setLabel("Game name")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.gameName)
          .setPlaceholder("e.g. Military Tycoon")
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("gameUrl")
          .setLabel("Game link (optional)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.gameUrl ?? "")
          .setPlaceholder("https://www.roblox.com/games/…")
          .setRequired(false)
      )
    );
}

function scheduleModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_SCHEDULE_MODAL)
    .setTitle("Schedule & Enforcement")
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
          .setCustomId("weekStart")
          .setLabel("Week start day + reset time")
          .setStyle(TextInputStyle.Short)
          .setValue(`${DAY_NAMES[clan.weekStartDay] ?? "Monday"} ${clan.resetTime}`)
          .setPlaceholder("Monday 00:00")
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("reminderDays")
          .setLabel("Reminder days")
          .setStyle(TextInputStyle.Short)
          .setValue(
            clan.reminderDays.map((d) => DAY_NAMES[d]?.slice(0, 3) ?? "").filter(Boolean).join(", ")
          )
          .setPlaceholder("Wed, Fri")
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("reminderTime")
          .setLabel("Reminder time (HH:mm, 24h)")
          .setStyle(TextInputStyle.Short)
          .setValue(clan.reminderTimes[0] ?? "18:00")
          .setRequired(false)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("thresholds")
          .setLabel("Warn after N reminders, escalate at N warns")
          .setStyle(TextInputStyle.Short)
          .setValue(`${clan.warningThreshold}, ${clan.escalationThreshold}`)
          .setPlaceholder("3, 2")
          .setRequired(false)
      )
    );
}

/* -------------------------------------------------------------- handlers */

async function guard(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | StringSelectMenuInteraction,
  deferred = false
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isAdmin(interaction.member, clan)) {
    const content = "Only admins can change configuration.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/** Entry point for /setup. */
export async function openSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "You need the Manage Server permission to run setup.",
      flags: 64,
    });
    return;
  }
  // Defer first — ensureClan hits the DB and can exceed the 3-second window on
  // a cold Postgres connection.
  await interaction.deferReply({ flags: 64 });
  const clan = await ensureClan(interaction.guildId, interaction.guild.name);
  await interaction.editReply(setupMainPayload(clan));
}

export async function handleSetupButton(interaction: ButtonInteraction) {
  const { action, arg } = parseId(interaction.customId);

  // Modals must be the first response — Discord forbids deferring beforehand.
  if (action === "goal" || action === "schedule") {
    const clan = await guard(interaction);
    if (!clan) return;
    return void (await interaction.showModal(
      action === "goal" ? goalModal(clan) : scheduleModal(clan)
    ));
  }

  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;

  switch (action) {
    case "mode":
      return void (await interaction.editReply(modePayload(clan)));
    case "channels":
      return void (await interaction.editReply(channelsPayload(clan)));
    case "roles":
      return void (await interaction.editReply(rolesPayload(clan)));
    case "notify":
      return void (await interaction.editReply(notifyPayload(clan)));
    case "back":
      return void (await interaction.editReply(setupMainPayload(clan)));
    case "toggle": {
      const key = arg as ToggleKey | undefined;
      if (!key || !TOGGLES.some((t) => t.key === key)) return;
      const updated = (await updateClan(clan.guildId, { [key]: !clan[key] })) ?? clan;
      return void (await interaction.editReply(notifyPayload(updated)));
    }
    case "finish": {
      const updated = (await updateClan(clan.guildId, { setupComplete: true })) ?? clan;
      return void (await interaction.editReply(setupMainPayload(updated)));
    }
  }
}

export async function handleSetupModal(interaction: ModalSubmitInteraction) {
  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: 64 });
  const clan = await guard(interaction, true);
  if (!clan) return;
  const { action } = parseId(interaction.customId);
  const f = (k: string) => interaction.fields.getTextInputValue(k);
  const num = (s: string) => parseInt(s.replace(/[^0-9]/g, ""), 10);
  const dayIndexOf = (s: string) => {
    const key = s.trim().slice(0, 3).toLowerCase();
    return key ? DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(key)) : -1;
  };

  let patch: Partial<typeof import("@workspace/db").clansTable.$inferInsert> = {};

  if (action === "goalModal") {
    const goal = num(f("weeklyGoal"));
    const url = f("gameUrl").trim();
    patch = {
      clanName: f("clanName").trim() || clan.clanName,
      activityName: f("activityName").trim() || "XP",
      weeklyGoal: Number.isFinite(goal) && goal > 0 ? goal : clan.weeklyGoal,
      gameName: f("gameName").trim() || clan.gameName,
      gameUrl: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
    };
  } else if (action === "scheduleModal") {
    const [dayPart = "", timePart = ""] = f("weekStart").trim().split(/\s+/);
    const dayIdx = dayIndexOf(dayPart);
    const { hour, minute } = parseHm(timePart || clan.resetTime);
    const days = f("reminderDays").split(",").map(dayIndexOf).filter((i) => i >= 0);
    const rt = parseHm(f("reminderTime") || clan.reminderTimes[0] || "18:00");
    const [warnRaw = "", escRaw = ""] = f("thresholds").split(",");
    const warnN = num(warnRaw);
    const escN = num(escRaw);
    patch = {
      timezone: f("timezone").trim() || "UTC",
      weekStartDay: dayIdx >= 0 ? dayIdx : clan.weekStartDay,
      resetTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      reminderDays: days.length ? days : clan.reminderDays,
      reminderTimes: [`${String(rt.hour).padStart(2, "0")}:${String(rt.minute).padStart(2, "0")}`],
      warningThreshold: Number.isFinite(warnN) && warnN > 0 ? warnN : clan.warningThreshold,
      escalationThreshold: Number.isFinite(escN) && escN > 0 ? escN : clan.escalationThreshold,
    };
  }

  const updated = (await updateClan(clan.guildId, patch)) ?? clan;
  await interaction.editReply(setupMainPayload(updated));
}

export async function handleSetupSelect(
  interaction:
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | StringSelectMenuInteraction
) {
  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;
  const { action } = parseId(interaction.customId);

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    const map: Record<string, keyof typeof import("@workspace/db").clansTable.$inferInsert> = {
      reminderChannel: "reminderChannelId",
      warningChannel: "warningChannelId",
      logChannel: "logChannelId",
    };
    const key = map[action];
    if (key) await updateClan(clan.guildId, { [key]: channelId });
    await interaction.editReply(channelsPayload((await getClan(clan.guildId)) ?? clan));
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    const roleIds = [...interaction.values];
    const map: Record<string, keyof typeof import("@workspace/db").clansTable.$inferInsert> = {
      officerRoles: "staffRoleIds",
      adminRoles: "adminRoleIds",
      exemptRoles: "exemptRoleIds",
      leaveRoles: "leaveRoleIds",
      warnRoles: "warningRoleIds",
    };
    const key = map[action];
    if (key) await updateClan(clan.guildId, { [key]: roleIds });
    await interaction.editReply(rolesPayload((await getClan(clan.guildId)) ?? clan));
    return;
  }

  if (interaction.isStringSelectMenu() && action === "mode") {
    const mode = interaction.values[0] ?? "exact";
    const updated = (await updateClan(clan.guildId, { trackingMode: mode })) ?? clan;
    await interaction.editReply(modePayload(updated));
  }
}
