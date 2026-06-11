# Talkers Guild

A Discord activity-RPG bot: chat activity becomes XP, gold, and idle income, which
feed gacha gear, expeditions, duels, boss raids, and prestige. One Bun/TypeScript
process, one SQLite file. All progression is computed **lazily from timestamps** when
a member runs a command — the only scheduled job is the **daily leaderboard at 00:00
UTC**.

See [`discord-talkers-guild-design.md`](./discord-talkers-guild-design.md) for the full
game design, economy math, and schema, and [`docs/`](./docs/README.md) for architecture,
the command reference, and deployment (Docker / Render).

## Setup

1. **Install deps**

   ```bash
   bun install
   ```

2. **Create a Discord application & bot** at <https://discord.com/developers/applications>.
   Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent** and
   **Server Members Intent** — the bot needs them for message length scoring and for
   granting level-up roles, respectively. Without Message Content, no XP is earned.

3. **Configure env**

   ```bash
   cp .env.example .env
   # fill in DISCORD_TOKEN, DISCORD_APP_ID; set DEV_GUILD_ID for instant dev commands
   ```

4. **Invite the bot.** OAuth2 scopes: **`bot`** and **`applications.commands`**.

### Permissions

| Permission | Why |
|---|---|
| View Channels | See messages to award activity XP |
| Send Messages | Post command replies, level-ups, leaderboards, raid results |
| Embed Links | Profile / leaderboard / pull embeds |
| Read Message History | Resolve replied-to messages for social XP |
| Add Reactions | (optional) react on prompts |
| Manage Roles | (optional) grant the L5/10/25/50 reward roles from `/config role-reward` |

The corresponding permission integer is **`268520512`**. Quick invite URL (replace
`YOUR_APP_ID` with your Application ID):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=268520512&scope=bot%20applications.commands
```

> If you skip the optional **Manage Roles** permission, drop it to `85056` —
> everything works except automatic level-up role grants. Note that for role grants
> to succeed, the bot's own role must also sit **above** the reward roles in the
> server's role list.

## Run

```bash
bun start        # production
bun dev          # hot reload (bun --hot)
```

On startup the bot creates/migrates the SQLite DB, seeds the item catalog, registers
slash commands (to `DEV_GUILD_ID` if set, else globally), logs in, and schedules the
daily leaderboard.

## Commands

| Command | What it does |
|---|---|
| `/profile [user]` | Level, XP bar, stats, gear, idle rate, prestige |
| `/claim` | Collect idle gold and resolve a finished expedition |
| `/pull [x10]` | Gacha pull (buttons: pull again / ten-pull / salvage commons) |
| `/inventory` | Equip / salvage gear via select menus |
| `/upgrade <stat> [with]` | Spend a stat point or gold to raise STR/INT/CHA/LUK |
| `/expedition start <tier>` · `/expedition status` | Idle timers (scout/delve/vigil) |
| `/duel <user> <wager>` | PvP gold duel (accept/decline buttons) |
| `/leaderboard [type]` | Top 10 by XP / gold / weekly XP |
| `/prestige` | Reset at the level cap for a permanent income bonus (keeps gear) |
| `/raid status` · `/raid spawn` | Boss raid board; admins spawn a boss |
| `/config …` | Admin: channel weights, role rewards, leaderboard channel |

### Daily leaderboard

Set the target channel once:

```
/config leaderboard-channel #channel
```

It posts the previous UTC day's top-10 XP earners at 00:00 UTC. To verify it without
waiting for midnight, an admin can run `/config post-leaderboard`.

### Idle digest (opt-in)

An optional second daily post that nudges members to `/claim` their idle gold before it
caps. Enable it with:

```
/config idle-digest #channel      # enable
/config idle-digest               # (no channel) disable
```

It posts alongside the leaderboard at 00:00 UTC, listing the top members by uncollected
idle gold. It is **read-only** — it previews pending gold from timestamps and never
credits anyone or runs a per-user timer, so it stays within the bot's lazy, single-cron
model. Test it anytime with `/config post-digest`.

## Develop

```bash
bun test          # unit tests (economy/gacha math) + DB integration tests
bun run typecheck # tsc --noEmit
```

The pure game math lives in `src/game/*` (no discord.js imports) so the economy is
unit-testable; the Discord handlers in `src/discord/*` stay thin and delegate to it.
