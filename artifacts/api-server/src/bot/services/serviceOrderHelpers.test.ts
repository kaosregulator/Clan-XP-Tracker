import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPublicId,
  ordersAhead,
  denseQueuePositions,
  resolveServiceKey,
  isTerminalStatus,
  isQueueStatus,
  queueHeadline,
} from "./serviceOrderHelpers.js";

describe("serviceOrderHelpers", () => {
  it("formats public ids as LV-0001", () => {
    assert.equal(formatPublicId(1), "LV-0001");
    assert.equal(formatPublicId(42), "LV-0042");
  });

  it("computes orders ahead from queue position", () => {
    assert.equal(ordersAhead(1), 0);
    assert.equal(ordersAhead(4), 3);
    assert.equal(ordersAhead(null), 0);
  });

  it("assigns dense queue positions", () => {
    const map = denseQueuePositions([{ id: 10 }, { id: 20 }, { id: 30 }]);
    assert.equal(map.get(10), 1);
    assert.equal(map.get(20), 2);
    assert.equal(map.get(30), 3);
  });

  it("resolves service keys from free text", () => {
    assert.equal(resolveServiceKey("Vehicle Leveling"), "vehicle_leveling");
    assert.equal(resolveServiceKey("trading help"), "vehicle_trading");
    assert.equal(resolveServiceKey("something else"), "other");
  });

  it("classifies terminal vs queue statuses", () => {
    assert.equal(isTerminalStatus("completed"), true);
    assert.equal(isTerminalStatus("queued"), false);
    assert.equal(isQueueStatus("queued"), true);
    assert.equal(isQueueStatus("cancelled"), false);
  });

  it("builds a queue headline", () => {
    const line = queueHeadline({
      publicId: "LV-0007",
      status: "queued",
      queuePosition: 3,
    });
    assert.match(line, /#3/);
    assert.match(line, /2 order/);
  });
});
