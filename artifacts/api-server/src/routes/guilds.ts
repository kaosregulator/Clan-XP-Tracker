import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { clansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/guilds", requireAuth, async (req, res) => {
  try {
    const accessToken = req.session.accessToken;
    if (!accessToken) {
      res.status(401).json({ error: "No access token" });
      return;
    }

    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!guildsRes.ok) {
      res.status(502).json({ error: "Failed to fetch guilds from Discord" });
      return;
    }

    const allGuilds = await guildsRes.json() as Array<{
      id: string;
      name: string;
      icon: string | null;
      permissions: string;
    }>;

    const MANAGE_SERVER = BigInt(0x20);
    const ADMINISTRATOR = BigInt(0x8);

    const adminGuilds = allGuilds.filter((g) => {
      const perms = BigInt(g.permissions);
      return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_SERVER) === MANAGE_SERVER;
    });

    const guildIds = adminGuilds.map((g) => g.id);
    const existingClans = guildIds.length > 0
      ? await db.select({ guildId: clansTable.guildId })
          .from(clansTable)
          .where(
            guildIds.length === 1
              ? eq(clansTable.guildId, guildIds[0]!)
              : undefined as never
          )
      : [];

    // Simpler approach: query all and filter
    const allClans = await db.select({ guildId: clansTable.guildId }).from(clansTable);
    const setupGuildIds = new Set(allClans.map((c) => c.guildId));

    res.json(
      adminGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        iconUrl: g.icon
          ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=256`
          : null,
        isSetUp: setupGuildIds.has(g.id),
        memberCount: null,
      }))
    );
  } catch (err) {
    logger.error({ err }, "Error fetching guilds");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
