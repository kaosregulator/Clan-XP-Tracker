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
  canPlaceServiceOrderAccess,
  staffQuickReplyByKey,
  STAFF_QUICK_REPLIES,
  serviceOrderChannelName,
  serviceOrderChannelTopic,
  customerQuickReplyByKey,
  CUSTOMER_QUICK_REPLIES,
  formatServiceOrderDetails,
  parseServiceOrderDetails,
  queuePlaceMessage,
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

  it("enforces blacklist over whitelist for placing orders", () => {
    assert.equal(
      canPlaceServiceOrderAccess({
        userId: "u1",
        memberRoleIds: ["r1"],
        whitelistUserIds: ["u1"],
        whitelistRoleIds: [],
        blacklistUserIds: ["u1"],
        blacklistRoleIds: [],
      }),
      false
    );
    assert.equal(
      canPlaceServiceOrderAccess({
        userId: "u1",
        memberRoleIds: ["r-bad"],
        whitelistUserIds: ["u1"],
        whitelistRoleIds: [],
        blacklistUserIds: [],
        blacklistRoleIds: ["r-bad"],
      }),
      false
    );
  });

  it("requires whitelist when configured", () => {
    assert.equal(
      canPlaceServiceOrderAccess({
        userId: "u1",
        memberRoleIds: [],
        whitelistUserIds: ["u2"],
        whitelistRoleIds: [],
        blacklistUserIds: [],
        blacklistRoleIds: [],
      }),
      false
    );
    assert.equal(
      canPlaceServiceOrderAccess({
        userId: "u1",
        memberRoleIds: ["vip"],
        whitelistUserIds: [],
        whitelistRoleIds: ["vip"],
        blacklistUserIds: [],
        blacklistRoleIds: [],
      }),
      true
    );
  });

  it("allows everyone when whitelist empty (unless blacklisted)", () => {
    assert.equal(
      canPlaceServiceOrderAccess({
        userId: "anyone",
        memberRoleIds: [],
        whitelistUserIds: [],
        whitelistRoleIds: [],
        blacklistUserIds: [],
        blacklistRoleIds: [],
      }),
      true
    );
  });

  it("resolves staff quick replies", () => {
    assert.ok(STAFF_QUICK_REPLIES.length >= 6);
    assert.match(staffQuickReplyByKey("greet") ?? "", /thanks for requesting/i);
    assert.match(staffQuickReplyByKey("brb") ?? "", /be right with you/i);
    assert.ok(staffQuickReplyByKey("greet")!.includes("Thanks for requesting"));
    assert.equal(staffQuickReplyByKey("nope"), null);
  });

  it("names ticket channels as lvl-up-{name}-{n} (not LV-####)", () => {
    assert.equal(
      serviceOrderChannelName({
        username: "Kaosregulator",
        displayName: "Kaosregulator",
        sequence: 1,
      }),
      "lvl-up-kaosregulator-1"
    );
    assert.equal(
      serviceOrderChannelTopic({
        username: "Kaosregulator",
        displayName: "Kaosregulator",
        sequence: 1,
      }),
      "LVL-Up Kaosregulator-#1"
    );
    assert.doesNotMatch(
      serviceOrderChannelName({
        username: "someone",
        sequence: 4,
      }),
      /lv-|order-/i
    );
  });

  it("resolves customer quick replies", () => {
    assert.ok(CUSTOMER_QUICK_REPLIES.length >= 3);
    assert.match(customerQuickReplyByKey("cq0") ?? "", /started/i);
    assert.equal(customerQuickReplyByKey("nope"), null);
  });
  it("formats and parses structured service order details", () => {
    const raw = formatServiceOrderDetails({
      serviceLabel: "Vehicle Leveling",
      vehicleText: "M1 Abrams, F-22",
      currentLevel: 1,
      targetLevel: 50,
      tags: ["Vehicle", "Urgent"],
    });
    assert.match(raw, /Vehicle Leveling/);
    assert.match(raw, /M1 Abrams/);
    assert.match(raw, /1 → 50/);
    const parsed = parseServiceOrderDetails(raw);
    assert.equal(parsed.vehicleCount, 2);
    assert.equal(parsed.currentLevel, 1);
    assert.equal(parsed.targetLevel, 50);
    assert.deepEqual(parsed.tags, ["Vehicle", "Urgent"]);
  });

  it("builds a queue place message", () => {
    assert.match(queuePlaceMessage(1, 2), /#1/);
    assert.match(queuePlaceMessage(3, 1), /#3/);
    assert.match(queuePlaceMessage(3, 1), /1 vehicle/);
  });
});
