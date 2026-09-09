import { Client, GatewayIntentBits, Events, Partials, REST, Routes } from "discord.js";
import { logger } from "../lib/logger";
import { commands } from "./commands";
import { routeInteraction } from "./router";
import { ensureFonts } from "./canvas/fonts";
import { initRenderPool } from "./canvas/render-pool";
import { startScheduler } from "./scheduler";
import { setCommandCenterClient } from "./services/commandCenter";
import { startScoutAutoSnapshots } from "./services/scout";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
// Optional: register commands to specific guild(s) for INSTANT availability
// (global commands can take up to an hour to appear). Comma-separated IDs.
const DISCORD_DEV_GUILD_ID = process.env.DISCORD_DEV_GUILD_ID;

let client: Client | null = null;

/**
 * Register slash commands.
 *
 * Always push the full set **globally** so a bad/missing guild ID can never
 * wipe the live command list. Optional `DISCORD_DEV_GUILD_ID` also mirrors the
 * same set onto those guilds for instant updates (and we clear leftover guild
 * trees on other joined servers so old `/roblox profile` ghosts die).
 *
 * Never clear the global set — that was wiping production when guild PUT
 * failed with Discord 50001 Missing Access.
 */
async function registerCommands(client: Client) {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN!);
  const guildIds = (DISCORD_DEV_GUILD_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const appId = DISCORD_CLIENT_ID!;

  // 1) Global is the source of truth — must succeed for the bot to work.
  try {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    logger.info(
      { count: commands.length },
      "Slash commands registered globally (Discord may take up to ~1h to refresh clients)"
    );
  } catch (err) {
    logger.error({ err }, "Failed to register global slash commands");
    return;
  }

  // 2) Optional guild mirrors for instant visibility.
  const mirrored: string[] = [];
  for (const guildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
      mirrored.push(guildId);
    } catch (err) {
      const code = (err as { code?: number })?.code;
      logger.error(
        { err, guildId, code },
        code === 50001
          ? "Missing Access registering guild slash commands — remove DISCORD_DEV_GUILD_ID or re-invite the bot with the applications.commands scope"
          : "Failed to register guild slash commands (global commands still updated)"
      );
    }
  }
  if (mirrored.length) {
    logger.info({ guilds: mirrored, count: commands.length }, "Slash commands also mirrored to guild(s) — instant");
  }

  // 3) Clear stale guild command trees on other joined servers (old subcommand hubs).
  let cleared = 0;
  let blocked = 0;
  for (const guild of client.guilds.cache.values()) {
    if (mirrored.includes(guild.id)) continue;
    try {
      await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body: [] });
      cleared += 1;
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 50001) {
        blocked += 1;
        logger.warn(
          { guildId: guild.id, guildName: guild.name },
          "Cannot clear stale guild slash commands (Missing Access) — re-invite the bot with applications.commands or old /roblox subcommands may keep showing"
        );
      } else {
        logger.warn({ err, guildId: guild.id }, "Failed to clear stale guild slash commands");
      }
    }
  }
  if (cleared || blocked) {
    logger.info(
      { clearedGuildCommandSets: cleared, blockedMissingAccess: blocked },
      "Guild slash-command cleanup finished"
    );
  }
}

/** The single bot client, if started. Used by schedulers/dashboards later. */
export function getClient(): Client | null {
  return client;
}

export function startBot() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    logger.warn("Bot not started — missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID");
    return;
  }

  // Avoid running two Discord bots at the same time (dev workflow + production
  // deployment both share the same token and would steal each other's interactions).
  // In development, explicitly opt in with DISCORD_BOT_ENABLED=true when you need to test bot logic.
  const botEnabled = process.env.DISCORD_BOT_ENABLED;
  if (process.env.NODE_ENV === "development" && botEnabled !== "true" && botEnabled !== "1") {
    logger.info("Bot not started in development — set DISCORD_BOT_ENABLED=true to test locally");
    return;
  }

  // Warm the canvas fonts once at boot so the first hub render is fast.
  ensureFonts();
  // Pre-warm the render worker pool so the first interaction doesn't pay the
  // thread-spawn cost.
  initRenderPool();

  client = new Client({
    // Officers drive everything through slash commands and components, so the
    // bot needs no message-content access. GuildMembers is required to resolve
    // role membership for bulk actions and exempt/leave role sync.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
    rest: {
      // Card replies attach a rendered PNG. discord.js's default undici
      // `request` strategy converts the multipart FormData through resolveBody
      // and its upload stalls on this host — every image command aborted after
      // the REST timeout while text-only replies worked. Node's native fetch
      // accepts the FormData directly and streams multipart correctly, so route
      // Discord HTTP through it instead. Keep a generous timeout as a backstop.
      timeout: 60_000,
      makeRequest: (url, init) =>
        fetch(url, init as RequestInit) as unknown as ReturnType<
          NonNullable<ConstructorParameters<typeof Client>[0]["rest"]>["makeRequest"] & object
        >,
    },
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, "Discord bot ready");
    // Give the persistent command center a live client so it can edit its
    // message in place when data changes.
    setCommandCenterClient(c);
    await registerCommands(c);
    startScheduler(c);
    // Background Military Tycoon (and tracked) snapshots for Game Intelligence.
    try {
      startScoutAutoSnapshots();
    } catch (err) {
      logger.warn({ err }, "Scout auto-snapshots failed to start");
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction);
  });

  client.login(DISCORD_BOT_TOKEN).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}
