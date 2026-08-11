import { db, staffNotificationsTable, type Clan, type StaffNotification } from "@workspace/db";
import { and, eq, ne, desc, sql } from "drizzle-orm";
import type { Guild } from "discord.js";
import { listTracked, statusOf, warningTargets } from "./progress";
import { countOpenDisputes } from "./disputes";
import { weekKey } from "./time";
import { logAction } from "./logging";

/**
 * The staff notification queue. One live item per concern per period (keyed by
 * dedupeKey) with a Read / Clear lifecycle. This is the single generator of
 * "what needs attention" — the XP Manager badge, the notifications panel and
 * the DM nudge all read from here so counts never disagree.
 */

interface Concern {
  kind: StaffNotification["kind"];
  category: string | null;
  title: string;
  body: string;
  count: number;
  dedupeKey: string;
}

/** Compute the current concerns for a clan from live state. */
async function concernsFor(clan: Clan): Promise<Concern[]> {
  const wk = weekKey(clan);
  const members = await listTracked(clan);
  const missed = members.filter((m) => statusOf(clan, m) === "notStarted").length;
  const attention = members.filter((m) => statusOf(clan, m) === "inProgress").length;
  const onLeave = members.filter((m) => statusOf(clan, m) === "leave").length;
  const warnable = warningTargets(clan, members).length;
  const disputes = await countOpenDisputes(clan.guildId);

  const out: Concern[] = [];
  if (missed > 0) {
    out.push({
      kind: "xp_entry",
      category: "missed",
      title: "⚠️ XP entry needed",
      body: `${missed} member${missed === 1 ? "" : "s"} still need XP entered.`,
      count: missed,
      dedupeKey: `xp_entry:${wk}`,
    });
  }
  if (attention > 0) {
    out.push({
      kind: "status",
      category: "attention",
      title: "🟡 Members need attention",
      body: `${attention} member${attention === 1 ? "" : "s"} are part-way to the goal.`,
      count: attention,
      dedupeKey: `attention:${wk}`,
    });
  }
  if (warnable > 0) {
    out.push({
      kind: "warning_review",
      category: "attention",
      title: "⚠️ Warning attention",
      body: `${warnable} member${warnable === 1 ? "" : "s"} are warning-eligible (${clan.warningThreshold}+ reminders, still short).`,
      count: warnable,
      dedupeKey: `warning_review:${wk}`,
    });
  }
  if (onLeave > 0) {
    out.push({
      kind: "status",
      category: "leave",
      title: "🌙 On leave",
      body: `${onLeave} member${onLeave === 1 ? "" : "s"} on leave — no XP expected.`,
      count: onLeave,
      dedupeKey: `leave:${wk}`,
    });
  }
  if (disputes > 0) {
    out.push({
      kind: "dispute",
      category: "disputes",
      title: "❓ Disputes to review",
      body: `${disputes} open dispute${disputes === 1 ? "" : "s"} awaiting a decision.`,
      count: disputes,
      dedupeKey: `dispute:open`,
    });
  }
  return out;
}

/**
 * Refresh the queue for a clan: upsert live concerns and retire items whose
 * concern has resolved. A cleared item is NOT reopened for the same period —
 * staff dismissed it on purpose. Returns the current active (uncleared) items.
 */
export async function refreshNotifications(clan: Clan): Promise<StaffNotification[]> {
  const concerns = await concernsFor(clan);
  const wantKeys = new Set(concerns.map((c) => c.dedupeKey));

  for (const c of concerns) {
    const [existing] = await db
      .select()
      .from(staffNotificationsTable)
      .where(and(eq(staffNotificationsTable.guildId, clan.guildId), eq(staffNotificationsTable.dedupeKey, c.dedupeKey)));

    if (!existing) {
      await db.insert(staffNotificationsTable).values({
        guildId: clan.guildId,
        kind: c.kind,
        category: c.category,
        title: c.title,
        body: c.body,
        count: c.count,
        dedupeKey: c.dedupeKey,
        status: "unread",
      });
    } else if (existing.status !== "cleared") {
      // Live concern still open — refresh the numbers, keep read/unread state.
      await db
        .update(staffNotificationsTable)
        .set({ body: c.body, count: c.count, category: c.category, title: c.title })
        .where(eq(staffNotificationsTable.id, existing.id));
    }
  }

  // Retire active items whose concern is gone (auto-clear — resolved on its own).
  const active = await listActive(clan.guildId);
  for (const item of active) {
    if (!wantKeys.has(item.dedupeKey)) {
      await db
        .update(staffNotificationsTable)
        .set({ status: "cleared", clearedAt: new Date() })
        .where(eq(staffNotificationsTable.id, item.id));
    }
  }

  return listActive(clan.guildId);
}

/** Active = not cleared. These count toward the badge and get re-nudged. */
export async function listActive(guildId: string): Promise<StaffNotification[]> {
  return db
    .select()
    .from(staffNotificationsTable)
    .where(and(eq(staffNotificationsTable.guildId, guildId), ne(staffNotificationsTable.status, "cleared")))
    .orderBy(desc(staffNotificationsTable.count));
}

/** How many active items are still unread — drives the badge and DM nudge. */
export async function unreadCount(guildId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(staffNotificationsTable)
    .where(and(eq(staffNotificationsTable.guildId, guildId), eq(staffNotificationsTable.status, "unread")));
  return row?.n ?? 0;
}

export async function getNotification(guildId: string, id: number): Promise<StaffNotification | null> {
  const [row] = await db
    .select()
    .from(staffNotificationsTable)
    .where(and(eq(staffNotificationsTable.guildId, guildId), eq(staffNotificationsTable.id, id)));
  return row ?? null;
}

export async function markRead(guildId: string, id: number, by: string, byName: string): Promise<void> {
  await db
    .update(staffNotificationsTable)
    .set({ status: sql`case when ${staffNotificationsTable.status} = 'unread' then 'read' else ${staffNotificationsTable.status} end`, readBy: by, readByUsername: byName, readAt: new Date() })
    .where(and(eq(staffNotificationsTable.guildId, guildId), eq(staffNotificationsTable.id, id)));
  await logAction(guildId, { action: "notification_read", moderatorId: by, moderatorUsername: byName, details: { id } });
}

export async function markCleared(guildId: string, id: number, by: string, byName: string): Promise<void> {
  await db
    .update(staffNotificationsTable)
    .set({ status: "cleared", clearedBy: by, clearedByUsername: byName, clearedAt: new Date() })
    .where(and(eq(staffNotificationsTable.guildId, guildId), eq(staffNotificationsTable.id, id)));
  await logAction(guildId, { action: "notification_cleared", moderatorId: by, moderatorUsername: byName, details: { id } });
}

export async function clearAll(guildId: string, by: string, byName: string): Promise<number> {
  const active = await listActive(guildId);
  for (const item of active) {
    await markCleared(guildId, item.id, by, byName);
  }
  return active.length;
}

/** Staff/owner user ids to DM the nudge to (officer + admin role holders). */
export async function staffRecipients(clan: Clan, guild: Guild): Promise<string[]> {
  const roleIds = [...new Set([...clan.staffRoleIds, ...clan.adminRoleIds])];
  if (!roleIds.length) return [];
  await guild.members.fetch().catch(() => null);
  const ids = new Set<string>();
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    for (const m of role.members.values()) if (!m.user.bot) ids.add(m.id);
  }
  return [...ids];
}
