# Architecture

## Design principles

1. **One process, one file.** A single Bun process holds the gateway connection and
   writes to one SQLite database. There is no external queue, cache, or scheduler.
2. **Lazy evaluation.** No per-user background timers. Idle income, expedition
   results, raid windows, and stat decay are all computed on read, from stored
   timestamps, at the moment a member runs a command. The only thing that ticks is
   wall-clock time.
3. **One scheduled job.** The sole exception to principle 2 is the daily job at
   00:00 UTC, which posts each guild's leaderboard (and optional idle digest) for
   the day that just ended, then prunes old activity rows.
4. **Pure core, thin handlers.** Everything under `src/game/` is pure game logic
   with no discord.js imports, so the economy is unit-testable in isolation. The
   discord.js handlers under `src/discord/` stay thin and delegate to it.

## Process lifecycle

`src/index.ts` is the entry point. On boot it:

1. Validates required environment (`assertEnv`).
2. Opens, migrates, and seeds the database (`getDb`).
3. Builds the client with the required intents (`createClient`).
4. Wires gateway events: message create, reaction add, interaction create.
5. Registers slash commands (to `DEV_GUILD_ID` if set, otherwise globally).
6. Logs in, and once ready, arms the daily scheduler.

A fatal error during startup is logged and exits non-zero so the host can restart.

## Directory layout

```
src/
  index.ts              Entry point: boot sequence above.
  config.ts             Environment loading + the economy constants (ECON) and tables.
  scheduler.ts          The one scheduled job; self-rearming timer to next UTC midnight.
  types.ts              Shared types (e.g. GuildSettings).

  db/
    db.ts               Database singleton (getDb) + tx() transaction wrapper.
    schema.ts           initSchema: PRAGMAs + CREATE TABLE IF NOT EXISTS for every table.
    seed.ts             Idempotent item-catalog seed (~40 items across slot x rarity).

  game/                 Pure logic, no discord.js imports, unit-tested.
    formulas.ts         XP, levels, gold, duel power/probability, stat cost.
    idle.ts             Decayed idle rate and capped accrual.
    users.ts            DB hub: getOrCreateUser, grantXp, idle claim, stat allocation.
    inventory.ts        Gacha rolls, equip, salvage, gear score.
    gacha.ts            Rarity rolls with LUK shift and pity.
    expeditions.ts      Start and lazy-resolve idle timers.
    duels.ts            Wager validation and duel resolution.
    raids.ts            Boss spawn, damage, and reward distribution.
    prestige.ts         Level-gated reset for a permanent income bonus.
    guilds.ts           Per-guild settings (JSON in guild_config) + known guild ids.

  discord/              Thin handlers and presentation.
    client.ts           Client with required (incl. privileged) intents and partials.
    register.ts         Slash command registration.
    interactionCreate.ts Routes slash / button / select interactions by customId.
    embeds.ts           Shared embed builders (profile, leaderboard, pull, digest).
    components.ts        Shared button/select row builders.
    state.ts            In-memory caps and cooldowns (see below).
    rewards.ts          Applies role rewards on level-up.
    raidAnnounce.ts     Raid announcements.
    events/
      messageCreate.ts  Message XP, reply social XP, activity tracking, raid damage.
      reactionAdd.ts    Reaction social XP to the message author.
    commands/           One file per command (see commands.md).

  util/
    time.ts             utcDayString, previousUtcDay, msUntilNextUtcMidnight, nowS.
    lru.ts              Bounded map for the in-memory caps.
```

## In-memory state

Some anti-abuse limits live in memory and are intentionally allowed to reset on
restart (they bound bursts, not balances):

- **Reaction dedupe** — one social-XP credit per reactor per message.
- **Reply caps** — bounded social XP per message.
- **Duel pair cooldown** — one duel per pair per cooldown window.

All durable state (gold, XP, levels, inventory, expeditions, raids) is in SQLite.

## Intents

The client requests two privileged intents that must be enabled in the Discord
Developer Portal (Bot, Privileged Gateway Intents):

- **Message Content** — required to measure message length for the XP length
  bonus. Without it, no XP is earned.
- **Server Members** — required to grant the level-milestone reward roles.

Message and reaction partials are enabled so reactions on older, uncached messages
still credit social XP.

## Concurrency model

SQLite runs in WAL mode with a single writer (this process). Multi-step state
changes (grant XP plus level-up plus role plus raid damage; duel payouts; gacha
pulls) run inside `db.transaction(...)` so they commit atomically.
