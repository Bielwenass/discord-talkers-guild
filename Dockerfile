# Talkers Guild bot — Render deployment image.
# Run as a Render "Background Worker" (the bot is a gateway client, not an HTTP server).
FROM oven/bun:1 AS base
WORKDIR /app

# --- Install dependencies (cached unless lockfile/manifest change) ---
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# --- Runtime image ---
FROM base AS runtime
ENV NODE_ENV=production

# Persist the SQLite DB on a Render disk mounted at /data.
ENV DB_PATH=/data/talkers.db

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The bot writes WAL sidecars next to the DB; ensure the mount point exists.
RUN mkdir -p /data

# Registers slash commands on boot, logs in, and arms the daily scheduler.
CMD ["bun", "run", "src/index.ts"]
