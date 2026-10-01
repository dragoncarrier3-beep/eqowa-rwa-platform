# Web app, standalone Next.js output. Build from the repo root, because the app
# imports the repo-level config/:
#   docker compose -f deploy/docker-compose.aws.yml build web
FROM node:22-bookworm-slim AS build

WORKDIR /repo

COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN npm --prefix apps/web ci --no-audit --no-fund

COPY config ./config
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build
# arguments. Contract addresses are not among them: the app reads those from
# the API at run time.
ARG NEXT_PUBLIC_CHAIN_ID=31337
ARG NEXT_PUBLIC_RPC_URL=
ARG NEXT_PUBLIC_APP_URL=
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
  NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
  NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
  NEXT_TELEMETRY_DISABLED=1

RUN npm --prefix apps/web run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  HOSTNAME=0.0.0.0

# outputFileTracingRoot is the repo root, so the server sits under apps/web.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
