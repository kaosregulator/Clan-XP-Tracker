import { db, disputesTable, warningsTable } from "@workspace/db";
import type { Clan, Dispute, DisputeEvidence, DisputeStatus, DisputeType, Warning } from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type Client,
  type Guild,
  type TextChannel,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { logAction, sendLog } from "./logging";
import { createNotification, resolveRelated } from "./notifications";
import { logger } from "../../lib/logger";
import {
  disputeResolve,
  disputeReject,
  disputeClose,
  disputeTranscript,
  disputeDelete,
} from "../ui/ids";
import {
  parseEvidence,
  serializeEvidence,
  disputeChannelName,
  buildDisputeOverwrites,
  disputeStaffRoleIds,
  formatDisputeTranscript,
  type TranscriptMessageLine,
} from "./disputeHelpers";

export {
  parseEvidence,
  serializeEvidence,
  disputeChannelName,
  buildDisputeOverwrites,
  disputeStaffRoleIds,
  formatDisputeTranscript,
} from "./disputeHelpers";

/**
 * XP dispute tickets — private Discord channels for member ↔ staff conversation.
 *
 * Evidence comes from Discord's native slash-command attachment upload (device
 * gallery / file picker). We never ask members for an image URL.
 */

export const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  "open",
  "pending",
  "info_requested",
];

export const DISPUTE_TYPE_LABEL: Record<DisputeType, string> = {
  warning: "XP warning",
  xp_record: "XP record",
  role_action: "Role action",
};

/* --------------------------------------------------------------- queries */

async function ownedWarning(
  guildId: string,
  warningId: number,
  userId: string
): Promise<Warning | null> {
  const [warning] = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.id, warningId), eq(warningsTable.guildId, guildId)));
  if (!warning || warning.userId !== userId) return null;
  return warning;
}

export async function listDisputes(
  guildId: string,
  status?: DisputeStatus | "open",
  limit = 20
): Promise<Dispute[]> {
  const statusFilter =
    status === "open"
      ? inArray(disputesTable.status, OPEN_DISPUTE_STATUSES)
      : status
        ? eq(disputesTable.status, status)
        : undefined;
  return db
    .select()
    .from(disputesTable)
    .where(statusFilter ? and(eq(disputesTable.guildId, guildId), statusFilter) : eq(disputesTable.guildId, guildId))
    .orderBy(desc(disputesTable.createdAt))
    .limit(limit);
}

export async function disputesForUser(guildId: string, userId: string, limit = 10): Promise<Dispute[]> {
  return db
    .select()
    .from(disputesTable)
    .where(and(eq(disputesTable.guildId, guildId), eq(disputesTable.userId, userId)))
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

export async function openDisputeCount(guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(disputesTable)
    .where(
      and(eq(disputesTable.guildId, guildId), inArray(disputesTable.status, OPEN_DISPUTE_STATUSES))
    );
  return row?.count ?? 0;
}

/** Active open dispute for this member (any type), if one exists. */
export async function findOpenDisputeForUser(
  guildId: string,
  userId: string
): Promise<Dispute | null> {
  const [row] = await db
    .select()
    .from(disputesTable)
    .where(
      and(
        eq(disputesTable.guildId, guildId),
        eq(disputesTable.userId, userId),
        inArray(disputesTable.status, OPEN_DISPUTE_STATUSES)
      )
    )
    .orderBy(desc(disputesTable.createdAt))
    .limit(1);
  return row ?? null;
}

/* -------------------------------------------------------- channel helpers */

export async function ensureDisputeCategory(
  guild: Guild,
  clan: Clan,
  botId: string
): Promise<{ categoryId: string; created: boolean }> {
  if (clan.disputeCategoryId) {
    const existing = await guild.channels.fetch(clan.disputeCategoryId).catch(() => null);
    if (existing && existing.type === ChannelType.GuildCategory) {
      return { categoryId: existing.id, created: false };
    }
  }

  const staffRoles = disputeStaffRoleIds(clan);
  const category = await guild.channels.create({
    name: "XP DISPUTES",
    type: ChannelType.GuildCategory,
    permissionOverwrites: buildDisputeOverwrites({
      guildId: guild.id,
      // Category: no member id yet — deny @everyone, allow staff + bot.
      memberId: botId,
      botId,
      staffRoleIds: staffRoles,
    }),
    reason: "XP dispute ticket category",
  });

  return { categoryId: category.id, created: true };
}

function staffActionRow(disputeId: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(disputeResolve(disputeId))
      .setLabel("Resolve")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(disputeReject(disputeId))
      .setLabel("Reject")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(disputeClose(disputeId))
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
  );
}

