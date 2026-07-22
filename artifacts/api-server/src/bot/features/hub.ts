import {
  AttachmentBuilder,
  EmbedBuilder,
  type BaseMessageOptions,
  type User,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { ensureMember, identityFromUser, getMember, getClan, isStaff } from "../services/config";
import { todayStatus, recentForUser } from "../services/submissions";
import { relative, formatInZone } from "../services/time";
import { onVacationToday, recordVacation } from "../services/vacations";
import { fetchAvatar } from "../canvas/theme";
import { renderMemberHub, type DayState, type AccountRow } from "../canvas/cards/memberHub";
import { memberHubComponents } from "../ui/components";
import { parseId } from "../ui/ids";
import { handleSubmitButton } from "./submit";
import { scheduleTrackerRefresh } from "./tracker";
import { postVacationCard } from "./xpcard";
import { accountStatesToday } from "../services/accounts";
import { handleAccountsButton, handleAddAccountButton } from "./accounts";

/**
 * Build the full /xp member hub message (canvas image + buttons) for a user.
 * Ephemeral by default so the hub feels personal and doesn't clutter channels.
 */
export async function buildMemberHub(clan: Clan, user: User, displayName?: string): Promise<BaseMessageOptions> {
  const identity = identityFromUser(user, displayName);
  const member = await ensureMember(clan.guildId, identity);
  let status: DayState = await todayStatus(clan, user.id);
  if (status === "missing" && (await onVacationToday(clan, user.id))) status = "vacation";
  const avatar = await fetchAvatar(identity.avatarUrl);

  const reviewed = member.approvedCount + member.rejectedCount;
  const approvalRate = reviewed > 0 ? member.approvedCount / reviewed : 0;

  let accounts: AccountRow[] | undefined;
  if (clan.altAccountsEnabled) {
    const states = await accountStatesToday(clan, user.id);
    if (states.length > 1) accounts = states.map((s) => ({ label: s.account.label, state: s.state }));
  }

  const png = renderMemberHub({
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    gameName: clan.gameName || "Roblox",
    displayName: identity.displayName,
    avatar,
    dailyGoal: clan.dailyGoal,
    status,
    currentStreak: member.currentStreak,
    longestStreak: member.longestStreak,
    warnings: member.warningsCount,
    approvalRate,
    totalApproved: member.approvedCount,
    lastActivity: member.lastApprovedAt ? relative(member.lastApprovedAt) : "never",
    vacations: member.vacationCount,
    accounts,
  });

  return {
    files: [new AttachmentBuilder(png, { name: "hub.png" })],
    components: memberHubComponents(clan),
  };
}

/** Message shown when a server hasn't completed setup yet. */
export function notConfiguredMessage(isStaffUser: boolean): BaseMessageOptions {
  const hint = isStaffUser
    ? "Run **/setup** to launch the setup wizard and configure this server."
    : "This server hasn't been set up yet. Ask an admin to run **/setup**.";
  return { content: `🧩 **Not configured yet.**\n${hint}` };
}

/** Re-fetch the member row (used after mutations to render fresh stats). */
export async function refreshedMember(clan: Clan, userId: string) {
  return getMember(clan.guildId, userId);
}

async function historyEmbed(clan: Clan, user: User): Promise<EmbedBuilder> {
  const recent = await recentForUser(clan.guildId, user.id, 6);
  const glyph = { approved: "✅", rejected: "⛔", pending: "⏳" } as Record<string, string>;
  const body = recent.length
    ? recent
        .map(
          (s) =>
            `${glyph[s.status] ?? "•"} **${s.activityDate}** — ${s.status} · ${formatInZone(s.submittedAt, clan)}`
        )
        .join("\n")
    : "_No submissions yet. Post a screenshot in the submission channel to get started._";
  return new EmbedBuilder().setColor(0x5865f2).setTitle("Your recent activity").setDescription(body);
}

/** /xp — open the member hub (ephemeral). */
export async function sendMemberHub(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(isStaff(interaction.member, null)), flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const payload = await buildMemberHub(clan, interaction.user, interaction.member.displayName);
  await interaction.editReply(payload);
}

/** Route the member-hub buttons (submit / progress / history / refresh). */
export async function handleXpButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(false), flags: 64 });
    return;
  }
  const { action } = parseId(interaction.customId);

  switch (action) {
    case "submit":
      return handleSubmitButton(interaction, clan);
    case "vacation":
      return handleVacation(interaction, clan);
    case "accounts":
      return handleAccountsButton(interaction, clan);
    case "addAccount":
      return handleAddAccountButton(interaction);
    case "refresh": {
      await interaction.deferUpdate();
      const payload = await buildMemberHub(clan, interaction.user, interaction.member.displayName);
      await interaction.editReply(payload);
      return;
    }
    case "progress": {
      await interaction.deferReply({ flags: 64 });
      const payload = await buildMemberHub(clan, interaction.user, interaction.member.displayName);
      const embed = await historyEmbed(clan, interaction.user);
      await interaction.editReply({ ...payload, embeds: [embed] });
      return;
    }
    case "history": {
      await interaction.deferReply({ flags: 64 });
      const embed = await historyEmbed(clan, interaction.user);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    default:
      return;
  }
}

/** Vacation button — records a negative "can't do it today" mark. */
async function handleVacation(interaction: ButtonInteraction, clan: Clan) {
  if (!interaction.inCachedGuild()) return;
  const identity = identityFromUser(interaction.user, interaction.member.displayName);
  const { recorded } = await recordVacation(clan, identity);
  if (recorded) {
    await postVacationCard(interaction.client, clan, identity); // visible vacation card
    scheduleTrackerRefresh(interaction.client, clan);
  }
  await interaction.reply({
    content: recorded
      ? `🏝️ You're marked **on vacation** for today. This is logged and counts against your record — it does not complete the day.`
      : `You're already marked on vacation for today.`,
    flags: 64,
  });
}
