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
  type BaseMessageOptions,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ModalActionRowComponentBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, updateClan, isAdmin } from "../services/config";
import { parseHm } from "../services/time";
import { syncTrackedRoleMembers } from "../services/progress";
import {
  parseId,
  wizGo,
  wizEdit,
  wizModal,
  wizToggle,
  wizSel,
  wizCreateTrackRole,
  WIZ_FINISH,
  WIZ_CANCEL,
  WIZ_HUB,
} from "../ui/ids";
import { TRACKING_MODES, DAY_NAMES, setupMainPayload } from "./setup";

/**
 * The guided Setup Wizard: a single message that walks an admin through the
 * server configuration one step at a time, with a progress indicator, Back /
 * Next / Cancel navigation and a validated Review → Activate finish. It writes
 * to the same `clans` row the configuration hub edits, so nothing here needs a
 * new table and both entry points stay in sync.
 */

const TOTAL = 11;
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]): Row =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

const STEP_TITLES: Record<number, string> = {
  1: "Community & activity",
  2: "How progress is tracked",
  3: "Activity goal",
  4: "Schedule",
  5: "Activity track role",
  6: "Officer & admin roles",
  7: "Exempt & leave roles",
  8: "Channels",
  9: "Reminders",
  10: "Enforcement",
  11: "Review & activate",
};

function clampStep(n: number): number {
  return Math.min(TOTAL, Math.max(1, n));
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function daysLabel(days: number[]): string {
  return days.map((d) => DAY_NAMES[d]?.slice(0, 3)).filter(Boolean).join(", ") || "none";
}

/* --------------------------------------------------------------- validation */

interface Validation {
  errors: string[]; // block Activate
  warnings: string[]; // soft advisories
}

function validate(clan: Clan): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!clan.clanName.trim()) errors.push("**Community name** is empty (Step 1).");
  if (!clan.activityName.trim()) errors.push("**Activity name** is empty (Step 1).");
  if (clan.trackingMode !== "complete" && clan.weeklyGoal <= 0) {
    errors.push("**Activity goal** must be greater than 0 for this tracking mode (Step 3).");
  }
  if (!isValidTimezone(clan.timezone)) errors.push(`**Timezone** \`${clan.timezone}\` isn't valid (Step 4).`);
  if (clan.remindersEnabled) {
    if (!clan.reminderTimes[0]) errors.push("**Reminders are on** but no reminder time is set (Step 9).");
    if (!clan.reminderDays.length) errors.push("**Reminders are on** but no reminder days are chosen (Step 9).");
  }

  if (!clan.requiredRoleId) {
    warnings.push("No activity track role — leaderboard includes every linked member until you pick one (Step 5).");
  }
  if (!clan.staffRoleIds.length && !clan.adminRoleIds.length) {
    warnings.push("No officer/admin roles chosen — only members with Manage Server can operate the bot (Step 6).");
  }
  if (!clan.warningChannelId) {
    warnings.push("No warning channel — warnings won't post publicly (Step 8).");
  }
  if (clan.remindersEnabled && !clan.dmReminders && !clan.reminderChannelId) {
    warnings.push("Reminders are on with DMs off and no reminder channel — they can't be delivered (Step 8/9).");
  }
  return { errors, warnings };
}

/* ------------------------------------------------------------------ header */

function header(step: number, clan: Clan): EmbedBuilder {
  const dots = "●".repeat(step) + "○".repeat(TOTAL - step);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `🧭 Guided Setup — ${clan.clanName}` })
    .setTitle(`Step ${step}/${TOTAL} · ${STEP_TITLES[step]}`)
    .setDescription(`\`${dots}\``);
}

