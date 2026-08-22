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

/* ------------------------------------------------------------- transcripts */

export interface TranscriptMessageLine {
  timestampIso: string;
  authorTag: string;
  authorId: string;
  content: string;
  attachments: { name: string; url: string; contentType: string | null; size: number }[];
}

export interface TranscriptHeader {
  disputeId: number;
  guildId: string;
  memberTag: string;
  memberId: string;
  disputeType: string;
  warningId: number | null;
  reason: string;
  initialEvidence: DisputeEvidence[];
  result: string;
  handledByTag: string;
  handledById: string;
  note?: string | null;
  channelId: string | null;
  generatedAtIso: string;
  footerNote?: string | null;
}

/** Build a plain-text dispute transcript for staff logs. */
export function formatDisputeTranscript(
  header: TranscriptHeader,
  lines: TranscriptMessageLine[]
): string {
  const out: string[] = [];
  out.push("════════════════════════════════════════");
  out.push(` XP DISPUTE TRANSCRIPT  #${header.disputeId}`);
  out.push("════════════════════════════════════════");
  out.push(`Generated:     ${header.generatedAtIso}`);
  out.push(`Guild:         ${header.guildId}`);
  out.push(`Member:        ${header.memberTag} (${header.memberId})`);
  out.push(`Type:          ${header.disputeType}`);
  if (header.warningId != null) out.push(`Warning ID:    ${header.warningId}`);
  out.push(`Result:        ${header.result}`);
  out.push(`Handled by:    ${header.handledByTag} (${header.handledById})`);
  if (header.channelId) out.push(`Channel ID:    ${header.channelId}`);
  if (header.note) out.push(`Staff note:    ${header.note}`);
  out.push("");
  out.push("--- Original dispute reason ---");
  out.push(header.reason || "(none)");
  out.push("");
  if (header.initialEvidence.length) {
    out.push("--- Initial evidence (slash upload) ---");
    for (const e of header.initialEvidence) {
      out.push(
        `  • ${e.name} | ${e.contentType ?? "unknown"} | ${e.size} bytes | ${e.url}`
      );
    }
    out.push("");
  }
  out.push("--- Channel conversation ---");
  if (!lines.length) {
    out.push("(no messages captured)");
  } else {
    for (const line of lines) {
      out.push(`[${line.timestampIso}] ${line.authorTag} (${line.authorId}):`);
      out.push(line.content.trim() ? line.content : "(no text)");
      for (const a of line.attachments) {
        out.push(
          `  📎 ${a.name} | ${a.contentType ?? "unknown"} | ${a.size} bytes | ${a.url}`
        );
      }
      out.push("");
    }
  }
  if (header.footerNote) {
    out.push("---");
    out.push(header.footerNote);
  }
  out.push("════════════════════════════════════════");
  out.push(" Staff-only transcript — not shared with the member.");
  out.push("════════════════════════════════════════");
  return out.join("\n");
}
