import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/clans/:guildId/audit", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params as Record<string, string>;
    const userId = req.query.userId as string | undefined;
    const action = req.query.action as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 30);
    const offset = (page - 1) * limit;

    const conditions = [
      eq(auditLogsTable.guildId, guildId),
      ...(userId ? [eq(auditLogsTable.targetUserId, userId)] : []),
      ...(action ? [eq(auditLogsTable.action, action)] : []),
    ];

    const whereClause = conditions.length === 1 ? conditions[0]! : and(...conditions as [typeof conditions[0], typeof conditions[0]]);

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(whereClause)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(logs.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      details: l.details ?? {},
    })));
  } catch (err) {
    logger.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
