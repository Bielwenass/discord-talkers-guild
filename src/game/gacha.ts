// Gacha & gear rolling (design §6). The weight/pity/spread logic is pure and
// unit-tested; persistence (reading item_defs, writing inventory, pity counter)
// lives in the gacha command/handler which calls these helpers.
import {
  ECON,
  RARITY_TABLE,
  RARITIES,
  STAT_KEYS,
  type Rarity,
  type StatKey,
} from "../config.ts";

const EPIC_PLUS: Rarity[] = ["epic", "legendary"];

/**
 * Rarity weights after LUK shift (design §6): each LUK point moves 0.5% of
 * weight out of Common into the higher tiers, proportionally to their base
 * weights, capped at 20% total shifted.
 */
export function rarityWeights(luk: number): Record<Rarity, number> {
  const base: Record<Rarity, number> = {
    common: RARITY_TABLE.common.weight,
    uncommon: RARITY_TABLE.uncommon.weight,
    rare: RARITY_TABLE.rare.weight,
    epic: RARITY_TABLE.epic.weight,
    legendary: RARITY_TABLE.legendary.weight,
  };
  const shift = Math.min(luk * ECON.LUK_WEIGHT_SHIFT, ECON.LUK_MAX_SHIFT);
  if (shift <= 0) return base;

  // distribute the shifted weight across the non-common tiers in proportion to base weight
  const higher = RARITIES.filter((r) => r !== "common");
  const higherTotal = higher.reduce((s, r) => s + base[r], 0);
  const out = { ...base };
  out.common = base.common - shift;
  for (const r of higher) {
    out[r] = base[r] + shift * (base[r] / higherTotal);
  }
  return out;
}

/** Sample a rarity from weights using rng in [0,1). */
export function sampleRarity(
  weights: Record<Rarity, number>,
  rng: number = Math.random(),
): Rarity {
  const total = RARITIES.reduce((s, r) => s + weights[r], 0);
  let x = rng * total;
  for (const r of RARITIES) {
    x -= weights[r];
    if (x < 0) return r;
  }
  return "common";
}

/**
 * Roll one rarity honoring pity (design §6): pity counter is the number of
 * pulls since the last Epic+. If this pull would be the PITY_THRESHOLD-th
 * without an Epic+, force an Epic+. Returns the rarity and the next pity value.
 */
export function rollRarityWithPity(args: {
  luk: number;
  pityCounter: number;
  rng?: () => number;
}): { rarity: Rarity; pityCounter: number } {
  const rng = args.rng ?? Math.random;
  const pulledNumber = args.pityCounter + 1; // this pull's index since last Epic+
  let rarity: Rarity;
  if (pulledNumber >= ECON.PITY_THRESHOLD) {
    // force Epic+: epic vs legendary in their base ratio
    const epicW = RARITY_TABLE.epic.weight;
    const legW = RARITY_TABLE.legendary.weight;
    rarity = rng() < legW / (epicW + legW) ? "legendary" : "epic";
  } else {
    rarity = sampleRarity(rarityWeights(args.luk), rng());
  }
  const isEpicPlus = EPIC_PLUS.includes(rarity);
  return { rarity, pityCounter: isEpicPlus ? 0 : pulledNumber };
}

/**
 * Roll a stat spread for an item: pick a total budget within the rarity's range
 * and distribute points randomly across the four stats.
 */
export function rollStatSpread(
  rarity: Rarity,
  rng: () => number = Math.random,
): Record<StatKey, number> {
  const { budgetMin, budgetMax } = RARITY_TABLE[rarity];
  const budget = budgetMin + Math.floor(rng() * (budgetMax - budgetMin + 1));
  const spread: Record<StatKey, number> = { str: 0, int: 0, cha: 0, luk: 0 };
  for (let i = 0; i < budget; i++) {
    const k = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)] as StatKey;
    spread[k]++;
  }
  return spread;
}

export function gearScore(spread: { str: number; int: number; cha: number; luk: number }): number {
  return spread.str + spread.int + spread.cha + spread.luk;
}

/** Pull price (design §6): single 250, ten-pull 2250 (10% discount). */
export function pullCost(tenPull: boolean): number {
  return tenPull ? ECON.PULL_COST_TEN : ECON.PULL_COST_SINGLE;
}

export function salvageValue(rarity: Rarity): number {
  return RARITY_TABLE[rarity].salvage;
}