function navRow(step: number): Row {
  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(wizGo(step - 1)).setLabel("← Back").setStyle(ButtonStyle.Secondary).setDisabled(step <= 1),
  ];
  if (step < TOTAL) {
    buttons.push(
      new ButtonBuilder().setCustomId(wizGo(step + 1)).setLabel("Next →").setStyle(ButtonStyle.Primary)
    );
  } else {
    buttons.push(
      new ButtonBuilder().setCustomId(WIZ_FINISH).setLabel("✅ Activate").setStyle(ButtonStyle.Success)
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId(WIZ_CANCEL).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
  return row(...buttons);
}

/* ------------------------------------------------------------- step payloads */

export function wizardStepPayload(clan: Clan, stepRaw: number): BaseMessageOptions {
  const step = clampStep(stepRaw);
  const h = header(step, clan);
  const rows: Row[] = [];

  switch (step) {
    case 1: {
      h.addFields(
        { name: "Community name", value: clan.clanName || "_not set_", inline: true },
        { name: "Activity", value: clan.activityName || "XP", inline: true },
        { name: "Game", value: clan.gameName || "_not set_", inline: true }
      ).setFooter({ text: "What you track and where. Press Edit to fill these in." });
      rows.push(row(new ButtonBuilder().setCustomId(wizEdit(1)).setLabel("✏️ Edit details").setStyle(ButtonStyle.Primary)));
      break;
    }
    case 2: {
      h.setDescription(
        `\`${"●".repeat(2)}${"○".repeat(9)}\`\n\n` +
          "**Exact progress** — officers enter numbers, e.g. `4200 / 5000`.\n" +
          "**Complete / Not complete** — a period checkmark for activity.\n" +
          "**Custom goal** — small countable targets, e.g. `8 / 10`."
      );
      rows.push(
        row(
          new StringSelectMenuBuilder()
            .setCustomId(wizSel("mode", 2))
            .setPlaceholder("Choose a tracking mode…")
            .addOptions(
              TRACKING_MODES.map((m) => ({
                value: m.value,
                label: m.label,
                description: m.description,
                emoji: m.emoji,
                default: m.value === clan.trackingMode,
              }))
            )
        )
      );
      break;
    }
    case 3: {
      if (clan.trackingMode === "complete") {
        h.addFields({
          name: "Activity goal",
          value: "Not needed in Complete/Not-complete mode — members just need the activity checkmark each period.",
        });
      } else {
        h.addFields({
          name: "Period goal",
          value: `**${clan.weeklyGoal.toLocaleString()} ${clan.activityName}** per period`,
          inline: true,
        });
      }
      h.addFields({
        name: "Optional day target",
        value: clan.dailyTarget > 0 ? `**${clan.dailyTarget.toLocaleString()} ${clan.activityName}** / day` : "off",
        inline: true,
      }).setFooter({ text: "Day target is optional — used for calendar done/missed days only." });
      rows.push(row(new ButtonBuilder().setCustomId(wizEdit(3)).setLabel("✏️ Set activity goal").setStyle(ButtonStyle.Primary)));
      break;
    }
    case 4: {
      h.addFields(
        { name: "Timezone", value: `\`${clan.timezone}\``, inline: true },
        { name: "Week starts", value: `${DAY_NAMES[clan.weekStartDay] ?? "Monday"} at ${clan.resetTime}`, inline: true }
      ).setFooter({ text: "All reset/reminder math uses this timezone." });
      rows.push(row(new ButtonBuilder().setCustomId(wizEdit(4)).setLabel("✏️ Set schedule").setStyle(ButtonStyle.Primary)));
      break;
    }
    case 5: {
      h.setDescription(
        `\`${"●".repeat(5)}${"○".repeat(6)}\`\n\n` +
          "**Activity track role** — members with this role appear on the leaderboard and count toward activity requirements.\n" +
          "Choose an existing role, or create **Clan Activity** in one tap."
      );
      h.addFields({
        name: "Current track role",
        value: clan.requiredRoleId ? `<@&${clan.requiredRoleId}>` : "_not set — all linked members_",
      });
      rows.push(
        singleRoleSelectRow("requiredRole", 5, "Activity track role", clan.requiredRoleId),
        row(
          new ButtonBuilder()
            .setCustomId(wizCreateTrackRole(5))
            .setLabel("Create Clan Activity role")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("✨")
        )
      );
      break;
    }
    case 6: {
      h.setDescription(
        `\`${"●".repeat(6)}${"○".repeat(5)}\`\n\n` +
          "**Officers** update progress, remind, warn and run reviews.\n" +
          "**Admins** can additionally change configuration.\n" +
          "_Members with Manage Server always have access._"
      );
      rows.push(
        roleSelectRow("officerRoles", 6, "Officer roles", clan.staffRoleIds),
        roleSelectRow("adminRoles", 6, "Admin roles", clan.adminRoleIds)
      );
      break;
    }
    case 7: {
      h.setDescription(
        `\`${"●".repeat(7)}${"○".repeat(4)}\`\n\n` +
          "Members holding these roles are skipped by reminders, warnings and completion-rate math. Both optional."
      );
      rows.push(
        roleSelectRow("exemptRoles", 7, "Exempt roles", clan.exemptRoleIds),
        roleSelectRow("leaveRoles", 7, "On-leave roles", clan.leaveRoleIds)
      );
      break;
    }
    case 8: {
      h.setDescription(
        `\`${"●".repeat(8)}${"○".repeat(3)}\`\n\n` +
          "**Reminders** — where nudges post (and the DM fallback).\n" +
          "**Warnings** — where activity warnings are announced.\n" +
          "**Logs** — the audit trail. All optional but recommended."
      );
      rows.push(
        channelSelectRow("reminderChannel", 8, "Reminder channel", clan.reminderChannelId),
        channelSelectRow("warningChannel", 8, "Warning channel", clan.warningChannelId),
        channelSelectRow("logChannel", 8, "Log channel", clan.logChannelId)
      );
      break;
    }
    case 9: {
      h.addFields(
        { name: "Auto reminders", value: clan.remindersEnabled ? "on" : "off", inline: true },
        { name: "Days", value: daysLabel(clan.reminderDays), inline: true },
        { name: "Time", value: clan.reminderTimes[0] ?? "not set", inline: true }
      );
      rows.push(
        row(
          toggleButton("remindersEnabled", 9, "Auto reminders", clan.remindersEnabled),
          toggleButton("dmReminders", 9, "DM reminders", clan.dmReminders),
          toggleButton("pingReminders", 9, "Ping in channel", clan.pingReminders),
          new ButtonBuilder().setCustomId(wizEdit(9)).setLabel("✏️ Days & time").setStyle(ButtonStyle.Primary)
        )
      );
      break;
    }
    case 10: {
      h.addFields(
        { name: "Warn after", value: `${clan.warningThreshold} reminder(s)`, inline: true },
        { name: "Escalate at", value: `${clan.escalationThreshold} warning(s)`, inline: true },
        { name: "DM on warning", value: clan.dmOnWarn ? "on" : "off", inline: true },
        {
          name: "Warning role",
          value: clan.warningRoleIds.map((r) => `<@&${r}>`).join(" ") || "_none_",
          inline: false,
        }
      );
      rows.push(
        row(
          new ButtonBuilder().setCustomId(wizEdit(10)).setLabel("✏️ Thresholds").setStyle(ButtonStyle.Primary),
          toggleButton("dmOnWarn", 10, "DM on warning", clan.dmOnWarn)
        ),
        roleSelectRow("warnRoles", 10, "Warning role (assigned on warn)", clan.warningRoleIds)
      );
      break;
    }
    case 11: {
      const v = validate(clan);
      h.setColor(v.errors.length ? 0xed4245 : 0x3ba55d).addFields(
        {
          name: "Requirement",
          value:
            (clan.trackingMode === "complete"
              ? `Complete ${clan.activityName} each period`
              : `${clan.weeklyGoal.toLocaleString()} ${clan.activityName} / period`) +
            ` · mode **${clan.trackingMode}**` +
            (clan.dailyTarget > 0 ? ` · day target **${clan.dailyTarget.toLocaleString()}**` : ""),
        },
        {
          name: "Schedule",
          value: `Period starts ${DAY_NAMES[clan.weekStartDay] ?? "Monday"} ${clan.resetTime} (${clan.timezone}) · reminders ${clan.remindersEnabled ? `${daysLabel(clan.reminderDays)} at ${clan.reminderTimes[0] ?? "?"}` : "off"}`,
        },
        {
          name: "Roles & channels",
          value:
            `Track ${clan.requiredRoleId ? `<@&${clan.requiredRoleId}>` : "—"} · Officers ${clan.staffRoleIds.length || "—"} · Admins ${clan.adminRoleIds.length || "—"} · ` +
            `Reminder ${clan.reminderChannelId ? "✅" : "—"} · Warn ${clan.warningChannelId ? "✅" : "—"} · Log ${clan.logChannelId ? "✅" : "—"}`,
        },
        {
          name: "Enforcement",
          value: `Warn after ${clan.warningThreshold} reminder(s), escalate at ${clan.escalationThreshold} warning(s)`,
        }
      );
      if (v.errors.length) h.addFields({ name: "❌ Fix before activating", value: v.errors.join("\n") });
      if (v.warnings.length) h.addFields({ name: "⚠️ Advisories", value: v.warnings.join("\n") });
      h.setFooter({
        text: v.errors.length
          ? "Resolve the items above (use Back to jump to a step), then Activate."
          : clan.setupComplete
            ? "Already active — Activate re-confirms."
            : "Looks good — press Activate to go live.",
      });
      rows.push(
        row(new ButtonBuilder().setCustomId(WIZ_HUB).setLabel("⚙️ Advanced edit hub").setStyle(ButtonStyle.Secondary))
      );
      break;
    }
  }

  rows.push(navRow(step));
  return { embeds: [h], components: rows };
}

function roleSelectRow(field: string, step: number, placeholder: string, current: string[]): Row {
  return row(
    new RoleSelectMenuBuilder()
      .setCustomId(wizSel(field, step))
      .setPlaceholder(placeholder)
      .setMinValues(0)
      .setMaxValues(5)
      .setDefaultRoles(current)
  );
}

function singleRoleSelectRow(field: string, step: number, placeholder: string, current: string | null): Row {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(wizSel(field, step))
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(1);
  if (current) menu.setDefaultRoles([current]);
  return row(menu);
}

function channelSelectRow(field: string, step: number, placeholder: string, current: string | null): Row {
  return row(
    new ChannelSelectMenuBuilder()
      .setCustomId(wizSel(field, step))
      .setPlaceholder(placeholder)
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
      .setDefaultChannels(current ? [current] : [])
  );
}

function toggleButton(key: string, step: number, label: string, on: boolean): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(wizToggle(key, step))
    .setLabel(`${on ? "✅" : "⬜"} ${label}`)
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

/* ----------------------------------------------------------------- modals */

const modalField = (input: TextInputBuilder) =>
  new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);

