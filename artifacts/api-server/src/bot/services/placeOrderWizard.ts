/**
 * Multi-step Place Service Order wizard — ephemeral Discord UI.
 * Catalog-driven (MT vehicle defaults; other servers override via JSON).
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import {
  findCatalogService,
  formatMoney,
  formatQuoteAmount,
  getServiceCatalog,
  speedAddonLabel,
  type ServiceCatalog,
  type SpeedAddonKey,
} from "./serviceCatalog";
import {
  SVC_WIZ_CANCEL,
  SVC_WIZ_CONTINUE,
  SVC_WIZ_SERVICE,
  svcWizCustom,
  svcWizSpeed,
} from "../ui/ids";
import { SERVICE_ORDER_PATIENCE_NOTICE } from "./serviceOrderHelpers";

const DRAFT_TTL_MS = 15 * 60 * 1000;

export interface PlaceOrderDraft {
  guildId: string;
  userId: string;
  serviceKey: string;
  speedKey: SpeedAddonKey;
  /** Customer wants a non-max target level (+ custom addon when priced). */
  customTarget: boolean;
  updatedAt: number;
}

const drafts = new Map<string, PlaceOrderDraft>();

function draftKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function getPlaceDraft(guildId: string, userId: string): PlaceOrderDraft | null {
  pruneDrafts();
  const d = drafts.get(draftKey(guildId, userId));
  if (!d) return null;
  d.updatedAt = Date.now();
  return d;
}

export function ensurePlaceDraft(
  guildId: string,
  userId: string,
  catalog: ServiceCatalog
): PlaceOrderDraft {
  pruneDrafts();
  const key = draftKey(guildId, userId);
  const existing = drafts.get(key);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }
  const first = catalog.services[0]?.key ?? "vehicle_leveling";
  const fresh: PlaceOrderDraft = {
    guildId,
    userId,
    serviceKey: first,
    speedKey: "regular",
    customTarget: false,
    updatedAt: Date.now(),
  };
  drafts.set(key, fresh);
  return fresh;
}

export function savePlaceDraft(draft: PlaceOrderDraft): void {
  draft.updatedAt = Date.now();
  drafts.set(draftKey(draft.guildId, draft.userId), draft);
}

export function clearPlaceDraft(guildId: string, userId: string): void {
  drafts.delete(draftKey(guildId, userId));
}

function pruneDrafts(): void {
  const cutoff = Date.now() - DRAFT_TTL_MS;
  for (const [k, v] of drafts) {
    if (v.updatedAt < cutoff) drafts.delete(k);
  }
}

function pricingBlurb(catalog: ServiceCatalog): string {
  if (!catalog.levelTiers.length) return "";
  const cheapest = Math.min(...catalog.levelTiers.map((t) => t.price));
  const priciest = Math.max(...catalog.levelTiers.map((t) => t.price));
  return (
    `📦 Base to max **${catalog.maxLevel}**: ` +
    `${catalog.currencyEmoji} ${formatMoney(cheapest)}–${formatMoney(priciest)} ${catalog.currencyLabel}`
  );
}

function addonBlurb(catalog: ServiceCatalog): string {
  const speed = catalog.addons.filter((a) => a.group === "speed");
  const custom = catalog.addons.find((a) => a.autoWhenCustomTarget);
  const parts = speed.map(
    (a) =>
      `${a.emoji} **${a.label}**` +
      (a.price > 0 ? ` (+${formatMoney(a.price)})` : " (+0)")
  );
  if (custom) {
    parts.push(
      `${custom.emoji} **${custom.label}** (+${formatMoney(custom.price)})`
    );
  }
  return parts.join("\n");
}

export function buildWizardPayload(
  clan: Clan,
  draft: PlaceOrderDraft
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const catalog = getServiceCatalog(clan);
  const service =
    findCatalogService(catalog, draft.serviceKey) ?? catalog.services[0]!;
  const usesPricing = service.usesPricing !== false;
  const usesLevels = service.usesLevels !== false;

  const embed = new EmbedBuilder()
    .setColor(0x3f51e0)
    .setTitle(`🎫 ${catalog.brandName}`)
    .setDescription(
      [
        catalog.tagline ? `*${catalog.tagline}*` : null,
        "",
        "Pick your **service**, **priority**, then continue to details + photos.",
        "",
        pricingBlurb(catalog),
        "",
        "**⚡ Priority add-ons** (stack with custom target)",
        addonBlurb(catalog),
        "",
        SERVICE_ORDER_PATIENCE_NOTICE,
        ...(catalog.notes?.length
          ? ["", ...catalog.notes.map((n) => `• ${n}`)]
          : []),
      ]
        .filter((l) => l !== null)
        .join("\n")
    )
    .addFields(
      {
        name: "🛠️ Selected service",
        value: `${service.emoji} **${service.label}**\n${service.blurb}`,
        inline: false,
      },
      {
        name: "⚡ Priority",
        value: speedAddonLabel(catalog, draft.speedKey),
        inline: true,
      },
      {
        name: "🎯 Target",
        value: draft.customTarget
          ? `Custom level (+${formatMoney(
              catalog.addons.find((a) => a.autoWhenCustomTarget)?.price ?? 0
            )} ${catalog.currencyLabel})`
          : `🏁 Max ${catalog.maxLevel}`,
        inline: true,
      }
    )
    .setFooter({
      text: usesPricing
        ? `Quote uses ${catalog.currencyEmoji} ${catalog.currencyLabel} · staff confirms final price`
        : "This service has no auto-quote — staff will price in ticket",
    });

  const serviceOptions = catalog.services.slice(0, 25).map((s) => ({
    label: s.label.slice(0, 100),
    description: s.blurb.slice(0, 100),
    value: s.key.slice(0, 100),
    emoji: s.emoji,
    default: s.key === draft.serviceKey,
  }));

  const speedAddons = catalog.addons.filter((a) => a.group === "speed").slice(0, 3);
  const speedRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...speedAddons.map((a) =>
      new ButtonBuilder()
        .setCustomId(svcWizSpeed(a.key))
        .setLabel(
          (a.price > 0
            ? `${a.label} +${formatMoney(a.price)}`
            : a.label
          ).slice(0, 80)
        )
        .setEmoji(a.emoji)
        .setStyle(
          draft.speedKey === a.key ? ButtonStyle.Primary : ButtonStyle.Secondary
        )
    )
  );

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(SVC_WIZ_SERVICE)
        .setPlaceholder("📋 Choose a service…")
        .addOptions(serviceOptions)
    ),
    speedRow,
  ];

  if (usesLevels) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(svcWizCustom(0))
          .setLabel(`Max ${catalog.maxLevel}`)
          .setEmoji("🏁")
          .setStyle(!draft.customTarget ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(svcWizCustom(1))
          .setLabel("Custom target")
          .setEmoji("🎯")
          .setStyle(draft.customTarget ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    );
  }

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SVC_WIZ_CONTINUE)
        .setLabel("Continue to details")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(SVC_WIZ_CANCEL)
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  // Discord max 5 action rows
  return { embeds: [embed], components: rows.slice(0, 5) };
}

export function formatQuoteSummary(
  catalog: ServiceCatalog,
  total: number
): string {
  return `~${formatQuoteAmount(catalog, total)} (estimate)`;
}
