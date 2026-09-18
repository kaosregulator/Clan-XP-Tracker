/**
 * Configurable leveling / service-order catalog.
 * Defaults mirror the Military Tycoon vehicle price guide, but every field is
 * data-driven so another server can swap in character leveling (or anything)
 * via `clans.serviceCatalogJson` later without code changes.
 */
import type { Clan } from "@workspace/db";

export interface ServiceCatalogService {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  /** When false, skip level/quote UI (e.g. trading / other). Default true. */
  usesLevels?: boolean;
  /** When false, skip pricing quote. Default true for leveling-like services. */
  usesPricing?: boolean;
}

export interface ServiceLevelTier {
  /** Inclusive current-level min. */
  min: number;
  /** Inclusive current-level max. */
  max: number;
  /** Base price (in catalog currency units) to take this tier to maxLevel. */
  price: number;
  label?: string;
  note?: string;
}

export interface ServiceAddon {
  key: string;
  label: string;
  emoji: string;
  price: number;
  description: string;
  /**
   * Mutual-exclusion group. Only one addon per group can be selected.
   * e.g. speed: regular | rushed | priority_now
   */
  group?: string;
  /** If true, selected when target != maxLevel. */
  autoWhenCustomTarget?: boolean;
}

export interface ServiceCatalog {
  /** Brand line shown on panel / quotes. */
  brandName: string;
  tagline?: string;
  currencyLabel: string;
  currencyEmoji: string;
  /** Default max level for "maxed" targets (e.g. 100). */
  maxLevel: number;
  /** What customers are leveling — "vehicle", "character", "item", … */
  itemNoun: string;
  itemNounPlural: string;
  services: ServiceCatalogService[];
  levelTiers: ServiceLevelTier[];
  addons: ServiceAddon[];
  /** Short staff-facing notes. */
  notes?: string[];
}

/** Built-in default — Military Tycoon vehicle service price guide. */
export const DEFAULT_SERVICE_CATALOG: ServiceCatalog = {
  brandName: "Military Tycoon Vehicle Service",
  tagline: "Your vehicle. Our grind. Your way.",
  currencyLabel: "Gems",
  currencyEmoji: "💎",
  maxLevel: 100,
  itemNoun: "vehicle",
  itemNounPlural: "vehicles",
  services: [
    {
      key: "vehicle_leveling",
      label: "Vehicle Leveling",
      emoji: "🛠️",
      blurb: "Level a vehicle toward max (or a custom target)",
      usesLevels: true,
      usesPricing: true,
    },
    {
      key: "vehicle_trading",
      label: "Vehicle Trading",
      emoji: "🚗",
      blurb: "Help trading or swapping vehicles",
      usesLevels: false,
      usesPricing: false,
    },
    {
      key: "other",
      label: "Other Service",
      emoji: "📋",
      blurb: "Something else — describe it in the form",
      usesLevels: true,
      usesPricing: false,
    },
  ],
  levelTiers: [
    { min: 1, max: 1, price: 45_000, label: "Fresh / New", note: "Takes the longest" },
    { min: 2, max: 10, price: 42_500, note: "Slightly less time" },
    { min: 11, max: 20, price: 40_000 },
    { min: 21, max: 30, price: 37_500 },
    { min: 31, max: 40, price: 35_000 },
    { min: 41, max: 50, price: 32_500 },
    { min: 51, max: 60, price: 30_000 },
    { min: 61, max: 70, price: 27_500 },
    { min: 71, max: 80, price: 25_000 },
    { min: 81, max: 90, price: 20_000 },
    { min: 91, max: 99, price: 15_000, note: "Final stretch" },
  ],
  addons: [
    {
      key: "regular",
      label: "Regular Service",
      emoji: "🐢",
      price: 0,
      description: "Standard queue time",
      group: "speed",
    },
    {
      key: "rushed",
      label: "Rushed Service",
      emoji: "⚡",
      price: 10_000,
      description: "Faster — moves higher in queue",
      group: "speed",
    },
    {
      key: "priority_now",
      label: "I Need This Now",
      emoji: "🔥",
      price: 20_000,
      description: "Highest priority — top of queue",
      group: "speed",
    },
    {
      key: "custom_target",
      label: "Custom Target (not max)",
      emoji: "🎯",
      price: 5_000,
      description: "Level to a specific level instead of max",
      autoWhenCustomTarget: true,
    },
  ],
  notes: [
    "Final price is confirmed in your ticket.",
    "Down payment required to reserve your spot.",
    "No payment = no vehicle.",
  ],
};

