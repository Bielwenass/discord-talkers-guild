# Economy

All constants below live in `ECON` in `src/config.ts`; the formulas live in
`src/game/formulas.ts` and `src/game/idle.ts`. Section numbers reference the
design document. This page reflects what is implemented, not just the design prose.

## Faucets (where value enters)

### Message XP

A message must have at least `MIN_CHARS` (3) non-whitespace characters to count.
Per-user, per-guild XP is rate-limited by `XP_COOLDOWN_S`; messages sent inside the
cooldown still bump activity counts but grant 0 XP.

```
length_bonus  = 1 + 3 * min(chars, 400) / 400            # caps at 4.0x
stat_mult     = 1 + 0.02 * INT
prestige_mult = 1 + 0.20 * prestige
msg_xp        = BASE_XP * channel_weight * length_bonus * stat_mult * prestige_mult
```

`channel_weight` defaults to 1.0 and is set per channel via `/config channel-weight`.

### Social XP

Credited to the recipient, not the actor, and capped per message:

- **Reply** to someone's message: `REPLY_XP_BASE * (1 + 0.05 * CHA)` to the original
  author, capped at `REPLY_CAP_PER_MSG` credits.
- **Reaction** on someone's message: `REACT_XP_BASE * (1 + 0.05 * CHA)` to the
  author, one credit per reactor, capped at `REACT_CAP_PER_MSG`.

### Gold

Every XP grant also mints gold at `GOLD_PER_XP` (gold = xp / 4).

### Idle income

Idle gold accrues from recent activity, with each past day's contribution decayed
on a 3.5-day half-life and summed into a rate (gold/hour). Accrual is the rate
times hours elapsed since the last claim, multiplied by the prestige bonus, and
**capped at `IDLE_OFFLINE_CAP_H` (24h)** to encourage a daily check-in. The first
check-in grants nothing (it only sets the clock). Contributions older than
`IDLE_LOOKBACK_DAYS` (14) are below ~6% and ignored.

Idle gold is realized on `/claim`, and is auto-claimed before any spend so balances
are always current when it matters.

## Levels

```
xp_to_next(L) = 80 * L^1.5
```

