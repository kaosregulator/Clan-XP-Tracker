import type { BaseMessageOptions, InteractionEditReplyOptions } from "discord.js";

/**
 * Discord keeps previous file attachments when a message is edited unless they
 * are explicitly cleared. Canvas hubs replace the card image on every navigate
 * — without `attachments: []`, PNGs stack and every image command looks broken.
 */
export function replaceHubCard(
  payload: BaseMessageOptions
): InteractionEditReplyOptions {
  return {
    content: payload.content ?? null,
    embeds: payload.embeds ?? [],
    components: payload.components ?? [],
    files: payload.files ?? [],
    attachments: [],
  };
}

/** Error / empty reply that also drops any stacked canvas attachments. */
export function clearHubCard(content: string): InteractionEditReplyOptions {
  return {
    content,
    embeds: [],
    components: [],
    files: [],
    attachments: [],
  };
}
