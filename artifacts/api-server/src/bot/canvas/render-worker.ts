/**
 * Canvas render worker thread.
 *
 * This module runs inside a dedicated worker thread. All synchronous
 * @napi-rs/canvas draw calls (fills, shadows, gradients, text) happen here,
 * so they never block the bot's main event loop. Discord interactions can
 * always reach deferReply() within the 3-second window even while a complex
 * canvas card is being rendered for a different user.
 *
 * Communication protocol (message passing, no shared memory):
 *   Main → Worker: { id: number; fn: string; params: Record<string, unknown> }
 *   Worker → Main: { id: number; buf: ArrayBuffer }   (success — transferred, not copied)
 *                  { id: number; error: string }       (failure)
 */
import { parentPort } from "node:worker_threads";
import { renderHelpCard } from "./cards/helpCard";
import { renderWeeklyReview } from "./cards/weeklyReviewCard";
import { renderCalendar } from "./cards/calendarCard";
import { renderCommandCenter } from "./cards/commandCenterCard";

if (!parentPort) throw new Error("render-worker must be spawned as a Worker thread");

parentPort.on("message", (msg: { id: number; fn: string; params: Record<string, unknown> }) => {
  void dispatch(msg.fn, msg.params)
    .then((buf) => {
      // canvas.encode("png") returns a Buffer backed by native (napi external)
      // memory. That ArrayBuffer is NOT transferable — postMessaging it in the
      // transfer list throws "DataCloneError: Cannot transfer object of
      // unsupported type", which rejects the render and fails the command.
      // Copy the exact PNG bytes into a fresh, standalone ArrayBuffer we own,
      // which IS transferable (zero-copy hand-off, one copy to detach).
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer;
      parentPort!.postMessage({ id: msg.id, buf: ab }, [ab]);
    })
    .catch((err: unknown) => {
      parentPort!.postMessage({ id: msg.id, error: String(err) });
    });
});

async function dispatch(fn: string, p: Record<string, unknown>): Promise<Buffer> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  switch (fn) {
    case "weeklyReview":
      return renderWeeklyReview(p as any);
    case "helpCard":
      return renderHelpCard(p as any);
    case "calendarCard":
      return renderCalendar(p as any);
    case "commandCenter":
      return renderCommandCenter(p as any);
    default:
      throw new Error(`Unknown render function: "${fn}"`);
  }
}
