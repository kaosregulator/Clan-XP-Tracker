import { PermissionFlagsBits, type OverwriteResolvable } from "discord.js";
import type { Clan, DisputeEvidence } from "@workspace/db";

/**
 * Pure helpers for XP dispute tickets (no DB). Kept separate so unit tests
 * don't need DATABASE_URL.
 */

export function parseEvidence(raw: string | null | undefined): DisputeEvidence[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is DisputeEvidence =>
          !!e && typeof e === "object" && typeof (e as DisputeEvidence).url === "string"
      )
      .map((e) => ({
        url: e.url,
        name: typeof e.name === "string" ? e.name : "evidence",
        contentType: typeof e.contentType === "string" ? e.contentType : null,
        size: typeof e.size === "number" ? e.size : 0,
      }));
  } catch {
    return [];
  }
}

export function serializeEvidence(items: DisputeEvidence[]): string | null {
  return items.length ? JSON.stringify(items) : null;
}

/** Sanitize a Discord channel name from a username. */
export function disputeChannelName(username: string, disputeId?: number): string {
  const base = username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const stem = base || "member";
  return disputeId ? `dispute-${stem}-${disputeId}`.slice(0, 100) : `dispute-${stem}`.slice(0, 100);
}

/**
 * Permission overwrites for a private dispute channel.
 * @everyone deny view; member + staff role(s) + bot allow view/send/attach.
 */
export function buildDisputeOverwrites(opts: {
  guildId: string;
  memberId: string;
  botId: string;
  staffRoleIds: string[];
}): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    {
      id: opts.guildId,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: opts.memberId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: opts.botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
  for (const roleId of opts.staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  return overwrites;
}

/** Staff roles that may see dispute channels for this clan. */
export function disputeStaffRoleIds(clan: Clan): string[] {
  if (clan.disputeStaffRoleId) return [clan.disputeStaffRoleId];
  return [...new Set([...clan.staffRoleIds, ...clan.adminRoleIds])];
}
