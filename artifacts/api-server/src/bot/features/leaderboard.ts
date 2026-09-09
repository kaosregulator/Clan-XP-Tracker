/**
 * Clean-standing leaderboard — who can go without warnings.
 */
import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import type { Clan, ClanMember } from "@workspace/db";
import { getClan, isOfficer } from "../services/config";
import { listTracked, formatProgress, statusOf } from "../services/progress";
import { countLifetime, cardAvatarUrl } from "../services/warnings";
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

function toRow(clan: Clan, m: ClanMember, rank: number) {
  return {
    rank,
    username: m.username,
    displayName: m.displayName || m.username,
    avatarUrl: cardAvatarUrl(m, m.avatarUrl),
    cleanPoints: m.cleanPoints ?? 0,
    lifetimeWarnings: m.lifetimeWarnings ?? 0,
    progressLabel: `${formatProgress(clan, m)} · ${statusOf(clan, m)}`,
  };
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
    const raw = await listTracked(clan);
    const members = (await withLifetime(clan, raw))
      .filter((m) => !m.exempt && !m.onLeave)
      .sort(sortClean);
    const neverWarned = members.filter((m) => (m.lifetimeWarnings ?? 0) === 0);
    const podium = neverWarned.slice(0, 3).map((m, i) => toRow(clan, m, i + 1));
    const rows = members.slice(0, 10).map((m, i) => toRow(clan, m, i + 1));
    const png = await renderOffThread("leaderboardCard", {
      communityName: clan.clanName,
      podium,
      rows,
      neverWarnedCount: neverWarned.length,
      trackedCount: members.length,
    });
    const msg = await interaction.editReply(
      replaceHubCard({
        files: [new AttachmentBuilder(png, { name: "clean-leaderboard.png" })],
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
  const members = await listTracked(clan);
  const hits = (q ? members.filter((m) => {
    return (
      m.username.toLowerCase().includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      (m.gameUsername?.toLowerCase().includes(q) ?? false)
    );
  }) : members)
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
export async function cleanRankOf(clan: Clan, userId: string): Promise<number | null> {
  const raw = await listTracked(clan);
  const members = (await withLifetime(clan, raw))
    .filter((m) => !m.exempt && !m.onLeave)
    .sort(sortClean);
  const idx = members.findIndex((m) => m.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}
