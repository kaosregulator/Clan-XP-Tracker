import {
  AttachmentBuilder,
  EmbedBuilder,
  type BaseMessageOptions,
  type Client,
  type TextBasedChannel,
} from "discord.js";
import type { Clan, DashboardType, AuditLog } from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  todaySnapshot,
  streakLeaderboard,
  missingMembers,
} from "../services/stats";
import { nextReset, discordRelative } from "../services/time";
import { clanCapacity } from "../services/contributions";
import { patriotOverview } from "../services/accounts";
import {
  clanXpStats,
  inactiveCount,
  verificationQueueCount,
  recentActivity,
  type ClanXpStats,
  type Contributor,
} from "../services/dashboardStats";
import { upsertDashboard, setDashboardMessage } from "../services/dashboards";
import { renderOffThread } from "../canvas/render-pool";

/* ------------------------------------------------------------------ helpers */

/** A compact unicode progress bar, value 0..1. */
function bar(value: number, size = 10): string {
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * size);
  return "█".repeat(filled) + "░".repeat(size - filled);
}

function xp(n: number): string {
  return n.toLocaleString();
}

/** "Name — 12,000 XP" contributor lines with medals. */
function contributorLines(rows: Contributor[]): string {
  if (!rows.length) return "_No contributions yet._";
  const medals = ["🥇", "🥈", "🥉"];
  return rows
    .map(
      (r, i) =>
        `${medals[i] ?? `**${i + 1}.**`} **${r.name}** — ${xp(r.xp)} XP`,
    )
    .join("\n");
}

const ACTION_GLYPH: Record<string, string> = {
  submission_approved: "✅",
  submission_rejected: "⛔",
  warning_issued: "⚠️",
  warning_removed: "♻️",
  reminder_sent: "🔔",
};

/** Turn an audit-log row into a one-line human summary. */
function activityLine(clan: Clan, log: AuditLog): string {
  const glyph = ACTION_GLYPH[log.action] ?? "•";
  const who = log.targetUsername ? `**${log.targetUsername}**` : "";
  const label =
    {
      submission_approved: `approved`,
      submission_rejected: `rejected`,
      warning_issued: `warned`,
      warning_removed: `warning removed for`,
      reminder_sent: `reminded`,
    }[log.action] ?? log.action.replace(/_/g, " ");
  return `${glyph} ${label} ${who} · ${discordRelative(log.createdAt)}`.trim();
}

/** Goal + capacity progress block shared by the clan & admin dashboards. */
function goalBlock(
  clan: Clan,
  snap: Awaited<ReturnType<typeof todaySnapshot>>,
  xpStats: ClanXpStats,
  cap: Awaited<ReturnType<typeof clanCapacity>>,
): string {
  const todayGoal =
    snap.totalMembers > 0 ? snap.completed / snap.totalMembers : 0;
  const weekGoal =
    snap.totalMembers > 0
      ? xpStats.memberDaysWeek / (snap.totalMembers * 7)
      : 0;
  const lines = [
    `**Weekly Goal**\n${bar(weekGoal)} ${Math.round(weekGoal * 100)}%`,
    `**Today's Goal**\n${bar(todayGoal)} ${Math.round(todayGoal * 100)}%`,
  ];
  if (clan.clanDailyLimit > 0 && cap.contributionCap > 0) {
    lines.push(
      `**Clan Capacity**\n${bar(cap.pct / 100)} ${cap.contributions}/${cap.contributionCap}${cap.maxed ? " · MAXED" : ""}`,
    );
  }
  return lines.join("\n\n");
}

/* ------------------------------------------------------------- embed builders */

