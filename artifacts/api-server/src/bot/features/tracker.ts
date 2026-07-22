import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type Client,
  type Guild,
  type ButtonInteraction,
  type BaseMessageOptions,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { db, clanMembersTable, xpSubmissionsTable, vacationsTable } from "@workspace/db";
import type { Clan } from "@workspace/db";
import { eq, and, isNull, ne } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getClan, isStaff } from "../services/config";
import { activityDate, relative, nextReset } from "../services/time";
import { sendReminder, reminderSentToday } from "../services/reminders";
import { clanCapacity } from "../services/contributions";
import { getDashboard, upsertDashboard, setDashboardMessage } from "../services/dashboards";
import { renderTrackerCard } from "../canvas/cards/trackerCard";
import { TRACKER_REMIND, TRACKER_REFRESH, TRACKER_CHECK } from "../ui/ids";

interface Progress {
  total: number;
  completedIds: string[];
  vacationIds: string[];
  missingIds: string[];
  overflowIds: string[];
}

/* ----------------------------------------------------------- member cache */
// Fetching every guild member on each refresh is the main source of admin
// slowness. Cache the required-role member ids per guild with a short TTL.
const roleMemberCache = new Map<string, { ids: string[]; at: number }>();
const ROLE_CACHE_TTL = 5 * 60_000;

/** Clear a guild's role-member cache (e.g. on member join/leave). */
export function invalidateRoleCache(guildId: string): void {
  roleMemberCache.delete(guildId);
}

async function requiredMemberIds(guild: Guild, clan: Clan): Promise<string[]> {
  if (!clan.requiredRoleId) {
    const rows = await db
      .select({ userId: clanMembersTable.userId })
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, clan.guildId));
    return rows.map((r) => r.userId);
  }
  const cached = roleMemberCache.get(clan.guildId);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL) return cached.ids;

  await guild.members.fetch().catch(() => null); // populate the member cache
  const role = guild.roles.cache.get(clan.requiredRoleId);
  const ids = role ? [...role.members.values()].filter((m) => !m.user.bot).map((m) => m.id) : [];
  roleMemberCache.set(clan.guildId, { ids, at: Date.now() });
  return ids;
}

/**
 * Role-scoped progress for today: who among the required-role members has
 * submitted, is on vacation, or is still missing — plus who did overflow XP.
 */
async function computeProgress(guild: Guild, clan: Clan): Promise<Progress> {
  const today = activityDate(clan);
  const [requiredIds, subs, vac] = await Promise.all([
    requiredMemberIds(guild, clan),
    db
      .select({ userId: xpSubmissionsTable.userId, overflow: xpSubmissionsTable.overflow })
      .from(xpSubmissionsTable)
      .where(
        and(
          eq(xpSubmissionsTable.guildId, clan.guildId),
          eq(xpSubmissionsTable.activityDate, today),
          ne(xpSubmissionsTable.status, "rejected"),
          isNull(xpSubmissionsTable.deletedAt)
        )
      ),
    db
      .select({ userId: vacationsTable.userId })
      .from(vacationsTable)
      .where(and(eq(vacationsTable.guildId, clan.guildId), eq(vacationsTable.activityDate, today))),
  ]);

  const submitted = new Set(subs.map((s) => s.userId));
  const overflow = new Set(subs.filter((s) => s.overflow).map((s) => s.userId));
  const vacation = new Set(vac.map((v) => v.userId));

  const completedIds: string[] = [];
  const vacationIds: string[] = [];
  const missingIds: string[] = [];
  for (const id of requiredIds) {
    if (submitted.has(id)) completedIds.push(id);
    else if (vacation.has(id)) vacationIds.push(id);
    else missingIds.push(id);
  }
  return { total: requiredIds.length, completedIds, vacationIds, missingIds, overflowIds: [...overflow] };
}

function mentionList(ids: string[], max = 60): string {
  if (!ids.length) return "—";
  const shown = ids.slice(0, max).map((id) => `<@${id}>`).join(" ");
  return (ids.length > max ? `${shown} +${ids.length - max} more` : shown).slice(0, 1024);
}

function trackerComponents(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(TRACKER_CHECK).setStyle(ButtonStyle.Primary).setLabel("Show Users"),
      new ButtonBuilder().setCustomId(TRACKER_REMIND).setStyle(ButtonStyle.Secondary).setLabel("Remind Missing"),
      new ButtonBuilder().setCustomId(TRACKER_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh")
    ),
  ];
}

