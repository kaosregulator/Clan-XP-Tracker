import { db, ticketsTable } from "@workspace/db";
import type { Clan, Ticket, TicketStatus } from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { logAction } from "./logging";
import { createNotification, resolveRelated } from "./notifications";

/**
 * Staff tickets — a lightweight record for tracking an issue about a member to
 * resolution. No Discord channels are created; it is purely a record with an
 * assignee, status and resolution, optionally linked to the warning/dispute
 * that spawned it.
 */

export interface CreateTicketInput {
  clan: Clan;
  userId: string;
  username: string;
  issue: string;
  relatedWarningId?: number | null;
  relatedDisputeId?: number | null;
  createdBy: string;
  createdByUsername: string;
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      guildId: input.clan.guildId,
      userId: input.userId,
      username: input.username,
      issue: input.issue,
      relatedWarningId: input.relatedWarningId ?? null,
      relatedDisputeId: input.relatedDisputeId ?? null,
      createdBy: input.createdBy,
      createdByUsername: input.createdByUsername,
    })
    .returning();

  await logAction(input.clan.guildId, {
    action: "ticket_opened",
    targetUserId: input.userId,
    targetUsername: input.username,
    moderatorId: input.createdBy,
    moderatorUsername: input.createdByUsername,
    details: { ticketId: ticket?.id, issue: input.issue.slice(0, 200) },
  });

  await createNotification({
    guildId: input.clan.guildId,
    type: "ticket",
    title: `Ticket #${ticket?.id} — ${input.username}`,
    body: input.issue.slice(0, 300),
    targetUserId: input.userId,
    targetUsername: input.username,
    relatedId: ticket?.id ?? null,
    createdBy: input.createdBy,
    createdByUsername: input.createdByUsername,
  });

  return ticket!;
}

export async function listTickets(
  guildId: string,
  status?: TicketStatus | "open",
  limit = 20
): Promise<Ticket[]> {
  const statusFilter =
    status === "open"
      ? inArray(ticketsTable.status, ["open", "in_progress"])
      : status
        ? eq(ticketsTable.status, status)
        : undefined;
  return db
    .select()
    .from(ticketsTable)
    .where(statusFilter ? and(eq(ticketsTable.guildId, guildId), statusFilter) : eq(ticketsTable.guildId, guildId))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(limit);
}

export async function getTicket(guildId: string, id: number): Promise<Ticket | null> {
  const [row] = await db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.id, id)));
  return row ?? null;
}

export async function openTicketCount(guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), inArray(ticketsTable.status, ["open", "in_progress"])));
  return row?.count ?? 0;
}

export interface UpdateTicketInput {
  clan: Clan;
  ticketId: number;
  status?: TicketStatus;
  assignedTo?: string | null;
  assignedToUsername?: string | null;
  resolution?: string | null;
  notes?: string | null;
  staffId: string;
  staffUsername: string;
}

export async function updateTicket(input: UpdateTicketInput): Promise<Ticket | null> {
  const { clan, ticketId } = input;
  const [updated] = await db
    .update(ticketsTable)
    .set({
      status: input.status ?? sql`${ticketsTable.status}`,
      assignedTo: input.assignedTo !== undefined ? input.assignedTo : sql`${ticketsTable.assignedTo}`,
      assignedToUsername:
        input.assignedToUsername !== undefined ? input.assignedToUsername : sql`${ticketsTable.assignedToUsername}`,
      resolution: input.resolution ?? sql`${ticketsTable.resolution}`,
      notes: input.notes ?? sql`${ticketsTable.notes}`,
    })
    .where(and(eq(ticketsTable.guildId, clan.guildId), eq(ticketsTable.id, ticketId)))
    .returning();
  if (!updated) return null;

  await logAction(clan.guildId, {
    action: "ticket_updated",
    targetUserId: updated.userId,
    targetUsername: updated.username,
    moderatorId: input.staffId,
    moderatorUsername: input.staffUsername,
    details: { ticketId, status: updated.status },
  });

  if (updated.status === "resolved" || updated.status === "closed") {
    await resolveRelated(clan.guildId, "ticket", ticketId);
  }
  return updated;
}