function stepModal(step: number, clan: Clan): ModalBuilder | null {
  const m = new ModalBuilder().setCustomId(wizModal(step));
  switch (step) {
    case 1:
      return m
        .setTitle("Community & activity")
        .addComponents(
          modalField(new TextInputBuilder().setCustomId("clanName").setLabel("Community name").setStyle(TextInputStyle.Short).setValue(clan.clanName).setRequired(true)),
          modalField(new TextInputBuilder().setCustomId("activityName").setLabel("What you track (XP, Activities…)").setStyle(TextInputStyle.Short).setValue(clan.activityName).setRequired(true)),
          modalField(new TextInputBuilder().setCustomId("gameName").setLabel("Game name").setStyle(TextInputStyle.Short).setValue(clan.gameName).setRequired(false)),
          modalField(new TextInputBuilder().setCustomId("gameUrl").setLabel("Game link (optional)").setStyle(TextInputStyle.Short).setValue(clan.gameUrl ?? "").setRequired(false))
        );
    case 3:
      return m
        .setTitle("Activity goal")
        .addComponents(
          modalField(new TextInputBuilder().setCustomId("weeklyGoal").setLabel("Period goal (number)").setStyle(TextInputStyle.Short).setValue(String(clan.weeklyGoal)).setPlaceholder("5000").setRequired(clan.trackingMode !== "complete")),
          modalField(new TextInputBuilder().setCustomId("dailyTarget").setLabel("Optional day target (0 = off)").setStyle(TextInputStyle.Short).setValue(String(clan.dailyTarget)).setPlaceholder("0").setRequired(false))
        );
    case 4:
      return m
        .setTitle("Schedule")
        .addComponents(
          modalField(new TextInputBuilder().setCustomId("timezone").setLabel("Timezone (IANA, e.g. America/New_York)").setStyle(TextInputStyle.Short).setValue(clan.timezone).setRequired(true)),
          modalField(new TextInputBuilder().setCustomId("weekStart").setLabel("Week start day + reset time").setStyle(TextInputStyle.Short).setValue(`${DAY_NAMES[clan.weekStartDay] ?? "Monday"} ${clan.resetTime}`).setPlaceholder("Monday 00:00").setRequired(true))
        );
    case 9:
      return m
        .setTitle("Reminder days & time")
        .addComponents(
          modalField(new TextInputBuilder().setCustomId("reminderDays").setLabel("Reminder days").setStyle(TextInputStyle.Short).setValue(daysLabel(clan.reminderDays)).setPlaceholder("Wed, Fri").setRequired(false)),
          modalField(new TextInputBuilder().setCustomId("reminderTime").setLabel("Reminder time (HH:mm, 24h)").setStyle(TextInputStyle.Short).setValue(clan.reminderTimes[0] ?? "18:00").setRequired(false))
        );
    case 10:
      return m
        .setTitle("Enforcement thresholds")
        .addComponents(
          modalField(new TextInputBuilder().setCustomId("warningThreshold").setLabel("Warn after N reminders").setStyle(TextInputStyle.Short).setValue(String(clan.warningThreshold)).setRequired(false)),
          modalField(new TextInputBuilder().setCustomId("escalationThreshold").setLabel("Escalate at N active warnings").setStyle(TextInputStyle.Short).setValue(String(clan.escalationThreshold)).setRequired(false))
        );
    default:
      return null;
  }
}

