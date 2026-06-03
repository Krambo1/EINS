# syntax=docker/dockerfile:1.7

# ============================================================
# EINS PVS-Bridge service — Fastify inbound (/healthz, PVS webhooks)
# + Postgres-polling scheduler. Long-lived Node process; deploys to Fly.io.
#
# Unlike the portal worker (which runs TypeScript via tsx), the bridge
# has a real build step (tsc + tsc-alias -> dist) and starts from the
# compiled output, so this is a build -> deploy -> runtime multi-stage.
#
# Build from the repo root so the pnpm workspace context is available:
#   docker build -f apps/bridge/Dockerfile -t eins-bridge .
# ============================================================

ARG NODE_VERSION=20-alpine
ARG PNPM_VERSION=10.33.2

# ----- base: pinned Node + pnpm via corepack -----------------
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /workspace

# ----- build: full install (incl. devDeps) + tsc compile ------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bridge/package.json apps/bridge/
# --ignore-scripts: the bridge's deps (drizzle/fastify/postgres/zod) are pure JS
# and need no build step. It also stops the workspace's native modules (e.g. the
# agent's better-sqlite3) from trying to compile here — there's no toolchain in
# this Alpine image, and the bridge never imports them anyway.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter bridge... --ignore-scripts
COPY apps/bridge/ apps/bridge/
RUN pnpm --filter bridge build

# ----- deploy: flatten bridge + prod deps (and dist) into /deploy
FROM build AS deploy
# `--legacy` keeps pnpm v10 from demanding inject-workspace-packages.
# dist/ was produced in the build stage and travels with the package.
# --ignore-scripts here too: same reason as the install above. The bundle's real
# deps (drizzle/fastify/postgres/zod) are script-free; this stops a stray native
# module from trying (and failing) to compile while assembling /deploy.
RUN pnpm deploy --filter=bridge --prod --legacy --ignore-scripts /deploy

# ----- runtime: minimal image, non-root, tini for PID 1 -------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini forwards SIGTERM so the scheduler + Fastify shut down cleanly
# instead of being SIGKILLed after the grace period.
RUN apk add --no-cache tini

COPY --from=deploy /deploy /app

# Drop root.
RUN addgroup -S bridge && adduser -S -G bridge bridge \
 && chown -R bridge:bridge /app
USER bridge

EXPOSE 7300
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
