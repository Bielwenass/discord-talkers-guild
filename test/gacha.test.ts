import { test, expect, describe } from "bun:test";
import {
  rarityWeights,
  sampleRarity,
  rollRarityWithPity,
  rollStatSpread,
  gearScore,
  pullCost,
  salvageValue,
} from "../src/game/gacha.ts";
import { RARITY_TABLE, RARITIES, type Rarity } from "../src/config.ts";

describe("rarity weights (§6)", () => {
  test("no LUK → base table", () => {
    const w = rarityWeights(0);
    for (const r of RARITIES) expect(w[r]).toBeCloseTo(RARITY_TABLE[r].weight, 6);
  });

  test("LUK shifts weight out of common, capped at 20%", () => {
    const w = rarityWeights(1000); // far past the cap
    const shifted = RARITY_TABLE.common.weight - w.common;
    expect(shifted).toBeCloseTo(0.2, 6); // capped at 20%
    // legendary tops out around ~3.4% per the design note
    expect(w.legendary).toBeGreaterThan(RARITY_TABLE.legendary.weight);
    expect(w.legendary).toBeLessThan(0.04);
    // weights still sum to ~1
    const total = RARITIES.reduce((s, r) => s + w[r], 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("sampleRarity distribution", () => {
  test("matches base weights over many samples", () => {
    const counts: Record<Rarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };
    const N = 200_000;
    const w = rarityWeights(0);
    for (let i = 0; i < N; i++) counts[sampleRarity(w)]++;
    // common ~60%, allow tolerance
    expect(counts.common / N).toBeGreaterThan(0.57);
    expect(counts.common / N).toBeLessThan(0.63);
    expect(counts.legendary / N).toBeGreaterThan(0.006);
    expect(counts.legendary / N).toBeLessThan(0.015);
  });
});

describe("pity (§6)", () => {
  test("pull #50 without Epic+ is forced Epic+", () => {
    // pityCounter 49 means 49 pulls since last Epic+; this is the 50th
    const r = rollRarityWithPity({ luk: 0, pityCounter: 49, rng: () => 0.999999 });
    expect(["epic", "legendary"]).toContain(r.rarity);
    expect(r.pityCounter).toBe(0); // reset on Epic+
  });

  test("Epic+ drop resets the counter", () => {
    // rng 0 → first bucket (common) normally; force epic via low budget path:
    // use a luk/rng combo that yields legendary (rng near 1 lands in last tiny bucket)
    const r = rollRarityWithPity({ luk: 0, pityCounter: 10, rng: () => 0.999999 });
    expect(r.rarity).toBe("legendary");
    expect(r.pityCounter).toBe(0);
  });

  test("non-Epic+ increments the counter", () => {
    const r = rollRarityWithPity({ luk: 0, pityCounter: 10, rng: () => 0 });
    expect(r.rarity).toBe("common");
    expect(r.pityCounter).toBe(11);
  });
});

describe("stat spread", () => {
  test("total points land within the rarity budget", () => {
    for (const rarity of RARITIES) {
      for (let i = 0; i < 50; i++) {
        const spread = rollStatSpread(rarity, "str");
        const total = gearScore(spread);
        expect(total).toBeGreaterThanOrEqual(RARITY_TABLE[rarity].budgetMin);
        expect(total).toBeLessThanOrEqual(RARITY_TABLE[rarity].budgetMax);
      }
    }
  });
});

describe("prices & salvage (§6)", () => {
  test("pull costs", () => {
    expect(pullCost(false)).toBe(250);
    expect(pullCost(true)).toBe(2250);
  });
  test("salvage values by rarity", () => {
    expect(salvageValue("common")).toBe(15);
    expect(salvageValue("legendary")).toBe(2000);
  });
});
