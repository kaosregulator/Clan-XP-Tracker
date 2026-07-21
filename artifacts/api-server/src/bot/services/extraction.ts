import { db, xpSubmissionsTable } from "@workspace/db";
import type { Clan, XpSubmission } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * Screenshot data-extraction seam. This is intentionally a no-op by default:
 * it lets us wire OCR / Roblox verification in later without touching the
 * submission flow. Register a real extractor with `setExtractor()` and every
 * new submission's screenshot will be run through it, with the result stored
 * on `submission.extracted` and surfaced on the review card.
 */
export interface ExtractionInput {
  clan: Clan;
  submission: XpSubmission;
  imageUrls: string[];
  activityName: string;
}

export interface ExtractionResult {
  provider: string;
  /** Provider-defined fields, e.g. { xp: 20132, username: "player123" }. */
  fields: Record<string, unknown>;
  /** 0..1 confidence, if the provider reports one. */
  confidence?: number;
}

export interface ScreenshotExtractor {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult | null>;
}

const noopExtractor: ScreenshotExtractor = {
  name: "noop",
  async extract() {
    return null;
  },
};

let current: ScreenshotExtractor = noopExtractor;

/** Swap in a real extractor (e.g. an OCR or Roblox-API implementation). */
export function setExtractor(extractor: ScreenshotExtractor): void {
  current = extractor;
  logger.info({ extractor: extractor.name }, "Screenshot extractor registered");
}

export function getExtractor(): ScreenshotExtractor {
  return current;
}

export function extractionEnabled(): boolean {
  return current.name !== "noop";
}

/**
 * Run the active extractor for a submission and persist the result. Best-effort
 * and safe to call unconditionally — returns null (and does nothing) with the
 * default no-op extractor, so there is zero cost until OCR is turned on.
 */
export async function runExtraction(input: ExtractionInput): Promise<ExtractionResult | null> {
  if (!extractionEnabled()) return null;
  try {
    const result = await current.extract(input);
    if (result) {
      await db
        .update(xpSubmissionsTable)
        .set({ extracted: { provider: result.provider, confidence: result.confidence, ...result.fields } })
        .where(eq(xpSubmissionsTable.id, input.submission.id));
    }
    return result;
  } catch (err) {
    logger.warn({ err, extractor: current.name }, "Screenshot extraction failed");
    return null;
  }
}