/** Clan dashboard (public): totals, goals, top contributors, rank. */
async function buildClanEmbed(clan: Clan): Promise<EmbedBuilder> {
  const [snap, xpStats, cap] = await Promise.all([
    todaySnapshot(clan),
    clanXpStats(clan),
    clanCapacity(clan),
  ]);
  const activity = clan.activityName || "XP";

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor({ name: `${clan.clanName} • ${activity} Tracker` })
    .setTitle("📊 Clan Dashboard")
    .setDescription(
      (clan.clanRank ? `🏅 **Clan Rank:** ${clan.clanRank}\n\n` : "") +
        goalBlock(clan, snap, xpStats, cap),
    )
    .addFields(
      {
        name: `Total Clan ${activity}`,
        value: xp(xpStats.totalXp),
        inline: true,
      },
      { name: `${activity} Today`, value: xp(xpStats.todayXp), inline: true },
      {
        name: `${activity} This Week`,
        value: xp(xpStats.weekXp),
        inline: true,
      },
      {
        name: "Active Members (7d)",
        value: `${xpStats.activeMembers}/${snap.totalMembers}`,
        inline: true,
      },
      {
        name: "Completed Today",
        value: `${snap.completed}/${snap.totalMembers}`,
        inline: true,
      },
      { name: "Resets", value: discordRelative(nextReset(clan)), inline: true },
      {
        name: "🏆 Top Contributors",
        value: contributorLines(xpStats.topContributors),
      },
    )
    .setFooter({ text: "Live · last updated" })
    .setTimestamp(new Date());

  if (clan.clanLogoUrl) embed.setThumbnail(clan.clanLogoUrl);
  return embed;
}

/** Alt dashboard: combined alt XP, alt share, top alt contributors. */
async function buildAltEmbed(clan: Clan): Promise<EmbedBuilder> {
  const xpStats = await clanXpStats(clan);
  const activity = clan.activityName || "XP";

  return new EmbedBuilder()
    .setColor(0xa855f7)
    .setAuthor({ name: `${clan.clanName} • Alt Accounts` })
    .setTitle("👥 Alt Dashboard")
    .setDescription(
      `Alts contribute **${Math.round(xpStats.altPct * 100)}%** of all clan ${activity}.\n${bar(xpStats.altPct)} ${Math.round(xpStats.altPct * 100)}%`,
    )
    .addFields(
      {
        name: `Combined Alt ${activity}`,
        value: xp(xpStats.altTotalXp),
        inline: true,
      },
      {
        name: `Alt ${activity} Today`,
        value: xp(xpStats.altTodayXp),
        inline: true,
      },
      {
        name: `Total Clan ${activity}`,
        value: xp(xpStats.totalXp),
        inline: true,
      },
      {
        name: "🏆 Top Alt Contributors",
        value: contributorLines(xpStats.topAltContributors),
      },
    )
    .setFooter({ text: "Live · last updated" })
    .setTimestamp(new Date());
}

/** Admin dashboard: everything above + operational + moderation + activity log. */
async function buildAdminEmbed(clan: Clan): Promise<EmbedBuilder> {
  const [snap, xpStats, cap, patriots, inactive, verifQueue, missing, recent] =
    await Promise.all([
      todaySnapshot(clan),
      clanXpStats(clan),
      clanCapacity(clan),
      clan.altAccountsEnabled ? patriotOverview(clan) : Promise.resolve(null),
      inactiveCount(clan, 7),
      verificationQueueCount(clan),
      missingMembers(clan, 200),
      recentActivity(clan, 6),
    ]);
  const activity = clan.activityName || "XP";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `${clan.clanName} • Staff` })
    .setTitle("🛠️ Admin Dashboard")
    .setDescription(
      (clan.clanRank ? `🏅 **Clan Rank:** ${clan.clanRank}\n\n` : "") +
        goalBlock(clan, snap, xpStats, cap),
    )
    .addFields(
      // XP overview
      { name: `Total ${activity}`, value: xp(xpStats.totalXp), inline: true },
      { name: `${activity} Today`, value: xp(xpStats.todayXp), inline: true },
      {
        name: `${activity} This Week`,
        value: xp(xpStats.weekXp),
        inline: true,
      },
      // Participation
      {
        name: "Completed Today",
        value: `${snap.completed}/${snap.totalMembers}`,
        inline: true,
      },
      { name: "Active (7d)", value: `${xpStats.activeMembers}`, inline: true },
      { name: "Inactive (7d+)", value: `${inactive}`, inline: true },
      // Queue / moderation
      {
        name: "⏳ Pending Submissions",
        value: `${snap.pendingReviews}`,
        inline: true,
      },
      { name: "🔎 Verification Queue", value: `${verifQueue}`, inline: true },
      {
        name: "🔴 Late / Missed Today",
        value: `${missing.length}`,
        inline: true,
      },
      {
        name: "⚠️ Warnings Today",
        value: `${snap.warningsToday}`,
        inline: true,
      },
      {
        name: "🔔 Reminders Today",
        value: `${snap.remindersToday}`,
        inline: true,
      },
      {
        name: "👥 Patriots / Alts",
        value: patriots
          ? `${patriots.members} · ${patriots.totalAccounts} accts`
          : "off",
        inline: true,
      },
    );

  embed.addFields({
    name: "🏆 Top Contributors",
    value: contributorLines(xpStats.topContributors),
  });
  if (clan.altAccountsEnabled) {
    embed.addFields({
      name: "👥 Top Alt Contributors",
      value: contributorLines(xpStats.topAltContributors),
    });
  }
  embed.addFields({
    name: "🧾 Recent Activity",
    value: recent.length
      ? recent
          .map((r) => activityLine(clan, r))
          .join("\n")
          .slice(0, 1024)
      : "_No recent activity._",
  });

  embed.setFooter({ text: "Live · last updated" }).setTimestamp(new Date());
  return embed;
}

