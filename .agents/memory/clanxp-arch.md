---
name: ClanXP architecture
description: Key non-obvious constraints for the discord bot, API server, and React frontend in this project
---

- `zod/v4` cannot be resolved by esbuild bundler — always import from `zod` (plain) in api-server routes
- Bot (discord.js v14) runs in the same process as the API server; `startBot()` is called from `src/index.ts`
- Bot only starts when `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` env vars are set — server starts fine without them
- Leaderboard period enum uses `alltime` (not `all_time`) — from generated OpenAPI types
- `AuditLog[]` and `Warning[]` are returned as plain arrays from the API (not paginated wrappers)
- `MemberProfile` wraps data: member fields are at `profile.member.xpDaily` etc, not at top level
- `Submission` has no `status` field — track edits via `editedAt` and deletes via `deletedAt`
- `submissionId` is `number` not `string` in generated API types
- Per-server isolation: every DB query must scope by `guild_id`
- `CurrentUser` has no `displayName` — use `username`

**Why:** These were all discovered by running typecheck against the generated Orval types.
