import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
import { sendReminder } from "../services/reminders";
import { clanCapacity } from "../services/contributions";
import { getDashboard, upsertDashboard, setDashboardMessage } from "../services/dashboards";
import { TRACKER_REMIND, TRACKER_REFRESH } from "../ui/ids";

interface Progress {
  total: number;
  completedIds: string[];
  vacationIds: string[];
  missingIds: string[];
  overflowIds: string[];
}

/**
 * Role-scoped progress for today: who among the required-role members has
 * submitted, is on vacation, or is still missing — plus who did overflow XP.
 */
async function computeProgress(guild: Guild, clan: Clan): Promise<Progress> {
  const today = activityDate(clan);

  let requiredIds: string[];
  if (clan.requiredRoleId) {
    await guild.members.fetch().catch(() => null); // ensure the role's members are cached
    const role = guild.roles.cache.get(clan.requiredRoleId);
    requiredIds = role ? [...role.members.values()].filter((m) => !m.user.bot).map((m) => m.id) : [];
  } else {
    const rows = await db
      .select({ userId: clanMembersTable.userId })
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, clan.guildId));
    requiredIds = rows.map((r) => r.userId);
  }

  const [subs, vac] = await Promise.all([
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

function mentionList(ids: string[], max = 40): string {
  if (!ids.length) return "—";
  const shown = ids.slice(0, max).map((id) => `<@${id}>`).join(" ");
  return ids.length > max ? `${shown} +${ids.length - max} more` : shown;
}

function trackerComponents(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(TRACKER_REMIND).setStyle(ButtonStyle.Primary).setLabel("Remind Missing"),
      new ButtonBuilder().setCustomId(TRACKER_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh")
    ),
  ];
}

export async function buildTrackerMessage(guild: Guild, clan: Clan): Promise<BaseMessageOptions> {
  const [p, cap] = await Promise.all([computeProgress(guild, clan), clanCapacity(clan)]);
  const activity = clan.activityName || "XP";

  // Headline: clan capacity when a limit is configured, else head count.
  let headline: string;
  let color: number;
  if (cap.limitXp > 0) {
    const filledContribs = Math.min(cap.contributions, cap.contributionCap);
    headline =
      `**${filledContribs} / ${cap.contributionCap} contributions** · **${cap.pct}%**` +
      `\n${cap.filledXp.toLocaleString()} / ${cap.limitXp.toLocaleString()} ${activity}${cap.overflowXp > 0 ? ` · +${cap.overflowXp.toLocaleString()} overflow` : ""}`;
    color = cap.maxed ? 0x3ba55d : cap.pct >= 50 ? 0xfaa61a : 0xed4245;
  } else {
    const pct = p.total > 0 ? Math.round((p.completedIds.length / p.total) * 100) : 0;
    headline = `**${p.completedIds.length}/${p.total}** submitted today · **${pct}%**`;
    color = pct >= 100 ? 0x3ba55d : pct >= 50 ? 0xfaa61a : 0xed4245;
  }

  const maxedBanner = cap.maxed
    ? "\n\n🔴 **CLAN MAXED** — further XP is overflow: it still credits the member (no XP warning) but doesn't add to the clan. Post a screenshot as proof."
    : "";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${clan.clanName} — ${activity} Tracker`)
    .setDescription(`${headline}\n\n${p.completedIds.length}/${p.total} members submitted · resets ${relative(nextReset(clan))}${maxedBanner}`)
    .addFields(
      { name: `✅ Submitted (${p.completedIds.length})`, value: mentionList(p.completedIds).slice(0, 1024) },
      { name: `⏳ Missing (${p.missingIds.length})`, value: mentionList(p.missingIds).slice(0, 1024) },
      ...(p.vacationIds.length
        ? [{ name: `🏝️ Vacation (${p.vacationIds.length})`, value: mentionList(p.vacationIds).slice(0, 1024) }]
        : []),
      ...(p.overflowIds.length
        ? [{ name: `🌊 Overflow (${p.overflowIds.length})`, value: mentionList(p.overflowIds).slice(0, 1024) }]
        : [])
    )
    .setFooter({ text: `${activityDate(clan)} • updates automatically` })
    .setTimestamp();

  return { embeds: [embed], components: trackerComponents() };
}

/** Post or update the tracker embed in its configured channel. Best-effort. */
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
        await msg.edit(payload);
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

/** Fire-and-forget refresh used after a submission/vacation. */
export function scheduleTrackerRefresh(client: Client, clan: Clan): void {
  void refreshTracker(client, clan);
}

/* --------------------------------------------------------------- actions */

export async function handleTrackerRefresh(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "Staff only.", flags: 64 });
    return;
  }
  await interaction.deferUpdate();
  await interaction.message.edit(await buildTrackerMessage(interaction.guild, clan)).catch(() => {});
}

export async function handleTrackerRemind(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const clan = await getClan(interaction.guildId);
  if (!clan || !isStaff(interaction.member, clan)) {
    await interaction.reply({ content: "Staff only.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });

  const progress = await computeProgress(interaction.guild, clan);
  let sent = 0;
  for (const userId of progress.missingIds.slice(0, 50)) {
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
  await interaction.editReply(`👋 Sent reminders to **${sent}** missing member(s).`);
  await interaction.message?.edit(await buildTrackerMessage(interaction.guild, clan)).catch(() => {});
}
