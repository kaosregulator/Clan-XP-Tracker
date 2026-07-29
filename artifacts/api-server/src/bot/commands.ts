import {
  SlashCommandBuilder,
  PermissionFlagsBits,
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
          o.setName("text").setDescription("Note (leave empty to clear)").setRequired(false)
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
    .addSubcommand((s) =>
      s
        .setName("remind")
        .setDescription("Send a progress reminder to a member now")
        .addUserOption((o) => o.setName("user").setDescription("Member to remind").setRequired(true))
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
            .setName("remind")
            .setDescription("Remind everyone in a role who is behind")
            .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
        )
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
];
