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
import { type DayState, type AccountRow } from "../canvas/cards/memberHub";
import { renderOffThread } from "../canvas/render-pool";
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

  // Run all independent DB fetches in parallel. Avatar download is handled
  // by the render worker thread — no need to fetch it here.
  const [member, rawStatus, altStates] = await Promise.all([
    ensureMember(clan.guildId, identity),
    todayStatus(clan, user.id),
    clan.altAccountsEnabled
      ? accountStatesToday(clan, user.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof accountStatesToday>>),
  ]);

  // onVacationToday is only needed when status is "missing"; check it after.
  let status: DayState = rawStatus;
  if (status === "missing" && (await onVacationToday(clan, user.id))) status = "vacation";

  const reviewed = member.approvedCount + member.rejectedCount;
  const approvalRate = reviewed > 0 ? member.approvedCount / reviewed : 0;

  let accounts: AccountRow[] | undefined;
  if (clan.altAccountsEnabled && altStates.length > 1) {
    accounts = altStates.map((s) => ({ label: s.account.label, state: s.state }));
  }

  const png = await renderOffThread("memberHub", {
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    gameName: clan.gameName || "Roblox",
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
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
  // Defer BEFORE any async work so the 3-second Discord window never expires
  // on a slow first DB connection.
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isStaff(interaction.member, null)));
    return;
  }
  const payload = await buildMemberHub(clan, interaction.user, interaction.member.displayName);
  await interaction.editReply(payload);
}

/** Route the member-hub buttons (submit / progress / history / refresh). */
export async function handleXpButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  // Parse the action from the custom ID first (sync — no DB) so we can defer
  // before fetching the clan and beat the 3-second Discord window.
  const { action } = parseId(interaction.customId);

  // Defer early for actions that need it. "submit", "vacation", "accounts" and
  // "addAccount" respond via modal or immediate reply so we must NOT defer them.
  if (action === "refresh") {
    await interaction.deferUpdate();
  } else if (action === "progress" || action === "history") {
    await interaction.deferReply({ flags: 64 });
  }

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    if (interaction.deferred) {
      await interaction.editReply(notConfiguredMessage(false));
    } else {
      await interaction.reply({ ...notConfiguredMessage(false), flags: 64 });
    }
    return;
  }

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
      const payload = await buildMemberHub(clan, interaction.user, interaction.member.displayName);
      await interaction.editReply(payload);
      return;
    }
    case "progress": {
      const [payload, embed] = await Promise.all([
        buildMemberHub(clan, interaction.user, interaction.member.displayName),
        historyEmbed(clan, interaction.user),
      ]);
      await interaction.editReply({ ...payload, embeds: [embed] });
      return;
    }
    case "history": {
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
  // Defer first — recordVacation + postVacationCard are async and can exceed
  // Discord's 3-second acknowledgement window on a cold DB connection.
  await interaction.deferReply({ flags: 64 });
  const identity = identityFromUser(interaction.user, interaction.member.displayName);
  const { recorded } = await recordVacation(clan, identity);
  if (recorded) {
    await postVacationCard(interaction.client, clan, identity); // visible vacation card
    scheduleTrackerRefresh(interaction.client, clan);
  }
  await interaction.editReply({
    content: recorded
      ? `🏝️ You're marked **on vacation** for today. This is logged and counts against your record — it does not complete the day.`
      : `You're already marked on vacation for today.`,
  });
}
