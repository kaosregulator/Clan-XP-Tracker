import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SERVICE_CATALOG,
  buildOrderTags,
  calculateServiceQuote,
  formatQuoteAmount,
  parseServiceCatalogJson,
  speedAddonLabel,
} from "./serviceCatalog.js";

describe("serviceCatalog", () => {
  it("defaults to Military Tycoon vehicle pricing", () => {
    const c = DEFAULT_SERVICE_CATALOG;
    assert.match(c.brandName, /Military Tycoon/i);
    assert.equal(c.currencyLabel, "Gems");
    assert.equal(c.maxLevel, 100);
    assert.ok(c.services.some((s) => s.key === "vehicle_leveling"));
    assert.equal(c.levelTiers[0]?.price, 45_000);
    assert.equal(c.levelTiers.at(-1)?.price, 15_000);
  });

  it("merges partial clan JSON over defaults", () => {
    const c = parseServiceCatalogJson(
      JSON.stringify({
        brandName: "Character Leveling Co",
        itemNoun: "character",
        itemNounPlural: "characters",
        maxLevel: 50,
      })
    );
    assert.equal(c.brandName, "Character Leveling Co");
    assert.equal(c.itemNoun, "character");
    assert.equal(c.maxLevel, 50);
    assert.ok(c.services.length >= 1);
    assert.equal(c.currencyLabel, "Gems");
  });

  it("falls back safely on invalid JSON", () => {
    const c = parseServiceCatalogJson("{not json");
    assert.equal(c.brandName, DEFAULT_SERVICE_CATALOG.brandName);
  });

  it("quotes base + rushed + custom target", () => {
    const catalog = DEFAULT_SERVICE_CATALOG;
    const q = calculateServiceQuote({
      catalog,
      serviceKey: "vehicle_leveling",
      currentLevel: 1,
      targetMaxed: false,
      targetLevel: 50,
      speedKey: "rushed",
    });
    assert.ok(q);
    assert.equal(q!.basePrice, 45_000);
    assert.equal(q!.total, 45_000 + 10_000 + 5_000);
    assert.match(formatQuoteAmount(catalog, q!.total), /60,000/);
  });

  it("quotes priority_now without custom when maxed", () => {
    const q = calculateServiceQuote({
      catalog: DEFAULT_SERVICE_CATALOG,
      serviceKey: "vehicle_leveling",
      currentLevel: 91,
      targetMaxed: true,
      targetLevel: null,
      speedKey: "priority_now",
    });
    assert.ok(q);
    assert.equal(q!.basePrice, 15_000);
    assert.equal(q!.total, 15_000 + 20_000);
  });

  it("skips quote for non-pricing services", () => {
    const q = calculateServiceQuote({
      catalog: DEFAULT_SERVICE_CATALOG,
      serviceKey: "vehicle_trading",
      currentLevel: 10,
      targetMaxed: true,
      targetLevel: null,
      speedKey: "regular",
    });
    assert.equal(q, null);
  });

  it("builds staff-visible order tags", () => {
    const catalog = DEFAULT_SERVICE_CATALOG;
    const quote = calculateServiceQuote({
      catalog,
      serviceKey: "vehicle_leveling",
      currentLevel: 12,
      targetMaxed: true,
      targetLevel: null,
      speedKey: "rushed",
    });
    const tags = buildOrderTags({
      catalog,
      serviceKey: "vehicle_leveling",
      serviceLabel: "Vehicle Leveling",
      speedKey: "rushed",
      targetMaxed: true,
      targetLevel: null,
      quote,
    });
    assert.ok(tags.some((t) => /Vehicle Leveling/.test(t)));
    assert.ok(tags.some((t) => /Rushed/.test(t)));
    assert.ok(tags.some((t) => /Max 100/.test(t)));
    assert.match(speedAddonLabel(catalog, "priority_now"), /Need This Now/i);
  });
});
