import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { clanMembersTable, xpSubmissionsTable, warningsTable, auditLogsTable } from "@workspace/db";
import { eq, and, isNull, gte, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/clans/:guildId/stats", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now);
    monthStart.setDate(now.getDate() - 30);

    const [memberStats] = await db
      .select({
        totalMembers: sql<number>`count(*)`,
        totalXpAllTime: sql<number>`coalesce(sum(xp_all_time), 0)`,
        avgXpPerMember: sql<number>`coalesce(avg(xp_all_time), 0)`,
      })
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, guildId));

    const [activeTodayResult] = await db
      .select({ count: sql<number>`count(distinct user_id)` })
      .from(xpSubmissionsTable)
      .where(and(
        eq(xpSubmissionsTable.guildId, guildId),
        gte(xpSubmissionsTable.submittedAt, todayStart),
        isNull(xpSubmissionsTable.deletedAt)
      ));

    const [activeWeekResult] = await db
      .select({ count: sql<number>`count(distinct user_id)` })
      .from(xpSubmissionsTable)
      .where(and(
        eq(xpSubmissionsTable.guildId, guildId),
        gte(xpSubmissionsTable.submittedAt, weekStart),
        isNull(xpSubmissionsTable.deletedAt)
      ));

    const [xpTodayResult] = await db
      .select({ total: sql<number>`coalesce(sum(xp_earned), 0)` })
      .from(xpSubmissionsTable)
      .where(and(
        eq(xpSubmissionsTable.guildId, guildId),
        gte(xpSubmissionsTable.submittedAt, todayStart),
        isNull(xpSubmissionsTable.deletedAt)
      ));

    const [xpWeekResult] = await db
      .select({ total: sql<number>`coalesce(sum(xp_earned), 0)` })
      .from(xpSubmissionsTable)
      .where(and(
        eq(xpSubmissionsTable.guildId, guildId),
        gte(xpSubmissionsTable.submittedAt, weekStart),
        isNull(xpSubmissionsTable.deletedAt)
      ));

    const [xpMonthResult] = await db
      .select({ total: sql<number>`coalesce(sum(xp_earned), 0)` })
      .from(xpSubmissionsTable)
      .where(and(
        eq(xpSubmissionsTable.guildId, guildId),
        gte(xpSubmissionsTable.submittedAt, monthStart),
        isNull(xpSubmissionsTable.deletedAt)
      ));

    const [totalSubsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), isNull(xpSubmissionsTable.deletedAt)));

    const [totalWarningsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(warningsTable)
      .where(and(eq(warningsTable.guildId, guildId), isNull(warningsTable.removedAt)));

    // Daily chart data for last 14 days
    const chartData = await db
      .select({
        date: sql<string>`DATE(submitted_at AT TIME ZONE 'UTC')`,
        xp: sql<number>`coalesce(sum(xp_earned), 0)`,
        submissions: sql<number>`count(*)`,
      })
      .from(xpSubmissionsTable)
      .where(and(
        eq(xpSubmissionsTable.guildId, guildId),
        gte(xpSubmissionsTable.submittedAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
        isNull(xpSubmissionsTable.deletedAt)
      ))
      .groupBy(sql`DATE(submitted_at AT TIME ZONE 'UTC')`)
      .orderBy(sql`DATE(submitted_at AT TIME ZONE 'UTC')`);

    const topContributors = await db
      .select()
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, guildId))
      .orderBy(desc(clanMembersTable.xpAllTime))
      .limit(5);

    res.json({
      totalMembers: Number(memberStats?.totalMembers ?? 0),
      activeToday: Number(activeTodayResult?.count ?? 0),
      activeThisWeek: Number(activeWeekResult?.count ?? 0),
      totalXpToday: Number(xpTodayResult?.total ?? 0),
      totalXpWeek: Number(xpWeekResult?.total ?? 0),
      totalXpMonth: Number(xpMonthResult?.total ?? 0),
      totalXpAllTime: Number(memberStats?.totalXpAllTime ?? 0),
      avgXpPerMember: Math.round(Number(memberStats?.avgXpPerMember ?? 0)),
      totalSubmissions: Number(totalSubsResult?.count ?? 0),
      totalWarnings: Number(totalWarningsResult?.count ?? 0),
      xpChart: chartData.map((d) => ({
        date: d.date,
        xp: Number(d.xp),
        submissions: Number(d.submissions),
      })),
      topContributors: topContributors.map((m, i) => ({
        rank: i + 1,
        userId: m.userId,
        username: m.username,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl ?? null,
        xp: m.xpAllTime,
        altXp: m.altXpAllTime,
        submissions: m.submissionsCount,
        change: null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Error fetching stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/clans/:guildId/activity", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.guildId, guildId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    const activityEntries = logs.map((l, i) => {
      const details = l.details as Record<string, unknown> ?? {};
      let description = l.action;
      let xpAmount: number | null = null;

      switch (l.action) {
        case "xp_submitted":
          xpAmount = details.xpEarned as number ?? null;
          description = `Submitted ${xpAmount ?? 0} XP`;
          break;
        case "xp_edited":
          description = `XP edited (${details.oldXp} → ${details.newXp})`;
          xpAmount = details.newXp as number ?? null;
          break;
        case "xp_removed":
          description = `XP submission removed`;
          break;
        case "warning_issued":
          description = `Warning issued: ${details.reason ?? ""}`;
          break;
        case "warning_removed":
          description = `Warning removed`;
          break;
        case "setup_change":
          description = `Clan setup completed`;
          break;
        case "settings_change":
          description = `Settings updated`;
          break;
        default:
          description = l.action.replace(/_/g, " ");
      }

      return {
        id: l.id,
        type: l.action as string,
        userId: l.targetUserId ?? l.moderatorId ?? "system",
        username: l.targetUsername ?? l.moderatorUsername ?? "System",
        avatarUrl: null,
        xpAmount,
        description,
        timestamp: l.createdAt.toISOString(),
      };
    });

    res.json(activityEntries);
  } catch (err) {
    logger.error({ err }, "Error fetching activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
