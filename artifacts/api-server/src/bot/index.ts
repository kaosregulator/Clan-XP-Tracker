import { Client, GatewayIntentBits, Events, Partials, REST, Routes } from "discord.js";
import { logger } from "../lib/logger";
import { commands } from "./commands";
import { routeInteraction } from "./router";
import { handleSubmissionMessage } from "./features/submit";
import { ensureFonts } from "./canvas/fonts";
import { startScheduler } from "./scheduler";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
// Optional: register commands to specific guild(s) for INSTANT availability
// (global commands can take up to an hour to appear). Comma-separated IDs.
const DISCORD_DEV_GUILD_ID = process.env.DISCORD_DEV_GUILD_ID;

let client: Client | null = null;

/**
 * Register slash commands. If DISCORD_DEV_GUILD_ID is set we register to those
 * guilds (instant, ideal while setting up/testing); otherwise globally.
 */
async function registerCommands(client: Client) {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN!);
  const guildIds = (DISCORD_DEV_GUILD_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    if (guildIds.length) {
      for (const guildId of guildIds) {
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, guildId), { body: commands });
      }
      // Clear any stale global commands so members don't see duplicates.
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body: [] }).catch(() => {});
      logger.info({ count: commands.length, guilds: guildIds }, "Slash commands registered (guild — instant)");
    } else {
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body: commands });
      logger.info(
        { count: commands.length },
        "Slash commands registered (global — can take up to 1h to appear; set DISCORD_DEV_GUILD_ID for instant)"
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
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

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // required to read screenshot attachments
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, "Discord bot ready");
    await registerCommands(c);
    startScheduler(c);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction);
  });

  client.on(Events.MessageCreate, (message) => {
    void handleSubmissionMessage(message);
  });

  client.login(DISCORD_BOT_TOKEN).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}
