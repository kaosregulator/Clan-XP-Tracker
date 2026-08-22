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
} from "../ui/ids";
import {
  parseEvidence,
  serializeEvidence,
  disputeChannelName,
  buildDisputeOverwrites,
  disputeStaffRoleIds,
} from "./disputeHelpers";

export {
  parseEvidence,
  serializeEvidence,
  disputeChannelName,
  buildDisputeOverwrites,
  disputeStaffRoleIds,
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

export async function decideDisputeTicket(
  input: DecideDisputeTicketInput
): Promise<{ dispute: Dispute; channelLocked: boolean } | null> {
  const { clan, disputeId, decision } = input;
  const existing = await getDispute(clan.guildId, disputeId);
  if (!existing) return null;
  if (!OPEN_DISPUTE_STATUSES.includes(existing.status as DisputeStatus) && existing.status !== "info_requested") {
    // Already decided — return as-is so the UI can say so.
    return { dispute: existing, channelLocked: false };
  }

  const resultLabel =
    decision === "resolved" ? "Resolved" : decision === "rejected" ? "Rejected" : "Closed";
  const note = (input.note ?? "").trim() || resultLabel;

  const [updated] = await db
    .update(disputesTable)
    .set({
      status: decision,
      staffResponse: note,
      result: resultLabel,
      handledBy: input.staffId,
      handledByUsername: input.staffUsername,
    })
    .where(and(eq(disputesTable.guildId, clan.guildId), eq(disputesTable.id, disputeId)))
    .returning();

  if (!updated) return null;

  let channelLocked = false;
  if (updated.channelId) {
    try {
      const ch = await input.guild.channels.fetch(updated.channelId);
      if (ch && ch.isTextBased() && "permissionOverwrites" in ch) {
        // Lock the member from sending further messages; staff may still post.
        await ch.permissionOverwrites.edit(updated.userId, {
          SendMessages: false,
        });
        if ("setName" in ch) {
          const closedName = `closed-${disputeChannelName(updated.username, updated.id)}`.slice(0, 100);
          await ch.setName(closedName).catch(() => {});
        }
        await ch.send({
          embeds: [
            new EmbedBuilder()
              .setColor(
                decision === "resolved" ? 0x3ba55d : decision === "rejected" ? 0xed4245 : 0x99aab5
              )
              .setTitle(`⚖️ Dispute ${resultLabel}`)
              .setDescription(
                `Handled by <@${input.staffId}>.\n\n**Result:** ${resultLabel}\n**Note:** ${note.slice(0, 500)}`
              )
              .setTimestamp(),
          ],
          components: [],
        });
        channelLocked = true;
      }
    } catch (err) {
      logger.warn({ err, channelId: updated.channelId }, "Failed to lock dispute channel");
    }
  }

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
    },
  });

  await resolveRelated(clan.guildId, "dispute", disputeId);

  await sendLog(
    input.client,
    clan,
    new EmbedBuilder()
      .setColor(decision === "resolved" ? 0x3ba55d : decision === "rejected" ? 0xed4245 : 0x99aab5)
      .setTitle(`⚖️ Dispute ${resultLabel} · #${disputeId}`)
      .setDescription(`<@${updated.userId}>'s dispute was **${resultLabel.toLowerCase()}** by <@${input.staffId}>.`)
      .addFields(
        { name: "Type", value: updated.disputeType, inline: true },
        {
          name: "Channel",
          value: updated.channelId ? `<#${updated.channelId}>` : "_none_",
          inline: true,
        },
        { name: "Note", value: note.slice(0, 1024) }
      )
      .setTimestamp()
  );

  return { dispute: updated, channelLocked };
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
