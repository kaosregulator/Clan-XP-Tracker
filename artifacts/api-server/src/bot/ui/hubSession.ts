/**
 * Shared in-memory hub / panel session helpers.
 *
 * Discord component interactions look up state by message id. When that map
 * entry is missing (bot worker restart, TTL prune, failed bind), we used to
 * tell the owner "this belongs to someone else" — which is wrong and confusing.
 * These helpers distinguish missing vs foreign ownership and bind via
 * fetchReply() so the stored id always matches interaction.message.id.
 */
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from "discord.js";

export type HubDenialReason = "missing" | "foreign";

export type HubAccess<T extends { ownerId: string; ts: number }> =
  | { ok: true; state: T; reclaimed: boolean }
  | { ok: false; reason: HubDenialReason };

export function pruneStore<T extends { ts: number }>(
  store: Map<string, T>,
  ttlMs: number
): void {
  const cutoff = Date.now() - ttlMs;
  for (const [k, v] of store) {
    if (v.ts < cutoff) store.delete(k);
  }
}

/**
 * Resolve hub state for a component click.
 * - foreign: another user's live session on this message
 * - missing: no session (restart / TTL / bind miss) — optionally reclaim
 */
export function accessOwnedState<T extends { ownerId: string; ts: number }>(
  store: Map<string, T>,
  messageId: string,
  userId: string,
  opts: {
    ttlMs: number;
    /** When session was lost, recreate for this user so buttons keep working. */
    reclaim?: () => T;
  }
): HubAccess<T> {
  pruneStore(store, opts.ttlMs);
  const existing = store.get(messageId);
  if (existing) {
    if (existing.ownerId !== userId) return { ok: false, reason: "foreign" };
    existing.ts = Date.now();
    return { ok: true, state: existing, reclaimed: false };
  }
  if (opts.reclaim) {
    const state = opts.reclaim();
    state.ts = Date.now();
    store.set(messageId, state);
    return { ok: true, state, reclaimed: true };
  }
  return { ok: false, reason: "missing" };
}

export function hubDeniedContent(
  command: string,
  reason: HubDenialReason
): string {
  if (reason === "foreign") {
    return `This panel belongs to someone else — run \`/${command}\` to open yours.`;
  }
  return `This panel session expired (bot refreshed or timed out). Run \`/${command}\` again — you're not locked out.`;
}

/** Bind state to the real message snowflake after editReply. */
export async function bindAfterEditReply<T extends { ownerId: string; ts: number }>(
  interaction:
    | ChatInputCommandInteraction
    | MessageComponentInteraction
    | ModalSubmitInteraction,
  store: Map<string, T>,
  state: T,
  ttlMs: number
): Promise<Message> {
  pruneStore(store, ttlMs);
  state.ts = Date.now();
  const msg = await interaction.fetchReply();
  store.set(msg.id, state);
  return msg;
}

export function denyHubInteraction(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | UserSelectMenuInteraction
    | RoleSelectMenuInteraction
    | ModalSubmitInteraction,
  command: string,
  reason: HubDenialReason
): Promise<unknown> {
  const content = hubDeniedContent(command, reason);
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, flags: 64 }).catch(() => null);
  }
  return interaction.reply({ content, flags: 64 }).catch(() => null);
}
