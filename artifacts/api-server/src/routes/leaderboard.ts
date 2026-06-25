import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { clanMembersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/clans/:guildId/leaderboard", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params;
    const period = (req.query.period as string) || "weekly";
    const limit = Math.min(100, parseInt(req.query.limit as string) || 25);

    const xpColumn = (() => {
      switch (period) {
        case "daily": return clanMembersTable.xpDaily;
        case "weekly": return clanMembersTable.xpWeekly;
        case "monthly": return clanMembersTable.xpMonthly;
        default: return clanMembersTable.xpAllTime;
      }
    })();

    const members = await db
      .select()
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, guildId))
      .orderBy(desc(xpColumn))
      .limit(limit);

    const entries = members.map((m, i) => ({
      rank: i + 1,
      userId: m.userId,
      username: m.username,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl ?? null,
      xp: period === "daily" ? m.xpDaily
        : period === "weekly" ? m.xpWeekly
        : period === "monthly" ? m.xpMonthly
        : m.xpAllTime,
      altXp: m.altXpAllTime,
      submissions: m.submissionsCount,
      change: null,
    }));

    res.json(entries);
  } catch (err) {
    logger.error({ err }, "Error fetching leaderboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
