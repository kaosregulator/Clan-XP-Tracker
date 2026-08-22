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
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type ModalActionRowComponentBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { ensureClan, updateClan, isAdmin, getClan } from "../services/config";
import { parseHm, weekRangeLabel, weekKey } from "../services/time";
import { getTrackingPeriod, periodLabel, periodAdjective } from "../services/tracking";
import { ensureDisputeCategory, disputeStaffRoleIds } from "../services/disputes";
import {
  SETUP_GOAL,
  SETUP_GOAL_MODAL,
  SETUP_MODE,
  SETUP_PERIOD,
  SETUP_SCHEDULE,
  SETUP_SCHEDULE_MODAL,
  SETUP_CHANNELS,
  SETUP_ROLES,
  SETUP_NOTIFY,
  SETUP_WHITELIST,
  SETUP_CARDS,
  SETUP_DISPUTES,
  SETUP_DISPUTE_CATEGORY,
  SETUP_DISPUTE_STAFF_ROLE,
  SETUP_DISPUTE_CREATE_CATEGORY,
  SETUP_BACK,
  SETUP_FINISH,
  SETUP_REMINDER_CHANNEL,
  SETUP_WARNING_CHANNEL,
  SETUP_LOG_CHANNEL,
  SETUP_OFFICER_ROLES,
  SETUP_ADMIN_ROLES,
  SETUP_EXEMPT_ROLES,
  SETUP_LEAVE_ROLES,
  SETUP_WARN_ROLES,
  SETUP_WHITELIST_USERS,
  SETUP_CARD_STYLE,
  SETUP_WARN_REMOVAL,
  SETUP_WARN_REMOVAL_MODAL,
  SETUP_WARN_REMOVAL_CUSTOM,
  setupToggle,
  wizGo,
  parseId,
} from "../ui/ids";
import {
  wizardStepPayload,
  handleWizardButton,
  handleWizardModal,
  handleWizardSelect,
} from "./setupWizard";

/**
 * The configuration hub. Replaces the old static setup embeds: one compact
 * summary plus focused panels (goal, mode, schedule, channels, roles,
 * notifications) reached by buttons, each editing the same message in place.
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
    description: "A simple done-or-not flag each tracking period",
    emoji: "✅",
  },
  {
    value: "custom",
    label: "Custom goal",
    description: "Small countable goals — e.g. 8 / 10 activities",
    emoji: "🎯",
  },
] as const;

export const TRACKING_PERIODS = [
  {
    value: "weekly",
    label: "Weekly",
    description: "One requirement per week (resets on week-start day)",
    emoji: "🗓️",
  },
  {
    value: "daily",
    label: "Daily",
    description: "One requirement per day (resets every day at reset time)",
    emoji: "📆",
  },
] as const;

function modeLabel(clan: Clan): string {
  return TRACKING_MODES.find((m) => m.value === clan.trackingMode)?.label ?? "Exact progress";
}

function periodSetupLabel(clan: Clan): string {
  return TRACKING_PERIODS.find((p) => p.value === clan.trackingPeriod)?.label ?? "Weekly";
}

export const CARD_STYLES = [
  {
    value: "canvas",
    label: "Canvas cards",
    description: "Branded avatar cards (the new look)",
    emoji: "🖼️",
  },
  {
    value: "embed",
    label: "Avatar embed",
    description: "The classic embed with the member's avatar",
    emoji: "📇",
  },
] as const;

function cardStyleLabel(clan: Clan): string {
  return CARD_STYLES.find((c) => c.value === clan.cardStyle)?.label ?? "Canvas cards";
}

/* Warning-role auto-removal presets. Values are hours; 0 = off, -1 = custom.
 * "monthly" uses 720h (a flat 30 days) so the cadence stays predictable. */
