import { db, ticketsTable, type Ticket } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logAction } from "./logging";

/**
 * Minimal staff tickets. Created directly or escalated from a dispute. Kept
 * intentionally small — the record exists so a warning back-and-forth is
 * tracked and closeable; the conversation itself stays in Discord.
 */

export interface OpenTicketInput {
  guildId: string;
  userId: string;
  username: string;
  subject: string;
  disputeId?: number | null;
  channelId?: string | null;
  openedBy: string;
  openedByUsername: string;
}

export async function openTicket(input: OpenTicketInput): Promise<Ticket> {
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      guildId: input.guildId,
      userId: input.userId,
      username: input.username,
      subject: input.subject.slice(0, 200),
      status: "open",
      disputeId: input.disputeId ?? null,
      channelId: input.channelId ?? null,
      openedBy: input.openedBy,
      openedByUsername: input.openedByUsername,
    })
    .returning();
  await logAction(input.guildId, {
    action: "ticket_created",
    targetUserId: input.userId,
    targetUsername: input.username,
    moderatorId: input.openedBy,
    moderatorUsername: input.openedByUsername,
    details: { ticketId: ticket?.id, disputeId: input.disputeId ?? null },
  });
  return ticket!;
}

export async function closeTicket(
  guildId: string,
  ticketId: number,
  moderatorId: string,
  moderatorUsername: string,
  note?: string
): Promise<Ticket | null> {
  const [ticket] = await db
    .update(ticketsTable)
    .set({
      status: "closed",
      closedBy: moderatorId,
      closedByUsername: moderatorUsername,
      closeNote: note ?? null,
    })
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.id, ticketId)))
    .returning();
  if (ticket) {
    await logAction(guildId, {
      action: "ticket_closed",
      targetUserId: ticket.userId,
      targetUsername: ticket.username,
      moderatorId,
      moderatorUsername,
      details: { ticketId },
    });
  }
  return ticket ?? null;
}

export async function listOpenTickets(guildId: string, limit = 25): Promise<Ticket[]> {
  return db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.status, "open")))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(limit);
}

export async function countOpenTickets(guildId: string): Promise<number> {
  return (await listOpenTickets(guildId, 1000)).length;
}
