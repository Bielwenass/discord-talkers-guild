# Commands

All commands are slash commands. Responses that only concern the invoking user are
ephemeral. Interactive replies (buttons, select menus) are routed by `customId`
convention in `src/discord/interactionCreate.ts`.

## Player commands

| Command | Description |
|---|---|
| `/guide` | A concise primer on the stats, the core gameplay loop, and the main commands. New members are pointed here on their first `/profile`. |
| `/profile [user]` | Show level, XP bar, stats, equipped gear, idle rate, and prestige. Defaults to yourself. |
| `/claim` | Collect pending idle gold and resolve any finished expedition. |
| `/pull [x10]` | Gacha pull. Buttons let you pull again, do a ten-pull, or salvage commons. |
| `/inventory` | Browse gear; equip or salvage via select menus. One item per slot. |
| `/upgrade <stat> [with]` | Raise STR/INT/CHA/LUK using a stat point or gold. |
| `/expedition start <tier>` | Start a scout (4h), delve (8h), or vigil (24h) idle timer. |
| `/expedition status` | Show the active expedition and time remaining. |
| `/quest board` | Today's 3-offer quest board, your active slot, and the server quest. |
| `/quest start <1-3>` | Begin a solo quest from your board. |
| `/quest party <1-3>` | Open a party quest (2–4) others can Join; eff uses the party mean. |
| `/quest claim` | Claim today's server-quest reward (needs ≥3 counted messages, goal met). |
| `/duel <user> <wager>` | Challenge another member to a gold duel (accept/decline buttons). The loser earns XP (0.4×wager, underdog- and prestige-scaled), capped by a daily budget. |
| `/leaderboard [type]` | Top 10 by total XP, gold, or weekly XP. |
| `/prestige` | At level 50+, reset for a permanent income bonus (keeps gear). |
| `/raid status` | Show the current boss raid board. |
| `/raid strike` | Strike the boss for a STR-scaled % of its max HP (4h cooldown, while a raid is live). |

## Admin commands

`/raid spawn` and all `/config` subcommands require the Manage Server permission.

| Command | Description |
|---|---|
| `/raid spawn` | Spawn a boss raid (HP scales with the guild's last 7 days of XP). |
| `/config channel-weight <channel> <weight>` | Set a channel's XP multiplier (default 1.0). |
| `/config role-reward <level> <role>` | Set the role granted at level 5, 10, 25, or 50. |
| `/config leaderboard-channel <channel>` | Set where the daily leaderboard posts. |
| `/config idle-digest [channel]` | Set the opt-in idle-digest channel; omit the channel to disable. |
| `/config post-leaderboard` | Post yesterday's leaderboard now (test the daily job). |
| `/config post-digest` | Post the idle digest now (test the daily job). |
| `/config show` | Show the current guild configuration. |

## Dev commands (DEVMODE only)

The `/dev` command is registered only when the `DEVMODE` environment variable is set
to a truthy value (`1`, `true`, `yes`, or `on`). It is available to everyone in the
guild and lets you set balances directly for testing. Leave `DEVMODE` unset in
production — it mints arbitrary gold and XP.

| Command | Description |
|---|---|
| `/dev set-gold <amount> [user]` | Set a member's gold to an exact amount (defaults to yourself). |
| `/dev set-xp <amount> [user]` | Set a member's total XP; the level is recomputed and any newly earned stat points are granted. |

## Daily leaderboard

Set the target channel once with `/config leaderboard-channel`. At 00:00 UTC the bot
posts the previous UTC day's top-10 XP earners. Admins can verify it any time with
`/config post-leaderboard`.

## Idle digest (opt-in)

An optional second daily post nudging members to `/claim` idle gold before it caps at
24h. Enable with `/config idle-digest #channel`; disable by running the command with
no channel. It posts alongside the leaderboard at 00:00 UTC and lists the top members
by uncollected idle gold. It is read-only: it previews pending gold from timestamps
and never credits anyone or runs a per-user timer. Test it with `/config post-digest`.
