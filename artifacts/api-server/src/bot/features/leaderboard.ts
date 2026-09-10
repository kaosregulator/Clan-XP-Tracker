/**
 * Activity standing leaderboard — who can go without warnings.
 */
import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type Guild,
} from "discord.js";
import type { Clan, ClanMember } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { listTracked, canvasStandingLabel } from "../services/progress";
import { countLifetime, cardAvatarPair } from "../services/warnings";
import { renderOffThread } from "../canvas/render-pool";
import { replaceHubCard, clearHubCard } from "../ui/hubMessage";
import { armHubAutoDelete } from "../ui/hubVisibility";
import { notConfiguredMessage } from "./xp";

function sortClean(a: ClanMember, b: ClanMember): number {
  const aNever = (a.lifetimeWarnings ?? 0) === 0 ? 1 : 0;
  const bNever = (b.lifetimeWarnings ?? 0) === 0 ? 1 : 0;
  if (aNever !== bNever) return bNever - aNever;
  if (b.cleanPoints !== a.cleanPoints) return b.cleanPoints - a.cleanPoints;
  if (a.lifetimeWarnings !== b.lifetimeWarnings) return a.lifetimeWarnings - b.lifetimeWarnings;
  return a.displayName.localeCompare(b.displayName);
}

async function withLifetime(clan: Clan, members: ClanMember[]): Promise<ClanMember[]> {
  const out: ClanMember[] = [];
  for (const m of members) {
    if ((m.lifetimeWarnings ?? 0) === 0) {
      const life = await countLifetime(clan.guildId, m.userId);
      if (life > 0) {
        out.push({ ...m, lifetimeWarnings: life });
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

function trackRoleName(clan: Clan, guild: Guild | null): string | null {
  if (!clan.requiredRoleId || !guild) return null;
  return guild.roles.cache.get(clan.requiredRoleId)?.name ?? null;
}

function toRow(clan: Clan, m: ClanMember, rank: number, roleName: string | null) {
  const faces = cardAvatarPair(m, m.avatarUrl);
  return {
    rank,
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
}

/** Ranked clean-standing list for leaderboard + /viewlink podium. */
export async function rankedCleanStanding(
  clan: Clan,
  guild: Guild | null
): Promise<{ members: ClanMember[]; neverWarned: ClanMember[]; roleName: string | null }> {
  const raw = await listTracked(clan, guild);
  const members = (await withLifetime(clan, raw))
    .filter((m) => !m.exempt && !m.onLeave)
    .sort(sortClean);
  const neverWarned = members.filter((m) => (m.lifetimeWarnings ?? 0) === 0);
  return { members, neverWarned, roleName: trackRoleName(clan, guild) };
}

export async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply();
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  try {
    const { members, neverWarned, roleName } = await rankedCleanStanding(clan, interaction.guild);
    const podium = neverWarned.slice(0, 3).map((m, i) => toRow(clan, m, i + 1, roleName));
    const rows = members.slice(0, 10).map((m, i) => toRow(clan, m, i + 1, roleName));
    const png = await renderOffThread("leaderboardCard", {
      communityName: clan.clanName,
      trackRoleName: roleName,
      podium,
      rows,
      neverWarnedCount: neverWarned.length,
      trackedCount: members.length,
    });
    const msg = await interaction.editReply(
      replaceHubCard({
        files: [new AttachmentBuilder(png, { name: "activity-leaderboard.png" })],
      })
    );
    armHubAutoDelete(msg);
  } catch {
    await interaction.editReply(clearHubCard("Couldn't render the leaderboard. Try again."));
  }
}

/** Autocomplete tracked members by username / display name (top 10). */
export async function handleMemberSearchAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }
  const q = String(interaction.options.getFocused(true).value ?? "")
    .trim()
    .toLowerCase();
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.respond([]);
    return;
  }
  const members = await listTracked(clan, interaction.guild);
  const hits = (q
    ? members.filter((m) => {
        return (
          m.username.toLowerCase().includes(q) ||
          m.displayName.toLowerCase().includes(q) ||
          (m.gameUsername?.toLowerCase().includes(q) ?? false)
        );
      })
    : members)
    .slice(0, 10)
    .map((m) => ({
      name: `${m.displayName || m.username}${m.gameUsername ? ` · ${m.gameUsername}` : ""}`.slice(
        0,
        100
      ),
      value: m.userId,
    }));
  await interaction.respond(hits).catch(() => {});
}

/** Rank of a member on the clean leaderboard (1-based), or null if not ranked. */
export async function cleanRankOf(clan: Clan, userId: string, guild?: Guild | null): Promise<number | null> {
  const { members } = await rankedCleanStanding(clan, guild ?? null);
  const idx = members.findIndex((m) => m.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}