/** After a decision: channel stays; staff can re-send transcript or delete. */
function postDecisionActionRow(disputeId: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(disputeTranscript(disputeId))
      .setLabel("Transcript")
      .setEmoji("📄")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(disputeDelete(disputeId))
      .setLabel("Delete")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );
}

function disputeEmbed(opts: {
  clan: Clan;
  dispute: Dispute;
  warning?: Warning | null;
}): EmbedBuilder {
  const { clan, dispute, warning } = opts;
  const type = (dispute.disputeType as DisputeType) || "warning";
  const evidence = parseEvidence(dispute.evidenceJson);
  const statusLabel =
    dispute.status === "open" || dispute.status === "pending"
      ? "Open"
      : dispute.status === "resolved" || dispute.status === "accepted"
        ? "Resolved"
        : dispute.status === "rejected" || dispute.status === "denied"
          ? "Rejected"
          : dispute.status === "closed"
            ? "Closed"
            : dispute.status;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("⚖️ XP DISPUTE")
    .setDescription(
      `**Member:** <@${dispute.userId}>\n` +
        `**Type:** ${DISPUTE_TYPE_LABEL[type] ?? type}\n` +
        `**Status:** ${statusLabel}`
    )
    .addFields({ name: "Reason", value: dispute.reason.slice(0, 1024) || "_none_" })
    .setFooter({ text: `${clan.clanName} · Dispute #${dispute.id}` })
    .setTimestamp(dispute.createdAt);

  if (warning) {
    embed.addFields({
      name: "Linked warning",
      value: `#${warning.id} — ${warning.reason.slice(0, 200)}`,
    });
  }

  if (evidence.length) {
    embed.addFields({
      name: "Evidence",
      value: evidence.map((e) => `📎 \`${e.name}\` (${e.size ? `${Math.round(e.size / 1024)} KB` : "file"})`).join("\n"),
    });
  } else {
    embed.addFields({ name: "Evidence", value: "_None attached — member may upload images in this channel._" });
  }

  return embed;
}

/* -------------------------------------------------------------- open flow */

export interface OpenDisputeTicketInput {
  client: Client;
  guild: Guild;
  clan: Clan;
  user: { id: string; username: string; displayName?: string };
  disputeType: DisputeType;
  reason: string;
  warningId?: number | null;
  /** Native Discord attachments from the slash-command option (device upload). */
  evidence?: DisputeEvidence[];
}

export type OpenDisputeTicketResult =
  | { ok: true; dispute: Dispute; channelId: string }
  | { ok: false; error: string };

/**
 * Open a private dispute ticket channel under the configured category.
 * Evidence must already be Discord-hosted attachments (slash option) — never
 * a pasted URL from the member.
 */
