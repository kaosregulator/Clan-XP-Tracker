import {
  EmbedBuilder,
  type BaseMessageOptions,
  type User,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { Clan } from "@workspace/db";
import {
  ensureMember,
  identityFromUser,
  getMember,
  getClan,
  isStaff,
} from "../services/config";
import { todayStatus, recentForUser } from "../services/submissions";
import { relative, formatInZone } from "../services/time";
import { onVacationToday, recordVacation } from "../services/vacations";
import { memberHubComponents } from "../ui/components";
import { parseId } from "../ui/ids";
import { handleSubmitButton } from "./submit";
import { scheduleTrackerRefresh } from "./tracker";
import { scheduleDashboardRefresh } from "./dashboard";
import { postVacationCard } from "./xpcard";
import { accountStatesToday } from "../services/accounts";
import { handleAccountsButton, handleAddAccountButton } from "./accounts";

type DayState = "done" | "pending" | "missing" | "vacation";
interface AccountRow {
  label: string;
  state: DayState;
}

const STATUS_META: Record<
  DayState,
  { label: string; color: number; dot: string; sub: string }
> = {
  done: {
    label: "Complete",
    color: 0x57f287,
    dot: "🟢",
    sub: "You're done for today.",
  },
  pending: {
    label: "In Review",
    color: 0xfaa61a,
    dot: "🟡",
    sub: "Waiting on staff approval.",
  },
  missing: {
    label: "Not Submitted",
    color: 0xed4245,
    dot: "🔴",
    sub: "Submit before today's reset.",
  },
  vacation: {
    label: "On Vacation",
    color: 0x22d3ee,
    dot: "🔵",
    sub: "Marked as away today.",
  },
};
const ACCOUNT_DOT: Record<DayState, string> = {
  done: "🟢",
  pending: "🟡",
  missing: "🔴",
  vacation: "🔵",
};

/** Compact unicode progress bar, value 0..1. */
function progressBar(value: number, size = 14): string {
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

/**
 * Build the full /xp member hub message (embed + buttons) for a user.
 *
 * Rendered as a rich embed rather than a canvas image: no file upload, no
 * off-thread render, and the avatar is a thumbnail URL Discord fetches itself —
 * so the hub appears near-instantly instead of after a multi-second PNG upload.
 *
 * Ephemeral by default so the hub feels personal and doesn't clutter channels.
 * Pass `staff: true` to append the admin-action rows (the "admin profile").
 */
export async function buildMemberHub(
  clan: Clan,
  user: User,
  displayName?: string,
  opts: { staff?: boolean } = {},
): Promise<BaseMessageOptions> {
  const identity = identityFromUser(user, displayName);

  // Run all independent DB fetches in parallel.
  const [member, rawStatus, altStates] = await Promise.all([
    ensureMember(clan.guildId, identity),
    todayStatus(clan, user.id),
    clan.altAccountsEnabled
      ? accountStatesToday(clan, user.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof accountStatesToday>>),
  ]);

  // onVacationToday is only needed when status is "missing"; check it after.
  let status: DayState = rawStatus;
  if (status === "missing" && (await onVacationToday(clan, user.id)))
    status = "vacation";

  const reviewed = member.approvedCount + member.rejectedCount;
  const approvalRate = reviewed > 0 ? member.approvedCount / reviewed : 0;

  let accounts: AccountRow[] | undefined;
  if (clan.altAccountsEnabled && altStates.length > 1) {
    accounts = altStates.map((s) => ({
      label: s.account.label,
      state: s.state as DayState,
    }));
  }

  const activity = clan.activityName || "XP";
  const meta = STATUS_META[status];
  const goalPct = status === "done" ? 1 : status === "pending" ? 0.6 : 0.05;
  const goalLine =
    clan.dailyGoal > 0
      ? `**Daily ${activity} goal:** ${clan.dailyGoal.toLocaleString()}`
      : `**Daily goal:** submit once a day`;

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: `${clan.clanName} • ${activity} Tracker` })
    .setTitle(`${meta.dot} ${identity.displayName} — ${meta.label}`)
    .setDescription(`${meta.sub}\n${goalLine}\n${progressBar(goalPct)}`)
    .addFields(
      {
        name: "🔥 Current Streak",
        value: `${member.currentStreak}`,
        inline: true,
      },
      {
        name: "🏆 Longest Streak",
        value: `${member.longestStreak}`,
        inline: true,
      },
      {
        name: "✅ Approval",
        value: `${Math.round(approvalRate * 100)}%`,
        inline: true,
      },
      { name: "📈 Approved", value: `${member.approvedCount}`, inline: true },
      { name: "⚠️ Warnings", value: `${member.warningsCount}`, inline: true },
      { name: "🏝️ Vacations", value: `${member.vacationCount}`, inline: true },
    )
    .setFooter({
      text: `Last activity: ${member.lastApprovedAt ? relative(member.lastApprovedAt) : "never"}`,
    });

  if (identity.avatarUrl) embed.setThumbnail(identity.avatarUrl);

  if (accounts && accounts.length) {
    embed.addFields({
      name: "Accounts today",
      value: accounts
        .slice(0, 12)
        .map((a) => `${ACCOUNT_DOT[a.state]} ${a.label}`)
        .join("\n")
        .slice(0, 1024),
    });
  }

  return {
    embeds: [embed],
    components: memberHubComponents(clan, opts.staff ?? false),
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
  const glyph = { approved: "✅", rejected: "⛔", pending: "⏳" } as Record<
    string,
    string
  >;
  const body = recent.length
    ? recent
        .map(
          (s) =>
            `${glyph[s.status] ?? "•"} **${s.activityDate}** — ${s.status} · ${formatInZone(s.submittedAt, clan)}`,
        )
        .join("\n")
    : "_No submissions yet. Post a screenshot in the submission channel to get started._";
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Your recent activity")
    .setDescription(body);
}

/** /xp — open the member hub (ephemeral). */
export async function sendMemberHub(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  // Defer BEFORE any async work so the 3-second Discord window never expires
  // on a slow first DB connection.
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(
      notConfiguredMessage(isStaff(interaction.member, null)),
    );
    return;
  }
  const staff = isStaff(interaction.member, clan);
  const payload = await buildMemberHub(
    clan,
    interaction.user,
    interaction.member.displayName,
    { staff },
  );
  await interaction.editReply(payload);
}