export type SpeedAddonKey = "regular" | "rushed" | "priority_now";

export interface QuoteLine {
  key: string;
  label: string;
  emoji: string;
  amount: number;
}

export interface ServiceQuote {
  currencyLabel: string;
  currencyEmoji: string;
  basePrice: number;
  baseLabel: string;
  lines: QuoteLine[];
  total: number;
  /** Soft estimate — staff still confirms in ticket. */
  estimate: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Merge clan JSON over defaults; invalid/partial JSON falls back safely. */
export function parseServiceCatalogJson(raw: string | null | undefined): ServiceCatalog {
  if (!raw?.trim()) return structuredClone(DEFAULT_SERVICE_CATALOG);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return structuredClone(DEFAULT_SERVICE_CATALOG);
    const base = structuredClone(DEFAULT_SERVICE_CATALOG);
    const out: ServiceCatalog = {
      ...base,
      brandName:
        typeof parsed.brandName === "string" && parsed.brandName.trim()
          ? parsed.brandName.trim()
          : base.brandName,
      tagline: typeof parsed.tagline === "string" ? parsed.tagline : base.tagline,
      currencyLabel:
        typeof parsed.currencyLabel === "string" && parsed.currencyLabel.trim()
          ? parsed.currencyLabel.trim()
          : base.currencyLabel,
      currencyEmoji:
        typeof parsed.currencyEmoji === "string" && parsed.currencyEmoji.trim()
          ? parsed.currencyEmoji.trim()
          : base.currencyEmoji,
      maxLevel:
        typeof parsed.maxLevel === "number" && parsed.maxLevel > 0
          ? Math.floor(parsed.maxLevel)
          : base.maxLevel,
      itemNoun:
        typeof parsed.itemNoun === "string" && parsed.itemNoun.trim()
          ? parsed.itemNoun.trim()
          : base.itemNoun,
      itemNounPlural:
        typeof parsed.itemNounPlural === "string" && parsed.itemNounPlural.trim()
          ? parsed.itemNounPlural.trim()
          : base.itemNounPlural,
      services: Array.isArray(parsed.services) && parsed.services.length
        ? (parsed.services as ServiceCatalogService[]).filter(
            (s) => s && typeof s.key === "string" && typeof s.label === "string"
          )
        : base.services,
      levelTiers: Array.isArray(parsed.levelTiers) && parsed.levelTiers.length
        ? (parsed.levelTiers as ServiceLevelTier[])
        : base.levelTiers,
      addons: Array.isArray(parsed.addons) && parsed.addons.length
        ? (parsed.addons as ServiceAddon[])
        : base.addons,
      notes: Array.isArray(parsed.notes) ? (parsed.notes as string[]) : base.notes,
    };
    if (!out.services.length) out.services = base.services;
    return out;
  } catch {
    return structuredClone(DEFAULT_SERVICE_CATALOG);
  }
}

export function getServiceCatalog(clan: Pick<Clan, "serviceCatalogJson"> | null | undefined): ServiceCatalog {
  return parseServiceCatalogJson(clan?.serviceCatalogJson ?? null);
}

export function findCatalogService(
  catalog: ServiceCatalog,
  key: string
): ServiceCatalogService | null {
  return catalog.services.find((s) => s.key === key) ?? null;
}

export function tierForCurrentLevel(
  catalog: ServiceCatalog,
  currentLevel: number
): ServiceLevelTier | null {
  return (
    catalog.levelTiers.find((t) => currentLevel >= t.min && currentLevel <= t.max) ?? null
  );
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US");
}

export function formatQuoteAmount(catalog: ServiceCatalog, amount: number): string {
  return `${catalog.currencyEmoji} ${formatMoney(amount)} ${catalog.currencyLabel}`;
}

/**
 * Estimate quote from current level + speed addon + optional custom target.
 * Staff still confirms final price in the ticket.
 */
