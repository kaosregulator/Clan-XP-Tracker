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

## 4. Create the database tables

The app uses Drizzle. The session table auto-creates, but the application tables
must be pushed once (and again whenever the schema changes). Run this **locally**
against Railway's Postgres:

1. In the **Postgres** service → **Connect**, copy the **public** connection
   string.
2. From a checkout of this repo:

   ```bash
   pnpm install
   DATABASE_URL="<public-connection-string>" pnpm --filter @workspace/db push
   ```

Answer the prompts to create the tables. (Railway does not have a separate
release phase, so this schema push is a manual step rather than part of the
container start.)

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
  the URL registered in the Discord portal, or the tables weren't pushed
  (step 4).
- **Slash commands don't appear** → global commands can take up to an hour. Set
  `DISCORD_DEV_GUILD_ID` to your server's ID for instant registration while
  testing.
