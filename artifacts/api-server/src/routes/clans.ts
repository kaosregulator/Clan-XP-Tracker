import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import {
  clansTable,
  clanMembersTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

async function getClanWithStats(guildId: string) {
  const [clan] = await db.select().from(clansTable).where(eq(clansTable.guildId, guildId));
  if (!clan) return null;

  const [memberStats] = await db
    .select({
      totalMembers: sql<number>`count(*)`,
      totalXpAllTime: sql<number>`coalesce(sum(xp_all_time), 0)`,
    })
    .from(clanMembersTable)
    .where(eq(clanMembersTable.guildId, guildId));

  return {
    ...clan,
    totalMembers: Number(memberStats?.totalMembers ?? 0),
    totalXpAllTime: Number(memberStats?.totalXpAllTime ?? 0),
  };
}

router.get("/clans/:guildId", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params;
    const clan = await getClanWithStats(guildId);
    if (!clan) {
      res.status(404).json({ error: "Clan not found" });
      return;
    }
    res.json({
      ...clan,
      allowedRoleIds: clan.allowedRoleIds ?? [],
      allowedUserIds: clan.allowedUserIds ?? [],
      createdAt: clan.createdAt.toISOString(),
      updatedAt: clan.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Error getting clan");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ClanSetupSchema = z.object({
  clanName: z.string().min(1),
  clanLogoUrl: z.string().nullable().optional(),
  logChannelId: z.string().nullable().optional(),
  proofRequired: z.boolean(),
  allowedRoleIds: z.array(z.string()),
  allowedUserIds: z.array(z.string()),
});

router.post("/clans/:guildId/setup", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params;
    const parsed = ClanSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const { clanName, clanLogoUrl, logChannelId, proofRequired, allowedRoleIds, allowedUserIds } = parsed.data;

    const [existing] = await db.select({ id: clansTable.id }).from(clansTable).where(eq(clansTable.guildId, guildId));
    if (existing) {
      res.status(409).json({ error: "Clan already set up" });
      return;
    }

    const [clan] = await db.insert(clansTable).values({
      guildId,
      guildName: guildId,
      clanName,
      clanLogoUrl: clanLogoUrl ?? null,
      logChannelId: logChannelId ?? null,
      proofRequired,
      allowedRoleIds,
      allowedUserIds,
    }).returning();

    await db.insert(auditLogsTable).values({
      guildId,
      action: "setup_change",
      moderatorId: req.session.userId ?? null,
      moderatorUsername: req.session.discordUser?.username ?? null,
      details: { event: "clan_setup", clanName },
    });

    res.status(201).json({
      ...clan,
      totalMembers: 0,
      totalXpAllTime: 0,
      createdAt: clan!.createdAt.toISOString(),
      updatedAt: clan!.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Error setting up clan");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ClanSettingsUpdateSchema = z.object({
  clanName: z.string().min(1).optional(),
  clanLogoUrl: z.string().nullable().optional(),
  logChannelId: z.string().nullable().optional(),
  proofRequired: z.boolean().optional(),
  allowedRoleIds: z.array(z.string()).optional(),
  allowedUserIds: z.array(z.string()).optional(),
});

router.patch("/clans/:guildId/settings", requireAuth, async (req, res) => {
  try {
    const { guildId } = req.params;
    const parsed = ClanSettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const updateData: Partial<typeof parsed.data> = {};
    if (parsed.data.clanName !== undefined) updateData.clanName = parsed.data.clanName;
    if (parsed.data.clanLogoUrl !== undefined) updateData.clanLogoUrl = parsed.data.clanLogoUrl;
    if (parsed.data.logChannelId !== undefined) updateData.logChannelId = parsed.data.logChannelId;
    if (parsed.data.proofRequired !== undefined) updateData.proofRequired = parsed.data.proofRequired;
    if (parsed.data.allowedRoleIds !== undefined) updateData.allowedRoleIds = parsed.data.allowedRoleIds;
    if (parsed.data.allowedUserIds !== undefined) updateData.allowedUserIds = parsed.data.allowedUserIds;

    await db.update(clansTable).set(updateData).where(eq(clansTable.guildId, guildId));

    await db.insert(auditLogsTable).values({
      guildId,
      action: "settings_change",
      moderatorId: req.session.userId ?? null,
      moderatorUsername: req.session.discordUser?.username ?? null,
      details: { changes: updateData },
    });

    const clan = await getClanWithStats(guildId);
    if (!clan) {
      res.status(404).json({ error: "Clan not found" });
      return;
    }
    res.json({
      ...clan,
      createdAt: clan.createdAt.toISOString(),
      updatedAt: clan.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Error updating clan settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
