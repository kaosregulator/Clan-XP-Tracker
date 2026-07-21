import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { GlobalFonts } from "@napi-rs/canvas";
import { logger } from "../../lib/logger";

/**
 * Font families used across every canvas. We bundle OFL fonts and register
 * them explicitly so rendering is identical on any host (a bare container has
 * no guaranteed system fonts, which would otherwise blank out our text).
 */
export const FONT = {
  display: "Outfit", // headings / labels
  body: "Outfit", // body copy (same family, different weight)
  mono: "JetBrains Mono", // stat numerals
} as const;

let registered = false;

function register(file: string, family: string) {
  const path = fileURLToPath(new URL(`./assets/fonts/${file}`, import.meta.url));
  if (!existsSync(path)) {
    logger.warn({ path }, "Canvas font missing — falling back to system font");
    return;
  }
  GlobalFonts.registerFromPath(path, family);
}

/** Idempotently register the bundled fonts. Safe to call before every render. */
export function ensureFonts() {
  if (registered) return;
  registered = true;
  register("Outfit-Regular.ttf", "Outfit");
  register("Outfit-Bold.ttf", "Outfit Bold");
  register("JetBrainsMono-Bold.ttf", "JetBrains Mono");
}

/** Convenience for `ctx.font`. Weight "bold" swaps to the bold face. */
export function font(
  size: number,
  weight: "regular" | "bold" = "regular",
  family: keyof typeof FONT = "display"
) {
  if (family === "mono") return `${size}px "JetBrains Mono"`;
  const face = weight === "bold" ? "Outfit Bold" : "Outfit";
  return `${size}px "${face}"`;
}
