import { EmbedBuilder, type Client, type TextBasedChannel } from "discord.js";
import type { Clan, ClanMember, XpSubmission } from "@workspace/db";
import { logger } from "../../lib/logger";
import { getMember } from "../services/config";
import { clanCapacity } from "../services/contributions";
import { activityDate } from "../services/time";
import type { MemberIdentity } from "../services/config";

/** Where the visible "xp card" is posted: submission channel, else log channel. */
function cardChannelId(clan: Clan): string | null {
  return clan.submissionChannelId ?? clan.logChannelId ?? null;
}

async function postToCardChannel(client: Client, clan: Clan, embed: EmbedBuilder) {
  const channelId = cardChannelId(clan);
  if (!channelId) return;
  try {
    const channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
    if (channel && "send" in channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err, channelId }, "Failed to post xp card");
  }
}

function streakLine(member: ClanMember | null): string | null {
  if (!member || member.currentStreak <= 0) return null;
  return `🔥 **${member.currentStreak}** day streak`;
}

/** The XP card: avatar + a compact summary of the submission. Auto-posted. */
export async function postXpCard(client: Client, clan: Clan, sub: XpSubmission): Promise<void> {
  const activity = clan.activityName || "XP";
  const [member, cap] = await Promise.all([getMember(clan.guildId, sub.userId), clanCapacity(clan)]);

  const alts = Math.max(0, sub.contributions - 1);
  const embed = new EmbedBuilder()
    .setColor(sub.overflow ? 0x22d3ee : 0x3ba55d)
    .setAuthor({ name: sub.username, iconURL: sub.avatarUrl ?? undefined })
    .setThumbnail(sub.avatarUrl ?? null)
    .setTitle(sub.overflow ? `🌊 ${activity} Submitted · Overflow` : `✅ ${activity} Submitted`)
    .addFields(
      { name: "Member", value: `<@${sub.userId}>`, inline: true },
      { name: "Contributions", value: alts > 0 ? `${sub.contributions} (you +${alts} alt${alts === 1 ? "" : "s"})` : "1", inline: true }
    )
    .setFooter({ text: `${activityDate(clan)} • ID #${sub.id}` })
    .setTimestamp();

  const streak = streakLine(member);
  if (streak) embed.addFields({ name: "Streak", value: streak, inline: true });

  if (cap.limitXp > 0) {
    embed.addFields({
      name: "Clan progress",
      value: cap.maxed
        ? `🔴 **MAXED** (${cap.limitXp.toLocaleString()} ${activity})${cap.overflowXp > 0 ? ` · +${cap.overflowXp.toLocaleString()} overflow` : ""}`
        : `${cap.filledXp.toLocaleString()} / ${cap.limitXp.toLocaleString()} ${activity} · ${cap.pct}%`,
    });
  }
  if (sub.overflow) {
    embed.setDescription("Clan already maxed — this is **credited** to you (no XP warning) but doesn't add to the clan.");
  }
  if (sub.notes) embed.addFields({ name: "Note", value: sub.notes.slice(0, 1024) });
  if (sub.proofImageUrls[0]) embed.setImage(sub.proofImageUrls[0]);

  await postToCardChannel(client, clan, embed);
}

/** The vacation card: a visible, logged "away today" record. Auto-posted. */
export async function postVacationCard(client: Client, clan: Clan, identity: MemberIdentity): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x22d3ee)
    .setAuthor({ name: identity.displayName, iconURL: identity.avatarUrl ?? undefined })
    .setThumbnail(identity.avatarUrl ?? null)
    .setTitle("🏝️ Vacation")
    .setDescription(`<@${identity.userId}> is **away today**. This is logged and counts as an ${clan.activityName || "XP"} miss — it does not complete the day.`)
    .setFooter({ text: activityDate(clan) })
    .setTimestamp();
  await postToCardChannel(client, clan, embed);
}
