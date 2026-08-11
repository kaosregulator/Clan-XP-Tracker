import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

/**
 * Command surface for the XP Management & Enforcement bot.
 *
 * /xp is the officer toolkit — progress updates, bulk role actions, the
 * weekly review and the warning dashboard. Members never submit XP; officers
 * verify in-game and update the bot. Everything else happens through the
 * interactive panels those commands open.
 */
export const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure XP management for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Manage weekly XP (officers)")
    .setDMPermission(false)
    // Single-member updates -------------------------------------------------
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set a member's weekly progress to an exact value")
        .addUserOption((o) => o.setName("user").setDescription("Member to update").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("amount").setDescription("New progress value").setRequired(true).setMinValue(0)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add to a member's weekly progress")
        .addUserOption((o) => o.setName("user").setDescription("Member to update").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("amount").setDescription("Amount to add").setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove from a member's weekly progress")
        .addUserOption((o) => o.setName("user").setDescription("Member to update").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("amount").setDescription("Amount to remove").setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("complete")
        .setDescription("Mark a member's week as completed")
        .addUserOption((o) => o.setName("user").setDescription("Member to mark").setRequired(true))
        .addBooleanOption((o) =>
          o.setName("undo").setDescription("Un-mark instead").setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("Reset a member's weekly progress to zero")
        .addUserOption((o) => o.setName("user").setDescription("Member to reset").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("note")
        .setDescription("Attach an officer note to a member")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addStringOption((o) =>
          o.setName("text").setDescription("Note (leave empty to clear the quick note)").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("notify").setDescription("Also DM this note to the member").setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("goal")
        .setDescription("Set a per-member goal override")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("Custom goal (omit to restore the server goal)")
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("exempt")
        .setDescription("Exempt a member from the weekly requirement")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("On or off (default on)").setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("leave")
        .setDescription("Mark a member as on leave")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("On or off (default on)").setRequired(false)
        )
    )
    // Views ------------------------------------------------------------------
    .addSubcommand((s) =>
      s
        .setName("progress")
        .setDescription("View weekly progress (yours, or any member's)")
        .addUserOption((o) => o.setName("user").setDescription("Member to view").setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName("history")
        .setDescription("View a member's weekly history")
        .addUserOption((o) => o.setName("user").setDescription("Member to view").setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName("audit")
        .setDescription("View a member's full XP history / audit trail")
        .addUserOption((o) => o.setName("user").setDescription("Member to view").setRequired(false))
    )
    .addSubcommand((s) =>
      s.setName("review").setDescription("Open the weekly review panel (officers)")
    )
    .addSubcommand((s) =>
      s.setName("dashboard").setDescription("Open the warning dashboard (officers)")
    )
    // Bulk role actions -------------------------------------------------------
    .addSubcommandGroup((g) =>
      g
        .setName("role")
        .setDescription("Bulk actions on every member of a role")
        .addSubcommand((s) =>
          s
            .setName("add")
            .setDescription("Add progress to everyone in a role")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
            .addIntegerOption((o) =>
              o.setName("amount").setDescription("Amount to add").setRequired(true).setMinValue(1)
            )
        )
        .addSubcommand((s) =>
          s
            .setName("complete")
            .setDescription("Mark everyone in a role complete")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName("reset")
            .setDescription("Reset weekly progress for everyone in a role")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName("track")
            .setDescription("Start tracking everyone in a role")
            .addRoleOption((o) => o.setName("role").setDescription("Role to import").setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName("entry")
            .setDescription("Log the same XP for everyone in a role")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
            .addIntegerOption((o) =>
              o.setName("amount").setDescription("XP earned each").setRequired(true).setMinValue(0)
            )
            .addStringOption((o) =>
              o
                .setName("date")
                .setDescription("Day to log (YYYY-MM-DD); default today")
                .setRequired(false)
            )
            .addBooleanOption((o) =>
              o
                .setName("set")
                .setDescription("Overwrite that day's total instead of adding")
                .setRequired(false)
            )
        )
        .addSubcommand((s) =>
          s
            .setName("remind")
            .setDescription("Remind everyone in a role who is behind")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName("warn")
            .setDescription("Warn a whole role for missed XP")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
            .addStringOption((o) =>
              o
                .setName("message")
                .setDescription("Optional note to include with the warning")
                .setRequired(false)
                .setMaxLength(500)
            )
            .addStringOption((o) =>
              o
                .setName("mode")
                .setDescription("Warn each member individually, or ping the whole role once")
                .setRequired(false)
                .addChoices(
                  { name: "Warn each member (records a warning each)", value: "individual" },
                  { name: "Ping the whole role once (announcement only)", value: "announce" }
                )
            )
            .addStringOption((o) =>
              o
                .setName("destination")
                .setDescription("Where to send warnings (default: warn channel)")
                .setRequired(false)
                .addChoices(
                  { name: "Warn channel", value: "channel" },
                  { name: "Direct message", value: "dm" },
                  { name: "Both", value: "both" }
                )
            )
        )
    )
    .toJSON(),

  // Plain one-word commands for the everyday actions ------------------------
  new SlashCommandBuilder()
    .setName("xpremind")
    .setDescription("Nudge a member to do their XP")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to remind").setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName("xpwarn")
    .setDescription("Warn a member for missed XP")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) =>
      o.setName("message").setDescription("Optional note").setRequired(false).setMaxLength(500)
    )
    .addStringOption((o) =>
      o
        .setName("destination")
        .setDescription("Where to send it (default: warn channel)")
        .setRequired(false)
        .addChoices(
          { name: "Warn channel", value: "channel" },
          { name: "Direct message", value: "dm" },
          { name: "Both", value: "both" }
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("entry")
    .setDescription("Log a member's XP for a day")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("XP earned").setRequired(true).setMinValue(0)
    )
    .addStringOption((o) =>
      o
        .setName("date")
        .setDescription("Day to log (YYYY-MM-DD) — backfill past days; default today")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("set").setDescription("Overwrite that day instead of adding").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("note").setDescription("Optional note").setRequired(false).setMaxLength(200)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("calendar")
    .setDescription("Show a member's XP calendar")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to view").setRequired(false))
    .addStringOption((o) =>
      o.setName("month").setDescription("Month (YYYY-MM); default this month").setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("missing")
    .setDescription("List members who haven't hit today's XP target")
    .setDMPermission(false)
    .addRoleOption((o) => o.setName("role").setDescription("Only check this role").setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the persistent live XP command center (officers)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Where to post it (default: here or the configured staff channel)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View and manage XP warnings")
    .addUserOption((o) => o.setName("user").setDescription("Whose warnings to view").setRequired(false))
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("How the XP manager works (officers & members)")
    .setDMPermission(false)
    .toJSON(),

  // Member self-service: dispute one of your own warnings.
  new SlashCommandBuilder()
    .setName("dispute")
    .setDescription("Dispute one of your own XP warnings")
    .setDMPermission(false)
    .toJSON(),

  // Officer hubs for the enforcement workflow.
  new SlashCommandBuilder()
    .setName("disputes")
    .setDescription("Review member warning disputes (officers)")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("notifications")
    .setDescription("Open the staff notification center (officers)")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("tickets")
    .setDescription("View and manage staff tickets (officers)")
    .setDMPermission(false)
    .toJSON(),
];