export function calculateServiceQuote(opts: {
  catalog: ServiceCatalog;
  serviceKey: string;
  currentLevel: number;
  targetMaxed: boolean;
  targetLevel: number | null;
  speedKey: SpeedAddonKey;
}): ServiceQuote | null {
  const { catalog, serviceKey, currentLevel, targetMaxed, targetLevel, speedKey } = opts;
  const service = findCatalogService(catalog, serviceKey);
  if (!service || service.usesPricing === false) return null;

  const tier = tierForCurrentLevel(catalog, currentLevel);
  if (!tier) return null;

  const lines: QuoteLine[] = [];
  const baseLabel =
    tier.label
      ? `Base · ${tier.label} (Lv ${tier.min === tier.max ? tier.min : `${tier.min}–${tier.max}`})`
      : `Base · Current Lv ${currentLevel} → max ${catalog.maxLevel}`;
  lines.push({
    key: "base",
    label: baseLabel,
    emoji: "📦",
    amount: tier.price,
  });

  const speed = catalog.addons.find((a) => a.key === speedKey && a.group === "speed");
  if (speed && speed.price !== 0) {
    lines.push({
      key: speed.key,
      label: speed.label,
      emoji: speed.emoji,
      amount: speed.price,
    });
  } else if (speed) {
    lines.push({
      key: speed.key,
      label: speed.label,
      emoji: speed.emoji,
      amount: 0,
    });
  }

  const custom =
    !targetMaxed &&
    targetLevel != null &&
    targetLevel < catalog.maxLevel
      ? catalog.addons.find((a) => a.autoWhenCustomTarget)
      : null;
  if (custom) {
    lines.push({
      key: custom.key,
      label: `${custom.label} → Lv ${targetLevel}`,
      emoji: custom.emoji,
      amount: custom.price,
    });
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    currencyLabel: catalog.currencyLabel,
    currencyEmoji: catalog.currencyEmoji,
    basePrice: tier.price,
    baseLabel,
    lines,
    total,
    estimate: true,
  };
}

export function speedAddonLabel(catalog: ServiceCatalog, key: SpeedAddonKey): string {
  const a = catalog.addons.find((x) => x.key === key);
  return a ? `${a.emoji} ${a.label}` : key;
}

export function buildOrderTags(opts: {
  catalog: ServiceCatalog;
  serviceKey: string;
  serviceLabel: string;
  speedKey: SpeedAddonKey;
  targetMaxed: boolean;
  targetLevel: number | null;
  quote: ServiceQuote | null;
}): string[] {
  const service = findCatalogService(opts.catalog, opts.serviceKey);
  const tags: string[] = [];
  tags.push(`${service?.emoji ?? "🛠️"} ${opts.serviceLabel}`);
  tags.push(speedAddonLabel(opts.catalog, opts.speedKey));
  if (!opts.targetMaxed && opts.targetLevel != null) {
    tags.push(`🎯 Target ${opts.targetLevel}`);
  } else if (opts.targetMaxed) {
    tags.push(`🏁 Max ${opts.catalog.maxLevel}`);
  }
  if (opts.quote) {
    tags.push(`${opts.quote.currencyEmoji} ~${formatMoney(opts.quote.total)}`);
  }
  return tags.slice(0, 8);
}

/** Structured meta persisted on the order for canvas / tracker. */
export interface ServiceOrderMeta {
  catalogBrand?: string;
  itemNoun?: string;
  itemName?: string;
  currentLevel?: number | null;
  targetLevel?: number | null;
  targetMaxed?: boolean;
  speedKey?: SpeedAddonKey;
  speedLabel?: string;
  tags?: string[];
  quoteTotal?: number | null;
  quoteCurrency?: string | null;
  quoteCurrencyEmoji?: string | null;
  quoteLines?: QuoteLine[];
  estimate?: boolean;
}

export function serializeOrderMeta(meta: ServiceOrderMeta): string {
  return JSON.stringify(meta);
}

export function parseOrderMeta(raw: string | null | undefined): ServiceOrderMeta | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return null;
    return parsed as ServiceOrderMeta;
  } catch {
    return null;
  }
}
