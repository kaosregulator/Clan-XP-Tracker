/**
 * Showcase hub replies: public (channel-visible) cards with a short auto-delete
 * so the channel stays clean. Officer/private flows should keep using ephemeral.
 */
import type {
  ChatInputCommandInteraction,
  InteractionResponse,
  Message,
} from "discord.js";

// Multi-step hubs (Friends pages, Scout drills) need more than a couple minutes.
// Auto-delete still refreshes on each click via armHubAutoDelete.
export const HUB_AUTO_DELETE_MS = 600_000; // 10 min

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Public defer — everyone in the channel can see the card. */
export async function deferPublicHub(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply();
}

/**
 * Schedule (or refresh) auto-delete for a hub message. Call after every
 * successful edit so browsing buttons don't get cut off mid-session.
 */
export function armHubAutoDelete(
  message: Pick<Message, "id" | "deletable"> & { delete: () => Promise<unknown> },
  ms: number = HUB_AUTO_DELETE_MS
): void {
  const prev = timers.get(message.id);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    timers.delete(message.id);
    if (!message.deletable) return;
    void message.delete().catch(() => {});
  }, ms);
  timers.set(message.id, timer);
}

/** Helper after editReply — Discord returns Message | InteractionResponse. */
export function armHubAutoDeleteFromReply(
  reply: Message | InteractionResponse
): void {
  const msg = reply as Message;
  if (msg && typeof msg.id === "string" && typeof msg.delete === "function") {
    armHubAutoDelete(msg);
  }
}
