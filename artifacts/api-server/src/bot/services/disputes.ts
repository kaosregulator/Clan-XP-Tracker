import { db, disputesTable, warningsTable, type Clan, type Dispute } from "@workspace/db";
import { and, eq, desc, isNull } from "drizzle-orm";
import { EmbedBuilder, type Client, type User } from "discord.js";
import { logAction, sendLog } from "./logging";
import { logger } from "../../lib/logger";

/**
 * Warning disputes. A member opens one against a warning ("Something Wrong?");
 * staff resolve it in the Warnings & Enforcement hub. This service is the one
 * place disputes are written/read so the member flow and the staff review flow
 * never drift.
 */

export interface OpenDisputeInput {
  client: Client;
  clan: Clan;
  target: User;
  warningId: number | null;
  reason: string;
  proofUrl: string | null;
}

/** Create a dispute and announce it to staff (warn channel + audit log). */
export async function openDispute(input: OpenDisputeInput): Promise<Dispute> {
  const { clan, target } = input;
  const [dispute] = await db
    .insert(disputesTable)
    .values({
      guildId: clan.guildId,
      userId: target.id,
      username: target.username,
      avatarUrl: target.displayAvatarURL(),
      warningId: input.warningId,
      reason: input.reason.slice(0, 1000),
      proofUrl: input.proofUrl,
      status: "open",
    })
    .returning();

  await logAction(clan.guildId, {
    action: "dispute_submitted",
    targetUserId: target.id,
    targetUsername: target.username,
    details: { disputeId: dispute?.id, warningId: input.warningId },
  });

  // Post to staff so a dispute never sits unseen.
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setAuthor({ name: `🚨 XP Warning Dispute • ${target.username}`, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL())
    .setDescription(input.reason.slice(0, 2000))
    .addFields(
      { name: "Member", value: `<@${target.id}>`, inline: true },
      { name: "Warning", value: input.warningId ? `#${input.warningId}` : "General", inline: true },
      { name: "Dispute", value: `#${dispute?.id}`, inline: true }
    )
    .setFooter({ text: "Review it in /xp warnings → Disputes" })
    .setTimestamp();
  if (input.proofUrl) embed.setImage(input.proofUrl);

  const channelId = clan.warningChannelId ?? clan.logChannelId;
  if (channelId) {
    try {
      const channel = await input.client.channels.fetch(channelId);
      if (channel?.isTextBased() && "send" in channel) {
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      }
    } catch (err) {
      logger.warn({ err, channelId }, "Dispute announcement failed");
    }
  }
  await sendLog(input.client, clan, embed);

  return dispute!;
}

/** Open disputes for the hub, newest first. */
export async function listOpenDisputes(guildId: string, limit = 25): Promise<Dispute[]> {
  return db
    .select()
    .from(disputesTable)
    .where(and(eq(disputesTable.guildId, guildId), eq(disputesTable.status, "open")))
    .orderBy(desc(disputesTable.createdAt))
    .limit(limit);
}

export async function getDispute(guildId: string, id: number): Promise<Dispute | null> {
  const [row] = await db
    .select()
    .from(disputesTable)
    .where(and(eq(disputesTable.guildId, guildId), eq(disputesTable.id, id)));
  return row ?? null;
}

export async function countOpenDisputes(guildId: string): Promise<number> {
  return (await listOpenDisputes(guildId, 1000)).length;
}

export interface ResolveDisputeInput {
  client: Client;
  clan: Clan;
  disputeId: number;
  status: "accepted" | "denied" | "info_requested";
  moderatorId: string;
  moderatorUsername: string;
  note?: string;
}

/**
 * Resolve a dispute. Accepting a dispute does NOT auto-remove the warning —
 * warnings stay staff-managed — but it records the decision and DMs the member.
 */
export async function resolveDispute(input: ResolveDisputeInput): Promise<Dispute | null> {
  const dispute = await getDispute(input.clan.guildId, input.disputeId);
  if (!dispute || dispute.status !== "open") return null;

  const [updated] = await db
    .update(disputesTable)
    .set({
      status: input.status,
      reviewedBy: input.moderatorId,
      reviewedByUsername: input.moderatorUsername,
      resolutionNote: input.note ?? null,
    })
    .where(eq(disputesTable.id, input.disputeId))
    .returning();

  await logAction(input.clan.guildId, {
    action: `dispute_${input.status}`,
    targetUserId: dispute.userId,
    targetUsername: dispute.username,
    moderatorId: input.moderatorId,
    moderatorUsername: input.moderatorUsername,
    details: { disputeId: input.disputeId, note: input.note ?? null },
  });

  // Let the member know the outcome.
  const verb =
    input.status === "accepted" ? "accepted" : input.status === "denied" ? "denied" : "needs more info";
  const user = await input.client.users.fetch(dispute.userId).catch(() => null);
  if (user) {
    await user
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(input.status === "accepted" ? 0x3ba55d : input.status === "denied" ? 0xed4245 : 0xfaa61a)
            .setTitle(`Your dispute was ${verb}`)
            .setDescription(
              (input.note ? `**Staff:** ${input.note}\n\n` : "") +
                `Warning ${dispute.warningId ? `#${dispute.warningId}` : ""} · ${input.clan.clanName}`
            )
            .setTimestamp(),
        ],
      })
      .catch(() => {});
  }

  return updated ?? null;
}

/** The member's own disputes, newest first. */
export async function memberDisputes(guildId: string, userId: string, limit = 10): Promise<Dispute[]> {
  return db
    .select()
    .from(disputesTable)
    .where(and(eq(disputesTable.guildId, guildId), eq(disputesTable.userId, userId)))
    .orderBy(desc(disputesTable.createdAt))
    .limit(limit);
}

/** Whether a member already has an open dispute for a given warning. */
export async function hasOpenDisputeFor(guildId: string, userId: string, warningId: number | null): Promise<boolean> {
  const rows = await db
    .select({ id: disputesTable.id })
    .from(disputesTable)
    .where(
      and(
        eq(disputesTable.guildId, guildId),
        eq(disputesTable.userId, userId),
        eq(disputesTable.status, "open"),
        warningId === null ? isNull(disputesTable.warningId) : eq(disputesTable.warningId, warningId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Confirm a warning id belongs to the member (guards dispute ownership). */
export async function warningBelongsTo(guildId: string, userId: string, warningId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: warningsTable.id })
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.id, warningId), eq(warningsTable.userId, userId)));
  return !!row;
}
