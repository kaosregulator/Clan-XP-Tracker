/**
 * Multi-step Place Service Order wizard — ephemeral Discord UI.
 * Catalog-driven (MT vehicle defaults; other servers override via JSON).
 *
 * Target choice (Max vs Custom) is the *destination* — where leveling stops.
 * Current level is always asked on the next screen (where you are now).
 * Those are two different questions, never the same field twice.
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
  /** Customer wants a non-max destination level (+ custom addon when priced). */
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
  const customAddon = catalog.addons.find((a) => a.autoWhenCustomTarget);
  const customFee = customAddon?.price ?? 0;
  const noun = catalog.itemNoun;

  const destLine = draft.customTarget
    ? `🎯 **Stop at a level you choose** (+${formatMoney(customFee)} ${catalog.currencyLabel})\n` +
      `_Next screen: current level + the level you want to stop at._`
    : `🏁 **Level all the way to max ${catalog.maxLevel}**\n` +
      `_Next screen: only your current level — target is already max._`;

  const embed = new EmbedBuilder()
    .setColor(0x3f51e0)
    .setTitle(`🎫 ${catalog.brandName}`)
    .setDescription(
      [
        catalog.tagline ? `*${catalog.tagline}*` : null,
        "",
        "Build your order below — each row is one choice.",
        "",
        pricingBlurb(catalog),
        "",
        SERVICE_ORDER_PATIENCE_NOTICE,
      ]
        .filter((l) => l !== null)
        .join("\n")
    )
    .addFields(
      {
        name: "① Service",
        value: `${service.emoji} **${service.label}**\n${service.blurb}`,
        inline: false,
      },
      {
        name: "② Speed / priority",
        value: `${speedAddonLabel(catalog, draft.speedKey)}\n_How fast we work the queue._`,
        inline: true,
      },
      {
        name: "③ Destination (where leveling stops)",
        value: destLine,
        inline: false,
      }
    )
    .setFooter({
      text: usesPricing
        ? `Quote uses ${catalog.currencyEmoji} ${catalog.currencyLabel} · staff confirms final · ${noun} current level asked next`
        : "Staff will price this service in your ticket",
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
            ? `${a.label.replace(/\s+Service$/i, "")} +${formatMoney(a.price)}`
            : a.label.replace(/\s+Service$/i, "") || a.label
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
        .setPlaceholder("① Choose a service…")
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
          .setLabel(
            customFee > 0
              ? `Custom stop +${formatMoney(customFee)}`
              : "Custom stop level"
          )
          .setEmoji("🎯")
          .setStyle(draft.customTarget ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    );
  }

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SVC_WIZ_CONTINUE)
        .setLabel(
          draft.customTarget
            ? "Next: name, levels & photos"
            : "Next: name, current level & photos"
        )
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(SVC_WIZ_CANCEL)
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { embeds: [embed], components: rows.slice(0, 5) };
}

export function formatQuoteSummary(
  catalog: ServiceCatalog,
  total: number
): string {
  return `~${formatQuoteAmount(catalog, total)} (estimate)`;
}
