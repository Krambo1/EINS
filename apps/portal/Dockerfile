# syntax=docker/dockerfile:1.7

# ============================================================
# EINS Portal worker — pg-boss (Postgres) queues, scheduler, and
# maintenance in one always-on process.
#
# Single entry point: the long-running worker (src/worker/index.ts) creates the
# pgboss schema, registers every queue, runs the cron schedules (folded in from
# the old standalone cron.ts), and drains in-flight jobs on SIGTERM. No Redis.
#
# Build from the repo root so the pnpm workspace context is available:
#   docker build -f apps/portal/Dockerfile -t eins-portal-worker .
# ============================================================

ARG NODE_VERSION=20-alpine
ARG PNPM_VERSION=10.33.2
# Pin tsx to the version that lives in apps/portal devDependencies so the
# image matches `pnpm worker` behaviour 1:1 (cron is folded into the worker).
ARG TSX_VERSION=4.19.2

# ----- base: pinned Node + pnpm via corepack -----------------
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /workspace

# ----- deps: install the whole workspace, cached on the lockfile
FROM base AS deps
# Copy lockfile + workspace config + every package.json so pnpm can
# build the dependency graph without needing application source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/portal/package.json apps/portal/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----- deploy: flatten portal + prod deps into /deploy --------
FROM deps AS deploy
COPY apps/portal/ apps/portal/
COPY packages/ui/ packages/ui/
# `pnpm deploy --prod` excludes devDeps. tsx lives in devDeps so we
# install it globally in the runtime stage below — that keeps the
# deployed bundle lean while still executing TS without a build step.
#
# `--legacy` is required as of pnpm v10: without it, deploy demands
# every workspace dep be marked `inject-workspace-packages=true`,
# which would change how every other consumer (Next dev server,
# tests, etc.) resolves @eins/ui. Legacy mode keeps the prior
# behaviour — flatten workspace deps into a normal node_modules.
RUN pnpm deploy --filter=portal --prod --legacy /deploy

# ----- runtime: minimal image, non-root, tini for PID 1 -------
FROM node:${NODE_VERSION} AS runtime
ARG TSX_VERSION
ENV NODE_ENV=production
WORKDIR /app

# tini forwards SIGTERM cleanly so the worker's shutdown handler in
# worker/index.ts gets to drain in-flight jobs (boss.stop graceful)
# before the container exits. Without it, Docker sends SIGKILL after
# the grace period and in-flight jobs are left to expire + retry.
RUN apk add --no-cache tini \
 && npm install -g tsx@${TSX_VERSION} \
 && npm cache clean --force

COPY --from=deploy /deploy /app

# Drop root.
RUN addgroup -S worker && adduser -S -G worker worker \
 && chown -R worker:worker /app
USER worker

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/worker/index.ts"]
