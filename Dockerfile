# SATS WARS: EARTH DEFENSE — one container: game server :4000 + web :3000.
# UNVERIFIED here (no Docker daemon in the dev container); see docs/EVENT_RUNBOOK.md.
#   docker build -t sats-wars .
#   docker run --env-file .env -p 3000:3000 -p 4000:4000 -v sats-wars-data:/app/data sats-wars
# The web bundle reads NEXT_PUBLIC_* at build time: pass the public game server
# URL as a build arg when it is not "same host, port 4000".
FROM node:22.13-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
ARG NEXT_PUBLIC_GAME_SERVER_URL=
ENV NEXT_PUBLIC_GAME_SERVER_URL=$NEXT_PUBLIC_GAME_SERVER_URL
RUN pnpm install --frozen-lockfile && pnpm build && pnpm prune --prod --config.ignore-scripts=true

FROM node:22.13-bookworm-slim
WORKDIR /app
RUN corepack enable && useradd --create-home --uid 10001 satswars
COPY --from=build --chown=satswars /app /app
USER satswars
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/sats-wars.db \
    BACKUP_DIR=/app/data/backups
VOLUME ["/app/data"]
EXPOSE 3000 4000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "tools/start.mjs"]
