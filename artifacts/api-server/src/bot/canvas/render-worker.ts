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
import { ensureBackgroundLoaded } from "./theme";
import { renderHelpCard } from "./cards/helpCard";
import { renderWeeklyReview } from "./cards/weeklyReviewCard";
import { renderCalendar } from "./cards/calendarCard";
import { renderCommandCenter } from "./cards/commandCenterCard";
import { renderWarningCard } from "./cards/warningCard";
import { renderReminderCard } from "./cards/reminderCard";
import { renderEnforcementPicker } from "./cards/enforcementPickerCard";
import {
  renderRobloxHomeCard,
  renderRobloxPlayerCard,
  renderRobloxProfileCard,
  renderRobloxAvatarCard,
} from "./cards/roblox/playerCards";
import {
  renderRobloxGroupsCard,
  renderRobloxBadgesCard,
  renderRobloxFriendsCard,
  renderRobloxHistoryCard,
  renderRobloxStatusCard,
} from "./cards/roblox/listCards";
import {
  renderRobloxGameCard,
  renderRobloxServersCard,
  renderRobloxInventoryCard,
  renderMilitaryProfileCard,
  renderRobloxItemsCard,
  renderIntegrationCard,
} from "./cards/roblox/gameCards";
import {
  renderScoutHomeCard,
  renderScoutListCard,
  renderScoutGameIntelCard,
  renderScoutHistoryCard,
  renderScoutCompareCard,
  renderScoutVsGenreCard,
  renderScoutMoneyCard,
  renderScoutReportCard,
  renderScoutGroupCard,
} from "./cards/scout/scoutCards";

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
  // The shared brand texture is loaded once and reused by paintBackground /
  // paintPhotoSurface for every card, so warm it before the first draw.
  await ensureBackgroundLoaded();
  switch (fn) {
    case "weeklyReview":
      return renderWeeklyReview(p as any);
    case "helpCard":
      return renderHelpCard(p as any);
    case "calendarCard":
      return renderCalendar(p as any);
    case "commandCenter":
      return renderCommandCenter(p as any);
    case "warningCard":
      return renderWarningCard(p as any);
    case "reminderCard":
      return renderReminderCard(p as any);
    case "enforcementPicker":
      return renderEnforcementPicker(p as any);
    case "robloxHome":
      return renderRobloxHomeCard(p as any);
    case "robloxPlayer":
      return renderRobloxPlayerCard(p as any);
    case "robloxProfile":
      return renderRobloxProfileCard(p as any);
    case "robloxAvatar":
      return renderRobloxAvatarCard(p as any);
    case "robloxGroups":
      return renderRobloxGroupsCard(p as any);
    case "robloxBadges":
      return renderRobloxBadgesCard(p as any);
    case "robloxFriends":
      return renderRobloxFriendsCard(p as any);
    case "robloxHistory":
      return renderRobloxHistoryCard(p as any);
    case "robloxStatus":
      return renderRobloxStatusCard(p as any);
    case "robloxGame":
      return renderRobloxGameCard(p as any);
    case "robloxServers":
      return renderRobloxServersCard(p as any);
    case "robloxInventory":
      return renderRobloxInventoryCard(p as any);
    case "robloxMilitaryProfile":
      return renderMilitaryProfileCard(p as any);
    case "robloxItems":
      return renderRobloxItemsCard(p as any);
    case "robloxIntegration":
      return renderIntegrationCard(p as any);
    case "scoutHome":
      return renderScoutHomeCard(p as any);
    case "scoutList":
      return renderScoutListCard(p as any);
    case "scoutGame":
      return renderScoutGameIntelCard(p as any);
    case "scoutHistory":
      return renderScoutHistoryCard(p as any);
    case "scoutCompare":
      return renderScoutCompareCard(p as any);
    case "scoutVsGenre":
      return renderScoutVsGenreCard(p as any);
    case "scoutMoney":
      return renderScoutMoneyCard(p as any);
    case "scoutReport":
      return renderScoutReportCard(p as any);
    case "scoutGroup":
      return renderScoutGroupCard(p as any);
    default:
      throw new Error(`Unknown render function: "${fn}"`);
  }
}
