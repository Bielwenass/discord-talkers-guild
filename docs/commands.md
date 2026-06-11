# Commands

All commands are slash commands. Responses that only concern the invoking user are
ephemeral. Interactive replies (buttons, select menus) are routed by `customId`
convention in `src/discord/interactionCreate.ts`.

## Player commands

| Command | Description |
|---|---|
| `/profile [user]` | Show level, XP bar, stats, equipped gear, idle rate, and prestige. Defaults to yourself. |
| `/claim` | Collect pending idle gold and resolve any finished expedition. |
| `/pull [x10]` | Gacha pull. Buttons let you pull again, do a ten-pull, or salvage commons. |
| `/inventory` | Browse gear; equip or salvage via select menus. One item per slot. |
| `/upgrade <stat> [with]` | Raise STR/INT/CHA/LUK using a stat point or gold. |
| `/expedition start <tier>` | Start a scout (4h), delve (8h), or vigil (24h) idle timer. |
| `/expedition status` | Show the active expedition and time remaining. |
| `/duel <user> <wager>` | Challenge another member to a gold duel (accept/decline buttons). |
| `/leaderboard [type]` | Top 10 by total XP, gold, or weekly XP. |
| `/prestige` | At level 50+, reset for a permanent income bonus (keeps gear). |
| `/raid status` | Show the current boss raid board. |

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