export async function openDisputeTicket(
  input: OpenDisputeTicketInput
): Promise<OpenDisputeTicketResult> {
  const { client, guild, clan, user } = input;
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Please include an explanation for your dispute." };
  if (reason.length > 2000) return { ok: false, error: "Explanation is too long (max 2000 characters)." };

  if (!clan.disputeCategoryId) {
    return {
      ok: false,
      error:
        "Disputes aren't set up yet. Ask an admin to configure a **Dispute category** in **/setup → Disputes**.",
    };
  }

  const botId = client.user?.id;
  if (!botId) return { ok: false, error: "Bot is not ready — try again in a moment." };

  // One open dispute ticket per member keeps the category tidy.
  const existing = await findOpenDisputeForUser(clan.guildId, user.id);
  if (existing) {
    const where = existing.channelId ? ` — see <#${existing.channelId}>` : "";
    return {
      ok: false,
      error: `You already have an open dispute (#${existing.id})${where}. Staff will handle it there.`,
    };
  }

  let warning: Warning | null = null;
  if (input.disputeType === "warning") {
    if (!input.warningId) {
      return { ok: false, error: "Pick which warning you're disputing (warning_id option)." };
    }
    warning = await ownedWarning(clan.guildId, input.warningId, user.id);
    if (!warning) {
      return { ok: false, error: "That warning isn't one of yours, or it doesn't exist." };
    }
    if (warning.removedAt) {
      return { ok: false, error: "That warning has already been removed — nothing to dispute." };
    }
    // Also block a second open dispute specifically for this warning (belt+suspenders).
    const [dup] = await db
      .select({ id: disputesTable.id })
      .from(disputesTable)
      .where(
        and(
          eq(disputesTable.guildId, clan.guildId),
          eq(disputesTable.warningId, input.warningId),
          inArray(disputesTable.status, OPEN_DISPUTE_STATUSES)
        )
      );
    if (dup) {
      return { ok: false, error: "You already have an open dispute for that warning." };
    }
  }

  const evidence = input.evidence ?? [];
  const staffRoles = disputeStaffRoleIds(clan);

  // Insert first so we have a stable id for the channel name + buttons.
  const [dispute] = await db
    .insert(disputesTable)
    .values({
      guildId: clan.guildId,
      warningId: warning?.id ?? null,
      disputeType: input.disputeType,
      userId: user.id,
      username: user.username,
      reason,
      evidenceJson: serializeEvidence(evidence),
      status: "open",
    })
    .returning();

  if (!dispute) return { ok: false, error: "Could not create the dispute record." };

  let channel: TextChannel;
  try {
    const parent = await guild.channels.fetch(clan.disputeCategoryId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
      await db.delete(disputesTable).where(eq(disputesTable.id, dispute.id));
      return {
        ok: false,
        error:
          "The configured dispute category is missing. Ask an admin to re-run **/setup → Disputes**.",
      };
    }

    channel = await guild.channels.create({
      name: disputeChannelName(user.username, dispute.id),
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: `XP dispute #${dispute.id} — ${user.username}`,
      permissionOverwrites: buildDisputeOverwrites({
        guildId: guild.id,
        memberId: user.id,
        botId,
        staffRoleIds: staffRoles,
      }),
      reason: `XP dispute #${dispute.id}`,
    });
  } catch (err) {
    logger.error({ err, guildId: clan.guildId }, "Failed to create dispute channel");
    await db.delete(disputesTable).where(eq(disputesTable.id, dispute.id));
    return {
      ok: false,
      error:
        "Couldn't create the private dispute channel. Check that the bot can Manage Channels in the dispute category.",
    };
  }

  const [updated] = await db
    .update(disputesTable)
    .set({ channelId: channel.id })
    .where(eq(disputesTable.id, dispute.id))
    .returning();

  const row = updated ?? { ...dispute, channelId: channel.id };

  // Build files from Discord CDN URLs of the native uploads (not member-pasted links).
  const files: AttachmentBuilder[] = [];
  for (const e of evidence) {
    try {
      files.push(new AttachmentBuilder(e.url, { name: e.name }));
    } catch (err) {
      logger.warn({ err, url: e.url }, "Could not attach dispute evidence file");
    }
  }

  const staffPing = staffRoles.map((r) => `<@&${r}>`).join(" ");
  const introPing = [staffPing, `<@${user.id}>`].filter(Boolean).join(" · ");
  try {
    await channel.send({
      content: introPing,
      embeds: [disputeEmbed({ clan, dispute: row, warning })],
      files,
      components: [staffActionRow(row.id)],
      allowedMentions: {
        users: [user.id],
        roles: staffRoles,
      },
    });
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, "Dispute channel intro post failed");
  }

  await logAction(clan.guildId, {
    action: "dispute_opened",
    targetUserId: user.id,
    targetUsername: user.username,
    moderatorId: user.id,
    moderatorUsername: user.username,
    details: {
      disputeId: row.id,
      disputeType: input.disputeType,
      warningId: warning?.id ?? null,
      channelId: channel.id,
      evidenceCount: evidence.length,
      evidence: evidence.map((e) => ({ name: e.name, size: e.size, contentType: e.contentType })),
    },
  });

  await createNotification({
    guildId: clan.guildId,
    type: "dispute",
    title: `Dispute #${row.id} — ${user.username}`,
    body: `${DISPUTE_TYPE_LABEL[input.disputeType]}: ${reason.slice(0, 280)}`,
    targetUserId: user.id,
    targetUsername: user.username,
    relatedId: row.id,
    createdBy: user.id,
    createdByUsername: user.username,
  });

  await sendLog(
    client,
    clan,
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`⚖️ Dispute opened · #${row.id}`)
      .setDescription(`<@${user.id}> opened a **${DISPUTE_TYPE_LABEL[input.disputeType]}** dispute.`)
      .addFields(
        { name: "Channel", value: `<#${channel.id}>`, inline: true },
        { name: "Evidence", value: evidence.length ? `${evidence.length} file(s)` : "none", inline: true },
        { name: "Reason", value: reason.slice(0, 1024) }
      )
      .setTimestamp()
  );

  return { ok: true, dispute: row, channelId: channel.id };
}

