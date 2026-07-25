import {
  AttachmentBuilder,
  EmbedBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { Clan } from "@workspace/db";
import { todaySnapshot, missingMembers, streakLeaderboard } from "../services/stats";
import { pendingQueue } from "../services/submissions";
import { activityDate, relative, nextReset, formatInZone } from "../services/time";
import { getClan, isStaff } from "../services/config";
import { renderOffThread } from "../canvas/render-pool";
import { adminHubComponents } from "../ui/components";
import { parseId } from "../ui/ids";
import { notConfiguredMessage } from "./hub";
import { refreshDashboards } from "./dashboard";
import { refreshTracker } from "./tracker";
import { exportGuildData } from "../services/export";

/** Build the /xpadmin staff operations hub (canvas image + buttons). */
export async function buildAdminHub(clan: Clan): Promise<BaseMessageOptions> {
  const snap = await todaySnapshot(clan);
  const png = await renderOffThread("adminHub", {
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

  return {
    files: [new AttachmentBuilder(png, { name: "admin.png" })],
    components: adminHubComponents(),
  };
}

async function requireStaff(
  interaction: ChatInputCommandInteraction | ButtonInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(isStaff(interaction.member, null)), flags: 64 });
    return null;
  }
  if (!isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "This hub is for staff only.", flags: 64 });
    return null;
  }
  return clan;
}

/** /xpadmin — open the staff operations hub (ephemeral). */
export async function sendAdminHub(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  // Defer BEFORE the DB lookup so the 3-second window never expires on a cold
  // Postgres connection. Staff/config checks move to editReply.
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isStaff(interaction.member, null)));
    return;
  }
  if (!isStaff(interaction.member, clan)) {
    await interaction.editReply({ content: "This hub is for staff only." });
    return;
  }
  await interaction.editReply(await buildAdminHub(clan));
}

function jumpLink(guildId: string, channelId: string | null, messageId: string | null): string | null {
  if (!channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Route the admin-hub buttons (queue / missing / leaderboard / refresh). */
export async function handleAdminButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action } = parseId(interaction.customId);

  // Defer before any DB work to beat the 3-second Discord window.
  if (action === "refresh") {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: 64 });
  }

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(false));
    return;
  }
  if (!isStaff(interaction.member, clan)) {
    await interaction.editReply({ content: "This hub is for staff only." });
    return;
  }

  if (action === "refresh") {
    await interaction.editReply(await buildAdminHub(clan));
    return;
  }

  if (action === "export") {
    const data = await exportGuildData(clan.guildId);
    const buf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    const stamp = new Date().toISOString().slice(0, 10);
    const c = (data.counts as Record<string, number>) ?? {};
    await interaction.editReply({
      content: `💾 **Backup** — ${c.members ?? 0} members · ${c.submissions ?? 0} submissions · ${c.warnings ?? 0} warnings. Your live data always stays in the database; this is a copy you can keep.`,
      files: [new AttachmentBuilder(buf, { name: `xp-backup-${clan.guildId}-${stamp}.json` })],
    });
    return;
  }

  if (action === "dashboards") {
    await refreshDashboards(interaction.client, clan);
    await refreshTracker(interaction.client, clan);
    const set = [
      clan.trackerChannelId && `tracker → <#${clan.trackerChannelId}>`,
      clan.clanDashboardChannelId && `clan → <#${clan.clanDashboardChannelId}>`,
      clan.staffDashboardChannelId && `staff → <#${clan.staffDashboardChannelId}>`,
      clan.altAccountsEnabled && clan.patriotDashboardChannelId && `patriot → <#${clan.patriotDashboardChannelId}>`,
    ].filter(Boolean);
    await interaction.editReply(
      set.length
        ? `📊 Posted/updated: ${set.join(" · ")}`
        : "No dashboard channels are set yet. Add them in **/setup → Dashboards** (and a Tracker channel)."
    );
    return;
  }

  if (action === "queue") {
    const pending = await pendingQueue(clan.guildId, 15);
    const body = pending.length
      ? pending
          .map((s) => {
            const link = jumpLink(clan.guildId, clan.reviewChannelId, s.reviewMessageId);
            const label = `**#${s.id}** <@${s.userId}> · ${s.activityDate} · ${formatInZone(s.submittedAt, clan)}`;
            return link ? `${label} — [open](${link})` : label;
          })
          .join("\n")
      : "🎉 The review queue is empty.";
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle("Review queue").setDescription(body)],
    });
    return;
  }

  if (action === "missing") {
    const missing = await missingMembers(clan, 40);
    const body = missing.length
      ? missing.map((m) => `<@${m.userId}>`).join(" ")
      : "✅ Everyone has completed today. Nice.";
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(`Missing today — ${missing.length}`)
          .setDescription(body.slice(0, 4000)),
      ],
    });
    return;
  }

  if (action === "leaderboard") {
    const rows = await streakLeaderboard(clan.guildId, 10);
    const medals = ["🥇", "🥈", "🥉"];
    const body = rows.length
      ? rows
          .map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.userId}> — 🔥 **${r.currentStreak}** · ${r.approvedCount} approved`)
          .join("\n")
      : "No activity yet.";
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle("Streak leaderboard").setDescription(body)],
    });
    return;
  }
}
