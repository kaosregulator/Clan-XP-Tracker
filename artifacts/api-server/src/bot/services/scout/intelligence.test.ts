import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessScoutGame, assembleIntelDashboard, buildIntelBoards } from "./intelligence";
import type { ScoutGameRow, ScoutHistoryResult, ScoutSnapshotPoint } from "./types";

function point(takenAt: string, playing: number, prev?: number): ScoutSnapshotPoint {
  const playingDelta = prev == null ? null : playing - prev;
  const playingDeltaPct =
    prev == null ? null : prev === 0 ? (playing > 0 ? Infinity : 0) : (playing - prev) / prev;
  return {
    takenAt,
    playing,
    visits: playing * 100,
    favoritedCount: 10,
    playingDelta,
    playingDeltaPct,
  };
}

function live(partial: Partial<ScoutGameRow> = {}): ScoutGameRow {
  return {
    universeId: 1,
    placeId: 2,
    name: "Test Tycoon",
    playing: 5000,
    visits: 1_000_000,
    favorites: 20_000,
    creator: "Dev",
    creatorType: "User",
    genre: "Tycoon",
    iconUrl: null,
    deltaPct: null,
    updatedAt: null,
    ...partial,
  };
}

describe("Scout Intelligence", () => {
  it("marks unknown when history is too thin", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    const history: ScoutHistoryResult = {
      universeId: 1,
      name: "Test Tycoon",
      points: [point("2026-09-10T11:00:00Z", 1000)],
      latest: point("2026-09-10T11:00:00Z", 1000),
      previous: null,
    };
    const a = assessScoutGame(live({ playing: 1000 }), history, now);
    assert.equal(a.band, "unknown");
    assert.ok(a.summary.toLowerCase().includes("snapshot"));
  });

  it("flags rising momentum from 6h growth + above 7d average", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    const points = [
      point("2026-09-10T12:00:00Z", 8000, 5000),
      point("2026-09-10T09:00:00Z", 5000, 4200),
      point("2026-09-10T06:00:00Z", 4200, 4000),
      point("2026-09-09T12:00:00Z", 4000, 3900),
      point("2026-09-08T12:00:00Z", 3900, 3800),
      point("2026-09-07T12:00:00Z", 3800, 3700),
      point("2026-09-04T12:00:00Z", 3700),
    ];
    const history: ScoutHistoryResult = {
      universeId: 1,
      name: "Test Tycoon",
      points,
      latest: points[0]!,
      previous: points[1]!,
    };
    const a = assessScoutGame(live({ playing: 8000 }), history, now);
    assert.ok(a.score >= 58, `score ${a.score}`);
    assert.ok(["hot", "rising"].includes(a.band), a.band);
    assert.ok(a.signals.some((s) => s.id.includes("accel") || s.id.includes("above")));
  });

  it("builds riser / unusual boards from assessments", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    const mk = (id: number, name: string, playing: number, older: number) => {
      const points = [
        point("2026-09-10T12:00:00Z", playing, older),
        point("2026-09-10T06:00:00Z", older, older - 100),
        point("2026-09-03T12:00:00Z", older - 100),
      ];
      const history: ScoutHistoryResult = {
        universeId: id,
        name,
        points,
        latest: points[0]!,
        previous: points[1]!,
      };
      return assessScoutGame(live({ universeId: id, name, playing }), history, now);
    };
    const assessments = [
      mk(1, "Riser", 3000, 1000),
      mk(2, "Flat", 2000, 1950),
      mk(3, "Drop", 800, 2000),
    ];
    const boards = buildIntelBoards(assessments, 5);
    assert.ok(boards.risers.some((r) => r.name === "Riser"));
    assert.ok(boards.drops.some((r) => r.name === "Drop"));
    const dash = assembleIntelDashboard(assessments, { intervalSec: 900 });
    assert.equal(dash.trackedGames, 3);
    assert.equal(dash.needHistory, false);
  });
});
