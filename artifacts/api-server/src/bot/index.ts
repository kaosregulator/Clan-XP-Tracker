import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  AttachmentBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import {
  clansTable,
  clanMembersTable,
  xpSubmissionsTable,
  warningsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  logger.warn("DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — bot will not start");
}

const commands = [
  new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Clan XP Tracker commands")
    .addSubcommand((sub) =>
      sub.setName("daily").setDescription("Submit your daily XP")
    )
    .addSubcommand((sub) =>
      sub.setName("total").setDescription("View your total XP")
    )
    .addSubcommand((sub) =>
      sub.setName("history").setDescription("View your submission history")
    )
    .addSubcommand((sub) =>
      sub.setName("leaderboard").setDescription("View the clan leaderboard")
    )
    .addSubcommand((sub) =>
      sub.setName("profile").setDescription("View your profile")
    )
    .addSubcommand((sub) =>
      sub.setName("help").setDescription("Show help")
    )
    .addSubcommand((sub) =>
      sub.setName("warn")
        .setDescription("Warn a member (admin)")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to warn").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Reason for warning").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("warnings")
        .setDescription("View warnings for a member (admin)")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to check").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("unwarn")
        .setDescription("Remove a warning (admin)")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("warning_id").setDescription("Warning ID to remove").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("audit")
        .setDescription("Audit a member (admin)")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to audit").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("setup").setDescription("Setup the clan (admin)")
    ),
];

async function getClan(guildId: string) {
  const [clan] = await db.select().from(clansTable).where(eq(clansTable.guildId, guildId));
  return clan ?? null;
}

async function getOrCreateMember(
  guildId: string,
  userId: string,
  username: string,
  displayName: string,
  avatarUrl: string | null
) {
  const [existing] = await db
    .select()
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

  if (existing) return existing;

  const [newMember] = await db
    .insert(clanMembersTable)
    .values({ guildId, userId, username, displayName, avatarUrl })
    .returning();
  return newMember!;
}

async function sendLogEmbed(
  client: Client,
  guildId: string,
  embed: EmbedBuilder
) {
  try {
    const clan = await getClan(guildId);
    if (!clan?.logChannelId) return;
    const channel = await client.channels.fetch(clan.logChannelId);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err }, "Failed to send log embed");
  }
}

