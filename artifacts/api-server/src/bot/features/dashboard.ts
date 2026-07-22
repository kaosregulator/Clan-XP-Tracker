import { AttachmentBuilder, type Client, type TextBasedChannel } from "discord.js";
import type { Clan, DashboardType } from "@workspace/db";
import { logger } from "../../lib/logger";
import { todaySnapshot, streakLeaderboard } from "../services/stats";
import { activityDate, relative, nextReset } from "../services/time";
import { getDashboard, upsertDashboard, setDashboardMessage } from "../services/dashboards";
import { renderAdminHub } from "../canvas/cards/adminHub";
import { renderClanDashboard } from "../canvas/cards/clanDashboard";
import { renderPatriotDashboard } from "../canvas/cards/patriotDashboard";
import { renderLeaderboardCard } from "../canvas/cards/leaderboardCard";
import { patriotOverview } from "../services/accounts";

async function renderStaffImage(clan: Clan): Promise<Buffer> {
  const snap = await todaySnapshot(clan);
  return renderAdminHub({
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    activityDate: activityDate(clan),
    deadline: relative(nextReset(clan)),
    totalMembers: snap.totalMembers,
    completed: snap.completed,
    pending: snap.pending,
    missing: snap.missing,
    pendingReviews: snap.pendingReviews,
    warningsToday: snap.warningsToday,
    remindersToday: snap.remindersToday,
    topStreaks: snap.topStreaks,
  });
}

async function renderClanImage(clan: Clan): Promise<Buffer> {
  const [snap, leaders] = await Promise.all([
    todaySnapshot(clan),
    streakLeaderboard(clan.guildId, 5),
  ]);
  return renderClanDashboard({
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    activityDate: activityDate(clan),
    dailyGoal: clan.dailyGoal,
    completed: snap.completed,
    totalMembers: snap.totalMembers,
    deadline: relative(nextReset(clan)),
    leaders: leaders.map((l) => ({ name: l.displayName, streak: l.currentStreak, approved: l.approvedCount })),
  });
}

async function renderLeaderboardImage(clan: Clan): Promise<Buffer> {
  const rows = await streakLeaderboard(clan.guildId, 10);
  return renderLeaderboardCard({
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    subtitle: "Ranked by current streak",
    rows: rows.map((l) => ({ name: l.displayName, streak: l.currentStreak, approved: l.approvedCount })),
  });
}

async function renderPatriotImage(clan: Clan): Promise<Buffer> {
  const overview = await patriotOverview(clan);
  return renderPatriotDashboard({
    communityName: clan.clanName,
    activityDate: activityDate(clan),
    members: overview.members,
    totalAccounts: overview.totalAccounts,
    completedAccounts: overview.completedAccounts,
    rows: overview.rows.map((r) => ({ name: r.name, accounts: r.accounts })),
  });
}

/** Post or edit a single dashboard message in place. */
async function upsertDashboardMessage(
  client: Client,
  clan: Clan,
  type: DashboardType,
  channelId: string,
  image: Buffer,
  filename: string
) {
  const record = await upsertDashboard(clan.guildId, type, channelId);
  let channel: TextBasedChannel | null = null;
  try {
    channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
  } catch {
    return;
  }
  if (!channel || !("send" in channel)) return;

  const file = new AttachmentBuilder(image, { name: filename });

  if (record.messageId) {
    try {
      const msg = await channel.messages.fetch(record.messageId);
      await msg.edit({ files: [file], attachments: [] });
      return;
    } catch {
      // message was deleted — fall through and post a new one
    }
  }
  const msg = await channel.send({ files: [file] });
  await setDashboardMessage(record.id, msg.id);
}

/** Refresh every configured dashboard for a clan. Best-effort per dashboard. */
export async function refreshDashboards(client: Client, clan: Clan): Promise<void> {
  if (clan.staffDashboardChannelId) {
    try {
      await upsertDashboardMessage(
        client,
        clan,
        "staff",
        clan.staffDashboardChannelId,
        await renderStaffImage(clan),
        "staff-dashboard.png"
      );
    } catch (err) {
      logger.warn({ err, guild: clan.guildId }, "Staff dashboard refresh failed");
    }
  }
  if (clan.clanDashboardChannelId) {
    try {
      await upsertDashboardMessage(
        client,
        clan,
        "clan",
        clan.clanDashboardChannelId,
        await renderClanImage(clan),
        "clan-dashboard.png"
      );
    } catch (err) {
      logger.warn({ err, guild: clan.guildId }, "Clan dashboard refresh failed");
    }
  }
  if (clan.leaderboardChannelId) {
    try {
      await upsertDashboardMessage(
        client,
        clan,
        "leaderboard",
        clan.leaderboardChannelId,
        await renderLeaderboardImage(clan),
        "leaderboard.png"
      );
    } catch (err) {
      logger.warn({ err, guild: clan.guildId }, "Leaderboard dashboard refresh failed");
    }
  }
  if (clan.altAccountsEnabled && clan.patriotDashboardChannelId) {
    try {
      await upsertDashboardMessage(
        client,
        clan,
        "patriot",
        clan.patriotDashboardChannelId,
        await renderPatriotImage(clan),
        "patriot-dashboard.png"
      );
    } catch (err) {
      logger.warn({ err, guild: clan.guildId }, "Patriot dashboard refresh failed");
    }
  }
}
