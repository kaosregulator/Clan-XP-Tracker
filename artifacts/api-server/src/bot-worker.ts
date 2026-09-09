/**
 * Discord bot worker thread entry point.
 *
 * Running the bot in a dedicated worker thread gives it its own Node.js event
 * loop. Canvas draw calls (synchronous CPU work from @napi-rs/canvas) can no
 * longer block the HTTP server's event loop, so interactions are acknowledged
 * within Discord's 3-second window even while a canvas card is being rendered
 * for another user.
 */
import { startBot } from "./bot/index.js";
import { ensureSchema } from "./lib/ensureSchema.js";
import { logger } from "./lib/logger.js";

async function main() {
  // Bot worker has its own DB pool — ensure columns exist here too (main thread
  // also runs this before spawn; this covers race / restart edge cases).
  try {
    await ensureSchema();
  } catch (err) {
    logger.warn({ err }, "Bot worker schema ensure failed — /link may error until fixed");
  }
  startBot();
}

void main();
