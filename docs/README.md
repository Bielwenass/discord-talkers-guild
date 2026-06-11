# Talkers Guild — Documentation

Talkers Guild is a Discord activity-RPG bot. Chat activity becomes XP, gold, and
idle income, which feed gacha gear, expeditions, duels, boss raids, and prestige.
It runs as a single Bun/TypeScript process backed by one SQLite file.

The full game design (economy math, schema, tuning tables) lives in
[`../discord-talkers-guild-design.md`](../discord-talkers-guild-design.md). These
docs cover how the implementation is structured and how to run and operate it.

## Contents

- [architecture.md](./architecture.md) — process layout, the lazy-evaluation model,
  the single scheduled job, and the data model.
- [economy.md](./economy.md) — the faucets, sinks, and formulas as implemented.
- [commands.md](./commands.md) — every slash command and how it behaves.
- [deployment.md](./deployment.md) — Docker, Render, environment, and persistence.
- [development.md](./development.md) — local setup, tests, and project conventions.

## At a glance

| | |
|---|---|
| Runtime | Bun |
| Language | TypeScript |
| Storage | SQLite (`bun:sqlite`, WAL mode) |
| Discord library | discord.js v14 |
| Scheduled jobs | One: daily leaderboard + idle digest at 00:00 UTC |
| External services | None (Discord gateway only) |