/* ------------------------------------------------------------- transcripts */

const TRANSCRIPT_FETCH_LIMIT = 100;
const TRANSCRIPT_MAX_MESSAGES = 500;

/** Fetch messages from a dispute channel (oldest → newest), best-effort. */
async function fetchChannelTranscriptLines(
  channel: TextChannel
): Promise<TranscriptMessageLine[]> {
  const collected: TranscriptMessageLine[] = [];
  let before: string | undefined;
  while (collected.length < TRANSCRIPT_MAX_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: TRANSCRIPT_FETCH_LIMIT,
      ...(before ? { before } : {}),
    });
    if (!batch.size) break;
    const sorted = [...batch.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );
    for (const msg of sorted) {
      collected.push({
        timestampIso: msg.createdAt.toISOString(),
        authorTag: msg.author.tag || msg.author.username,
        authorId: msg.author.id,
        content: msg.content || "",
        attachments: [...msg.attachments.values()].map((a) => ({
          name: a.name || "attachment",
          url: a.url,
          contentType: a.contentType ?? null,
          size: a.size ?? 0,
        })),
      });
    }
    before = batch.last()?.id;
    if (batch.size < TRANSCRIPT_FETCH_LIMIT) break;
  }
  // We fetched newest-first in pages; each page was sorted ascending, but
  // pages themselves were newest-first. Re-sort the full set chronologically.
  collected.sort((a, b) => a.timestampIso.localeCompare(b.timestampIso));
  return collected.slice(0, TRANSCRIPT_MAX_MESSAGES);
}

export interface CaptureTranscriptResult {
  text: string;
  messageCount: number;
  attachmentCount: number;
}

function buildTranscriptForDispute(opts: {
  dispute: Dispute;
  lines: TranscriptMessageLine[];
  result: string;
  handledById: string;
  handledByTag: string;
  note?: string | null;
  footerNote?: string | null;
}): CaptureTranscriptResult {
  const evidence = parseEvidence(opts.dispute.evidenceJson);
  const text = formatDisputeTranscript(
    {
      disputeId: opts.dispute.id,
      guildId: opts.dispute.guildId,
      memberTag: opts.dispute.username,
      memberId: opts.dispute.userId,
      disputeType: opts.dispute.disputeType,
      warningId: opts.dispute.warningId ?? null,
      reason: opts.dispute.reason,
      initialEvidence: evidence,
      result: opts.result,
      handledByTag: opts.handledByTag,
      handledById: opts.handledById,
      note: opts.note,
      channelId: opts.dispute.channelId,
      generatedAtIso: new Date().toISOString(),
      footerNote: opts.footerNote,
    },
    opts.lines
  );
  const attachmentCount =
    evidence.length + opts.lines.reduce((n, l) => n + l.attachments.length, 0);
  return { text, messageCount: opts.lines.length, attachmentCount };
}

/**
 * Capture the private channel conversation into a transcript string.
 * Throws if the channel cannot be read — callers must not delete on failure.
 */
export async function captureDisputeTranscript(
  guild: Guild,
  dispute: Dispute,
  meta: {
    result: string;
    handledById: string;
    handledByTag: string;
    note?: string | null;
    footerNote?: string | null;
  }
): Promise<CaptureTranscriptResult> {
  if (!dispute.channelId) {
    return buildTranscriptForDispute({
      dispute,
      lines: [],
      result: meta.result,
      handledById: meta.handledById,
      handledByTag: meta.handledByTag,
      note: meta.note,
      footerNote: meta.footerNote ?? "No Discord channel was linked to this dispute.",
    });
  }
  const ch = await guild.channels.fetch(dispute.channelId);
  if (!ch || !ch.isTextBased() || !("messages" in ch)) {
    throw new Error("Dispute channel is missing or not text-based — transcript not captured.");
  }
  const lines = await fetchChannelTranscriptLines(ch as TextChannel);
  return buildTranscriptForDispute({
    dispute,
    lines,
    result: meta.result,
    handledById: meta.handledById,
    handledByTag: meta.handledByTag,
    note: meta.note,
    footerNote: meta.footerNote,
  });
}

