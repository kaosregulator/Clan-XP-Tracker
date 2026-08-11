import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, isOfficer, isAdmin, getMember, identityFromUser } from "../services/config";
import { applyProgress, statusOf, STATUS_LABEL, formatProgress } from "../services/progress";
import { sendReminder, recentReminder } from "../services/reminders";
import { issueWarning, recentWarning } from "../services/warnings";
import { discordRelative } from "../services/time";
import { mpXpModal, parseId } from "../ui/ids";

/**
 * Member-panel actions — the buttons under the member command-center summary
 * (Search / "view member"). Each one reuses an existing service so behaviour is
 * identical to the equivalent slash command; the panel just makes them one tap
 * away. Actions are officer-gated (warn is admin-gated) on every click.
 */

async function officerGuard(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isOfficer(interaction.member, clan)) {
    const content = "Only officers can act on members.";
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

const officer = (i: ButtonInteraction | ModalSubmitInteraction) => ({ id: i.user.id, username: i.user.username });

/** Resolve the target member's identity from the guild (fresh username/avatar). */
async function resolveIdentity(interaction: ButtonInteraction | ModalSubmitInteraction, userId: string) {
  if (!interaction.inCachedGuild()) return null;
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member) return identityFromUser(member.user, member.displayName);
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  return user ? identityFromUser(user) : null;
}

export async function handleMemberPanelButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action, arg } = parseId(interaction.customId);
  const userId = String(arg);

  // XP modals must be shown before any defer.
  if (action === "addxp" || action === "remxp") {
    const clan = await getClan(interaction.guildId);
    if (!clan || !isOfficer(interaction.member, clan)) {
      await interaction.reply({ content: "Only officers can act on members.", flags: 64 });
      return;
    }
    const kind = action === "addxp" ? "add" : "remove";
    const modal = new ModalBuilder()
      .setCustomId(mpXpModal(kind, userId))
      .setTitle(kind === "add" ? "Add XP" : "Remove XP")
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("amount")
            .setLabel(`Amount to ${kind}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction);
  if (!clan) return;
  const identity = await resolveIdentity(interaction, userId);
  if (!identity) {
    await interaction.editReply({ content: "Couldn't resolve that member." });
    return;
  }

  switch (action) {
    case "complete": {
      const res = await applyProgress(clan, identity, { kind: "complete" }, officer(interaction));
      await interaction.editReply({ content: `✅ **${identity.displayName}** marked complete — ${formatProgress(clan, res.member)}.` });
      return;
    }
    case "remind": {
      const member = await getMember(clan.guildId, userId);
      const status = member ? statusOf(clan, member) : "notStarted";
      if (status === "complete" || status === "exempt" || status === "leave") {
        await interaction.editReply({ content: `**${identity.username}** is ${STATUS_LABEL[status].toLowerCase()} — no reminder needed.` });
        return;
      }
      const prior = await recentReminder(clan, userId);
      if (prior) {
        await interaction.editReply({ content: `🔕 **${identity.username}** was already reminded ${discordRelative(prior.createdAt)} — skipping to avoid a double-ping.` });
        return;
      }
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (!user) {
        await interaction.editReply({ content: "Couldn't reach that member to remind them." });
        return;
      }
      const { delivered } = await sendReminder({
        client: interaction.client,
        clan,
        target: user,
        member,
        auto: false,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
      });
      await interaction.editReply({ content: delivered ? `🔔 Reminder sent to **${identity.username}**.` : `🔔 Reminder recorded, but couldn't be delivered.` });
      return;
    }
    case "warn": {
      if (!isAdmin(interaction.member, clan)) {
        await interaction.editReply({ content: "Only admins can issue warnings. Officers can use Remind." });
        return;
      }
      if (await recentWarning(clan.guildId, userId)) {
        await interaction.editReply({ content: `🛑 **${identity.username}** was warned recently — not issuing a duplicate.` });
        return;
      }
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (!user) {
        await interaction.editReply({ content: "Couldn't reach that member to warn them." });
        return;
      }
      const { activeCount } = await issueWarning({
        client: interaction.client,
        clan,
        guild: interaction.guild!,
        target: user,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
        reason: `Missed the weekly ${clan.activityName} goal.`,
      });
      await interaction.editReply({ content: `⚠️ Warned **${identity.username}** — now **${activeCount}** active warning(s).` });
      return;
    }
  }
}

export async function handleMemberPanelModal(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction);
  if (!clan) return;
  const { arg } = parseId(interaction.customId);
  const [kind = "add", userId = ""] = (arg ?? "").split("-");
  const identity = await resolveIdentity(interaction, userId);
  if (!identity) {
    await interaction.editReply({ content: "Couldn't resolve that member." });
    return;
  }
  const raw = interaction.fields.getTextInputValue("amount").replace(/[^0-9]/g, "");
  const amount = parseInt(raw, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    await interaction.editReply({ content: "Enter a positive number." });
    return;
  }
  const res = await applyProgress(
    clan,
    identity,
    kind === "remove" ? { kind: "remove", amount } : { kind: "add", amount },
    officer(interaction)
  );
  await interaction.editReply({
    content: `${res.completedNow ? "🎉" : "✅"} **${identity.displayName}** — ${formatProgress(clan, res.member)} _(was ${res.before.toLocaleString()})_`,
  });
}
