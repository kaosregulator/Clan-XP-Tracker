import { db, disputesTable, warningsTable } from "@workspace/db";
import type { Clan, Dispute, DisputeStatus, Warning } from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { logAction } from "./logging";
import { createNotification, resolveRelated } from "./notifications";

/**
 * The dispute system. A member may contest one of their OWN warnings; staff
 * decide the outcome. Ownership is enforced here — a member can never dispute
 * someone else's warning — and a dispute never lifts enforcement on its own.
 */

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

/** Look up an active warning that belongs to `userId`. */
async function ownedWarning(
  guildId: string,
  warningId: number,
  userId: string
): Promise<Warning | null> {
  const [warning] = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.id, warningId), eq(warningsTable.guildId, guildId)));
  if (!warning) return null;
  // Ownership check: the disputing member must own the warning.
  if (warning.userId !== userId) return null;
  return warning;
}

export async function createDispute(input: CreateDisputeInput): Promise<CreateDisputeResult> {
  const { clan, warningId, user } = input;
  const warning = await ownedWarning(clan.guildId, warningId, user.id);
  if (!warning) {
    return { ok: false, error: "That warning isn't one of yours, or it doesn't exist." };
  }
  if (warning.removedAt) {
    return { ok: false, error: "That warning has already been removed — nothing to dispute." };
  }

  // One open dispute per warning is enough.
  const [existing] = await db
    .select({ id: disputesTable.id })
    .from(disputesTable)
    .where(
      and(
        eq(disputesTable.guildId, clan.guildId),
        eq(disputesTable.warningId, warningId),
        inArray(disputesTable.status, ["pending", "info_requested"])
      )
    );
  if (existing) {
    return { ok: false, error: "You already have an open dispute for that warning." };
  }

  const [dispute] = await db
    .insert(disputesTable)
    .values({
      guildId: clan.guildId,
      warningId,
      userId: user.id,
      username: user.username,
      reason: input.reason,
      proofUrl: input.proofUrl ?? null,
    })
    .returning();

  await logAction(clan.guildId, {
    action: "dispute_created",
    targetUserId: user.id,
    targetUsername: user.username,
    moderatorId: user.id,
    moderatorUsername: user.username,
    details: { warningId, disputeId: dispute?.id },
  });

  await createNotification({
    guildId: clan.guildId,
    type: "dispute",
    title: `Dispute opened — ${user.username}`,
    body: `${user.username} disputes warning #${warningId}: ${input.reason.slice(0, 300)}`,
    targetUserId: user.id,
    targetUsername: user.username,
    relatedId: dispute?.id ?? null,
    createdBy: user.id,
    createdByUsername: user.username,
  });

  return { ok: true, dispute: dispute! };
}

/* --------------------------------------------------------------- queries */

export async function listDisputes(
  guildId: string,
  status?: DisputeStatus | "open",
  limit = 20
): Promise<Dispute[]> {
  const statusFilter =
    status === "open"
      ? inArray(disputesTable.status, ["pending", "info_requested"])
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

/** Count of disputes still awaiting a decision (pending + info requested). */
export async function openDisputeCount(guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(disputesTable)
    .where(
      and(
        eq(disputesTable.guildId, guildId),
        inArray(disputesTable.status, ["pending", "info_requested"])
      )
    );
  return row?.count ?? 0;
}

/* --------------------------------------------------------------- decisions */

export interface DecideDisputeInput {
  clan: Clan;
  disputeId: number;
  status: DisputeStatus;
  staffId: string;
  staffUsername: string;
  response?: string | null;
  result?: string | null;
}

export async function decideDispute(input: DecideDisputeInput): Promise<Dispute | null> {
  const { clan, disputeId, status } = input;
  const [updated] = await db
    .update(disputesTable)
    .set({
      status,
      staffResponse: input.response ?? sql`${disputesTable.staffResponse}`,
      result: input.result ?? sql`${disputesTable.result}`,
      handledBy: input.staffId,
      handledByUsername: input.staffUsername,
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
    details: { disputeId, status, warningId: updated.warningId },
  });

  // A closed dispute drops out of the active notification feed.
  if (status === "accepted" || status === "denied" || status === "resolved") {
    await resolveRelated(clan.guildId, "dispute", disputeId);
  }
  return updated;
}
