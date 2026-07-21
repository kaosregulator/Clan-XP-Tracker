import { db, dashboardsTable } from "@workspace/db";
import type { Dashboard, DashboardType } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export async function getDashboard(guildId: string, type: DashboardType): Promise<Dashboard | null> {
  const [row] = await db
    .select()
    .from(dashboardsTable)
    .where(and(eq(dashboardsTable.guildId, guildId), eq(dashboardsTable.type, type)));
  return row ?? null;
}

/**
 * Ensure a dashboard record points at `channelId`. If the channel changed we
 * drop the stored message id so a fresh message is posted in the new channel.
 */
export async function upsertDashboard(
  guildId: string,
  type: DashboardType,
  channelId: string
): Promise<Dashboard> {
  const existing = await getDashboard(guildId, type);
  if (existing) {
    if (existing.channelId !== channelId) {
      const [row] = await db
        .update(dashboardsTable)
        .set({ channelId, messageId: null })
        .where(eq(dashboardsTable.id, existing.id))
        .returning();
      return row!;
    }
    return existing;
  }
  const [row] = await db
    .insert(dashboardsTable)
    .values({ guildId, type, channelId })
    .returning();
  return row!;
}

export async function setDashboardMessage(id: number, messageId: string): Promise<void> {
  await db.update(dashboardsTable).set({ messageId }).where(eq(dashboardsTable.id, id));
}
