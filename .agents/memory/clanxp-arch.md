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

## XP management model (post-refactor)

- The bot is officer-managed: **members never submit XP**. All progress writes
  go through `bot/services/progress.ts` — never write `clan_members.weekly*`
  columns directly, or goal/status/eligibility rules drift.
- A member row whose `week_key` is stale reads as **zero progress this week**.
  This is deliberate: a missed weekly reset cannot carry numbers forward.
- The bot no longer uses the `MessageContent`/`GuildMessages` intents.
- `xp_submissions`, `tracked_accounts` and `vacations` are legacy tables kept
  only so the web dashboard keeps compiling — the bot never writes them.
- `isStaff` is an alias of `isOfficer`; use `isAdmin` for config changes.
- Canvas fonts have **no emoji coverage** — emoji in canvas text render as
  tofu boxes. Emoji are fine in embeds/messages, never in a card.
