# Deployment

The bot is a Discord gateway client, not an HTTP server. It needs an outbound
connection to Discord, persistent storage for its SQLite file, and a few
environment variables. Any host that can run a long-lived Bun process works; this
page covers Docker and Render.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Bot token (Developer Portal, Bot, Reset Token). |
| `DISCORD_APP_ID` | Yes | — | Application (client) ID. |
| `DEV_GUILD_ID` | No | — | Register commands to one guild for instant updates while developing. Leave unset in production to register globally. |
| `DB_PATH` | No | `./talkers.db` | SQLite file path. Point this at a persistent disk in production. |
| `DEVMODE` | No | — | Set to `1`/`true`/`yes`/`on` to register the privileged `/dev` command (set gold/xp). Leave unset in production. |

Bun auto-loads `.env` locally; in production, set these as the host's environment
variables. Never commit `.env`.

## Privileged intents

Before the bot can run, enable both privileged intents in the Discord Developer
Portal (Bot, Privileged Gateway Intents): Message Content and Server Members.
Missing intents cause a "Used disallowed intents" login failure. See
[architecture.md](./architecture.md#intents) for why each is needed.

## Persistence

The bot keeps all durable state in a single SQLite file, and WAL mode creates
`-wal` and `-shm` sidecar files next to it. The directory holding `DB_PATH` must be
on persistent storage, or all progress is lost on every restart/redeploy. Do not
point `DB_PATH` at an ephemeral container filesystem.

## Docker

The provided `Dockerfile` builds on the official `oven/bun` image, installs
production dependencies in a cached layer, and defaults `DB_PATH` to
`/data/talkers.db` so the database lives on a mounted volume.

```bash
docker build -t talkers-guild .

docker run -d --name talkers-guild \
  -e DISCORD_TOKEN=... \
  -e DISCORD_APP_ID=... \
  -v talkers-data:/data \
  talkers-guild
```

The named volume `talkers-data` mounted at `/data` is what makes state survive
restarts.

## Render

Deploy as a Background Worker (not a Web Service — there is no HTTP port to bind).

1. Create a new Background Worker from this repository.
2. Runtime: Docker (Render uses the `Dockerfile` at the repo root).
3. Add a persistent disk and mount it at `/data`. The image already sets
   `DB_PATH=/data/talkers.db`, so no extra config is needed for storage.
4. Set environment variables `DISCORD_TOKEN` and `DISCORD_APP_ID` (and optionally
   `DEV_GUILD_ID`). Leave `DB_PATH` as the image default unless you mount elsewhere.
5. Deploy. On boot the worker migrates the database, seeds the item catalog,
   registers commands, logs in, and arms the daily scheduler.

A single instance is correct. Do not scale to multiple instances: there must be
exactly one gateway connection and one SQLite writer.

## Logs and health

The process logs its boot sequence, the login tag, the time until the next daily
job, and daily-job completion. A fatal startup error exits non-zero so the host
restarts it. There is no health-check endpoint; liveness is the gateway connection.