export const WARN_REMOVAL_PRESETS = [
  { value: "0", label: "Off — clear only when warnings are gone", emoji: "🚫", hours: 0 },
  { value: "1", label: "Hourly", emoji: "⏱️", hours: 1 },
  { value: "24", label: "Daily", emoji: "📆", hours: 24 },
  { value: "168", label: "Weekly", emoji: "🗓️", hours: 168 },
  { value: "720", label: "Monthly (30 days)", emoji: "📅", hours: 720 },
] as const;

/** Human label for a warning-removal interval in hours (0 = off). */
export function warnRemovalLabel(hours: number): string {
  if (!hours || hours <= 0) return "off";
  const preset = WARN_REMOVAL_PRESETS.find((p) => p.hours === hours);
  if (preset && preset.hours > 0) return preset.label;
  if (hours % 720 === 0) return `every ${hours / 720} month(s)`;
  if (hours % 168 === 0) return `every ${hours / 168} week(s)`;
  if (hours % 24 === 0) return `every ${hours / 24} day(s)`;
  return `every ${hours} hour(s)`;
}

function goalLine(clan: Clan): string {
  const period = periodAdjective(clan);
  if (clan.trackingMode === "complete") {
    return `Complete the ${period} **${clan.activityName}** requirement`;
  }
  if (getTrackingPeriod(clan) === "daily") {
    const goal = clan.dailyTarget > 0 ? clan.dailyTarget : clan.weeklyGoal;
    return `**${goal.toLocaleString()} ${clan.activityName}** per day`;
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
        `Tracking period: **${periodLabel(clan)}**` +
        (getTrackingPeriod(clan) === "weekly"
          ? ` · Current week: **${weekRangeLabel(weekKey(clan))}**`
          : "")
    )
    .addFields(
      {
        name: `${check(clan.weeklyGoal || clan.trackingMode === "complete")} ${periodLabel(clan)} Requirement`,
        value:
          `${goalLine(clan)}\nTracking mode: **${modeLabel(clan)}** · Period: **${periodSetupLabel(clan)}**\n` +
          (getTrackingPeriod(clan) === "weekly"
            ? `Daily calendar target: **${clan.dailyTarget > 0 ? `${clan.dailyTarget.toLocaleString()} ${clan.activityName}/day` : "off"}**`
            : `Daily requirement source: **${clan.dailyTarget > 0 ? "daily target" : "goal amount"}**`),
        inline: false,
      },
      {
        name: `${check(true)} Schedule`,
        value:
          (getTrackingPeriod(clan) === "weekly"
            ? `Week starts **${DAY_NAMES[clan.weekStartDay] ?? "Monday"}** at **${clan.resetTime}** (${clan.timezone})\n`
            : `Resets every day at **${clan.resetTime}** (${clan.timezone})\n`) +
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
          `Leadership review at **${clan.escalationThreshold}** active warning(s)\n` +
          `Warning role auto-removal: **${warnRemovalLabel(clan.warningRemovalHours)}**\n` +
          `Warning/reminder style: **${cardStyleLabel(clan)}**`,
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
        name: `${check(clan.disputeCategoryId)} XP Disputes`,
        value: [
          `Category: ${clan.disputeCategoryId ? `<#${clan.disputeCategoryId}>` : "_not set — /dispute disabled_"}`,
          `Staff role: ${
            clan.disputeStaffRoleId
              ? `<@&${clan.disputeStaffRoleId}>`
              : disputeStaffRoleIds(clan)
                    .map((r) => `<@&${r}>`)
                    .join(" ") || "_officers / admins_"
          }`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `${check(clan.staffRoleIds.length || clan.adminRoleIds.length)} Roles`,
        value: [
          `Officers: ${clan.staffRoleIds.map((r) => `<@&${r}>`).join(" ") || "_server managers only_"}`,
          `Admins: ${clan.adminRoleIds.map((r) => `<@&${r}>`).join(" ") || "_server managers only_"}`,
          `Whitelisted users: ${clan.adminUserIds.map((u) => `<@${u}>`).join(" ") || "_none_"}`,
          `Exempt: ${clan.exemptRoleIds.map((r) => `<@&${r}>`).join(" ") || "_none_"}`,
          `On leave: ${clan.leaveRoleIds.map((r) => `<@&${r}>`).join(" ") || "_none_"}`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: clan.setupComplete
        ? "Everything is live — tweak any section anytime."
        : "Set a requirement, tracking period and officer roles, then press Finish.",
    });
}

function mainButtons(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const b = (cid: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(cid).setLabel(label).setStyle(style);
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_GOAL, "Requirement", ButtonStyle.Primary),
      b(SETUP_PERIOD, "Daily / Weekly", ButtonStyle.Primary),
      b(SETUP_MODE, "Tracking Mode", ButtonStyle.Primary)
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_SCHEDULE, "Schedule & Enforcement", ButtonStyle.Primary),
      b(SETUP_CHANNELS, "Channels"),
      b(SETUP_ROLES, "Roles")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_NOTIFY, "Notifications"),
      b(SETUP_WHITELIST, "Whitelist"),
      b(SETUP_CARDS, "Warnings & Cards")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(SETUP_DISPUTES, "XP Disputes", ButtonStyle.Primary),
      b(SETUP_FINISH, "Finish", ButtonStyle.Success),
      b(wizGo(1), "🧭 Guided setup wizard")
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
            "**Complete / Not complete** — a simple done-or-not checkmark each period.\n" +
            "**Custom goal** — small countable targets, e.g. `8 / 10` activities.\n\n" +
            `Currently: **${modeLabel(clan)}** · Period: **${periodSetupLabel(clan)}**`
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
      backRow(),
    ],
  };
}

