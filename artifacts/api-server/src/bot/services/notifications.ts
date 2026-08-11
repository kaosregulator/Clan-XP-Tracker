import { db, notificationsTable } from "@workspace/db";
import type { Notification, NotificationStatus, NotificationType } from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { scheduleDashboardRefresh } from "./commandCenter";

/**
 * The staff notification center. A thin, safe layer over the notifications
 * table: create items, count/list by status, and resolve items automatically
 * when the record they point at is closed — so the feed reflects live reality
 * instead of piling up stale entries.
 */

export interface CreateNotificationInput {
  guildId: string;
  type: NotificationType;
  title: string;
  body: string;
  targetUserId?: string | null;
  targetUsername?: string | null;
  relatedId?: number | null;
  createdBy?: string | null;
  createdByUsername?: string | null;
}

export async function createNotification(input: CreateNotificationInput): Promise<Notification | null> {
  const [row] = await db
    .insert(notificationsTable)
    .values({
      guildId: input.guildId,
      type: input.type,
      title: input.title,
      body: input.body,
      targetUserId: input.targetUserId ?? null,
      targetUsername: input.targetUsername ?? null,
      relatedId: input.relatedId ?? null,
      createdBy: input.createdBy ?? null,
      createdByUsername: input.createdByUsername ?? null,
    })
    .returning();
  scheduleDashboardRefresh(input.guildId);
  return row ?? null;
}

/** How many notifications are still unread — the badge number. */
export async function unreadCount(guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.guildId, guildId), eq(notificationsTable.status, "unread")));
  return row?.count ?? 0;
}

/** List notifications in a given status, newest first. */
export async function listNotifications(
  guildId: string,
  status: NotificationStatus | "active",
  limit = 15
): Promise<Notification[]> {
  // "active" = anything a human still cares about (unread + read, not cleared).
  const statusFilter =
    status === "active"
      ? inArray(notificationsTable.status, ["unread", "read"])
      : eq(notificationsTable.status, status);
  return db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.guildId, guildId), statusFilter))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
}

export async function setNotificationStatus(
  guildId: string,
  id: number,
  status: NotificationStatus
): Promise<void> {
  await db
    .update(notificationsTable)
    .set({ status })
    .where(and(eq(notificationsTable.guildId, guildId), eq(notificationsTable.id, id)));
  scheduleDashboardRefresh(guildId);
}

/** Bulk transition — e.g. mark every unread item read, or clear all read. */
export async function transitionAll(
  guildId: string,
  from: NotificationStatus[],
  to: NotificationStatus
): Promise<void> {
  await db
    .update(notificationsTable)
    .set({ status: to })
    .where(and(eq(notificationsTable.guildId, guildId), inArray(notificationsTable.status, from)));
  scheduleDashboardRefresh(guildId);
}

/**
 * Resolve open notifications that point at a now-closed record (e.g. a warning
 * was removed, or a dispute was decided). Resolved items drop out of the active
 * feed automatically — the "notifications self-clear when resolved" behaviour.
 */
export async function resolveRelated(
  guildId: string,
  type: NotificationType,
  relatedId: number
): Promise<void> {
  await db
    .update(notificationsTable)
    .set({ status: "resolved" })
    .where(
      and(
        eq(notificationsTable.guildId, guildId),
        eq(notificationsTable.type, type),
        eq(notificationsTable.relatedId, relatedId),
        inArray(notificationsTable.status, ["unread", "read"])
      )
    );
  scheduleDashboardRefresh(guildId);
}