async function postOrEditTranscriptLog(opts: {
  client: Client;
  clan: Clan;
  dispute: Dispute;
  resultLabel: string;
  staffId: string;
  staffUsername: string;
  transcript: CaptureTranscriptResult;
  title: string;
  color: number;
  editExisting?: boolean;
  extraFooter?: string | null;
}): Promise<{ channelId: string; messageId: string } | null> {
  const { clan, dispute, transcript } = opts;
  const type = (dispute.disputeType as DisputeType) || "warning";
  const embed = new EmbedBuilder()
    .setColor(opts.color)
    .setTitle(opts.title)
    .setDescription(
      `Staff-only transcript for dispute **#${dispute.id}**. Not shared with the member.`
    )
    .addFields(
      { name: "Member", value: `<@${dispute.userId}>`, inline: true },
      { name: "Type", value: DISPUTE_TYPE_LABEL[type] ?? type, inline: true },
      { name: "Result", value: opts.resultLabel, inline: true },
      { name: "Handled by", value: `<@${opts.staffId}>`, inline: true },
      {
        name: "Messages",
        value: `${transcript.messageCount}`,
        inline: true,
      },
      {
        name: "Attachments referenced",
        value: `${transcript.attachmentCount}`,
        inline: true,
      },
      ...(dispute.warningId
        ? [{ name: "Warning ID", value: `#${dispute.warningId}`, inline: true }]
        : []),
      ...(opts.extraFooter
        ? [{ name: "Note", value: opts.extraFooter.slice(0, 1024) }]
        : [])
    )
    .setFooter({ text: `Dispute #${dispute.id} · Transcript attached` })
    .setTimestamp();

  const file = new AttachmentBuilder(Buffer.from(transcript.text, "utf8"), {
    name: `dispute-${dispute.id}-transcript.txt`,
  });

  // Prefer editing the prior log message when Delete finalizes the ticket.
  if (
    opts.editExisting &&
    dispute.transcriptLogChannelId &&
    dispute.transcriptLogMessageId
  ) {
    try {
      const logCh = await opts.client.channels.fetch(dispute.transcriptLogChannelId);
      if (logCh?.isTextBased() && "messages" in logCh) {
        const existing = await logCh.messages.fetch(dispute.transcriptLogMessageId);
        await existing.edit({
          embeds: [embed],
          files: [file],
        });
        return {
          channelId: dispute.transcriptLogChannelId,
          messageId: dispute.transcriptLogMessageId,
        };
      }
    } catch (err) {
      logger.warn({ err, disputeId: dispute.id }, "Could not edit prior transcript log — posting new");
    }
  }

  return sendLog(opts.client, clan, embed, [file]);
}

/* ------------------------------------------------------------- decisions */

export type DisputeDecision = "resolved" | "rejected" | "closed";

export interface DecideDisputeTicketInput {
  client: Client;
  guild: Guild;
  clan: Clan;
  disputeId: number;
  decision: DisputeDecision;
  staffId: string;
  staffUsername: string;
  note?: string | null;
}

/**
 * Resolve / Reject / Close a dispute:
 *   1. Capture full channel transcript (must succeed before any destructive step)
 *   2. Post transcript + summary embed to the staff log channel
 *   3. Update DB + audit
 *   4. Lock the channel (do NOT delete) and swap buttons to Transcript / Delete
 */
