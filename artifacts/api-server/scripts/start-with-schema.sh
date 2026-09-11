#!/bin/sh
# Railway / Docker entrypoint: apply Drizzle schema, then start the API + bot.
# Runs BEFORE Node boots so /help, /xpwarn, /link, and the scheduler see tables.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required to apply the database schema" >&2
  exit 1
fi

echo "Applying database schema (drizzle-kit push, no --force)..."
# CI=true keeps drizzle-kit non-interactive. Safe CREATE/ALTER statements apply
# automatically; data-loss statements are NOT auto-approved (we never pass --force).
cd /app
CI=true pnpm --filter @workspace/db push

echo "Starting ClanXP API server..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
