import { Client, GatewayIntentBits, Events, Partials, REST, Routes } from "discord.js";
import { logger } from "../lib/logger";
import { commands } from "./commands";
import { routeInteraction } from "./router";
import { handleSubmissionMessage } from "./features/submit";
import { ensureFonts } from "./canvas/fonts";
import { startScheduler } from "./scheduler";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

let client: Client | null = null;

/** The single bot client, if started. Used by schedulers/dashboards later. */
export function getClient(): Client | null {
  return client;
}

export function startBot() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    logger.warn("Bot not started — missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID");
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
    logger.info({ tag: c.user.tag }, "Discord bot ready");
    try {
      const rest = new REST().setToken(DISCORD_BOT_TOKEN!);
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body: commands });
      logger.info({ count: commands.length }, "Slash commands registered");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
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