async function handleDaily(interaction: ChatInputCommandInteraction, client: Client) {
  const guildId = interaction.guildId!;
  const clan = await getClan(guildId);

  if (!clan) {
    await interaction.reply({
      content: "This server hasn't set up the clan yet. An admin can use `/xp setup` to get started.",
      flags: 64,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`xp_daily_${guildId}`)
    .setTitle("Submit Daily XP");

  const xpInput = new TextInputBuilder()
    .setCustomId("xp_earned")
    .setLabel("XP Earned Today")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("e.g. 5000");

  const altInput = new TextInputBuilder()
    .setCustomId("alt_accounts")
    .setLabel("Alt Accounts Completed (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("e.g. 2");

  const notesInput = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("Any notes about today's session...");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(xpInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(altInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
  );

  await interaction.showModal(modal);
}

async function handleTotal(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const [member] = await db
    .select()
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

  if (!member) {
    await interaction.editReply("You haven't submitted any XP yet.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`XP Summary — ${member.displayName}`)
    .setThumbnail(member.avatarUrl ?? null)
    .addFields(
      { name: "Daily XP", value: member.xpDaily.toLocaleString(), inline: true },
      { name: "Weekly XP", value: member.xpWeekly.toLocaleString(), inline: true },
      { name: "Monthly XP", value: member.xpMonthly.toLocaleString(), inline: true },
      { name: "All-Time XP", value: member.xpAllTime.toLocaleString(), inline: true },
      { name: "Alt XP", value: member.altXpAllTime.toLocaleString(), inline: true },
      { name: "Submissions", value: member.submissionsCount.toString(), inline: true },
    )
    .setFooter({ text: "Clan XP Tracker" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleHistory(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const submissions = await db
    .select()
    .from(xpSubmissionsTable)
    .where(and(eq(xpSubmissionsTable.guildId, guildId), eq(xpSubmissionsTable.userId, userId), isNull(xpSubmissionsTable.deletedAt)))
    .orderBy(desc(xpSubmissionsTable.submittedAt))
    .limit(5);

  if (!submissions.length) {
    await interaction.editReply("You haven't submitted any XP yet.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Your Recent Submissions")
    .setDescription(
      submissions.map((s, i) => {
        const date = s.submittedAt.toLocaleDateString();
        return `**${i + 1}.** ${date} — **${s.xpEarned.toLocaleString()} XP**${s.altAccountsCompleted > 0 ? ` + ${s.altAccountsCompleted} alts` : ""}${s.notes ? `\n   ↳ ${s.notes}` : ""}`;
      }).join("\n")
    )
    .setFooter({ text: "Showing last 5 submissions" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const guildId = interaction.guildId!;

  const members = await db
    .select()
    .from(clanMembersTable)
    .where(eq(clanMembersTable.guildId, guildId))
    .orderBy(desc(clanMembersTable.xpAllTime))
    .limit(10);

  if (!members.length) {
    await interaction.editReply("No members have submitted XP yet.");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Clan XP Leaderboard — All Time")
    .setDescription(
      members.map((m, i) => {
        const prefix = medals[i] ?? `**${i + 1}.**`;
        return `${prefix} <@${m.userId}> — **${m.xpAllTime.toLocaleString()} XP**`;
      }).join("\n")
    )
    .setFooter({ text: "Clan XP Tracker" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleProfile(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const [member] = await db
    .select()
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

  if (!member) {
    await interaction.editReply("You haven't submitted any XP yet.");
    return;
  }

  const [warningCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.userId, userId), isNull(warningsTable.removedAt)));

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Profile — ${member.displayName}`)
    .setThumbnail(member.avatarUrl ?? null)
    .addFields(
      { name: "All-Time XP", value: member.xpAllTime.toLocaleString(), inline: true },
      { name: "Weekly XP", value: member.xpWeekly.toLocaleString(), inline: true },
      { name: "Monthly XP", value: member.xpMonthly.toLocaleString(), inline: true },
      { name: "Total Submissions", value: member.submissionsCount.toString(), inline: true },
      { name: "Active Warnings", value: (warningCount?.count ?? 0).toString(), inline: true },
    )
    .setFooter({ text: `Member since ${member.joinedAt.toLocaleDateString()}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleHelp(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Clan XP Tracker — Commands")
    .addFields(
      {
        name: "Member Commands",
        value: [
          "`/xp daily` — Submit your daily XP",
          "`/xp total` — View your XP totals",
          "`/xp history` — View your submission history",
          "`/xp leaderboard` — View the leaderboard",
          "`/xp profile` — View your profile",
        ].join("\n"),
      },
      {
        name: "Admin Commands",
        value: [
          "`/xp setup` — Set up the clan",
          "`/xp warn @user <reason>` — Warn a member",
          "`/xp warnings @user` — View member warnings",
          "`/xp unwarn @user <id>` — Remove a warning",
          "`/xp audit @user` — Audit a member",
        ].join("\n"),
      }
    )
    .setFooter({ text: "Clan XP Tracker" });

  await interaction.reply({ embeds: [embed] });
}

async function handleWarn(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);

  const member = await interaction.guild?.members.fetch(interaction.user.id);
  if (!member?.permissions.has("Administrator") && !member?.permissions.has("ManageGuild")) {
    await interaction.editReply("You don't have permission to warn members.");
    return;
  }

  const targetMember = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);

  const [warning] = await db.insert(warningsTable).values({
    guildId,
    userId: targetUser.id,
    username: targetUser.username,
    avatarUrl: targetUser.displayAvatarURL(),
    issuedBy: interaction.user.id,
    issuedByUsername: interaction.user.username,
    reason,
  }).returning();

  await db.update(clanMembersTable)
    .set({ warningsCount: sql`warnings_count + 1` })
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, targetUser.id)));

  await db.insert(auditLogsTable).values({
    guildId,
    action: "warning_issued",
    targetUserId: targetUser.id,
    targetUsername: targetUser.username,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    details: { reason, warningId: warning?.id },
  });

  await interaction.editReply(`Warning issued to <@${targetUser.id}>. Reason: ${reason}`);
}

async function handleWarnings(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const targetUser = interaction.options.getUser("user", true);

  const warnings = await db
    .select()
    .from(warningsTable)
    .where(and(
      eq(warningsTable.guildId, guildId),
      eq(warningsTable.userId, targetUser.id),
      isNull(warningsTable.removedAt)
    ))
    .orderBy(desc(warningsTable.issuedAt));

  if (!warnings.length) {
    await interaction.editReply(`<@${targetUser.id}> has no active warnings.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`Warnings — ${targetUser.username}`)
    .setDescription(
      warnings.map((w) =>
        `**ID ${w.id}** — ${w.issuedAt.toLocaleDateString()}\nReason: ${w.reason}\nIssued by: ${w.issuedByUsername}`
      ).join("\n\n")
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleUnwarn(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const targetUser = interaction.options.getUser("user", true);
  const warningId = interaction.options.getInteger("warning_id", true);

  const member = await interaction.guild?.members.fetch(interaction.user.id);
  if (!member?.permissions.has("Administrator") && !member?.permissions.has("ManageGuild")) {
    await interaction.editReply("You don't have permission to remove warnings.");
    return;
  }

  const [warning] = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.id, warningId), eq(warningsTable.guildId, guildId), eq(warningsTable.userId, targetUser.id)));

  if (!warning) {
    await interaction.editReply("Warning not found.");
    return;
  }

  await db.update(warningsTable).set({
    removedAt: new Date(),
    removedBy: interaction.user.id,
  }).where(eq(warningsTable.id, warningId));

  await db.update(clanMembersTable)
    .set({ warningsCount: sql`greatest(warnings_count - 1, 0)` })
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, targetUser.id)));

  await interaction.editReply(`Warning #${warningId} removed from <@${targetUser.id}>.`);
}

async function handleAudit(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const targetUser = interaction.options.getUser("user", true);

  const member = await interaction.guild?.members.fetch(interaction.user.id);
  if (!member?.permissions.has("Administrator") && !member?.permissions.has("ManageGuild")) {
    await interaction.editReply("You don't have permission to audit members.");
    return;
  }

  const [clanMember] = await db
    .select()
    .from(clanMembersTable)
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, targetUser.id)));

  const recentSubs = await db
    .select()
    .from(xpSubmissionsTable)
    .where(and(eq(xpSubmissionsTable.guildId, guildId), eq(xpSubmissionsTable.userId, targetUser.id), isNull(xpSubmissionsTable.deletedAt)))
    .orderBy(desc(xpSubmissionsTable.submittedAt))
    .limit(5);

  const warnings = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.userId, targetUser.id), isNull(warningsTable.removedAt)));

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`Audit — ${targetUser.username}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      {
        name: "XP Stats",
        value: clanMember
          ? `All-Time: **${clanMember.xpAllTime.toLocaleString()}**\nWeekly: **${clanMember.xpWeekly.toLocaleString()}**\nSubmissions: **${clanMember.submissionsCount}**`
          : "No XP data",
        inline: true,
      },
      {
        name: "Warnings",
        value: warnings.length > 0
          ? warnings.map((w) => `ID ${w.id}: ${w.reason}`).join("\n")
          : "No active warnings",
        inline: true,
      },
      {
        name: "Recent Submissions",
        value: recentSubs.length > 0
          ? recentSubs.map((s) => `${s.submittedAt.toLocaleDateString()}: **${s.xpEarned.toLocaleString()} XP**`).join("\n")
          : "No submissions",
      },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleSetup(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const guildId = interaction.guildId!;
  const user = interaction.user;

  const member = await interaction.guild?.members.fetch(user.id);
  if (!member?.permissions.has("Administrator")) {
    await interaction.editReply("Only server administrators can set up the clan.");
    return;
  }

  const existing = await getClan(guildId);
  if (existing) {
    await interaction.editReply(`Clan "${existing.clanName}" is already set up. Visit the dashboard to manage settings.`);
    return;
  }

  await interaction.editReply(
    "To set up your clan, please visit the dashboard and click 'Setup' on this server.\n\n" +
    "Once set up, your clan will be ready for XP tracking!"
  );
}

async function handleDailyModalSubmit(
  interaction: ModalSubmitInteraction,
  guildId: string,
  client: Client
) {
  await interaction.deferReply({ flags: 64 });

  const xpRaw = interaction.fields.getTextInputValue("xp_earned");
  const altRaw = interaction.fields.getTextInputValue("alt_accounts");
  const notes = interaction.fields.getTextInputValue("notes") || null;

  const xpEarned = parseInt(xpRaw.replace(/[^0-9]/g, ""));
  const altAccountsCompleted = altRaw ? parseInt(altRaw.replace(/[^0-9]/g, "")) || 0 : 0;

  if (isNaN(xpEarned) || xpEarned <= 0) {
    await interaction.editReply("Invalid XP amount. Please enter a positive number.");
    return;
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const displayName = interaction.user.displayName ?? username;
  const avatarUrl = interaction.user.displayAvatarURL();

  const clan = await getClan(guildId);
  if (!clan) {
    await interaction.editReply("This clan is not set up yet.");
    return;
  }

  // Check 24h cooldown
  const [lastSub] = await db
    .select({ submittedAt: xpSubmissionsTable.submittedAt })
    .from(xpSubmissionsTable)
    .where(and(
      eq(xpSubmissionsTable.guildId, guildId),
      eq(xpSubmissionsTable.userId, userId),
      isNull(xpSubmissionsTable.deletedAt)
    ))
    .orderBy(desc(xpSubmissionsTable.submittedAt))
    .limit(1);

  if (lastSub) {
    const hoursSince = (Date.now() - lastSub.submittedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      const nextSubmit = new Date(lastSub.submittedAt.getTime() + 24 * 60 * 60 * 1000);
      await interaction.editReply(
        `You can submit XP once every 24 hours. Next submission available <t:${Math.floor(nextSubmit.getTime() / 1000)}:R>.`
      );
      return;
    }
  }

  // Insert submission
  const [submission] = await db.insert(xpSubmissionsTable).values({
    guildId,
    userId,
    username,
    avatarUrl,
    xpEarned,
    altAccountsCompleted,
    notes,
    proofImageUrls: [],
  }).returning();

  // Update or create member record
  await getOrCreateMember(guildId, userId, username, displayName, avatarUrl);

  await db.update(clanMembersTable).set({
    username,
    displayName,
    avatarUrl,
    xpDaily: sql`xp_daily + ${xpEarned}`,
    xpWeekly: sql`xp_weekly + ${xpEarned}`,
    xpMonthly: sql`xp_monthly + ${xpEarned}`,
    xpAllTime: sql`xp_all_time + ${xpEarned}`,
    altXpAllTime: sql`alt_xp_all_time + ${altAccountsCompleted}`,
    submissionsCount: sql`submissions_count + 1`,
    lastSubmittedAt: new Date(),
  }).where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

  await db.insert(auditLogsTable).values({
    guildId,
    action: "xp_submitted",
    targetUserId: userId,
    targetUsername: username,
    details: { xpEarned, altAccountsCompleted, submissionId: submission?.id },
  });

  const confirmEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("XP Submitted!")
    .setDescription(`**${xpEarned.toLocaleString()} XP** recorded for today.`)
    .addFields(
      ...(altAccountsCompleted > 0 ? [{ name: "Alt Accounts", value: altAccountsCompleted.toString(), inline: true }] : []),
      ...(notes ? [{ name: "Notes", value: notes, inline: false }] : []),
    )
    .setFooter({ text: "Clan XP Tracker" })
    .setTimestamp();

  await interaction.editReply({ embeds: [confirmEmbed] });

  if (clan.proofRequired) {
    await interaction.followUp({
      content: "Proof is required for this clan. Please upload your screenshots in this channel now. They will be automatically linked to your submission.",
      flags: 64,
    });
  }

  // Log to log channel
  const logEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("XP Submitted")
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "User", value: `<@${userId}>`, inline: true },
      { name: "XP Earned", value: xpEarned.toLocaleString(), inline: true },
      { name: "Alt Accounts", value: altAccountsCompleted.toString(), inline: true },
      ...(notes ? [{ name: "Notes", value: notes }] : []),
    )
    .setTimestamp();

  await sendLogEmbed(client, guildId, logEmbed);
}

export function startBot() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    logger.warn("Bot not started — missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");

    const rest = new REST().setToken(DISCORD_BOT_TOKEN!);
    try {
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), {
        body: commands.map((cmd) => cmd.toJSON()),
      });
      logger.info("Slash commands registered globally");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "xp") {
        const sub = interaction.options.getSubcommand();
        switch (sub) {
          case "daily":    await handleDaily(interaction, client); break;
          case "total":    await handleTotal(interaction); break;
          case "history":  await handleHistory(interaction); break;
          case "leaderboard": await handleLeaderboard(interaction); break;
          case "profile":  await handleProfile(interaction); break;
          case "help":     await handleHelp(interaction); break;
          case "warn":     await handleWarn(interaction); break;
          case "warnings": await handleWarnings(interaction); break;
          case "unwarn":   await handleUnwarn(interaction); break;
          case "audit":    await handleAudit(interaction); break;
          case "setup":    await handleSetup(interaction); break;
        }
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith("xp_daily_")) {
        const guildId = interaction.customId.replace("xp_daily_", "");
        await handleDailyModalSubmit(interaction, guildId, client);
      }
    } catch (err) {
      logger.error({ err }, "Error handling interaction");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "An error occurred. Please try again.", flags: 64 }).catch(() => {});
      }
    }
  });

  client.login(DISCORD_BOT_TOKEN).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}
