# ClanXP — Discord Clan XP Tracker

A Discord-first daily activity & XP tracker. Members prove daily activity by posting a screenshot in the submission channel; the bot forwards an interactive review card to a private staff queue where officers approve/reject/remind/warn. Streaks, approval %, warnings and reminders update automatically. The whole experience lives inside Discord through polished **canvas hubs** (`/xp`, `/xpadmin`) and buttons/modals — the companion website is a thin login/invite/docs surface.

Roblox-first in its defaults (activity "XP", game "Roblox", "Open Roblox" button) but fully configurable per server (`activityName`, `gameName`, `gameUrl`) so any community/game works without code changes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 / 8080 in dev)
- `pnpm --filter @workspace/clan-xp-tracker run dev` — run the React frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Required Env Vars

- `DATABASE_URL` — Postgres connection string (provisioned automatically)
- `SESSION_SECRET` — Express session secret (set)
- `DISCORD_BOT_TOKEN` — Discord bot token (must be added by user)
- `DISCORD_CLIENT_ID` — Discord application client ID (must be added by user)
- `DISCORD_CLIENT_SECRET` — Discord application client secret (must be added by user)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 at `/api`
- Frontend: React + Vite at `/` (slug: clan-xp-tracker)
- DB: PostgreSQL + Drizzle ORM
- Auth: Discord OAuth2 + express-session
- Bot: discord.js v14 with slash commands
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle for API server)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/api-zod/src/index.ts` — manually maintained barrel (critical, do not overwrite with codegen barrel)
- `lib/db/src/schema/` — Drizzle schema files (clans, clan_members, xp_submissions, warnings, audit_logs, sessions)
- `artifacts/api-server/src/` — Express API + Discord bot
- `artifacts/api-server/src/bot/` — Discord bot, modular:
  - `index.ts` — client, intents, command registration, event wiring
  - `router.ts` — single interaction dispatcher (by customId namespace)
  - `commands.ts` — slash command definitions (`/setup /xp /xpadmin /profile /leaderboard /warnings`)
  - `canvas/` — canvas engine: `theme.ts` primitives, bundled OFL fonts in `canvas/assets/fonts`, `canvas/cards/*` renderers
  - `services/` — reusable DB/domain services (config, time, members/streaks, submissions, warnings, reminders, logging, stats)
  - `features/` — hub/submit/review/setup/adminHub/misc flows
  - `ui/` — customId registry (`ids.ts`) + component builders (`components.ts`)
- `artifacts/api-server/src/routes/` — API route handlers
- `artifacts/clan-xp-tracker/src/` — React frontend
- `artifacts/clan-xp-tracker/src/pages/` — All pages (landing, guilds, dashboard/*)

## Architecture decisions

- Session-based auth (not JWT) — Discord OAuth2 stores user in express-session backed by PostgreSQL sessions table
- Per-server data isolation — every DB query scopes by `guild_id`
- Bot and API server run in the same process (`startBot()` called from `src/index.ts`)
- Orval generates both React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) from the same OpenAPI spec
- `lib/api-zod/src/index.ts` is manually maintained to avoid TS2308 collisions — never replace it with the generated barrel

## Product

- **Landing page**: Hero, feature grid, CTA
- **Guild selector**: Lists Discord servers the user belongs to
- **Dashboard**: Overview with stats + charts, leaderboard (daily/weekly/monthly/alltime), member list + profiles, submission management, warning system, full audit log, settings
- **Discord bot** (the primary product): `/setup` wizard, `/xp` member hub, `/xpadmin` staff hub, `/profile`, `/leaderboard`, `/warnings`. Everything else is buttons/menus/modals. Members submit by posting a screenshot in the submission channel → review card in the private review channel → approve/reject/remind/warn.

## User preferences

_None yet_

## Gotchas

- `zod/v4` cannot be resolved by esbuild — use `zod` (plain) in api-server routes
- `@apply dark` is invalid in Tailwind v4 — add `class="dark"` to `<html>` in index.html instead
- After any codegen rerun, restore `lib/api-zod/src/index.ts` to its manual barrel (see architecture decisions)
- Bot requires 3 env vars to start; server starts fine without them (logs a warning)
- The leaderboard period enum uses `alltime` not `all_time`
- **Schema changes require a DB push**: after pulling this revamp, run `pnpm --filter @workspace/db run push` to create the new columns/tables (`tracked_accounts`, `reminders`, `dashboards`, plus new `clans`/`clan_members`/`xp_submissions` columns). All additions are additive — legacy columns are retained so the existing web routes keep working.
- **Bot requires the Message Content privileged intent** (enabled in the Discord Developer Portal) so it can read screenshot attachments posted in the submission channel. It also uses Server Members intent.
- Canvas text uses **bundled OFL fonts** (Outfit + JetBrains Mono) registered explicitly — never rely on system fonts (a bare container has none). Avoid emoji in canvas (no color-emoji font); use drawn shapes or Latin glyphs.
- `build.mjs` externalizes `@napi-rs/canvas` (native module) and copies `src/bot/canvas/assets` → `dist/assets` so fonts resolve at runtime relative to the bundle.
- The api-server `typecheck` script has **pre-existing** failures in the legacy web routes (Express-5 `req.params` typing); the deploy builds via esbuild (`build.mjs`), which does not typecheck. The bot code is type-clean.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
