# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────
# SPORTSMART LOGISTICS-FACADE — production image
# ─────────────────────────────────────────────────────────────────────
# Mirrors infra/docker/Dockerfile.api. Build context MUST be the repo
# root because pnpm needs the workspace lockfile and the workspace
# `packages/logistics-contracts` link:
#
#   docker build -f apps/logistics-facade/Dockerfile -t sportsmart-logistics-facade:latest .
#
# Pin the same Node 22 slim base by digest as apps/api. When ops rotate
# the apps/api pin (via infra/scripts/pin-base-image.sh) update this
# file in the same PR so the two services stay aligned.
FROM node:22-slim@sha256:689c11043dad91472750cd824c97dd5e2318e9dd6f954e492fe7af0135d33ceb AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate


# ─── build: install dev deps, generate Prisma client, compile TS ────
FROM base AS build
WORKDIR /workspace

# Copy only the manifests first so `pnpm install` is cached between
# rebuilds whenever source changes but deps don't.
# .npmrc carries `shamefully-hoist=true` — without it the strict install can't
# resolve directly-imported deps (express) or the @sportsmart/logistics-contracts
# workspace package at build time, even though it builds locally.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/logistics-facade/package.json apps/logistics-facade/package.json
COPY packages/logistics-contracts/package.json packages/logistics-contracts/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sportsmart/logistics-facade...

# Now copy the facade source plus its only workspace dep.
COPY apps/logistics-facade apps/logistics-facade
COPY packages/logistics-contracts packages/logistics-contracts

RUN pnpm --filter @sportsmart/logistics-facade exec prisma generate
# Compile the logistics-contracts workspace package to ./dist BEFORE the facade
# build. Its package.json main/types point at ./dist, so the facade's bundled
# runtime require('@sportsmart/logistics-contracts') (webpack externalizes the
# workspace pkg) resolves to compiled JS — Node refuses to type-strip raw .ts
# under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). dist is
# .gitignore'd / .dockerignore'd, so it must be built inside the image; the
# subsequent `pnpm deploy` then ships the built dist/ into /out.
RUN pnpm --filter @sportsmart/logistics-contracts run build
RUN pnpm --filter @sportsmart/logistics-facade run build

# pnpm 10's legacy `pnpm deploy` refuses unless inject-workspace-packages=true.
# Set it here (Docker-only; the repo .npmrc keeps the symlinked dev layout),
# after the build, so it only governs pruning the prod tree into /out.
# Then regenerate the Prisma client INSIDE /out: pnpm deploy re-copies
# @prisma/client's UNgenerated stub from the store, so without this the facade
# throws "@prisma/client did not initialize yet" at runtime.
RUN echo 'inject-workspace-packages=true' >> .npmrc \
 && pnpm deploy --filter=@sportsmart/logistics-facade --prod --legacy /out \
 && cd /out && node_modules/.bin/prisma generate


# ─── runtime: lean image, non-root, healthcheck ─────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LOGISTICS_FACADE_PORT=4100

COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/logistics-facade/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/logistics-facade/prisma ./prisma

USER node

EXPOSE 4100

# Liveness probe. Routes carry the global 'api' prefix + URI version v1
# (main.ts: setGlobalPrefix('api') + enableVersioning defaultVersion '1'), so
# the real path is /api/v1/health — NOT /health (which 404s -> unhealthy).
# Use liveness (always 200), not /api/v1/readiness: a DB/Redis blip must not
# mark the container unhealthy and kill it (same rationale as Dockerfile.api).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.LOGISTICS_FACADE_PORT || 4100) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
