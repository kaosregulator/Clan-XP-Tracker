import {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type ModalActionRowComponentBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { getClan, identityFromUser, ensureMember } from "../services/config";
import { ensureAccounts, listAccounts, addAccount, removeAccount, accountStatesToday } from "../services/accounts";
import { createPendingSubmission } from "../services/submissions";
import {
  XP_ADD_ACCOUNT,
  XP_ADD_ACCOUNT_MODAL,
  XP_REMOVE_ACCOUNT,
  XP_SUBMIT_ACCOUNT,
} from "../ui/ids";

const STATE_GLYPH = { done: "✅", pending: "⏳", missing: "⬜" } as const;

async function accountsPayload(clan: Clan, userId: string): Promise<BaseMessageOptions> {
  const states = await accountStatesToday(clan, userId);
  const lines = states
    .map((s) => `${STATE_GLYPH[s.state]} **${s.account.label}**${s.account.isMain ? " · main" : ""}`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("👥 My Accounts")
    .setDescription(`Track each account you manage. Today's status:\n\n${lines}`)
    .setFooter({ text: "Each account needs its own screenshot each day." });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(XP_ADD_ACCOUNT).setStyle(ButtonStyle.Success).setLabel("Add account")
    ),
  ];

  const removable = states.filter((s) => !s.account.isMain);
  if (removable.length) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(XP_REMOVE_ACCOUNT)
          .setPlaceholder("Remove an alt account…")
          .addOptions(removable.map((s) => ({ label: s.account.label, value: String(s.account.id) })))
      )
    );
  }

  return { embeds: [embed], components: rows };
}

export async function handleAccountsButton(interaction: ButtonInteraction, clan: Clan) {
  await ensureAccounts(clan.guildId, interaction.user.id);
  await interaction.reply({ ...(await accountsPayload(clan, interaction.user.id)), flags: 64 });
}

export async function handleAddAccountButton(interaction: ButtonInteraction) {
  const modal = new ModalBuilder().setCustomId(XP_ADD_ACCOUNT_MODAL).setTitle("Add an account");
  modal.addComponents(
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("label")
        .setLabel("Account label")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Alt 1, Guardian, Recruiter")
        .setRequired(true)
        .setMaxLength(40)
    )
  );
  await interaction.showModal(modal);
}

export async function handleAddAccountModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const label = interaction.fields.getTextInputValue("label");
  const result = await addAccount(clan, interaction.user.id, label);
  if (!result.ok) {
    await interaction.reply({ content: `⚠️ ${result.reason}`, flags: 64 });
    return;
  }
  await interaction.reply({ ...(await accountsPayload(clan, interaction.user.id)), flags: 64 });
}

export async function handleRemoveAccountSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) return;
  const accountId = Number(interaction.values[0]);
  await removeAccount(clan.guildId, interaction.user.id, accountId);
  await interaction.update(await accountsPayload(clan, interaction.user.id));
}

/**
 * When alt accounts are enabled, the Submit button offers an account picker.
 * Choosing one opens a pending submission tagged to that account and prompts
 * the member to post their screenshot (linked by handleSubmissionMessage).
 */
export async function handleSubmitAccountSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) return;

  const accountId = Number(interaction.values[0]);
  const accounts = await listAccounts(clan.guildId, interaction.user.id);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    await interaction.update({ content: "That account no longer exists.", embeds: [], components: [] });
    return;
  }

  const identity = identityFromUser(interaction.user, interaction.member.displayName);
  await ensureMember(clan.guildId, identity);
  await createPendingSubmission({
    clan,
    identity,
    accountId: account.id,
    accountLabel: account.label,
  });

  await interaction.update({
    content:
      `📸 **Submitting for ${account.label}.**\n` +
      `Now post your screenshot in <#${clan.submissionChannelId}> within the next few minutes — ` +
      `I'll attach it to this account automatically.`,
    embeds: [],
    components: [],
  });
}

/** Build the account-picker shown by the Submit button (alt accounts enabled). */
export async function submitAccountPicker(clan: Clan, userId: string): Promise<BaseMessageOptions> {
  const states = await accountStatesToday(clan, userId);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(XP_SUBMIT_ACCOUNT)
    .setPlaceholder("Which account are you submitting for?")
    .addOptions(
      states.slice(0, 25).map((s) => ({
        label: s.account.label,
        description: s.state === "done" ? "already complete today" : s.state === "pending" ? "in review" : "not submitted",
        value: String(s.account.id),
      }))
    );
  return {
    content: `📸 **Submit ${clan.activityName || "XP"}** — pick the account:`,
    components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)],
  };
}
