import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import PQueue from "p-queue";
import { getClan, isStaff } from "../services/config";
import { issueWarning } from "../services/warnings";
import { sendReminder, reminderSentToday } from "../services/reminders";
import { submittedTodayIds } from "../services/submissions";
import {
  XPADMIN_WARN,
  XPADMIN_REMIND,
  XPADMIN_REMIND_ROLE,
  XPADMIN_WARN_PICK,
  XPADMIN_REMIND_PICK,
  XPADMIN_REMIND_ROLE_PICK,
  xpAdminWarnModal,
  parseId,
} from "../ui/ids";

/**
 * Staff-only guard for the admin-profile actions. Returns the clan when the
 * invoker is staff, otherwise replies (ephemerally) and returns null.
 * Pass deferred=true when the caller already acknowledged the interaction.
 */
async function staffGuard(
  interaction:
    | ButtonInteraction
    | UserSelectMenuInteraction
    | RoleSelectMenuInteraction
    | ModalSubmitInteraction,
  deferred = false,
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isStaff(interaction.member, clan)) {
    const content = "These actions are for staff only.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/* ------------------------------------------------------------------ buttons */

/** Route the staff-action buttons on the /xp hub — each opens a picker. */
export async function handleXpAdminButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const clan = await staffGuard(interaction);
  if (!clan) return;
  const { action } = parseId(interaction.customId);

  if (action === "warn") {
    const menu = new UserSelectMenuBuilder()
      .setCustomId(XPADMIN_WARN_PICK)
      .setPlaceholder("Select a member to warn…")
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.reply({
      content: "⚠️ **Warn a member** — pick who to warn, then enter a reason.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu),
      ],
      flags: 64,
    });
    return;
  }

  if (action === "remind") {
    const menu = new UserSelectMenuBuilder()
      .setCustomId(XPADMIN_REMIND_PICK)
      .setPlaceholder("Select member(s) to remind…")
      .setMinValues(1)
      .setMaxValues(10);
    await interaction.reply({
      content:
        "🔔 **Remind members** — pick up to 10 members to DM a friendly reminder.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu),
      ],
      flags: 64,
    });
    return;
  }

  if (action === "remindRole") {
    const menu = new RoleSelectMenuBuilder()
      .setCustomId(XPADMIN_REMIND_ROLE_PICK)
      .setPlaceholder("Select a role to remind…")
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.reply({
      content:
        "👥 **Remind a role** — everyone in the role who hasn't submitted today (and hasn't been reminded yet) gets a DM.",
      components: [
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(menu),
      ],
      flags: 64,
    });
    return;
  }
}

/* -------------------------------------------------------------- user select */

/** Route the user-select pickers (warn → modal, remind → send DMs). */
export async function handleXpAdminUserSelect(
  interaction: UserSelectMenuInteraction,
): Promise<void> {
  const { action } = parseId(interaction.customId);

  if (action === "warnPick") {
    // Guard before showing the modal (showModal must be the first response).
    if (!interaction.inCachedGuild()) return;
    const clan = await getClan(interaction.guildId);
    if (!clan || !isStaff(interaction.member, clan)) {
      await interaction.reply({
        content: "These actions are for staff only.",
        flags: 64,
      });
      return;
    }
    const userId = interaction.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(xpAdminWarnModal(userId))
      .setTitle("Warn member");
    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Warning reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Why is this member being warned?"),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "remindPick") {
    await interaction.deferUpdate();
    const clan = await staffGuard(interaction, true);
    if (!clan) return;
    if (!clan.remindersEnabled) {
      await interaction.editReply({
        content:
          "Reminders are turned OFF (safety). Re-enable them in /setup → Schedule.",
        components: [],
      });
      return;
    }

    const queue = new PQueue({
      concurrency: 3,
      intervalCap: 3,
      interval: 1000,
    });
    let sent = 0;
    let skipped = 0;
    for (const userId of interaction.values) {
      queue.add(async () => {
        if (await reminderSentToday(clan, userId)) {
          skipped++;
          return;
        }
        const user = await interaction.client.users
          .fetch(userId)
          .catch(() => null);
        if (!user) return;
        await sendReminder({
          clan,
          target: user,
          auto: false,
          moderatorId: interaction.user.id,
          moderatorUsername: interaction.user.username,
        });
        sent++;
      });
    }
    await queue.onIdle();
    await interaction.editReply({
      content: `🔔 Sent **${sent}** reminder(s)${skipped ? ` · skipped ${skipped} already reminded today` : ""}.`,
      components: [],
    });
    return;
  }
}

/* -------------------------------------------------------------- role select */

/** Remind everyone in the chosen role who is still missing today. */
export async function handleXpAdminRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  await interaction.deferUpdate();
  const clan = await staffGuard(interaction, true);
  if (!clan || !interaction.inCachedGuild()) return;
  if (!clan.remindersEnabled) {
    await interaction.editReply({
      content:
        "Reminders are turned OFF (safety). Re-enable them in /setup → Schedule.",
      components: [],
    });
    return;
  }

  const roleId = interaction.values[0]!;
  await interaction.guild.members.fetch().catch(() => null); // populate the member cache
  const role = interaction.guild.roles.cache.get(roleId);
  const targets = role
    ? [...role.members.values()].filter((m) => !m.user.bot).map((m) => m.id)
    : [];
  if (!targets.length) {
    await interaction.editReply({
      content: "That role has no members to remind.",
      components: [],
    });
    return;
  }

  const done = await submittedTodayIds(clan);
  const missing = targets.filter((id) => !done.has(id));

  const queue = new PQueue({ concurrency: 3, intervalCap: 3, interval: 1000 });
  let sent = 0;
  for (const userId of missing.slice(0, 100)) {
    queue.add(async () => {
      if (await reminderSentToday(clan, userId)) return;
      const user = await interaction.client.users
        .fetch(userId)
        .catch(() => null);
      if (!user) return;
      await sendReminder({
        clan,
        target: user,
        auto: false,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
      });
      sent++;
    });
  }
  await queue.onIdle();
  await interaction.editReply({
    content: `👥 <@&${roleId}> — **${missing.length}** missing today · sent **${sent}** reminder(s) (rest already done or reminded).`,
    components: [],
  });
}

/* -------------------------------------------------------------------- modal */

/** Issue the warning captured by the warn modal. */
export async function handleXpAdminWarnModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await staffGuard(interaction, true);
  if (!clan) return;

  const { arg: userId } = parseId(interaction.customId);
  if (!userId) {
    await interaction.editReply({
      content: "Could not determine who to warn.",
    });
    return;
  }
  const reason = interaction.fields.getTextInputValue("reason");
  const target = await interaction.client.users.fetch(userId).catch(() => null);
  if (!target) {
    await interaction.editReply({ content: "Could not find that user." });
    return;
  }

  const { activeCount } = await issueWarning({
    client: interaction.client,
    clan,
    guild: interaction.guild,
    target,
    moderatorId: interaction.user.id,
    moderatorUsername: interaction.user.username,
    reason,
  });
  await interaction.editReply({
    content: `⚠️ Warned <@${userId}> (now ${activeCount} active warning(s)).`,
  });
}
