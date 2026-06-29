# Railway-ready single-container build for ClanXP
# Builds frontend + API server, serves everything from Express

FROM node:24-slim AS builder
WORKDIR /app

RUN npm install -g pnpm@10.26.1

# Copy manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/clan-xp-tracker/package.json artifacts/clan-xp-tracker/

# Install all deps (needed for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/
COPY artifacts/clan-xp-tracker/ artifacts/clan-xp-tracker/

# Build workspace libs
RUN pnpm --filter @workspace/api-zod run build || true
RUN pnpm --filter @workspace/db run build || true

# Build frontend (static)
RUN cd artifacts/clan-xp-tracker && PORT=8080 BASE_PATH=/ pnpm run build

# Build API server (esbuild bundle)
RUN cd artifacts/api-server && pnpm run build

# ---- Runtime ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@10.26.1

# Copy lockfile + manifests for prod install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/

# Install only production deps
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/artifacts/api-server/dist artifacts/api-server/dist
COPY --from=builder /app/artifacts/clan-xp-tracker/dist/public artifacts/clan-xp-tracker/dist/public
COPY --from=builder /app/lib/api-zod/dist lib/api-zod/dist || true
COPY --from=builder /app/lib/db/dist lib/db/dist || true

EXPOSE 8080
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
