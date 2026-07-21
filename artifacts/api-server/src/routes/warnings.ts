import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { warningsTable, clanMembersTable, auditLogsTable } from "@workspace/db";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

function serializeWarning(w: typeof warningsTable.$inferSelect) {
  return {
    ...w,
    issuedAt: w.issuedAt.toISOString(),
    removedAt: w.removedAt?.toISOString() ?? null,
  };
}

router.get("/clans/:guildId/warnings", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params as Record<string, string>;
    const userId = req.query.userId as string | undefined;

    const conditions = [
      eq(warningsTable.guildId, guildId),
      isNull(warningsTable.removedAt),
      ...(userId ? [eq(warningsTable.userId, userId)] : []),
    ];

    const whereClause = conditions.length === 1 ? conditions[0]! : and(...conditions as [typeof conditions[0], typeof conditions[0]]);

    const warnings = await db
      .select()
      .from(warningsTable)
      .where(whereClause)
      .orderBy(desc(warningsTable.issuedAt));

    res.json(warnings.map(serializeWarning));
  } catch (err) {
    logger.error({ err }, "Error fetching warnings");
    res.status(500).json({ error: "Internal server error" });
  }
});

const WarningInputSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().min(1),
});

router.post("/clans/:guildId/warnings", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params as Record<string, string>;
    const parsed = WarningInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const { userId, reason } = parsed.data;

    const [member] = await db
      .select()
      .from(clanMembersTable)
      .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

    const [warning] = await db.insert(warningsTable).values({
      guildId,
      userId,
      username: member?.username ?? userId,
      avatarUrl: member?.avatarUrl ?? null,
      issuedBy: req.session.userId ?? "unknown",
      issuedByUsername: req.session.discordUser?.username ?? "unknown",
      reason,
    }).returning();

    await db.update(clanMembersTable)
      .set({ warningsCount: sql`warnings_count + 1` })
      .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

    await db.insert(auditLogsTable).values({
      guildId,
      action: "warning_issued",
      targetUserId: userId,
      targetUsername: member?.username ?? userId,
      moderatorId: req.session.userId ?? null,
      moderatorUsername: req.session.discordUser?.username ?? null,
      details: { reason },
    });

    res.status(201).json(serializeWarning(warning!));
  } catch (err) {
    logger.error({ err }, "Error issuing warning");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/clans/:guildId/warnings/:warningId", requireAuth, async (req, res) => {
  try {
    const { guildId, warningId } = req.params as Record<string, string>;

    const [warning] = await db
      .select()
      .from(warningsTable)
      .where(and(eq(warningsTable.guildId, guildId), eq(warningsTable.id, parseInt(warningId))));

    if (!warning) {
      res.status(404).json({ error: "Warning not found" });
      return;
    }

    await db.update(warningsTable).set({
      removedAt: new Date(),
      removedBy: req.session.userId ?? null,
    }).where(eq(warningsTable.id, parseInt(warningId)));

    await db.update(clanMembersTable)
      .set({ warningsCount: sql`greatest(warnings_count - 1, 0)` })
      .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, warning.userId)));

    await db.insert(auditLogsTable).values({
      guildId,
      action: "warning_removed",
      targetUserId: warning.userId,
      targetUsername: warning.username,
      moderatorId: req.session.userId ?? null,
      moderatorUsername: req.session.discordUser?.username ?? null,
      details: { warningId: warning.id, originalReason: warning.reason },
    });

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Error removing warning");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