/** Route the member-hub buttons (submit / progress / history / refresh). */
export async function handleXpButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  // Parse the action from the custom ID first (sync — no DB) so we can defer
  // before fetching the clan and beat the 3-second Discord window.
  const { action } = parseId(interaction.customId);

  // Defer early for all non-modal actions before the getClan DB call.
  // "submit" and "addAccount" show a modal so they must NOT defer.
  if (action === "refresh") {
    await interaction.deferUpdate();
  } else if (
    action === "progress" ||
    action === "history" ||
    action === "vacation" ||
    action === "accounts"
  ) {
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
      const staff = isStaff(interaction.member, clan);
      const payload = await buildMemberHub(
        clan,
        interaction.user,
        interaction.member.displayName,
        { staff },
      );
      await interaction.editReply(payload);
      return;
    }
    case "progress": {
      const staff = isStaff(interaction.member, clan);
      const [payload, embed] = await Promise.all([
        buildMemberHub(clan, interaction.user, interaction.member.displayName, {
          staff,
        }),
        historyEmbed(clan, interaction.user),
      ]);
      await interaction.editReply({
        ...payload,
        embeds: [...(payload.embeds ?? []), embed],
      });
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
  // Interaction is already deferred by handleXpButton before getClan.
  const identity = identityFromUser(
    interaction.user,
    interaction.member.displayName,
  );
  const { recorded } = await recordVacation(clan, identity);
  if (recorded) {
    await postVacationCard(interaction.client, clan, identity); // visible vacation card
    scheduleTrackerRefresh(interaction.client, clan);
    scheduleDashboardRefresh(interaction.client, clan);
  }
  await interaction.editReply({
    content: recorded
      ? `🏝️ You're marked **on vacation** for today. This is logged and counts against your record — it does not complete the day.`
      : `You're already marked on vacation for today.`,
  });
}
