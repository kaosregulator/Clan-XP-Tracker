import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { xpSubmissionsTable, clanMembersTable, auditLogsTable } from "@workspace/db";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

function serializeSubmission(s: typeof xpSubmissionsTable.$inferSelect) {
  return {
    ...s,
    submittedAt: s.submittedAt.toISOString(),
    editedAt: s.editedAt?.toISOString() ?? null,
    deletedAt: s.deletedAt?.toISOString() ?? null,
    proofImageUrls: s.proofImageUrls ?? [],
  };
}

router.get("/clans/:guildId/submissions", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params as Record<string, string>;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const userId = req.query.userId as string | undefined;
    const offset = (page - 1) * limit;

    const conditions = [
      eq(xpSubmissionsTable.guildId, guildId),
      isNull(xpSubmissionsTable.deletedAt),
      ...(userId ? [eq(xpSubmissionsTable.userId, userId)] : []),
    ];

    const whereClause = conditions.length === 1 ? conditions[0]! : and(...conditions as [typeof conditions[0], typeof conditions[0]]);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(xpSubmissionsTable)
      .where(whereClause);

    const submissions = await db
      .select()
      .from(xpSubmissionsTable)
      .where(whereClause)
      .orderBy(desc(xpSubmissionsTable.submittedAt))
      .limit(limit)
      .offset(offset);

    res.json({
      submissions: submissions.map(serializeSubmission),
      total: Number(countResult?.count ?? 0),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching submissions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/clans/:guildId/submissions/:submissionId", requireAuth, async (req, res) => {
  try {
    const { guildId, submissionId } = req.params as Record<string, string>;
    const [submission] = await db
      .select()
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), eq(xpSubmissionsTable.id, parseInt(submissionId))));

    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    res.json(serializeSubmission(submission));
  } catch (err) {
    logger.error({ err }, "Error fetching submission");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateSubmissionSchema = z.object({
  xpEarned: z.number().int().min(0).optional(),
  altAccountsCompleted: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
  reason: z.string().optional(),
});

router.patch("/clans/:guildId/submissions/:submissionId", requireAuth, async (req, res) => {
  try {
    const { guildId, submissionId } = req.params as Record<string, string>;
    const parsed = UpdateSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const [existing] = await db
      .select()
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), eq(xpSubmissionsTable.id, parseInt(submissionId))));

    if (!existing) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const oldXp = existing.xpEarned;
    const newXp = parsed.data.xpEarned ?? existing.xpEarned;
    const xpDiff = newXp - oldXp;

    await db.update(xpSubmissionsTable).set({
      xpEarned: parsed.data.xpEarned ?? existing.xpEarned,
      altAccountsCompleted: parsed.data.altAccountsCompleted ?? existing.altAccountsCompleted,
      notes: parsed.data.notes !== undefined ? parsed.data.notes : existing.notes,
      editedBy: req.session.userId ?? null,
      editedAt: new Date(),
      editReason: parsed.data.reason ?? null,
    }).where(eq(xpSubmissionsTable.id, parseInt(submissionId)));

    if (xpDiff !== 0) {
      await db.update(clanMembersTable).set({
        xpAllTime: sql`xp_all_time + ${xpDiff}`,
        xpWeekly: sql`xp_weekly + ${xpDiff}`,
        xpMonthly: sql`xp_monthly + ${xpDiff}`,
      }).where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, existing.userId)));
    }

    await db.insert(auditLogsTable).values({
      guildId,
      action: "xp_edited",
      targetUserId: existing.userId,
      targetUsername: existing.username,
      moderatorId: req.session.userId ?? null,
      moderatorUsername: req.session.discordUser?.username ?? null,
      details: { oldXp, newXp, reason: parsed.data.reason },
    });

    const [updated] = await db.select().from(xpSubmissionsTable).where(eq(xpSubmissionsTable.id, parseInt(submissionId)));
    res.json(serializeSubmission(updated!));
  } catch (err) {
    logger.error({ err }, "Error updating submission");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/clans/:guildId/submissions/:submissionId", requireAuth, async (req, res) => {
  try {
    const { guildId, submissionId } = req.params as Record<string, string>;

    const [existing] = await db
      .select()
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), eq(xpSubmissionsTable.id, parseInt(submissionId))));

    if (!existing) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    await db.update(xpSubmissionsTable).set({
      deletedAt: new Date(),
      deletedBy: req.session.userId ?? null,
    }).where(eq(xpSubmissionsTable.id, parseInt(submissionId)));

    await db.update(clanMembersTable).set({
      xpAllTime: sql`xp_all_time - ${existing.xpEarned}`,
      xpWeekly: sql`xp_weekly - ${existing.xpEarned}`,
      xpMonthly: sql`xp_monthly - ${existing.xpEarned}`,
      submissionsCount: sql`submissions_count - 1`,
    }).where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, existing.userId)));

    await db.insert(auditLogsTable).values({
      guildId,
      action: "xp_removed",
      targetUserId: existing.userId,
      targetUsername: existing.username,
      moderatorId: req.session.userId ?? null,
      moderatorUsername: req.session.discordUser?.username ?? null,
      details: { xpRemoved: existing.xpEarned },
    });

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Error deleting submission");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
