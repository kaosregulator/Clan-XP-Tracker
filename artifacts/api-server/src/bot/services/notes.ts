import { db, memberNotesTable } from "@workspace/db";
import type { Clan, MemberNote } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { EmbedBuilder, type Client } from "discord.js";
import { logger } from "../../lib/logger";
import { logAction } from "./logging";
import { createNotification } from "./notifications";

/**
 * Append-only staff notes about a member. Each keeps its author and timestamp.
 * A note may optionally be delivered to the member; once the DM is sent the
 * member-facing part is marked delivered (the self-clear) while the staff trail
 * is kept. Notes are staff-only and never leak to the member unless explicitly
 * delivered.
 */

export interface AddNoteInput {
  client: Client;
  clan: Clan;
  target: { id: string; username: string };
  body: string;
  notifyMember: boolean;
  author: { id: string; username: string };
}

export interface AddNoteResult {
  note: MemberNote;
  delivered: boolean;
}

export async function addMemberNote(input: AddNoteInput): Promise<AddNoteResult> {
  const { client, clan, target } = input;
  const [note] = await db
    .insert(memberNotesTable)
    .values({
      guildId: clan.guildId,
      userId: target.id,
      username: target.username,
      authorId: input.author.id,
      authorUsername: input.author.username,
      body: input.body,
      notifyMember: input.notifyMember,
    })
    .returning();

  let delivered = false;
  if (input.notifyMember) {
    // Deliver to the member by DM, then mark delivered so it self-clears.
    try {
      const user = await client.users.fetch(target.id);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: `A note from ${clan.clanName} staff` })
        .setDescription(input.body.slice(0, 4000))
        .setTimestamp();
      await user.send({ embeds: [embed] });
      delivered = true;
    } catch {
      delivered = false;
    }
    if (delivered && note) {
      await db.update(memberNotesTable).set({ delivered: true }).where(eq(memberNotesTable.id, note.id));
    }
    // Record a staff-side notification so the delivery is visible in the center.
    await createNotification({
      guildId: clan.guildId,
      type: "note",
      title: `Note ${delivered ? "sent to" : "for"} ${target.username}`,
      body: input.body.slice(0, 300),
      targetUserId: target.id,
      targetUsername: target.username,
      relatedId: note?.id ?? null,
      createdBy: input.author.id,
      createdByUsername: input.author.username,
    });
  }

  await logAction(clan.guildId, {
    action: "member_note_added",
    targetUserId: target.id,
    targetUsername: target.username,
    moderatorId: input.author.id,
    moderatorUsername: input.author.username,
    details: { noteId: note?.id, notifyMember: input.notifyMember, delivered },
  });

  if (input.notifyMember) {
    logger.info(
      { event: "member_note", guildId: clan.guildId, targetId: target.id, delivered },
      `Staff note ${delivered ? "delivered to" : "recorded (undelivered) for"} ${target.username}`
    );
  }

  return { note: note!, delivered };
}

export async function listMemberNotes(guildId: string, userId: string, limit = 10): Promise<MemberNote[]> {
  return db
    .select()
    .from(memberNotesTable)
    .where(and(eq(memberNotesTable.guildId, guildId), eq(memberNotesTable.userId, userId)))
    .orderBy(desc(memberNotesTable.createdAt))
    .limit(limit);
}
