import { db, xpSubmissionsTable } from "@workspace/db";
import type { Clan, XpSubmission } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { activityDate } from "./time";
import type { MemberIdentity } from "./config";

export interface CreateSubmissionInput {
  clan: Clan;
  identity: MemberIdentity;
  accountId?: number | null;
  accountLabel?: string | null;
  notes?: string | null;
  proofImageUrls?: string[];
  /** "pending" for the review queue, "approved" for the auto-approve flow. */
  status?: "pending" | "approved";
  autoReviewer?: { id: string; username: string };
}

/** Create a submission for the current activity day (pending by default). */
export async function createSubmission(input: CreateSubmissionInput): Promise<XpSubmission> {
  const status = input.status ?? "pending";
  const approved = status === "approved";
  const [row] = await db
    .insert(xpSubmissionsTable)
    .values({
      guildId: input.clan.guildId,
      userId: input.identity.userId,
      username: input.identity.username,
      avatarUrl: input.identity.avatarUrl,
      accountId: input.accountId ?? null,
      accountLabel: input.accountLabel ?? null,
      activityDate: activityDate(input.clan),
      status,
      notes: input.notes ?? null,
      proofImageUrls: input.proofImageUrls ?? [],
      reviewedBy: approved ? (input.autoReviewer?.id ?? "auto") : null,
      reviewedByUsername: approved ? (input.autoReviewer?.username ?? "Auto-approved") : null,
      reviewedAt: approved ? new Date() : null,
    })
    .returning();
  return row!;
}

/** Back-compat helper — a pending submission for the review-queue flow. */
export async function createPendingSubmission(
  input: Omit<CreateSubmissionInput, "status" | "autoReviewer">
): Promise<XpSubmission> {
  return createSubmission({ ...input, status: "pending" });
}

export async function getSubmission(id: number): Promise<XpSubmission | null> {
  const [row] = await db.select().from(xpSubmissionsTable).where(eq(xpSubmissionsTable.id, id));
  return row ?? null;
}

/** Latest pending submission for a user that has no proof attached yet. */
export async function latestPendingAwaitingProof(
  guildId: string,
  userId: string
): Promise<XpSubmission | null> {
  const rows = await db
    .select()
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, guildId),
        eq(xpSubmissionsTable.userId, userId),
        eq(xpSubmissionsTable.status, "pending"),
        isNull(xpSubmissionsTable.deletedAt)
      )
    )
    .orderBy(desc(xpSubmissionsTable.submittedAt))
    .limit(5);
  return rows.find((r) => r.proofImageUrls.length === 0) ?? null;
}

/**
 * The member's most recent submission today that still has no screenshot —
 * used to attach a screenshot posted right after a modal submit, regardless of
 * whether it's pending (review flow) or already approved (auto-approve flow).
 */
export async function latestTodayAwaitingProof(
  clan: Clan,
  userId: string
): Promise<XpSubmission | null> {
  const rows = await db
    .select()
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.userId, userId),
        eq(xpSubmissionsTable.activityDate, activityDate(clan)),
        isNull(xpSubmissionsTable.deletedAt)
      )
    )
    .orderBy(desc(xpSubmissionsTable.submittedAt))
    .limit(5);
  return rows.find((r) => r.proofImageUrls.length === 0) ?? null;
}

export async function setProof(id: number, urls: string[]): Promise<XpSubmission | null> {
  const [row] = await db
    .update(xpSubmissionsTable)
    .set({ proofImageUrls: urls })
    .where(eq(xpSubmissionsTable.id, id))
    .returning();
  return row ?? null;
}

export async function setReviewMessage(id: number, messageId: string): Promise<void> {
  await db
    .update(xpSubmissionsTable)
    .set({ reviewMessageId: messageId })
    .where(eq(xpSubmissionsTable.id, id));
}

export interface ReviewInput {
  moderatorId: string;
  moderatorUsername: string;
  note?: string | null;
}

export async function setStatus(
  id: number,
  status: "approved" | "rejected",
  review: ReviewInput
): Promise<XpSubmission | null> {
  const [row] = await db
    .update(xpSubmissionsTable)
    .set({
      status,
      reviewedBy: review.moderatorId,
      reviewedByUsername: review.moderatorUsername,
      reviewedAt: new Date(),
      reviewNote: review.note ?? null,
    })
    .where(eq(xpSubmissionsTable.id, id))
    .returning();
  return row ?? null;
}

/**
 * Whether the member already has a non-rejected submission for today. When
 * `accountId` is provided (alt-account flow) the check is scoped to that
 * account; otherwise any non-rejected submission today counts.
 */
export async function hasSubmissionToday(
  clan: Clan,
  userId: string,
  accountId: number | null = null
): Promise<boolean> {
  const today = activityDate(clan);
  const rows = await db
    .select({
      status: xpSubmissionsTable.status,
      accountId: xpSubmissionsTable.accountId,
    })
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.userId, userId),
        eq(xpSubmissionsTable.activityDate, today),
        isNull(xpSubmissionsTable.deletedAt)
      )
    );
  return rows.some(
    (r) => r.status !== "rejected" && (accountId === null || r.accountId === accountId)
  );
}

export type TodayState = "done" | "pending" | "missing";

/** The member's completion state for the current activity day. */
export async function todayStatus(clan: Clan, userId: string): Promise<TodayState> {
  const today = activityDate(clan);
  const rows = await db
    .select({ status: xpSubmissionsTable.status })
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.userId, userId),
        eq(xpSubmissionsTable.activityDate, today),
        isNull(xpSubmissionsTable.deletedAt)
      )
    );
  if (rows.some((r) => r.status === "approved")) return "done";
  if (rows.some((r) => r.status === "pending")) return "pending";
  return "missing";
}

export async function recentForUser(
  guildId: string,
  userId: string,
  limit = 5
): Promise<XpSubmission[]> {
  return db
    .select()
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, guildId),
        eq(xpSubmissionsTable.userId, userId),
        isNull(xpSubmissionsTable.deletedAt)
      )
    )
    .orderBy(desc(xpSubmissionsTable.submittedAt))
    .limit(limit);
}

export async function pendingQueue(guildId: string, limit = 25): Promise<XpSubmission[]> {
  return db
    .select()
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, guildId),
        eq(xpSubmissionsTable.status, "pending"),
        isNull(xpSubmissionsTable.deletedAt)
      )
    )
    .orderBy(xpSubmissionsTable.submittedAt)
    .limit(limit);
}