function periodPayload(clan: Clan): BaseMessageOptions {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_PERIOD)
    .setPlaceholder("Choose the tracking period…")
    .addOptions(
      TRACKING_PERIODS.map((p) => ({
        value: p.value,
        label: p.label,
        description: p.description,
        emoji: p.emoji,
        default: p.value === (clan.trackingPeriod ?? "weekly"),
      }))
    );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🗓️ Tracking Period")
        .setDescription(
          "**Weekly** — one requirement per week. Resets on the week-start day at reset time.\n" +
            "**Daily** — one requirement per day. Resets every day at reset time.\n\n" +
            "This drives reminders, warnings, progress, auto-role clearance, and resets.\n\n" +
            `Currently: **${periodSetupLabel(clan)}**`
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
      backRow(),
    ],
  };
}

function disputesPayload(clan: Clan): BaseMessageOptions {
  const staffFallback = disputeStaffRoleIds(clan);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⚖️ XP Disputes")
        .setDescription(
          "Members open a **private ticket channel** with **/dispute** and can attach an image " +
            "from their device (Discord's normal upload — **no image URL**).\n\n" +
            "**Category** — where dispute channels are created (kept private from @everyone).\n" +
            "**Staff role** — who can see every dispute channel. When unset, officer/admin roles are used.\n\n" +
            `Category: ${clan.disputeCategoryId ? `<#${clan.disputeCategoryId}>` : "_not set_"}\n` +
            `Staff role: ${
              clan.disputeStaffRoleId
                ? `<@&${clan.disputeStaffRoleId}>`
                : staffFallback.map((r) => `<@&${r}>`).join(" ") || "_officers / admins_"
            }`
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(SETUP_DISPUTE_CATEGORY)
          .setPlaceholder("Pick an existing category…")
          .setChannelTypes(ChannelType.GuildCategory)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(clan.disputeCategoryId ? [clan.disputeCategoryId] : [])
      ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(SETUP_DISPUTE_STAFF_ROLE)
          .setPlaceholder("Dispute staff role…")
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultRoles(clan.disputeStaffRoleId ? [clan.disputeStaffRoleId] : [])
      ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SETUP_DISPUTE_CREATE_CATEGORY)
          .setLabel("Create private XP DISPUTES category")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(SETUP_BACK).setLabel("← Back").setStyle(ButtonStyle.Secondary)
      ),
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
  { key: "autoWeeklyReset", label: "Auto period reset" },
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
            "**DM on warning** — send the warning by direct message too.\n" +
            "**Auto weekly reset** — archive & reset progress at the week boundary.\n" +
            "**Archive history** — keep per-member weekly snapshots for `/xp history`.\n\n" +
            "**Warning role** — assigned automatically whenever a member is warned, " +
            "and removed once they have no active warnings left. Leave empty for none."
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons.slice(0, 3)),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons.slice(3)),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(SETUP_WARN_ROLES)
          .setPlaceholder("Warning role (assigned on warn)")
          .setMinValues(0)
          .setMaxValues(5)
          .setDefaultRoles(clan.warningRoleIds)
      ),
      backRow(),
    ],
  };
}

