import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function spawnBotWorker() {
  // Resolve relative to this file — in the built output this is dist/index.mjs
  // so the worker lives at dist/bot-worker.mjs.
  const workerPath = fileURLToPath(new URL("./bot-worker.mjs", import.meta.url));
  const worker = new Worker(workerPath);

  worker.on("error", (err) => {
    logger.error({ err }, "Bot worker error");
  });

  worker.on("exit", (code) => {
    if (code !== 0) {
      logger.warn({ code }, "Bot worker exited — restarting in 5 s");
      setTimeout(spawnBotWorker, 5_000);
    }
  });
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Spawn the bot in a dedicated worker thread. Canvas rendering (CPU-bound
  // synchronous work) runs on the worker's event loop and never blocks HTTP
  // request handling or Discord interaction acknowledgements on the main thread.
  spawnBotWorker();
});
