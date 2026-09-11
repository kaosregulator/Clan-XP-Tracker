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
    assert.equal(STAFF_QUICK_REPLIES.length, 10);
    assert.match(staffQuickReplyByKey("qr0") ?? "", /patient/i);
    assert.equal(staffQuickReplyByKey("nope"), null);
  });
});
