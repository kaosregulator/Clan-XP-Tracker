import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { clanMembersTable, xpSubmissionsTable, warningsTable } from "@workspace/db";
import { eq, and, isNull, ilike, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

function serializeMember(m: typeof clanMembersTable.$inferSelect) {
  return {
    ...m,
    lastSubmittedAt: m.lastSubmittedAt?.toISOString() ?? null,
    joinedAt: m.joinedAt.toISOString(),
    updatedAt: undefined,
  };
}

router.get("/clans/:guildId/members", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params as Record<string, string>;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let query = db.select().from(clanMembersTable).where(
      search
        ? and(eq(clanMembersTable.guildId, guildId), ilike(clanMembersTable.username, `%${search}%`))
        : eq(clanMembersTable.guildId, guildId)
    );

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clanMembersTable)
      .where(
        search
          ? and(eq(clanMembersTable.guildId, guildId), ilike(clanMembersTable.username, `%${search}%`))
          : eq(clanMembersTable.guildId, guildId)
      );

    const members = await query.limit(limit).offset(offset).orderBy(desc(clanMembersTable.xpAllTime));

    res.json({
      members: members.map(serializeMember),
      total: Number(countResult?.count ?? 0),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching members");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/clans/:guildId/members/:userId", requireAuth, async (req, res) => {
  try {
    const { guildId, userId } = req.params as Record<string, string>;

    const [member] = await db
      .select()
      .from(clanMembersTable)
      .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));

    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const recentSubmissions = await db
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
      .limit(10);

    const warnings = await db
      .select()
      .from(warningsTable)
      .where(
        and(
          eq(warningsTable.guildId, guildId),
          eq(warningsTable.userId, userId),
          isNull(warningsTable.removedAt)
        )
      )
      .orderBy(desc(warningsTable.issuedAt));

    // Build XP history from last 30 submissions
    const allSubs = await db
      .select({ submittedAt: xpSubmissionsTable.submittedAt, xpEarned: xpSubmissionsTable.xpEarned })
      .from(xpSubmissionsTable)
      .where(and(eq(xpSubmissionsTable.guildId, guildId), eq(xpSubmissionsTable.userId, userId), isNull(xpSubmissionsTable.deletedAt)))
      .orderBy(desc(xpSubmissionsTable.submittedAt))
      .limit(30);

    const xpHistory = allSubs.map((s) => ({
      date: s.submittedAt.toISOString().split("T")[0],
      xp: s.xpEarned,
    })).reverse();

    res.json({
      member: serializeMember(member),
      recentSubmissions: recentSubmissions.map((s) => ({
        ...s,
        submittedAt: s.submittedAt.toISOString(),
        editedAt: s.editedAt?.toISOString() ?? null,
        deletedAt: s.deletedAt?.toISOString() ?? null,
        proofImageUrls: s.proofImageUrls ?? [],
      })),
      warnings: warnings.map((w) => ({
        ...w,
        issuedAt: w.issuedAt.toISOString(),
        removedAt: w.removedAt?.toISOString() ?? null,
      })),
      xpHistory,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching member");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