/* --------------------------------------------------------------- handlers */

const num = (s: string) => parseInt(s.replace(/[^0-9]/g, ""), 10);
const dayIndexOf = (s: string) => {
  const key = s.trim().slice(0, 3).toLowerCase();
  return key ? DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(key)) : -1;
};

/** Non-deferred admin guard (for the showModal path). Returns clan or null. */
async function guardModalOpen(interaction: ButtonInteraction): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isAdmin(interaction.member, clan)) {
    await interaction.reply({ content: "Only admins can change configuration.", flags: 64 });
    return null;
  }
  return clan;
}

/** Deferred admin guard shared by the update paths. */
async function guardDeferred(
  interaction: ButtonInteraction | ModalSubmitInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | StringSelectMenuInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isAdmin(interaction.member, clan)) {
    await interaction.editReply({ content: "Only admins can change configuration." });
    return null;
  }
  return clan;
}

/** Returns true when it handled a wizard button. */
export async function handleWizardButton(interaction: ButtonInteraction): Promise<void> {
  const { action, arg } = parseId(interaction.customId);

  // Modal opener must respond with showModal first (no defer allowed).
  if (action === "wizEdit") {
    const clan = await guardModalOpen(interaction);
    if (!clan) return;
    const modal = stepModal(Number(arg) || 1, clan);
    if (modal) await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();
  const clan = await guardDeferred(interaction);
  if (!clan) return;

  if (action === "wizCancel") {
    await interaction.editReply({
      content: clan.setupComplete
        ? "Setup unchanged — everything already configured stays live."
        : "Setup cancelled. Run **/setup** again anytime to pick up where you left off.",
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === "wizHub") {
    await interaction.editReply(setupMainPayload(clan));
    return;
  }

  if (action === "wizFinish") {
    const v = validate(clan);
    if (v.errors.length) {
      await interaction.editReply(wizardStepPayload(clan, 11));
      return;
    }
    const updated = (await updateClan(clan.guildId, { setupComplete: true })) ?? clan;
    await interaction.editReply({
      content: `✅ **${updated.clanName}** is live! Post the live dashboard with **/panel**, and manage members with **/xp**.`,
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === "wizCreateTrack") {
    const step = Number(arg) || 5;
    if (!interaction.guild) return;
    try {
      const existing = interaction.guild.roles.cache.find(
        (r) => r.name.toLowerCase() === "clan activity" && r.editable
      );
      const role =
        existing ??
        (await interaction.guild.roles.create({
          name: "Clan Activity",
          reason: "Tracked activity role for clan leaderboard / requirements",
          mentionable: false,
        }));
      await updateClan(clan.guildId, { requiredRoleId: role.id });
      const refreshed = (await getClan(clan.guildId)) ?? clan;
      await syncTrackedRoleMembers(refreshed, interaction.guild).catch(() => 0);
      await interaction.editReply({
        ...wizardStepPayload(refreshed, step),
        content: existing
          ? `✅ Using existing **${role.name}** as the activity track role.`
          : `✅ Created **${role.name}** — assign it to members you want tracked.`,
      });
    } catch {
      await interaction.editReply({
        content:
          "⚠️ Couldn't create the role. Make sure the bot has **Manage Roles** and sits above the new role.",
        embeds: [],
        components: [],
      });
    }
    return;
  }

  if (action === "wizToggle") {
    const [key, stepStr] = (arg ?? "").split("-");
    const step = Number(stepStr) || 9;
    const boolKeys = ["remindersEnabled", "dmReminders", "pingReminders", "dmOnWarn"] as const;
    if (key && (boolKeys as readonly string[]).includes(key)) {
      const k = key as (typeof boolKeys)[number];
      const updated = (await updateClan(clan.guildId, { [k]: !clan[k] })) ?? clan;
      await interaction.editReply(wizardStepPayload(updated, step));
    }
    return;
  }

  if (action === "wizGo") {
    await interaction.editReply(wizardStepPayload(clan, Number(arg) || 1));
    return;
  }
}

export async function handleWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: 64 });
  const clan = await guardDeferred(interaction);
  if (!clan) return;
  const { arg } = parseId(interaction.customId);
  const step = Number(arg) || 1;
  const f = (k: string) => interaction.fields.getTextInputValue(k);

  let patch: Partial<typeof import("@workspace/db").clansTable.$inferInsert> = {};

  if (step === 1) {
    const url = f("gameUrl").trim();
    patch = {
      clanName: f("clanName").trim() || clan.clanName,
      activityName: f("activityName").trim() || "XP",
      gameName: f("gameName").trim() || clan.gameName,
      gameUrl: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
    };
  } else if (step === 3) {
    const goal = num(f("weeklyGoal"));
    const daily = num(f("dailyTarget"));
    patch = {
      weeklyGoal: Number.isFinite(goal) && goal > 0 ? goal : clan.weeklyGoal,
      dailyTarget: Number.isFinite(daily) && daily >= 0 ? daily : clan.dailyTarget,
    };
  } else if (step === 4) {
    const tzRaw = f("timezone").trim();
    const [dayPart = "", timePart = ""] = f("weekStart").trim().split(/\s+/);
    const dayIdx = dayIndexOf(dayPart);
    const { hour, minute } = parseHm(timePart || clan.resetTime);
    patch = {
      timezone: tzRaw && isValidTimezone(tzRaw) ? tzRaw : clan.timezone,
      weekStartDay: dayIdx >= 0 ? dayIdx : clan.weekStartDay,
      resetTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  } else if (step === 9) {
    const days = f("reminderDays").split(",").map(dayIndexOf).filter((i) => i >= 0);
    const rt = parseHm(f("reminderTime") || clan.reminderTimes[0] || "18:00");
    patch = {
      reminderDays: days.length ? days : clan.reminderDays,
      reminderTimes: [`${String(rt.hour).padStart(2, "0")}:${String(rt.minute).padStart(2, "0")}`],
    };
  } else if (step === 10) {
    const warnN = num(f("warningThreshold"));
    const escN = num(f("escalationThreshold"));
    patch = {
      warningThreshold: Number.isFinite(warnN) && warnN > 0 ? warnN : clan.warningThreshold,
      escalationThreshold: Number.isFinite(escN) && escN > 0 ? escN : clan.escalationThreshold,
    };
  }

  const updated = (await updateClan(clan.guildId, patch)) ?? clan;
  await interaction.editReply(wizardStepPayload(updated, step));
}

export async function handleWizardSelect(
  interaction: ChannelSelectMenuInteraction | RoleSelectMenuInteraction | StringSelectMenuInteraction
): Promise<void> {
  await interaction.deferUpdate();
  const clan = await guardDeferred(interaction);
  if (!clan) return;
  const { arg } = parseId(interaction.customId);
  const [field = "", stepStr = ""] = (arg ?? "").split("-");
  const step = Number(stepStr) || 1;

  if (interaction.isStringSelectMenu() && field === "mode") {
    const mode = interaction.values[0] ?? "exact";
    const updated = (await updateClan(clan.guildId, { trackingMode: mode })) ?? clan;
    await interaction.editReply(wizardStepPayload(updated, step));
    return;
  }

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    const map: Record<string, keyof typeof import("@workspace/db").clansTable.$inferInsert> = {
      reminderChannel: "reminderChannelId",
      warningChannel: "warningChannelId",
      logChannel: "logChannelId",
    };
    const key = map[field];
    if (key) await updateClan(clan.guildId, { [key]: channelId });
    await interaction.editReply(wizardStepPayload((await getClan(clan.guildId)) ?? clan, step));
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    const roleIds = [...interaction.values];
    if (field === "requiredRole") {
      const requiredRoleId = roleIds[0] ?? null;
      await updateClan(clan.guildId, { requiredRoleId });
      const refreshed = (await getClan(clan.guildId)) ?? clan;
      if (requiredRoleId && interaction.guild) {
        await syncTrackedRoleMembers(refreshed, interaction.guild).catch(() => 0);
      }
      await interaction.editReply(wizardStepPayload((await getClan(clan.guildId)) ?? refreshed, step));
      return;
    }
    const map: Record<string, keyof typeof import("@workspace/db").clansTable.$inferInsert> = {
      officerRoles: "staffRoleIds",
      adminRoles: "adminRoleIds",
      exemptRoles: "exemptRoleIds",
      leaveRoles: "leaveRoleIds",
      warnRoles: "warningRoleIds",
    };
    const key = map[field];
    if (key) await updateClan(clan.guildId, { [key]: roleIds });
    await interaction.editReply(wizardStepPayload((await getClan(clan.guildId)) ?? clan, step));
    return;
  }
}
