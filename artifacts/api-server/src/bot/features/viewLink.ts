/**
 * Staff /viewlink — officers & admins open a private clan player dashboard.
 * Ephemeral so warning/activity breakdowns stay out of the channel.
 */
import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { getClan, ensureMember, getMember, isOfficer } from "../services/config";
import {
  buildPlayerProfile,
  memberHasCombatSupportRole,
} from "../services/player";
import { activityBreakdownForUser } from "../services/activity";
import { warningBreakdownByCategory, cardAvatarPair } from "../services/warnings";
import { canvasStandingLabel } from "../services/progress";
import { renderOffThread } from "../canvas/render-pool";
import { replaceHubCard, clearHubCard } from "../ui/hubMessage";
import { armHubAutoDelete } from "../ui/hubVisibility";
import { notConfiguredMessage } from "./xp";
import { rankedCleanStanding, handleMemberSearchAutocomplete } from "./leaderboard";

function fmtDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function handleViewLink(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({
      content: "Only officers and admins can use **/viewlink** — it shows detailed standing and warning breakdowns.",
    });
    return;
  }

  const target =
    interaction.options.getUser("user") ??
    (interaction.options.get("member")?.value
      ? await interaction.client.users.fetch(String(interaction.options.get("member")!.value)).catch(() => null)
      : null);

  if (!target || target.bot) {
    await interaction.editReply(clearHubCard("Pick a real Discord member to view."));
    return;
  }

  try {
    const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    const identity = {
      userId: target.id,
      username: target.username,
      displayName: guildMember?.displayName || target.displayName || target.username,
      avatarUrl: target.displayAvatarURL({ size: 256, extension: "png" }),
    };
    let member = await getMember(clan.guildId, target.id);
    if (!member) {
      member = await ensureMember(clan.guildId, identity);
    }

    const { neverWarned, roleName, members } = await rankedCleanStanding(clan, interaction.guild);
    const podium = neverWarned.slice(0, 3).map((m, i) => {
      const faces = cardAvatarPair(m, m.avatarUrl);
      return {
        rank: i + 1,
        username: m.username,
        displayName: m.displayName || m.username,
        avatarUrl: faces.primaryAvatarUrl,
        discordAvatarUrl: faces.discordAvatarUrl,
        robloxAvatarUrl: faces.robloxAvatarUrl,
        cleanPoints: m.cleanPoints ?? 0,
        lifetimeWarnings: m.lifetimeWarnings ?? 0,
        progressLabel: canvasStandingLabel(clan, m),
        roleLabel: roleName ?? undefined,
      };
    });

    const cleanRankIdx = members.findIndex((m) => m.userId === member!.userId);
    const cleanRank = cleanRankIdx >= 0 ? cleanRankIdx + 1 : null;

    const profile = await buildPlayerProfile(clan, member, {
      hasCombatSupportRole: memberHasCombatSupportRole(
        clan,
        guildMember?.roles.cache.keys()
      ),
    });
    const activityRows = await activityBreakdownForUser(clan.guildId, member.userId);
    const warningRows = await warningBreakdownByCategory(clan.guildId, member.userId);
    const faces = cardAvatarPair(
      member,
      guildMember?.displayAvatarURL({ size: 256, extension: "png" }) || member.avatarUrl
    );

    const png = await renderOffThread("viewLinkCard", {
      clanName: clan.clanName,
      trackRoleName: roleName,
      podium,
      username: member.username,
      displayName: member.displayName || member.username,
      discordAvatarUrl: faces.discordAvatarUrl,
      robloxAvatarUrl: faces.robloxAvatarUrl,
      robloxUsername: member.gameUsername,
      robloxLinked: profile.robloxLinked,
      rankTitle: profile.level.title,
      standing: profile.standing,
      standingHint: profile.standingHint,
      level: profile.level.level,
      xpLabel: `${profile.level.xpIntoLevel.toLocaleString()} / ${profile.level.xpForNext.toLocaleString()}`,
      xpPct: profile.level.pct,
      clanPoints: profile.clanPoints,
      weeklyActivityLabel: canvasStandingLabel(clan, member),
      weeklyActivityPct: profile.weeklyActivityPct,
      weeklyActivityDone: profile.weeklyActivityDone,
      combatSupportCount: profile.combatSupportCount,
      hasCombatSupportRole: profile.hasCombatSupportRole,
      activeWarnings: profile.activeWarnings,
      warningCap: profile.warningCap,
      openDisputes: profile.openDisputes,
      cleanPoints: profile.cleanPoints,
      cleanRank,
      discordJoinedLabel: fmtDate(target.createdAt),
      serverJoinedLabel: fmtDate(guildMember?.joinedAt ?? null),
      trackedSinceLabel: fmtDate(profile.memberSince),
      lastActivityLabel: profile.lastActivityLabel,
      activityRows: activityRows.map((r) => ({
        emoji: r.emoji,
        name: r.name,
        points: r.points,
      })),
      warningRows: warningRows.map((r) => ({
        label: r.label,
        count: r.count,
      })),
    });

    const msg = await interaction.editReply(
      replaceHubCard({
        content: `Viewing **${member.displayName || member.username}**`,
        files: [new AttachmentBuilder(png, { name: "view-link.png" })],
      })
    );
    armHubAutoDelete(msg);
  } catch {
    await interaction.editReply(clearHubCard("Couldn't open that player link. Try again."));
  }
}

export { handleMemberSearchAutocomplete as handleViewLinkAutocomplete };