export async function decideDisputeTicket(
  input: DecideDisputeTicketInput
): Promise<{ dispute: Dispute; channelLocked: boolean; transcriptPosted: boolean } | null> {
  const { clan, disputeId, decision } = input;
  const existing = await getDispute(clan.guildId, disputeId);
  if (!existing) return null;
  if (
    !OPEN_DISPUTE_STATUSES.includes(existing.status as DisputeStatus) &&
    existing.status !== "info_requested"
  ) {
    return { dispute: existing, channelLocked: false, transcriptPosted: false };
  }

  const resultLabel =
    decision === "resolved" ? "Resolved" : decision === "rejected" ? "Rejected" : "Closed";
  const note = (input.note ?? "").trim() || resultLabel;
  const color =
    decision === "resolved" ? 0x3ba55d : decision === "rejected" ? 0xed4245 : 0x99aab5;

  // 1. Capture transcript BEFORE locking/renaming (channel must still be readable).
  let transcript: CaptureTranscriptResult;
  try {
    transcript = await captureDisputeTranscript(input.guild, existing, {
      result: resultLabel,
      handledById: input.staffId,
      handledByTag: input.staffUsername,
      note,
    });
  } catch (err) {
    logger.error({ err, disputeId }, "Transcript capture failed — aborting decision");
    throw new Error(
      "Could not capture the dispute transcript. The ticket was left open so nothing is lost. Try again."
    );
  }

  // 2. Staff log with transcript file (member never sees this).
  const posted = await postOrEditTranscriptLog({
    client: input.client,
    clan,
    dispute: existing,
    resultLabel,
    staffId: input.staffId,
    staffUsername: input.staffUsername,
    transcript,
    title: "⚖️ Dispute Closed",
    color,
  });

  // 3. Persist decision + transcript log pointer.
  const [updated] = await db
    .update(disputesTable)
    .set({
      status: decision,
      staffResponse: note,
      result: resultLabel,
      handledBy: input.staffId,
      handledByUsername: input.staffUsername,
      transcriptLogMessageId: posted?.messageId ?? existing.transcriptLogMessageId,
      transcriptLogChannelId: posted?.channelId ?? existing.transcriptLogChannelId,
    })
    .where(and(eq(disputesTable.guildId, clan.guildId), eq(disputesTable.id, disputeId)))
    .returning();

  if (!updated) return null;

  await logAction(clan.guildId, {
    action: "dispute_decided",
    targetUserId: updated.userId,
    targetUsername: updated.username,
    moderatorId: input.staffId,
    moderatorUsername: input.staffUsername,
    details: {
      disputeId,
      decision,
      result: resultLabel,
      note,
      disputeType: updated.disputeType,
      warningId: updated.warningId,
      channelId: updated.channelId,
      evidence: parseEvidence(updated.evidenceJson),
      reason: updated.reason.slice(0, 500),
      transcriptMessageCount: transcript.messageCount,
      transcriptAttachmentCount: transcript.attachmentCount,
      transcriptLogMessageId: posted?.messageId ?? null,
      transcriptLogChannelId: posted?.channelId ?? null,
    },
  });

  await resolveRelated(clan.guildId, "dispute", disputeId);

  // 4. Lock channel (keep it). Swap action row to Transcript / Delete.
  let channelLocked = false;
  if (updated.channelId) {
    try {
      const ch = await input.guild.channels.fetch(updated.channelId);
      if (ch && ch.isTextBased() && "permissionOverwrites" in ch) {
        await ch.permissionOverwrites.edit(updated.userId, {
          SendMessages: false,
        });
        if ("setName" in ch) {
          const closedName = `closed-${disputeChannelName(updated.username, updated.id)}`.slice(
            0,
            100
          );
          await ch.setName(closedName).catch(() => {});
        }
        await ch.send({
          embeds: [
            new EmbedBuilder()
              .setColor(color)
              .setTitle(`⚖️ Dispute ${resultLabel}`)
              .setDescription(
                `Handled by <@${input.staffId}>.\n\n**Result:** ${resultLabel}\n**Note:** ${note.slice(0, 500)}\n\n` +
                  `_A full transcript was saved to the staff log channel._\n` +
                  `Staff can **Transcript** (re-send) or **Delete** this channel when finished.`
              )
              .setTimestamp(),
          ],
          components: [postDecisionActionRow(updated.id)],
        });
        channelLocked = true;
      }
    } catch (err) {
      logger.warn({ err, channelId: updated.channelId }, "Failed to lock dispute channel");
    }
  }

  return { dispute: updated, channelLocked, transcriptPosted: !!posted };
}

/**
 * Re-capture and post the transcript to the staff log (does not change status).
 * Staff-only; never DMs the member.
 */
