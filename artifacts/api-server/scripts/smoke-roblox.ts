import { RobloxService } from "../src/bot/services/roblox/index.ts";

async function main() {
  const user = await RobloxService.resolveUsername("Roblox");
  console.log("user", user.id, user.name, user.displayName);

  const card = await RobloxService.getPlayerCardData(user.id);
  console.log(
    "presence",
    card.presence?.userPresenceType,
    "friends",
    card.friendCount,
    "groups",
    card.groupCount
  );

  const search = await RobloxService.searchUsers("kao", 5);
  console.log(
    "search",
    search.map((s) => s.name).join(", ")
  );

  const game = await RobloxService.military.getMilitaryGame();
  console.log(
    "MT",
    game.name,
    "playing",
    game.playing,
    "universe",
    game.universeId,
    "place",
    game.rootPlaceId
  );

  const group = await RobloxService.getGroupDetails(11257245);
  console.log("group", group.name, "members", group.memberCount);

  const servers = await RobloxService.getPublicServers(7180042682, 0);
  console.log("servers", servers.items.length, servers.hasMore);

  const thumbs = await RobloxService.getUserThumbnails(user.id);
  console.log("thumbs", Boolean(thumbs.headshot), Boolean(thumbs.fullBody));

  console.log("openCloud?", RobloxService.hasOpenCloudKey());
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
