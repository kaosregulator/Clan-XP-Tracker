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
  // Broad-coverage fallback (Latin/Cyrillic/Greek/symbols). @napi-rs/canvas
  // falls back to other registered fonts for glyphs Outfit lacks, so member
  // names in other scripts still render instead of showing tofu boxes.
  register("DejaVuSans.ttf", "DejaVu Sans");
}

/**
 * Make arbitrary user text safe to render: normalize "fancy" Unicode (e.g.
 * 𝕽𝖆𝖎𝖉𝖊𝖓 → Raiden, ᴰᵃʳᵏ → Dark) to plain letters via NFKC, and drop control
 * and zero-width characters. Glyphs still missing after this fall back to
 * DejaVu; anything truly unrenderable is dropped rather than shown as tofu.
 */
export function sanitizeText(value: string): string {
  return value
    .normalize("NFKC")
    // strip control chars, zero-width & bidi marks, and BOM
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .trim();
}

/** Convenience for `ctx.font`. Weight "bold" swaps to the bold face. */
export function font(
  size: number,
  weight: "regular" | "bold" = "regular",
  family: keyof typeof FONT = "display"
) {
  // Always append the broad-coverage fallback so glyphs missing from the
  // primary face (Cyrillic, Greek, accents, symbols) render via DejaVu instead
  // of tofu boxes. @napi-rs/canvas honours the comma-separated font stack.
  if (family === "mono") return `${size}px "JetBrains Mono", "DejaVu Sans"`;
  const face = weight === "bold" ? "Outfit Bold" : "Outfit";
  return `${size}px "${face}", "DejaVu Sans"`;
}