export async function resendDisputeTranscript(opts: {
  client: Client;
  guild: Guild;
  clan: Clan;
  disputeId: number;
  staffId: string;
  staffUsername: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const dispute = await getDispute(opts.clan.guildId, opts.disputeId);
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };

  const resultLabel = dispute.result || dispute.status;
  let transcript: CaptureTranscriptResult;
  try {
    transcript = await captureDisputeTranscript(opts.guild, dispute, {
      result: resultLabel,
      handledById: dispute.handledBy ?? opts.staffId,
      handledByTag: dispute.handledByUsername ?? opts.staffUsername,
      note: dispute.staffResponse,
      footerNote: `Re-sent by ${opts.staffUsername} at ${new Date().toISOString()}`,
    });
  } catch (err) {
    logger.error({ err, disputeId: opts.disputeId }, "Transcript re-capture failed");
    return { ok: false, error: "Could not read the dispute channel to build a transcript." };
  }

  const posted = await postOrEditTranscriptLog({
    client: opts.client,
    clan: opts.clan,
    dispute,
    resultLabel,
    staffId: dispute.handledBy ?? opts.staffId,
    staffUsername: dispute.handledByUsername ?? opts.staffUsername,
    transcript,
    title: "⚖️ Dispute Transcript",
    color: 0x5865f2,
    extraFooter: `Re-sent by <@${opts.staffId}>`,
  });

  if (!posted) {
    return {
      ok: false,
      error: "No log channel configured (or send failed). Set a log channel in /setup.",
    };
  }

  await db
    .update(disputesTable)
    .set({
      transcriptLogMessageId: posted.messageId,
      transcriptLogChannelId: posted.channelId,
    })
    .where(and(eq(disputesTable.guildId, opts.clan.guildId), eq(disputesTable.id, opts.disputeId)));

  await logAction(opts.clan.guildId, {
    action: "dispute_transcript_resent",
    targetUserId: dispute.userId,
    targetUsername: dispute.username,
    moderatorId: opts.staffId,
    moderatorUsername: opts.staffUsername,
    details: {
      disputeId: opts.disputeId,
      transcriptLogMessageId: posted.messageId,
      messageCount: transcript.messageCount,
    },
  });

  return { ok: true };
}

/**
 * Permanently delete the dispute Discord channel.
 * ALWAYS captures + saves/edits the transcript first. Never deletes on failure.
 */
export async function deleteDisputeChannel(opts: {
  client: Client;
  guild: Guild;
  clan: Clan;
  disputeId: number;
  staffId: string;
  staffUsername: string;
}): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const dispute = await getDispute(opts.clan.guildId, opts.disputeId);
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };
  if (!dispute.channelId) {
    return { ok: false, error: "This dispute has no Discord channel left to delete." };
  }

  const resultLabel = `${dispute.result || dispute.status} · Channel deleted`;
  let transcript: CaptureTranscriptResult;
  try {
    transcript = await captureDisputeTranscript(opts.guild, dispute, {
      result: resultLabel,
      handledById: dispute.handledBy ?? opts.staffId,
      handledByTag: dispute.handledByUsername ?? opts.staffUsername,
      note: dispute.staffResponse,
      footerNote: `FINAL CLOSE — channel deleted by ${opts.staffUsername} at ${new Date().toISOString()}`,
    });
  } catch (err) {
    logger.error({ err, disputeId: opts.disputeId }, "Transcript capture failed before delete");
    return {
      ok: false,
      error:
        "Could not capture the transcript. The channel was **not** deleted. Fix channel access and try again.",
    };
  }

  // Post/edit transcript in the staff log BEFORE deleting the channel.
  const posted = await postOrEditTranscriptLog({
    client: opts.client,
    clan: opts.clan,
    dispute,
    resultLabel,
    staffId: dispute.handledBy ?? opts.staffId,
    staffUsername: dispute.handledByUsername ?? opts.staffUsername,
    transcript,
    title: "⚖️ Dispute Closed",
    color: 0x99aab5,
    editExisting: true,
    extraFooter: `Channel permanently deleted by <@${opts.staffId}>.`,
  });

  if (!posted && opts.clan.logChannelId) {
    // Log channel is configured but we failed to write — refuse to delete.
    return {
      ok: false,
      error:
        "Transcript could not be saved to the log channel. The Discord channel was **not** deleted.",
    };
  }

  // Delete only after a successful capture (and log write when a log channel exists).
  let deleted = false;
  try {
    const ch = await opts.guild.channels.fetch(dispute.channelId);
    if (ch) {
      await ch.delete(`Dispute #${dispute.id} deleted by ${opts.staffUsername}`);
      deleted = true;
    }
  } catch (err) {
    logger.error({ err, channelId: dispute.channelId }, "Failed to delete dispute channel");
    return {
      ok: false,
      error:
        "Transcript was saved, but Discord refused to delete the channel. Check Manage Channels permission.",
    };
  }

  await db
    .update(disputesTable)
    .set({
      channelId: null,
      result: resultLabel,
      transcriptLogMessageId: posted?.messageId ?? dispute.transcriptLogMessageId,
      transcriptLogChannelId: posted?.channelId ?? dispute.transcriptLogChannelId,
    })
    .where(and(eq(disputesTable.guildId, opts.clan.guildId), eq(disputesTable.id, opts.disputeId)));

  await logAction(opts.clan.guildId, {
    action: "dispute_channel_deleted",
    targetUserId: dispute.userId,
    targetUsername: dispute.username,
    moderatorId: opts.staffId,
    moderatorUsername: opts.staffUsername,
    details: {
      disputeId: opts.disputeId,
      previousChannelId: dispute.channelId,
      transcriptLogMessageId: posted?.messageId ?? null,
      messageCount: transcript.messageCount,
      attachmentCount: transcript.attachmentCount,
      finalResult: resultLabel,
    },
  });

  return { ok: true, deleted };
}