Crossing a level grants `STAT_POINTS_PER_LEVEL` (1) stat point. Every
`FREE_PULL_EVERY_LEVELS` (2) levels grants a free gacha pull. Milestones at L5, L10,
L25, and L50 grant configured reward roles. (The level-to-XP mapping follows the
formula above; the design's prose checkpoints are approximate.)

## Stats

Four stats — STR, INT, CHA, LUK — bought with stat points or gold. The gold cost of
the nth purchased point rises geometrically:

```
cost(n) = 500 * 1.15^n
```

- **STR** adds `STR_DUEL_POWER` (2) duel power per point, and is the raid stat: it
  multiplies your boss chat damage (`1 + 0.05 * STR`) and powers `/raid strike`.
- **INT** raises message XP (the `stat_mult` above).
- **CHA** raises social XP received.
- **LUK** shifts gacha weight off Common, by `LUK_WEIGHT_SHIFT` (0.5%) per point,
  capped at `LUK_MAX_SHIFT` (20%), and makes LUK (loot) quests guarantee an item.

Beyond their headline effect, **every stat scales quests**: the governing stat of a
quest sets its efficiency `eff = 1 + 0.025 * stat` (capped ×3). Stats never gate a
quest — they only make it more efficient. See [Quests](#quests).

## Sinks (where value leaves)

### Gacha

Pulls cost `PULL_COST_SINGLE` (250) or `PULL_COST_TEN` (2250, a 10% discount).
Rarity is rolled from the base weights below, adjusted by the LUK shift, with a pity
rule: a pull that reaches `PITY_THRESHOLD` (50) without an Epic-or-better guarantees
Epic+.

| Rarity | Weight | Stat budget | Salvage |
|---|---|---|---|
| Common | 0.60 | 1–2 | 15 |
| Uncommon | 0.25 | 2–4 | 60 |
| Rare | 0.10 | 4–7 | 150 |
| Epic | 0.04 | 7–11 | 500 |
| Legendary | 0.01 | 12–18 | 2000 |

An item's stat budget is distributed across its stats; salvaging returns the gold
shown. Gear contributes to duel power via gear score.

### Expeditions

Idle timers that snapshot the idle rate at start and pay out on lazy resolve:

| Tier | Duration | Gold multiplier | Item rolls | LUK bonus |
|---|---|---|---|---|
| Scout | 4h | 2x | 1 | 0 |
| Delve | 8h | 4x | 1 | +5 |
| Vigil | 24h | 8x | 2 | +10 |

Gold payout has +/-15% variance.

### Duels

Both players stake equal gold. Win probability scales with relative power:

```
power     = level + 2 * STR + gear_score
P(win A)  = power_A / (power_A + power_B)
```

The pot is `2 * wager` minus a `DUEL_RAKE` (5%) house cut paid to the winner. The
minimum wager is `DUEL_MIN_WAGER` (50); there is no upper cap, so a player may wager
up to their entire balance. A pair can duel once per `DUEL_COOLDOWN_S` (2 min by default). Idle
is auto-claimed for both players before affordability is checked, so the balances used
are current — each player only needs to hold at least the wagered amount.

Gold stays the winner's prize and the winner earns **no** XP; instead the **loser**
earns XP (addendum A). Splitting the two rewards across the two players removes any
XP-efficient win-trading configuration.

```
loser_xp      = round(0.4 * wager * underdog_mult * prestige_mult)
underdog_mult = clamp(power_winner / power_loser, 0.5, 2.0)
prestige_mult = 1 + 0.10 * loser_prestige        # the loser's own
```

Losing to a stronger opponent pays more. Reference: 50 g → 20 XP, 500 g → 200 XP,
1,000 g against a 2× stronger opponent → 800 XP.

**Daily budget (anti-farm).** Each member has a per-UTC-day loser-XP budget of
`1000 * prestige_mult`. Loser XP draws it down; once exhausted, further losses that day
pay 0 XP (gold and rake still flow). A single large loss may consume the whole budget at
once — that is intended. The reset is lazy: the stored `last_duel_day` is compared to
today on access (no cron). The XP flows through the normal grant path (levels, stat
points, and gold = xp/4), so a duel is **no longer a guaranteed gold sink** — the loser's
minted gold is a deliberate, budget-capped faucet.

### Raids

A boss spawns and stays up for `RAID_WINDOW_H` (72h). Its HP is recalibrated
(addendum B.1 — the old 40× formula produced bosses ~20–40× beyond reachable damage):

```
HP = max(2 * weekly_guild_xp, 1500 * active_users)
```

`weekly_guild_xp` is guild-wide XP over the previous 7 days; `active_users` is the
distinct members with ≥1 counted message in that window. The per-user floor keeps bosses
meaningful on small/quiet servers; an absolute floor of 1500 prevents a zero-HP boss.

Damage comes from two sources:

- **Chat (passive)** — XP earned during the window also damages the boss, scaled by STR:
  `chat_damage = xp_earned * (1 + 0.05 * STR)` (20 STR = 2×, 40 STR = 3×, uncapped).
- **`/raid strike` (active)** — a percentage of the boss's max HP, so it self-balances
  across server sizes: `strike_damage = HP_max * strike_pct * prestige_mult`, where
  `strike_pct = 1.2% + 0.10% * STR` capped at 8% (cap at STR 68). One strike per 4h per
  user, only while a raid is live; strikes cost nothing and count toward the top-3 bonus.

On kill, each participant earns `RAID_PARTICIPANT_IDLE_H` (12h) of their idle rate,
floored at `RAID_PARTICIPANT_MIN_GOLD` (200), plus item rolls (an extra roll for the top
3 by damage). On timeout: half gold, no items.

### Quests

Quests are *dealt* (a deterministic daily board) and *test a stat*, where expeditions are
*chosen* and scale off idle rate. Stats never gate a quest — the governing stat only
scales efficiency:

```
eff = 1 + 0.05 * governing_stat        # capped at 3.0 (cap at stat 80)
```

Each user sees **3 offers per UTC day** (spanning ≥2 governing stats) and holds **one
active quest slot**. Offers are generated deterministically from
`(guild_id, user_id, date)` — no storage, idempotent re-render, no reroll abuse.

Every offer rolls a template (stat + kind) and a duration tier:

| Tier | Base duration | Reward multiplier |
|---|---|---|
| Errand | 2h | ×1.0 |
| Task | 6h | ×1.1 |
| Undertaking | 12h | ×1.25 |

Per-hour base rates scale with level: `gold_rate = 8 + 0.6 * level`,
`xp_rate = 5 + 0.4 * level`. A reward is `rate * base_hours * tier_mult * prestige_mult`,
then by **kind**:

- **Bountiful** — fixed duration; gold, XP, and item chance are all × `eff`.
- **Swift** — fixed (base) rewards; the duration is divided by `eff` (the gain is slot
  turnover).

An item rolls on completion at 10% (Bountiful: 10% × `eff`). **LUK quests are loot
quests**: they guarantee an item and halve their gold.

**Party (2–4).** Opened from a board offer; others Join. `eff` uses the **mean** of
members' governing stat (composition matters). Every member receives full solo-tier
rewards × `(1 + 0.10 * (member_count − 1))`, and the quest occupies all members' slots.
Recruiting concludes when full or 15 minutes after opening (min 2, else it disbands).

**Server quest.** One per guild per UTC day: a collective goal of
`max(50, round(1.2 * trailing 7-day daily avg counted messages))`. Every member who
contributes ≥3 counted messages may claim one Errand-tier payout × their own governing
eff. No opt-in, no party mechanics — ambient collective pressure.

## Prestige

At `PRESTIGE_BASE_LEVEL` (50) a member may prestige: level, gold, and stats reset,
but inventory is kept, and a permanent `+20%` income bonus per prestige applies. The
required level rises by `PRESTIGE_LEVEL_STEP` (5) each time.

## Maintenance

`activity_daily` rows older than `ACTIVITY_PRUNE_DAYS` (30) are pruned by the daily
job.
