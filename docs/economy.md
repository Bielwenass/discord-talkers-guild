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
xp_to_next(L) = 80 * L^1.75
```

Crossing a level grants `STAT_POINTS_PER_LEVEL` (1) stat point. Every
`FREE_PULL_EVERY_LEVELS` (5) levels grants a free gacha pull. Milestones at L5, L10,
L25, and L50 grant configured reward roles. (The level-to-XP mapping follows the
formula above; the design's prose checkpoints are approximate.)

## Stats

Four stats — STR, INT, CHA, LUK — bought with stat points or gold. The gold cost of
the nth purchased point rises geometrically:

```
cost(n) = 500 * 1.15^n
```

- **STR** adds `STR_DUEL_POWER` (2) duel power per point.
- **INT** raises message XP (the `stat_mult` above).
- **CHA** raises social XP received.
- **LUK** shifts gacha weight off Common, by `LUK_WEIGHT_SHIFT` (0.5%) per point,
  capped at `LUK_MAX_SHIFT` (20%).

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
| Scout | 4h | 3x | 1 | 0 |
| Delve | 8h | 6x | 1 | +5 |
| Vigil | 24h | 16x | 2 | +10 |

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

### Raids

A boss spawns with `HP = RAID_HP_PER_XP (40) * guild XP over the previous 7 days`,
and stays up for `RAID_WINDOW_H` (72h). Damage is dealt by participating. On kill,
each participant earns `RAID_PARTICIPANT_IDLE_H` (12h) of their idle rate, floored
at `RAID_PARTICIPANT_MIN_GOLD` (200).

## Prestige

At `PRESTIGE_BASE_LEVEL` (50) a member may prestige: level, gold, and stats reset,
but inventory is kept, and a permanent `+20%` income bonus per prestige applies. The
required level rises by `PRESTIGE_LEVEL_STEP` (5) each time.

## Maintenance

`activity_daily` rows older than `ACTIVITY_PRUNE_DAYS` (30) are pruned by the daily
job.
