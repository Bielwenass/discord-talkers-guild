# Development

## Prerequisites

- [Bun](https://bun.sh) (the project targets Bun, not Node.js).
- A Discord application with a bot token, and a test server you can invite it to.

## Setup

```bash
bun install
cp .env.example .env
# fill in DISCORD_TOKEN and DISCORD_APP_ID; set DEV_GUILD_ID for instant commands
```

Set `DEV_GUILD_ID` to your test server's ID during development. Commands registered
to a single guild appear instantly; global registration can take up to an hour to
propagate.

## Running

```bash
bun start   # production-style run
bun dev     # hot reload (bun --hot)
```

On startup the bot creates and migrates the SQLite database, seeds the item catalog,
registers slash commands, logs in, and schedules the daily job.

## Testing

```bash
bun test           # unit tests (economy/gacha math) + DB integration tests
bun run typecheck  # tsc --noEmit
```

Tests use `bun:test`. The integration suite sets `DB_PATH=:memory:` before importing
the db module (via dynamic import) so it runs against a throwaway in-memory database
and never touches your real file.

## Project conventions

- **Pure core, thin handlers.** Modules under `src/game/` must not import discord.js.
  Game math is pure and unit-tested; the discord.js handlers under `src/discord/`
  stay thin and delegate to the game layer. Keep new economy logic in `src/game/`.
- **Single source for formulas.** Economy constants live in `ECON` in `src/config.ts`
  and formulas in `src/game/formulas.ts`. Reference design section numbers in
  comments rather than duplicating numbers across files.
- **Transactions for multi-step writes.** Use `db.transaction(...)` (via the `tx`
  helper) for anything that changes more than one row atomically — XP grants with
  level-ups, duel payouts, gacha pulls.
- **Bun APIs over Node equivalents.** Per `CLAUDE.md`: `bun:sqlite` rather than
  better-sqlite3, `Bun.serve`/built-in `WebSocket` rather than express/ws, and
  `Bun.file` rather than `node:fs`. Bun auto-loads `.env`, so do not add dotenv.

## Adding a command

1. Create `src/discord/commands/<name>.ts` exporting a `Command` (a
   `SlashCommandBuilder` `data` plus an `execute` handler).
2. Register it in `src/discord/commands/index.ts` so it is included in command
   registration and interaction routing.
3. Keep game logic in `src/game/`; the command handler should validate input, call
   the game layer, and render a reply or embed.
4. For buttons and select menus, encode any needed state in the `customId` and add a
   case to `src/discord/interactionCreate.ts`.

## Database

The schema is defined in `src/db/schema.ts` as `CREATE TABLE IF NOT EXISTS`
statements run on every boot, so adding a new table is additive and safe. There is no
migration framework; for changes to existing tables, write an idempotent migration in
the schema-init path. The seed in `src/db/seed.ts` is idempotent (it skips if the
item catalog is already populated).
