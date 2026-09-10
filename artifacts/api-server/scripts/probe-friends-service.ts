/**
 * Live service-layer probe: Friends names + headshots must actually load.
 * Run: pnpm exec tsx scripts/probe-friends-service.ts
 */
import { getFriendsPage, getFollowersPage, getFollowingPage } from "../src/bot/services/roblox/friends";
import { getHeadshots } from "../src/bot/services/roblox/thumbnails";
import { getPresence } from "../src/bot/services/roblox/presence";
import { getUserGroupsPage } from "../src/bot/services/roblox/groups";
import { getUserBadgesPage } from "../src/bot/services/roblox/badges";
import { RobloxServiceError } from "../src/bot/services/roblox/errors";

const UID = 2837719; // asimo3089 — public profile with friends

function ok(label: string, detail: string) {
  console.log(`PASS  ${label}: ${detail}`);
}
function fail(label: string, detail: string) {
  console.error(`FAIL  ${label}: ${detail}`);
  process.exitCode = 1;
}

async function main() {
  // --- Friends page 0 ---
  const page0 = await getFriendsPage(UID, 0, 8);
  if (page0.items.length === 0) fail("friends.page0", "no items");
  else ok("friends.page0", `${page0.items.length} items, total=${page0.total}, hasMore=${page0.hasMore}`);

  const named = page0.items.filter((f) => f.name && !/^User \d+$/.test(f.name));
  if (named.length < Math.min(6, page0.items.length)) {
    fail(
      "friends.names",
      `only ${named.length}/${page0.items.length} real names: ${page0.items.map((f) => f.name).join(", ")}`
    );
  } else {
    ok("friends.names", named.map((f) => f.name).slice(0, 5).join(", "));
  }

  const withHead = page0.items.filter((f) => f.headshotUrl && f.headshotUrl.startsWith("http"));
  if (withHead.length < Math.min(6, page0.items.length)) {
    fail(
      "friends.headshots",
      `only ${withHead.length}/${page0.items.length} headshots`
    );
  } else {
    ok("friends.headshots", `${withHead.length}/${page0.items.length} urls`);
  }

  // Verify CDN actually serves an image
  if (withHead[0]?.headshotUrl) {
    const res = await fetch(withHead[0].headshotUrl);
    if (!res.ok) fail("friends.cdn", `HTTP ${res.status}`);
    else ok("friends.cdn", `HTTP ${res.status} ${res.headers.get("content-type")}`);
  }

  // --- Pagination ---
  if (page0.hasMore) {
    const page1 = await getFriendsPage(UID, 1, 8);
    const overlap = page1.items.some((a) => page0.items.some((b) => b.id === a.id));
    if (overlap) fail("friends.pagination", "page1 overlaps page0");
    else ok("friends.pagination", `page1=${page1.items.length}, first=${page1.items[0]?.name}`);
  } else {
    ok("friends.pagination", "only one page");
  }

  // --- Per-avatar retry path: force individual fetch ---
  const solo = await getHeadshots([page0.items[0]!.id]);
  if (!solo.get(page0.items[0]!.id)) fail("headshot.solo", "null");
  else ok("headshot.solo", String(solo.get(page0.items[0]!.id)).slice(0, 60));

  // --- Presence ---
  const presence = await getPresence(page0.items.slice(0, 5).map((f) => f.id));
  ok("presence", `${presence.size} presence rows`);

  // --- Groups ---
  const groups = await getUserGroupsPage(UID, 0, 6);
  ok("groups", `${groups.items.length} groups, total=${groups.total}`);

  // --- Followers (expect auth_required) ---
  try {
    await getFollowersPage(UID, 0);
    fail("followers", "expected auth_required but succeeded");
  } catch (err) {
    if (err instanceof RobloxServiceError && err.kind === "auth_required") {
      ok("followers", `auth_required (Roblox privacy): ${err.technical.slice(0, 80)}`);
    } else {
      fail("followers", String(err));
    }
  }

  try {
    await getFollowingPage(UID, 0);
    fail("following", "expected auth_required but succeeded");
  } catch (err) {
    if (err instanceof RobloxServiceError && err.kind === "auth_required") {
      ok("following", `auth_required (Roblox privacy)`);
    } else {
      fail("following", String(err));
    }
  }

  // --- User badges list (expect auth_required) ---
  try {
    await getUserBadgesPage(UID, 0);
    fail("badges.user", "expected auth_required but succeeded");
  } catch (err) {
    if (err instanceof RobloxServiceError && err.kind === "auth_required") {
      ok("badges.user", "auth_required (Roblox privacy)");
    } else {
      fail("badges.user", String(err));
    }
  }

  console.log(process.exitCode ? "\nRESULT: FAILED" : "\nRESULT: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