function whitelistPayload(clan: Clan): BaseMessageOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("✅ Command Whitelist")
        .setDescription(
          "Grant staff/admin command access to specific **people** — on top of your admin roles. " +
            "A whitelisted user can run every admin & officer command (warnings, config, the review, …) " +
            "without needing a role.\n\n" +
            "To whitelist a whole **role** instead, add it as an **Admin role** on the **Roles** page.\n\n" +
            `Currently whitelisted: ${clan.adminUserIds.map((u) => `<@${u}>`).join(" ") || "_none_"}`
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(SETUP_WHITELIST_USERS)
          .setPlaceholder("Whitelisted users (admin command access)")
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultUsers(clan.adminUserIds)
      ),
      backRow(),
    ],
  };
}

function cardsPayload(clan: Clan): BaseMessageOptions {
  const cardStyle = new StringSelectMenuBuilder()
    .setCustomId(SETUP_CARD_STYLE)
    .setPlaceholder("Warning / reminder style…")
    .addOptions(
      CARD_STYLES.map((c) => ({
        value: c.value,
        label: c.label,
        description: c.description,
        emoji: c.emoji,
        default: c.value === clan.cardStyle,
      }))
    );

  // A preset is "selected" only when it exactly matches the stored hours; a
  // custom value shows as a placeholder so the current interval stays visible.
  const removalMatches = WARN_REMOVAL_PRESETS.some((p) => p.hours === clan.warningRemovalHours);
  const removal = new StringSelectMenuBuilder()
    .setCustomId(SETUP_WARN_REMOVAL)
    .setPlaceholder(
      removalMatches
        ? "Warning role auto-removal…"
        : `Custom — ${warnRemovalLabel(clan.warningRemovalHours)}`
    )
    .addOptions(
      WARN_REMOVAL_PRESETS.map((p) => ({
        value: p.value,
        label: p.label,
        emoji: p.emoji,
        default: removalMatches && p.hours === clan.warningRemovalHours,
      }))
    );

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⚠️ Warnings & Cards")
        .setDescription(
          "**Warning / reminder style** — pick what posts to the channel & DM:\n" +
            "• **Canvas cards** — the branded avatar cards.\n" +
            "• **Avatar embed** — the classic embed with the member's avatar.\n\n" +
            "**Warning role auto-removal** — the warning role is auto-assigned once a member " +
            "reaches your warning threshold. Choose when it comes back off:\n" +
            "• **Off** — cleared only when a member has no active warnings left (default).\n" +
            "• **Hourly / Daily / Weekly / Monthly** — warnings expire at that age and the role is stripped.\n" +
            "• **Custom interval…** — enter any number of hours, days, weeks or months.\n\n" +
            `Currently: style **${cardStyleLabel(clan)}** · auto-removal **${warnRemovalLabel(clan.warningRemovalHours)}**`
        ),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(cardStyle),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(removal),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SETUP_WARN_REMOVAL_CUSTOM)
          .setLabel("✏️ Custom interval…")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(SETUP_BACK).setLabel("← Back").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

