import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

/**
 * The bot deliberately ships a tiny command surface — everything else happens
 * through the hubs, buttons, menus and modals.
 */
export const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure the activity tracker for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Open your activity hub")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("xpadmin")
    .setDescription("Open the staff operations hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View an activity profile")
    .addUserOption((o) => o.setName("user").setDescription("Whose profile to view").setRequired(false))
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the streak leaderboard")
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View and manage warnings")
    .addUserOption((o) => o.setName("user").setDescription("Whose warnings to view").setRequired(false))
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("report")
    .setDescription("Weekly or monthly activity report (staff)")
    .addStringOption((o) =>
      o
        .setName("period")
        .setDescription("Reporting period")
        .setRequired(false)
        .addChoices({ name: "Weekly", value: "week" }, { name: "Monthly", value: "month" })
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .setDMPermission(false)
    .toJSON(),
];
