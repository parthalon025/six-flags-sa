# syntax=docker/dockerfile:1
#
# One image, two processes: the Next.js app on 3000 and the party host on 8787.
# They are separate servers on purpose — the party host has to keep working when
# the web app is being redeployed, and it holds SSE connections that a static
# host cannot.
#
#   docker build -t six-flags-sa .
#   docker run -p 3000:3000 -p 8787:8787 -v party-data:/data six-flags-sa

# --- production dependencies, resolved once and copied in verbatim -----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- build stage: full dependency tree, thrown away afterwards ---------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8787 \
    WEB_PORT=3000 \
    ORIGIN=* \
    DATA_FILE=/data/parties.json

# /data is created here so a fresh named volume inherits this ownership; a
# volume mounted over a root-owned directory would be unwritable to `party`.
RUN addgroup -S party \
 && adduser -S -G party party \
 && mkdir -p /data \
 && chown -R party:party /data

COPY --from=deps  --chown=party:party /app/node_modules ./node_modules
COPY --from=build --chown=party:party /app/.next ./.next
COPY --chown=party:party public ./public
COPY --chown=party:party lib ./lib
COPY --chown=party:party server ./server
COPY --chown=party:party package.json next.config.mjs ./

USER party
EXPOSE 3000 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

# No init system and no supervisor: two children, signals forwarded to both, and
# the container dies with whichever one dies first so the orchestrator restarts it.
CMD ["sh", "-c", "node server/index.mjs & sync=$!; ./node_modules/.bin/next start -p \"$WEB_PORT\" & web=$!; trap 'kill -TERM $sync $web 2>/dev/null' TERM INT; wait $web; kill -TERM $sync 2>/dev/null; wait $sync"]