/* ---------------------------------------------------------------- modals */

function goalModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_GOAL_MODAL)
    .setTitle("Activity Requirement")
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
          .setLabel(
            getTrackingPeriod(clan) === "daily"
              ? "Daily goal (optional , override)"
              : "Weekly goal (optional , daily target)"
          )
          .setStyle(TextInputStyle.Short)
          .setValue(
            getTrackingPeriod(clan) === "daily"
              ? String(clan.dailyTarget > 0 ? clan.dailyTarget : clan.weeklyGoal)
              : clan.dailyTarget > 0
                ? `${clan.weeklyGoal}, ${clan.dailyTarget}`
                : String(clan.weeklyGoal)
          )
          .setPlaceholder(
            getTrackingPeriod(clan) === "daily"
              ? "1  — or  500 for a numeric daily goal"
              : "5000  — or  5000, 500 to set a daily target"
          )
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

function warnRemovalModal(clan: Clan) {
  const row = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(SETUP_WARN_REMOVAL_MODAL)
    .setTitle("Custom warning-role auto-removal")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Number (0 turns it off)")
          .setStyle(TextInputStyle.Short)
          .setValue(String(customAmount(clan.warningRemovalHours)))
          .setPlaceholder("e.g. 3")
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId("unit")
          .setLabel("Unit: hours, days, weeks or months")
          .setStyle(TextInputStyle.Short)
          .setValue(customUnit(clan.warningRemovalHours))
          .setPlaceholder("days")
          .setRequired(true)
      )
    );
}

/** Best-fit whole amount for the modal's pre-fill, paired with customUnit. */
function customAmount(hours: number): number {
  if (!hours || hours <= 0) return 0;
  if (hours % 720 === 0) return hours / 720;
  if (hours % 168 === 0) return hours / 168;
  if (hours % 24 === 0) return hours / 24;
  return hours;
}

/** Best-fit unit for the modal's pre-fill, paired with customAmount. */
function customUnit(hours: number): string {
  if (!hours || hours <= 0) return "days";
  if (hours % 720 === 0) return "months";
  if (hours % 168 === 0) return "weeks";
  if (hours % 24 === 0) return "days";
  return "hours";
}

