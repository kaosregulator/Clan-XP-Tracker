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

startBot();