/* ------------------------------------------------------------- leaderboard */

async function renderLeaderboardImage(clan: Clan): Promise<Buffer> {
  const rows = await streakLeaderboard(clan.guildId, 10);
  return renderOffThread("leaderboardCard", {
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    subtitle: "Ranked by current streak",
    rows: rows.map((l) => ({
      name: l.displayName,
      streak: l.currentStreak,
      approved: l.approvedCount,
    })),
  });
}

/* --------------------------------------------------------------- in-place */

/** Post or edit a single dashboard message in place (never reposts on refresh). */
async function upsertDashboardMessage(
  client: Client,
  clan: Clan,
  type: DashboardType,
  channelId: string,
  payload: BaseMessageOptions,
) {
  const record = await upsertDashboard(clan.guildId, type, channelId);
  let channel: TextBasedChannel | null = null;
  try {
    channel = (await client.channels.fetch(
      channelId,
    )) as TextBasedChannel | null;
  } catch {
    return;
  }
  if (!channel || !("send" in channel)) return;

  if (record.messageId) {
    try {
      const msg = await channel.messages.fetch(record.messageId);
      // Clear any prior attachments so a legacy image dashboard becomes an embed.
      await msg.edit({
        embeds: [],
        components: [],
        ...payload,
        attachments: [],
      });
      return;
    } catch {
      // message was deleted — fall through and post a new one
    }
  }
  const msg = await channel.send(payload);
  await setDashboardMessage(record.id, msg.id);
}

/** Refresh every configured dashboard for a clan. Best-effort per dashboard. */
export async function refreshDashboards(
  client: Client,
  clan: Clan,
): Promise<void> {
  const jobs: {
    type: DashboardType;
    channelId: string | null;
    build: () => Promise<BaseMessageOptions>;
  }[] = [
    {
      type: "staff",
      channelId: clan.staffDashboardChannelId,
      build: async () => ({ embeds: [await buildAdminEmbed(clan)] }),
    },
    {
      type: "clan",
      channelId: clan.clanDashboardChannelId,
      build: async () => ({ embeds: [await buildClanEmbed(clan)] }),
    },
    {
      type: "leaderboard",
      channelId: clan.leaderboardChannelId,
      build: async () => ({
        files: [
          new AttachmentBuilder(await renderLeaderboardImage(clan), {
            name: "leaderboard.png",
          }),
        ],
      }),
    },
  ];
  if (clan.altAccountsEnabled && clan.patriotDashboardChannelId) {
    jobs.push({
      type: "patriot",
      channelId: clan.patriotDashboardChannelId,
      build: async () => ({ embeds: [await buildAltEmbed(clan)] }),
    });
  }

  for (const job of jobs) {
    if (!job.channelId) continue;
    try {
      await upsertDashboardMessage(
        client,
        clan,
        job.type,
        job.channelId,
        await job.build(),
      );
    } catch (err) {
      logger.warn(
        { err, guild: clan.guildId, type: job.type },
        "Dashboard refresh failed",
      );
    }
  }
}

/* --------------------------------------------------------------- debounce */

// Coalesce bursts of XP changes (many submissions at once) into one refresh so
// the live dashboards update on data change without spamming Discord edits.
const pendingRefresh = new Map<string, NodeJS.Timeout>();

/** Fire-and-forget, debounced dashboard refresh after any XP-affecting change. */
export function scheduleDashboardRefresh(client: Client, clan: Clan): void {
  const existing = pendingRefresh.get(clan.guildId);
  if (existing) clearTimeout(existing);
  pendingRefresh.set(
    clan.guildId,
    setTimeout(() => {
      pendingRefresh.delete(clan.guildId);
      void refreshDashboards(client, clan);
    }, 4000),
  );
}
