import { db, auditLogsTable } from "@workspace/db";
import type { AuditLog, Clan } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import type { Client, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { logger } from "../../lib/logger";

export interface AuditInput {
  action: string;
  targetUserId?: string | null;
  targetUsername?: string | null;
  moderatorId?: string | null;
  moderatorUsername?: string | null;
  details?: Record<string, unknown>;
}

/** Record a structured admin/audit action. Never throws — logging is best-effort. */
export async function logAction(guildId: string, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      guildId,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      targetUsername: input.targetUsername ?? null,
      moderatorId: input.moderatorId ?? null,
      moderatorUsername: input.moderatorUsername ?? null,
      details: input.details ?? {},
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "Failed to write audit log");
  }
}

/** One page of a member's audit trail, plus the total for pagination. */
export async function auditForUser(
  guildId: string,
  userId: string,
  limit: number,
  offset: number
): Promise<{ rows: AuditLog[]; total: number }> {
  const where = and(eq(auditLogsTable.guildId, guildId), eq(auditLogsTable.targetUserId, userId));
  const [rows, [countRow]] = await Promise.all([
    db.select().from(auditLogsTable).where(where).orderBy(desc(auditLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLogsTable).where(where),
  ]);
  return { rows, total: countRow?.count ?? 0 };
}

/** Post an embed (and optional files) to the clan's log channel. Best-effort. */
export async function sendLog(
  client: Client,
  clan: Clan,
  embed: EmbedBuilder,
  files?: AttachmentBuilder[]
): Promise<{ channelId: string; messageId: string } | null> {
  if (!clan.logChannelId) return null;
  try {
    const channel = await client.channels.fetch(clan.logChannelId);
    if (channel?.isTextBased() && "send" in channel) {
      const msg = await channel.send({
        embeds: [embed],
        ...(files?.length ? { files } : {}),
      });
      return { channelId: channel.id, messageId: msg.id };
    }
  } catch (err) {
    logger.error({ err, channel: clan.logChannelId }, "Failed to send log message");
  }
  return null;
}
