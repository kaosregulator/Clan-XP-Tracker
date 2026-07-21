import { db, auditLogsTable } from "@workspace/db";
import type { Clan } from "@workspace/db";
import type { Client, EmbedBuilder } from "discord.js";
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

/** Post an embed to the clan's configured log channel, if any. Best-effort. */
export async function sendLog(client: Client, clan: Clan, embed: EmbedBuilder): Promise<void> {
  if (!clan.logChannelId) return;
  try {
    const channel = await client.channels.fetch(clan.logChannelId);
    if (channel?.isTextBased() && "send" in channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    logger.error({ err, channel: clan.logChannelId }, "Failed to send log message");
  }
}
