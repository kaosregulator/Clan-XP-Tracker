# Deploying ClanXP to Railway

ClanXP builds and runs as a **single container**: the Dockerfile compiles the
React frontend and the Express + Discord bot API server, then serves the static
frontend and the API from one process. Railway builds it straight from this
repo — no extra services besides a Postgres database.

The build/deploy settings are already committed:

- `railway.json` / `railway.toml` — builder = Dockerfile at
  `artifacts/api-server/Dockerfile`, start command, and a `/api/healthz`
  health check.
- `artifacts/api-server/Dockerfile` — the multi-stage build.

## 1. Create the project

1. In Railway, click **New** → **Deploy from GitHub repo**.
2. Choose **`kaosregulator/clan-xp-tracker`** and the branch you want to deploy
   (e.g. `main`).
3. Railway reads `railway.json` and builds with the Dockerfile automatically —
   you don't need to change the builder or start command.

## 2. Add a Postgres database

1. In the project, click **New** → **Database** → **Add PostgreSQL**.
2. This creates a `Postgres` service and exposes `DATABASE_URL` to reference.

## 3. Set environment variables

On the **app service** → **Variables**, add:

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | References the Postgres service above |
| `SESSION_SECRET` | a long random string | `openssl rand -hex 32` |
| `DISCORD_CLIENT_ID` | from Discord Developer Portal | |
| `DISCORD_CLIENT_SECRET` | from Discord Developer Portal | |
| `DISCORD_BOT_TOKEN` | from Discord Developer Portal | Bot starts automatically in production |
| `DISCORD_REDIRECT_URI` | `https://<your-domain>/api/auth/callback` | Set after step 5; recommended so the OAuth URL never drifts |

`PORT` and `NODE_ENV=production` are handled for you (Railway injects `PORT`;
the image sets `NODE_ENV`). Optional variables (`DISCORD_DEV_GUILD_ID`,
`LOG_LEVEL`) are described in `.env.example`.

The server **will not boot** without `DATABASE_URL` and `SESSION_SECRET`, so set
those before the first successful deploy.

## 4. Database tables (automatic on deploy)

The container entrypoint (`artifacts/api-server/scripts/start-with-schema.sh`)
runs **`drizzle-kit push` without `--force`** against `DATABASE_URL` **before**
the API/bot process starts. That creates `clan_members` and every other table
from `lib/db/src/schema` on a fresh Railway Postgres, and applies safe additive
schema changes on later deploys.

You do **not** need to open a Railway shell or run `pnpm --filter @workspace/db
push` manually for normal deploys. Watch deploy logs for
`Applying database schema` / drizzle-kit output, then `Starting ClanXP API
server...`.

Boot still runs additive `ensureSchema` (safe `ADD COLUMN IF NOT EXISTS` /
activity table helpers) as a second safety net after Node starts.

**Manual push (optional / recovery only):** if a deploy fails on a destructive
schema change (drizzle-kit will not auto-approve data loss without `--force`),
review the change locally, then either adjust the schema or run a careful
manual push against the Railway public URL from your laptop:

```bash
pnpm install
DATABASE_URL="<public-connection-string>" pnpm --filter @workspace/db push
```

Never use `push-force` on production unless you have explicitly accepted data
loss.

## 4b. Instant slash-command updates (optional)

You can set `DISCORD_DEV_GUILD_ID` to your Discord **server ID** so slash
commands refresh instantly in that server. It is optional.

If Railway logs show `Failed to register slash commands` with
`DiscordAPIError: Missing Access` / code `50001`:

1. **Delete** `DISCORD_DEV_GUILD_ID` from Railway variables (safest), **or**
2. Confirm the value is the server ID (right-click server → Copy Server ID — needs Developer Mode), **and**
3. Re-invite the bot with the `applications.commands` + `bot` scopes from the Discord Developer Portal OAuth2 URL Generator.

The bot always registers commands **globally** now — a bad guild ID will not
wipe `/link`, hubs, or the dashboard anymore.

## 5. Generate a domain and finish OAuth

1. App service → **Settings** → **Networking** → **Generate Domain**.
2. Set `DISCORD_REDIRECT_URI` to `https://<that-domain>/api/auth/callback`.
3. In the **Discord Developer Portal** → your app → **OAuth2** → **Redirects**,
   add the exact same URL.
4. Redeploy if needed. Railway watches `/api/healthz`; once it returns `200`
   the deploy is healthy.

## Troubleshooting

- **Crash loop right after build** → almost always a missing `DATABASE_URL` or
  `SESSION_SECRET`. Check the deploy logs for the thrown error.
- **Login bounces back to the home page** → `DISCORD_REDIRECT_URI` doesn't match
  the URL registered in the Discord portal, or schema push failed at container
  start (check logs for drizzle-kit / `DATABASE_URL`).
- **Slash commands don't appear / old hubs stick around** → check deploy logs for
  `Missing Access` (see §4b). Otherwise wait up to ~1h for global sync, or set a
  valid `DISCORD_DEV_GUILD_ID`. Fully quit the Discord client after a successful
  “Slash commands registered globally” log line.
- **`relation "clan_members" does not exist` / `/help` / `/xpwarn` fail** → the
  start script did not run or schema push failed. Confirm the service start
  command is `sh artifacts/api-server/scripts/start-with-schema.sh`, redeploy,
  and verify deploy logs show the schema step before `Server listening`.
- **`/link` says database is updating / missing columns** → redeploy so
  entrypoint push + boot `ensureSchema` can add them.