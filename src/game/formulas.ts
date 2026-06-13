// Pure economy math (design §3–§8). No discord.js, no DB — fully unit-testable.
import { ECON } from "../config.ts";

// --- §3.1 message XP ---

/** stat_mult = 1 + 0.02 * INT */
export function intMult(intStat: number): number {
  return 1 + ECON.INT_XP_PER_POINT * intStat;
}

/** prestige_mult = 1 + 0.20 * prestige_count */
export function prestigeMult(prestige: number): number {
  return 1 + ECON.PRESTIGE_PER_LEVEL * prestige;
}

/**
 * msg_xp = BASE * channel_weight * stat_mult * prestige_mult
 * Returned unfloored; caller floors the final integer grant.
 */
export function messageXp(args: {
  channelWeight: number;
  intStat: number;
  prestige: number;
}): number {
  return (
    ECON.BASE_XP *
    args.channelWeight *
    intMult(args.intStat) *
    prestigeMult(args.prestige)
  );
}

// --- §3.2 social XP (credited to recipient) ---

/** reply XP = 8 * (1 + 0.05 * CHA) */
export function replyXp(cha: number): number {
  return ECON.REPLY_XP_BASE * (1 + ECON.REPLY_CHA_PER_POINT * cha);
}

/** reaction XP = 12 * (1 + 0.05 * CHA) */
export function reactionXp(cha: number): number {
  return ECON.REACT_XP_BASE * (1 + ECON.REACT_CHA_PER_POINT * cha);
}

// --- §3.3 gold ---

/** gold = floor(xp / 4) on every XP grant. */
export function goldFromXp(xp: number): number {
  return Math.floor(xp * ECON.GOLD_PER_XP);
}

// --- §3.4 levels: xp_to_next(L) = 80 * L^1.5 ---

export function xpToNext(level: number): number {
  return Math.floor(ECON.LEVEL_COEFF * Math.pow(level, ECON.LEVEL_EXPONENT));
}

/** Total cumulative XP required to *reach* a given level from level 1. */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/**
 * Given total XP and a current level, return the level reached.
 * Levels advance while xp >= cost of the current level's xp_to_next.
 * `xp` is the running total; we consume thresholds cumulatively.
 */
export function levelFromTotalXp(totalXp: number): number {
  let level = 1;
  let consumed = 0;
  // hard ceiling guard to avoid pathological loops
  while (level < 10000) {
    const need = xpToNext(level);
    if (totalXp - consumed < need) break;
    consumed += need;
    level++;
  }
  return level;
}

// --- §5 stats ---

/** cost(nth bought point) = 500 * 1.15^n  (n = bought_points already purchased). */
export function statPointCost(boughtPoints: number): number {
  return Math.floor(
    ECON.STAT_COST_BASE * Math.pow(ECON.STAT_COST_GROWTH, boughtPoints),
  );
}

// --- §8 duels ---

/** power = level + 2*STR + gear_score (gear_score = sum of stat points on equipped items). */
export function duelPower(level: number, str: number, gearScore: number): number {
  return level + ECON.STR_DUEL_POWER * str + gearScore;
}

/** P(A wins) = power_A / (power_A + power_B). */
export function duelWinProbability(powerA: number, powerB: number): number {
  const denom = powerA + powerB;
  return denom <= 0 ? 0.5 : powerA / denom;
}

/** prestige_mult for loser XP & its budget = 1 + 0.10 * prestige (addendum A). */
export function loserXpPrestigeMult(prestige: number): number {
  return 1 + ECON.DUEL_LOSER_XP_PRESTIGE_PER * prestige;
}

/**
 * Uncapped consolation XP for the duel loser (addendum A):
 *   loser_xp = 0.4 * wager * underdog_mult * prestige_mult
 *   underdog_mult = clamp(power_winner / power_loser, 0.5, 2.0)
 *   prestige_mult = 1 + 0.10 * loser_prestige
 */
export function duelLoserXp(
  wager: number,
  powerWinner: number,
  powerLoser: number,
  loserPrestige: number,
): number {
  const ratio = powerLoser > 0 ? powerWinner / powerLoser : 1;
  const underdog = Math.max(ECON.DUEL_UNDERDOG_MIN, Math.min(ECON.DUEL_UNDERDOG_MAX, ratio));
  return Math.round(
    ECON.DUEL_LOSER_XP_COEFF * wager * underdog * loserXpPrestigeMult(loserPrestige),
  );
}

/** Per-UTC-day loser-XP budget = 1000 * prestige_mult (addendum A). */
export function loserXpDailyBudget(prestige: number): number {
  return Math.round(ECON.DUEL_LOSER_XP_BUDGET_BASE * loserXpPrestigeMult(prestige));
}

// --- quests ---

/** governing-stat efficiency: eff = 1 + 0.05 * stat, capped at 3.0 (cap at stat 40). */
export function questEff(stat: number): number {
  return Math.min(ECON.QUEST_EFF_CAP, 1 + ECON.QUEST_EFF_PER_STAT * Math.max(0, stat));
}

/** quest gold/hour = 8 + 0.6 * level. */
export function questGoldRate(level: number): number {
  return ECON.QUEST_GOLD_RATE_BASE + ECON.QUEST_GOLD_RATE_PER_LEVEL * level;
}

/** quest xp/hour = 5 + 0.4 * level. */
export function questXpRate(level: number): number {
  return ECON.QUEST_XP_RATE_BASE + ECON.QUEST_XP_RATE_PER_LEVEL * level;
}

// --- §9 raids (addendum B) ---

/** chat-damage multiplier from STR: 1 + 0.05 * STR (20 STR = 2x, uncapped). */
export function raidStrDamageMult(str: number): number {
  return 1 + ECON.RAID_STR_DMG_PER * Math.max(0, str);
}

/** /raid strike share of max HP: 1.2% + 0.10% * STR, capped at 8% (cap at STR 68). */
export function raidStrikePct(str: number): number {
  return Math.min(
    ECON.RAID_STRIKE_PCT_CAP,
    ECON.RAID_STRIKE_PCT_BASE + ECON.RAID_STRIKE_PCT_PER_STR * Math.max(0, str),
  );
}
