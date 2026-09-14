# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Travelar API — production image.
#
# One image, two commands:
#   API        (default)  node --import tsx src/server.ts
#   migrations            node_modules/.bin/prisma migrate deploy
#
# The app runs through tsx rather than a compiled dist/ — that is the repo's
# convention (see package.json#scripts.start) — so tsx is a production
# dependency. Secrets and URLs are runtime env; nothing is baked in.
#
# For local development only Postgres runs in a container: docker-compose.yaml.
# The whole stack in containers: docker-compose.production.yaml.
# ---------------------------------------------------------------------------

FROM node:24-alpine AS base
# Pinned to the version that wrote pnpm-lock.yaml (package.json#packageManager).
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /app

# ---- full install + Prisma client generation -----------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
# prisma generate does not connect, but prisma.config.ts reads DATABASE_URL, so
# give it a placeholder rather than baking a real one into a layer.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm generate

# ---- production dependencies only ----------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- runtime --------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5050

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json prisma.config.ts tsconfig.json ./
COPY --chown=node:node prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src

# The node image ships an unprivileged `node` user; the API never needs root.
USER node
EXPOSE 5050

# /health runs SELECT 1, so "healthy" means the API can reach Postgres too.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node --import tsx keeps a single process as PID 1, so SIGTERM from the
# orchestrator reaches server.ts's graceful shutdown directly instead of going
# through a pnpm or tsx wrapper process.
CMD ["node", "--import", "tsx", "src/server.ts"]
