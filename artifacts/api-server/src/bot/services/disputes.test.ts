/**
 * Unit tests for XP dispute ticket helpers (permissions, naming, evidence JSON).
 * Run with: `pnpm --filter @workspace/api-server test`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import {
  buildDisputeOverwrites,
  disputeChannelName,
  parseEvidence,
  serializeEvidence,
  disputeStaffRoleIds,
} from "./disputeHelpers.js";
import type { Clan } from "@workspace/db";

describe("dispute channel naming", () => {
  it("sanitizes usernames into discord-safe channel names", () => {
    assert.equal(disputeChannelName("Chris"), "dispute-chris");
    assert.equal(disputeChannelName("Cool User!"), "dispute-cool-user");
    assert.equal(disputeChannelName("Alice", 42), "dispute-alice-42");
  });
});

describe("dispute permission overwrites", () => {
  it("denies @everyone and allows member, staff, and bot", () => {
    const overs = buildDisputeOverwrites({
      guildId: "guild1",
      memberId: "member1",
      botId: "bot1",
      staffRoleIds: ["staff1"],
    });
    assert.equal(overs.length, 4);

    const everyone = overs.find((o) => o.id === "guild1") as {
      deny?: bigint[] | readonly bigint[];
      allow?: bigint[] | readonly bigint[];
    };
    assert.ok(Array.isArray(everyone.deny));
    assert.ok(everyone.deny!.includes(PermissionFlagsBits.ViewChannel));

    const member = overs.find((o) => o.id === "member1") as {
      allow?: bigint[] | readonly bigint[];
    };
    assert.ok(Array.isArray(member.allow));
    assert.ok(member.allow!.includes(PermissionFlagsBits.ViewChannel));
    assert.ok(member.allow!.includes(PermissionFlagsBits.SendMessages));
    assert.ok(member.allow!.includes(PermissionFlagsBits.AttachFiles));

    const staff = overs.find((o) => o.id === "staff1") as {
      allow?: bigint[] | readonly bigint[];
    };
    assert.ok(Array.isArray(staff.allow));
    assert.ok(staff.allow!.includes(PermissionFlagsBits.ViewChannel));

    const bot = overs.find((o) => o.id === "bot1") as {
      allow?: bigint[] | readonly bigint[];
    };
    assert.ok(bot.allow!.includes(PermissionFlagsBits.ManageChannels));
  });

  it("never grants @everyone view", () => {
    const overs = buildDisputeOverwrites({
      guildId: "g",
      memberId: "m",
      botId: "b",
      staffRoleIds: [],
    });
    const everyone = overs.find((o) => o.id === "g") as {
      deny?: bigint[] | readonly bigint[];
      allow?: bigint[] | readonly bigint[];
    };
    assert.ok(everyone.deny!.includes(PermissionFlagsBits.ViewChannel));
    assert.equal(everyone.allow, undefined);
  });
});

describe("evidence serialization", () => {
  it("round-trips Discord attachment metadata (no member-pasted URL field)", () => {
    const items = [
      {
        url: "https://cdn.discordapp.com/attachments/1/2/proof.png",
        name: "proof.png",
        contentType: "image/png",
        size: 12_345,
      },
    ];
    const json = serializeEvidence(items);
    assert.ok(json);
    assert.doesNotMatch(json!, /paste|host|imgur/i);
    const back = parseEvidence(json);
    assert.equal(back.length, 1);
    assert.equal(back[0]!.name, "proof.png");
    assert.equal(back[0]!.url, items[0]!.url);
  });

  it("returns empty for missing / invalid JSON", () => {
    assert.deepEqual(parseEvidence(null), []);
    assert.deepEqual(parseEvidence("not-json"), []);
    assert.deepEqual(parseEvidence("[]"), []);
  });
});

describe("dispute staff role resolution", () => {
  it("prefers dedicated disputeStaffRoleId, else officer/admin roles", () => {
    const withDedicated = {
      disputeStaffRoleId: "disp-staff",
      staffRoleIds: ["off1"],
      adminRoleIds: ["adm1"],
    } as Clan;
    assert.deepEqual(disputeStaffRoleIds(withDedicated), ["disp-staff"]);

    const fallback = {
      disputeStaffRoleId: null,
      staffRoleIds: ["off1", "off2"],
      adminRoleIds: ["adm1", "off1"],
    } as Clan;
    assert.deepEqual(disputeStaffRoleIds(fallback).sort(), ["adm1", "off1", "off2"].sort());
  });
});

describe("dispute transcript formatting", () => {
  it("includes member/staff lines, attachments, and dispute metadata", async () => {
    const { formatDisputeTranscript } = await import("./disputeHelpers.js");
    const text = formatDisputeTranscript(
      {
        disputeId: 7,
        guildId: "g1",
        memberTag: "chris",
        memberId: "m1",
        disputeType: "warning",
        warningId: 99,
        reason: "I did complete my XP",
        initialEvidence: [
          {
            url: "https://cdn.discordapp.com/attachments/1/2/proof.png",
            name: "proof.png",
            contentType: "image/png",
            size: 1000,
          },
        ],
        result: "Resolved",
        handledByTag: "mod",
        handledById: "s1",
        note: "Looks good",
        channelId: "c1",
        generatedAtIso: "2026-08-22T12:00:00.000Z",
      },
      [
        {
          timestampIso: "2026-08-22T12:01:00.000Z",
          authorTag: "chris",
          authorId: "m1",
          content: "Here is my screenshot",
          attachments: [
            {
              name: "shot.png",
              url: "https://cdn.discordapp.com/attachments/1/2/shot.png",
              contentType: "image/png",
              size: 2000,
            },
          ],
        },
        {
          timestampIso: "2026-08-22T12:02:00.000Z",
          authorTag: "mod",
          authorId: "s1",
          content: "Thanks, resolving",
          attachments: [],
        },
      ]
    );
    assert.match(text, /Dispute Transcript/i);
    assert.match(text, /Warning ID:\s+99/);
    assert.match(text, /Result:\s+Resolved/);
    assert.match(text, /I did complete my XP/);
    assert.match(text, /proof\.png/);
    assert.match(text, /Here is my screenshot/);
    assert.match(text, /shot\.png/);
    assert.match(text, /Thanks, resolving/);
    assert.match(text, /Staff-only/);
    assert.doesNotMatch(text, /paste a URL|image URL/i);
  });

  it("marks final-close footer when provided", async () => {
    const { formatDisputeTranscript } = await import("./disputeHelpers.js");
    const text = formatDisputeTranscript(
      {
        disputeId: 1,
        guildId: "g",
        memberTag: "a",
        memberId: "1",
        disputeType: "xp_record",
        warningId: null,
        reason: "x",
        initialEvidence: [],
        result: "Closed · Channel deleted",
        handledByTag: "mod",
        handledById: "2",
        channelId: null,
        generatedAtIso: "2026-08-22T00:00:00.000Z",
        footerNote: "FINAL CLOSE — channel deleted",
      },
      []
    );
    assert.match(text, /FINAL CLOSE/);
    assert.match(text, /Channel deleted/);
  });
});

describe("member-facing dispute UX rules", () => {
  it("slash command evidence option is the only image path (documented in command builder)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../commands.ts"), "utf8");
    // The dispute command is built by a shared factory. Inspect that block.
    const disputeBlock = src.slice(
      src.indexOf("function disputeCommand"),
      src.indexOf("export const commands")
    );
    assert.match(disputeBlock, /addAttachmentOption/);
    assert.match(disputeBlock, /setName\("evidence"\)/);
    assert.doesNotMatch(disputeBlock, /setName\("proof"\)|setName\("url"\)|setName\("image_url"\)|setName\("link"\)/);
  });
});