/** Parse a "number + unit" pair into hours. Returns null when unparseable. */
function parseRemovalHours(amountRaw: string, unitRaw: string): number | null {
  const amount = parseInt(amountRaw.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return 0;
  const unit = unitRaw.trim().toLowerCase();
  const per = unit.startsWith("month")
    ? 720
    : unit.startsWith("week")
      ? 168
      : unit.startsWith("day")
        ? 24
        : unit.startsWith("hour") || unit.startsWith("hr")
          ? 1
          : null;
  if (per === null) return null;
  return amount * per;
}

/* -------------------------------------------------------------- handlers */

async function guard(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | StringSelectMenuInteraction
    | UserSelectMenuInteraction,
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
  // New servers get the linear guided wizard; already-configured servers open
  // the advanced hub for quick edits (the wizard is one button away).
  await interaction.editReply(
    clan.setupComplete ? setupMainPayload(clan) : wizardStepPayload(clan, 1)
  );
}

export async function handleSetupButton(interaction: ButtonInteraction) {
  const { action, arg } = parseId(interaction.customId);

  // Guided-wizard actions ("wiz…") are handled separately; delegate before any
  // defer so the modal-open path can still showModal first.
  if (action.startsWith("wiz")) return void (await handleWizardButton(interaction));

  // Modals must be the first response — Discord forbids deferring beforehand.
  if (action === "goal" || action === "schedule" || action === "warnRemovalCustom") {
    const clan = await guard(interaction);
    if (!clan) return;
    const modal =
      action === "goal"
        ? goalModal(clan)
        : action === "schedule"
          ? scheduleModal(clan)
          : warnRemovalModal(clan);
    return void (await interaction.showModal(modal));
  }

  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;

  switch (action) {
    case "mode":
      return void (await interaction.editReply(modePayload(clan)));
    case "period":
      return void (await interaction.editReply(periodPayload(clan)));
    case "disputes":
      return void (await interaction.editReply(disputesPayload(clan)));
    case "disputeCreateCategory": {
      const botId = interaction.client.user?.id;
      if (!botId) {
        return void (await interaction.editReply({
          content: "Bot user isn't ready — try again.",
          embeds: [],
          components: [],
        }));
      }
      try {
        const { categoryId, created } = await ensureDisputeCategory(
          interaction.guild!,
          clan,
          botId
        );
        const updated =
          (await updateClan(clan.guildId, { disputeCategoryId: categoryId })) ?? clan;
        await interaction.editReply({
          ...disputesPayload(updated),
          content: created
            ? "✅ Created private **XP DISPUTES** category and saved it."
            : "✅ Existing dispute category verified and saved.",
        });
      } catch (err) {
        await interaction.editReply({
          content:
            "⚠️ Couldn't create the category. Make sure the bot has **Manage Channels**.",
          embeds: [],
          components: [backRow()],
        });
      }
      return;
    }
    case "channels":
      return void (await interaction.editReply(channelsPayload(clan)));
    case "roles":
      return void (await interaction.editReply(rolesPayload(clan)));
    case "notify":
      return void (await interaction.editReply(notifyPayload(clan)));
    case "whitelist":
      return void (await interaction.editReply(whitelistPayload(clan)));
    case "cards":
      return void (await interaction.editReply(cardsPayload(clan)));
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
  const parsed = parseId(interaction.customId);
  if (parsed.action.startsWith("wiz")) return void (await handleWizardModal(interaction));
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

  // The custom warning-removal interval re-renders the Warnings & Cards panel,
  // not the main summary, so it's handled on its own path.
  if (action === "warnRemovalModal") {
    const hours = parseRemovalHours(f("amount"), f("unit"));
    if (hours === null) {
      await interaction.editReply({
        embeds: [],
        components: [],
        content:
          "⚠️ Couldn't read that interval. Enter a **number** and a **unit** (hours, days, weeks or months) — e.g. `3` and `days`. Reopen **Warnings & Cards** to try again.",
      });
      return;
    }
    const updated = (await updateClan(clan.guildId, { warningRemovalHours: hours })) ?? clan;
    await interaction.editReply(cardsPayload(updated));
    return;
  }

  let patch: Partial<typeof import("@workspace/db").clansTable.$inferInsert> = {};

  if (action === "goalModal") {
    // Weekly period: "5000" sets weeklyGoal; "5000, 500" also sets dailyTarget.
    // Daily period: the first number is the daily requirement (written to
    // dailyTarget, with weeklyGoal kept in sync as the fallback amount).
    const [weeklyRaw = "", dailyRaw = ""] = f("weeklyGoal").split(",");
    const goal = num(weeklyRaw);
    const daily = num(dailyRaw);
    const url = f("gameUrl").trim();
    if (getTrackingPeriod(clan) === "daily") {
      const amount = Number.isFinite(goal) && goal > 0 ? goal : clan.dailyTarget || clan.weeklyGoal;
      patch = {
        clanName: f("clanName").trim() || clan.clanName,
        activityName: f("activityName").trim() || "XP",
        dailyTarget: amount,
        weeklyGoal: amount,
        gameName: f("gameName").trim() || clan.gameName,
        gameUrl: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
      };
    } else {
      patch = {
        clanName: f("clanName").trim() || clan.clanName,
        activityName: f("activityName").trim() || "XP",
        weeklyGoal: Number.isFinite(goal) && goal > 0 ? goal : clan.weeklyGoal,
        dailyTarget: dailyRaw.trim()
          ? Number.isFinite(daily) && daily >= 0
            ? daily
            : clan.dailyTarget
          : 0,
        gameName: f("gameName").trim() || clan.gameName,
        gameUrl: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
      };
    }
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
    | UserSelectMenuInteraction
) {
  // Guided-wizard selects manage their own defer/guard/persist flow.
  if (parseId(interaction.customId).action.startsWith("wiz")) {
    return void (await handleWizardSelect(interaction as StringSelectMenuInteraction));
  }
  await interaction.deferUpdate();
  const clan = await guard(interaction, true);
  if (!clan) return;
  const { action } = parseId(interaction.customId);

  if (interaction.isUserSelectMenu() && action === "whitelistUsers") {
    // Never whitelist a bot; user-select can technically include the bot user.
    const userIds = interaction.users.filter((u) => !u.bot).map((u) => u.id);
    await updateClan(clan.guildId, { adminUserIds: userIds });
    await interaction.editReply(whitelistPayload((await getClan(clan.guildId)) ?? clan));
    return;
  }

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    if (action === "disputeCategory") {
      await updateClan(clan.guildId, { disputeCategoryId: channelId });
      await interaction.editReply(disputesPayload((await getClan(clan.guildId)) ?? clan));
      return;
    }
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
    if (action === "disputeStaffRole") {
      await updateClan(clan.guildId, {
        disputeStaffRoleId: roleIds[0] ?? null,
      });
      await interaction.editReply(disputesPayload((await getClan(clan.guildId)) ?? clan));
      return;
    }
    const map: Record<string, keyof typeof import("@workspace/db").clansTable.$inferInsert> = {
      officerRoles: "staffRoleIds",
      adminRoles: "adminRoleIds",
      exemptRoles: "exemptRoleIds",
      leaveRoles: "leaveRoleIds",
      warnRoles: "warningRoleIds",
    };
    const key = map[action];
    if (key) await updateClan(clan.guildId, { [key]: roleIds });
    const refreshed = (await getClan(clan.guildId)) ?? clan;
    // The warning-role selector lives on the Notifications page; everything
    // else on the Roles page. Re-render whichever the officer is looking at.
    await interaction.editReply(
      action === "warnRoles" ? notifyPayload(refreshed) : rolesPayload(refreshed)
    );
    return;
  }

  if (interaction.isStringSelectMenu() && action === "mode") {
    const mode = interaction.values[0] ?? "exact";
    const updated = (await updateClan(clan.guildId, { trackingMode: mode })) ?? clan;
    await interaction.editReply(modePayload(updated));
    return;
  }

  if (interaction.isStringSelectMenu() && action === "period") {
    const period = interaction.values[0] === "daily" ? "daily" : "weekly";
    const patch: Partial<typeof import("@workspace/db").clansTable.$inferInsert> = {
      trackingPeriod: period,
    };
    // Daily servers usually want reminders every day; seed all 7 days when
    // switching to daily if the officer hasn't customized a denser schedule.
    if (period === "daily" && clan.reminderDays.length <= 2) {
      patch.reminderDays = [0, 1, 2, 3, 4, 5, 6];
    }
    const updated = (await updateClan(clan.guildId, patch)) ?? clan;
    await interaction.editReply(periodPayload(updated));
    return;
  }

  if (interaction.isStringSelectMenu() && action === "cardStyle") {
    const style = interaction.values[0] === "embed" ? "embed" : "canvas";
    const updated = (await updateClan(clan.guildId, { cardStyle: style })) ?? clan;
    await interaction.editReply(cardsPayload(updated));
    return;
  }

  if (interaction.isStringSelectMenu() && action === "warnRemoval") {
    const hours = parseInt(interaction.values[0] ?? "0", 10);
    const updated =
      (await updateClan(clan.guildId, {
        warningRemovalHours: Number.isFinite(hours) && hours >= 0 ? hours : 0,
      })) ?? clan;
    await interaction.editReply(cardsPayload(updated));
    return;
  }
}
