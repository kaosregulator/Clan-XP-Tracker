/**
 * Render worker pool.
 *
 * Maintains a small pool of `render-worker` threads. Callers await
 * renderOffThread() just like a normal async function — the event loop is
 * freed immediately (no synchronous blocking) while the worker thread does
 * the CPU-heavy canvas drawing.
 *
 * Pool size is intentionally small (2). Canvas renders are fast enough that
 * queuing is rare for a community-scale bot, and each worker holds @napi-rs/
 * canvas native bindings in its own thread — more workers = more RAM.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { logger } from "../../lib/logger";

const POOL_SIZE = 2;

interface Pending {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
}

const pending = new Map<number, Pending>();
let nextId = 0;
let workers: Worker[] = [];
let nextWorker = 0;

function buildWorker(): Worker {
  // When bundled by esbuild, import.meta.url is the bundle file (bot-worker.mjs
  // in dist/). The render worker is output to dist/bot/canvas/render-worker.mjs
  // because esbuild preserves the source path relative to src/.
  const workerPath = fileURLToPath(new URL("./bot/canvas/render-worker.mjs", import.meta.url));
  const w = new Worker(workerPath);

  w.on("message", ({ id, buf, error }: { id: number; buf?: ArrayBuffer; error?: string }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error !== undefined) {
      p.reject(new Error(error));
    } else {
      // buf is a transferred ArrayBuffer — wrap it in a Buffer without copying.
      p.resolve(Buffer.from(buf!));
    }
  });

  w.on("error", (err) => {
    logger.error({ err }, "Render worker error — rebuilding");
    const idx = workers.indexOf(w);
    if (idx >= 0) workers[idx] = buildWorker();
  });

  w.on("exit", (code) => {
    if (code !== 0) {
      logger.warn({ code }, "Render worker exited unexpectedly — rebuilding");
      const idx = workers.indexOf(w);
      if (idx >= 0) workers[idx] = buildWorker();
    }
  });

  return w;
}

/** Call once at bot startup to pre-warm the worker threads. */
export function initRenderPool(): void {
  if (workers.length > 0) return;
  workers = Array.from({ length: POOL_SIZE }, buildWorker);
  logger.info({ poolSize: POOL_SIZE }, "Render worker pool initialised");
}

/**
 * Dispatch a canvas render to a worker thread.
 *
 * The function name maps to one of the cases in render-worker.ts.
 * All params must be JSON-serializable. For renders that need an avatar,
 * pass avatarUrl (string | null) instead of the Image object — the worker
 * fetches and caches the image itself.
 */
export function renderOffThread(fn: string, params: unknown): Promise<Buffer> {
  // Lazy init in case initRenderPool() was not called explicitly.
  if (workers.length === 0) initRenderPool();

  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    // Round-robin across the pool.
    const w = workers[nextWorker % workers.length]!;
    nextWorker++;
    w.postMessage({ id, fn, params });
  });
}