/** The clean canvas tracker (no mention wall — that's behind Show Users). */
export async function buildTrackerMessage(guild: Guild, clan: Clan): Promise<BaseMessageOptions> {
  const [p, cap] = await Promise.all([computeProgress(guild, clan), clanCapacity(clan)]);
  const png = renderTrackerCard({
    communityName: clan.clanName,
    activityName: clan.activityName || "XP",
    activityDate: activityDate(clan),
    deadline: relative(nextReset(clan)),
    submitted: p.completedIds.length,
    total: p.total,
    missing: p.missingIds.length,
    vacation: p.vacationIds.length,
    overflow: p.overflowIds.length,
    limitXp: cap.limitXp,
    filledXp: cap.filledXp,
    pct: cap.pct,
    maxed: cap.maxed,
    contributions: cap.contributions,
    contributionCap: cap.contributionCap,
    overflowXp: cap.overflowXp,
  });
  return { files: [new AttachmentBuilder(png, { name: "tracker.png" })], components: trackerComponents() };
}

/** Post or update the tracker card in its configured channel. Best-effort. */
export async function refreshTracker(client: Client, clan: Clan): Promise<void> {
  if (!clan.trackerChannelId) return;
  const guild = client.guilds.cache.get(clan.guildId);
  if (!guild) return;
  try {
    const payload = await buildTrackerMessage(guild, clan);
    const record = await upsertDashboard(clan.guildId, "tracker", clan.trackerChannelId);
    const channel = await client.channels.fetch(clan.trackerChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return;

    if (record.messageId) {
      try {
        const msg = await channel.messages.fetch(record.messageId);
        await msg.edit({ ...payload, attachments: [] });
        return;
      } catch {
        /* deleted — repost */
      }
    }
    const msg = await channel.send(payload);
    await setDashboardMessage(record.id, msg.id);
  } catch (err) {
    logger.warn({ err, guild: clan.guildId }, "Tracker refresh failed");
  }
}

// Coalesce bursts of refreshes (e.g. many submissions at once) into one edit.
const pendingRefresh = new Map<string, NodeJS.Timeout>();

/** Fire-and-forget, debounced refresh used after a submission/vacation. */
export function scheduleTrackerRefresh(client: Client, clan: Clan): void {
  const existing = pendingRefresh.get(clan.guildId);
  if (existing) clearTimeout(existing);
  pendingRefresh.set(
    clan.guildId,
    setTimeout(() => {
      pendingRefresh.delete(clan.guildId);
      void refreshTracker(client, clan);
    }, 3000)
  );
}

/* --------------------------------------------------------------- actions */

async function staffGuard(interaction: ButtonInteraction): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "Staff only.", flags: 64 });
    return null;
  }
  return clan;
}

export async function handleTrackerRefresh(interaction: ButtonInteraction) {
  const clan = await staffGuard(interaction);
  if (!clan || !interaction.inCachedGuild()) return;
  invalidateRoleCache(clan.guildId); // force a fresh member count on manual refresh
  await interaction.deferUpdate();
  await interaction.message.edit(await buildTrackerMessage(interaction.guild, clan)).catch(() => {});
}

/** Show Users — the submitted / missing / vacation lists, ephemerally. */
export async function handleTrackerCheck(interaction: ButtonInteraction) {
  const clan = await staffGuard(interaction);
  if (!clan || !interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const p = await computeProgress(interaction.guild, clan);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${clan.clanName} — who's in`)
    .addFields(
      { name: `✅ Submitted (${p.completedIds.length})`, value: mentionList(p.completedIds) },
      { name: `⏳ Missing (${p.missingIds.length})`, value: mentionList(p.missingIds) },
      ...(p.vacationIds.length ? [{ name: `🏝️ Vacation (${p.vacationIds.length})`, value: mentionList(p.vacationIds) }] : []),
      ...(p.overflowIds.length ? [{ name: `🌊 Overflow (${p.overflowIds.length})`, value: mentionList(p.overflowIds) }] : [])
    )
    .setFooter({ text: "Only you can see this" });
  await interaction.editReply({ embeds: [embed] });
}

export async function handleTrackerRemind(interaction: ButtonInteraction) {
  const clan = await staffGuard(interaction);
  if (!clan || !interaction.inCachedGuild()) return;
  if (!clan.remindersEnabled) {
    await interaction.reply({ content: "Reminders are turned OFF (safety). Re-enable them in /setup → Schedule.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });

  const progress = await computeProgress(interaction.guild, clan);
  let sent = 0;
  for (const userId of progress.missingIds.slice(0, 50)) {
    if (await reminderSentToday(clan, userId)) continue; // don't double-ping
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    await sendReminder({
      clan,
      target: user,
      auto: false,
      moderatorId: interaction.user.id,
      moderatorUsername: interaction.user.username,
    });
    sent++;
  }
  await interaction.editReply(`👋 Sent reminders to **${sent}** missing member(s) who hadn't been reminded today.`);
}