/* ---- legacy wrappers kept so older call sites compile during transition ---- */

export interface CreateDisputeInput {
  clan: Clan;
  warningId: number;
  user: { id: string; username: string };
  reason: string;
  proofUrl?: string | null;
}

export type CreateDisputeResult =
  | { ok: true; dispute: Dispute }
  | { ok: false; error: string };

/** @deprecated Prefer openDisputeTicket — kept for transitional call sites. */
export async function createDispute(input: CreateDisputeInput): Promise<CreateDisputeResult> {
  // Without a guild/client we can only write the DB row (no channel).
  const warning = await ownedWarning(input.clan.guildId, input.warningId, input.user.id);
  if (!warning) return { ok: false, error: "That warning isn't one of yours, or it doesn't exist." };
  if (warning.removedAt) {
    return { ok: false, error: "That warning has already been removed — nothing to dispute." };
  }
  const open = await findOpenDisputeForUser(input.clan.guildId, input.user.id);
  if (open) {
    return { ok: false, error: `You already have an open dispute (#${open.id}).` };
  }
  const [dispute] = await db
    .insert(disputesTable)
    .values({
      guildId: input.clan.guildId,
      warningId: input.warningId,
      disputeType: "warning",
      userId: input.user.id,
      username: input.user.username,
      reason: input.reason,
      proofUrl: input.proofUrl ?? null,
      status: "open",
    })
    .returning();
  return { ok: true, dispute: dispute! };
}

export interface DecideDisputeInput {
  clan: Clan;
  disputeId: number;
  status: DisputeStatus;
  staffId: string;
  staffUsername: string;
  response?: string | null;
  result?: string | null;
}

/** @deprecated Prefer decideDisputeTicket. */
export async function decideDispute(input: DecideDisputeInput): Promise<Dispute | null> {
  const [updated] = await db
    .update(disputesTable)
    .set({
      status: input.status,
      staffResponse: input.response ?? sql`${disputesTable.staffResponse}`,
      result: input.result ?? sql`${disputesTable.result}`,
      handledBy: input.staffId,
      handledByUsername: input.staffUsername,
    })
    .where(and(eq(disputesTable.guildId, input.clan.guildId), eq(disputesTable.id, input.disputeId)))
    .returning();
  if (!updated) return null;
  await logAction(input.clan.guildId, {
    action: "dispute_decided",
    targetUserId: updated.userId,
    targetUsername: updated.username,
    moderatorId: input.staffId,
    moderatorUsername: input.staffUsername,
    details: { disputeId: input.disputeId, status: input.status, warningId: updated.warningId },
  });
  if (["accepted", "denied", "resolved", "rejected", "closed"].includes(input.status)) {
    await resolveRelated(input.clan.guildId, "dispute", input.disputeId);
  }
  return updated;
}
