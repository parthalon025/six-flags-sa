# syntax=docker/dockerfile:1
#
# Monorepo image: Next.js app on 3000, party host on 8787.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/party-tracker/package.json ./apps/party-tracker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/venue-builder/package.json ./packages/venue-builder/
RUN npm ci --omit=dev -w @party-tracker/app

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/party-tracker/package.json ./apps/party-tracker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/venue-builder/package.json ./packages/venue-builder/
RUN npm ci
COPY . .
RUN npm run build -w @party-tracker/app

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8787 \
    WEB_PORT=3000 \
    ORIGIN=* \
    DATA_FILE=/data/parties.json

RUN addgroup -S party \
 && adduser -S -G party party \
 && mkdir -p /data \
 && chown -R party:party /data

COPY --from=deps  --chown=party:party /app/node_modules ./node_modules
COPY --from=build --chown=party:party /app/apps/party-tracker/.next ./apps/party-tracker/.next
COPY --chown=party:party apps/party-tracker/public ./apps/party-tracker/public
COPY --chown=party:party apps/party-tracker/lib ./apps/party-tracker/lib
COPY --chown=party:party apps/party-tracker/server ./apps/party-tracker/server
COPY --chown=party:party apps/party-tracker/package.json ./apps/party-tracker/
COPY --chown=party:party apps/party-tracker/next.config.mjs ./apps/party-tracker/
COPY --chown=party:party package.json ./

USER party
EXPOSE 3000 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

WORKDIR /app/apps/party-tracker
CMD ["sh", "-c", "node server/index.mjs & sync=$!; ../../node_modules/.bin/next start -p \"$WEB_PORT\" & web=$!; trap 'kill -TERM $sync $web 2>/dev/null' TERM INT; wait $web; kill -TERM $sync 2>/dev/null; wait $sync"]
