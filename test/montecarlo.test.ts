// Monte Carlo simulation of the gacha (design §6). A "pull" is one
// rollRarityWithPity call; a "ten-pull" is ten sequential rolls that share the
// same persistent pity counter. These tests sample large campaigns to verify the
// realized rarity distribution, the LUK weight-shift thresholds, and how often the
// pity rule actually fires.
//
// A seeded PRNG (mulberry32) drives every campaign so the runs are fully
// deterministic — large-N Monte Carlo with a fixed seed gives stable numbers and
// never flakes in CI.
import { test, expect, describe } from "bun:test";
import { rollRarityWithPity, rarityWeights } from "../src/game/gacha.ts";
import { ECON, RARITIES, type Rarity } from "../src/config.ts";

const EPIC_PLUS: Rarity[] = ["epic", "legendary"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Campaign {
  counts: Record<Rarity, number>;
  total: number;
  pityActivations: number; // pulls the pity rule forced to Epic+
  epicPlus: number; // Epic or Legendary, however obtained
}

/** Run `n` pulls for one user at a fixed LUK, threading the pity counter. */
function runCampaign(luk: number, n: number, seed: number): Campaign {
  const rng = mulberry32(seed);
  const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  let pity = 0;
  let pityActivations = 0;
  let epicPlus = 0;
  for (let i = 0; i < n; i++) {
    const forced = pity + 1 >= ECON.PITY_THRESHOLD; // this pull will be pity-forced
    const res = rollRarityWithPity({ luk, pityCounter: pity, rng });
    counts[res.rarity]++;
    if (EPIC_PLUS.includes(res.rarity)) epicPlus++;
    if (forced) pityActivations++;
    pity = res.pityCounter;
  }
  return { counts, total: n, pityActivations, epicPlus };
}

const share = (c: Campaign, r: Rarity) => c.counts[r] / c.total;
const epicPlusShare = (c: Campaign) => c.epicPlus / c.total;
const pityRate = (c: Campaign) => c.pityActivations / c.total;

describe("single-pull Monte Carlo (LUK 0)", () => {
  const N = 300_000;
  const c = runCampaign(0, N, 0xc0ffee);

  test("rarity distribution tracks the base weights", () => {
    // Realized Common sits a hair under the 0.60 base because the pity rule
    // occasionally upgrades a would-be lower roll to Epic+.
    expect(share(c, "common")).toBeGreaterThan(0.58);
    expect(share(c, "common")).toBeLessThan(0.61);
    expect(share(c, "uncommon")).toBeCloseTo(0.25, 1);
    expect(share(c, "rare")).toBeCloseTo(0.1, 1);
    // Epic+ is the 0.05 base plus the small pity contribution.
    expect(epicPlusShare(c)).toBeGreaterThan(0.05);
    expect(epicPlusShare(c)).toBeLessThan(0.06);
    console.log(
      `[single LUK=0] common ${(share(c, "common") * 100).toFixed(1)}%  ` +
        `uncommon ${(share(c, "uncommon") * 100).toFixed(1)}%  ` +
        `rare ${(share(c, "rare") * 100).toFixed(1)}%  ` +
        `epic ${(share(c, "epic") * 100).toFixed(2)}%  ` +
        `legendary ${(share(c, "legendary") * 100).toFixed(2)}%`,
    );
  });
});

describe("ten-pull Monte Carlo (LUK 0)", () => {
  const BATCHES = 30_000; // 300k pulls grouped into tens
  const PER = 10;
  const rng = mulberry32(0x7e2);
  const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  let pity = 0;
  let epicPlus = 0;
  let batchesWithEpicPlus = 0;
  for (let b = 0; b < BATCHES; b++) {
    let batchEpicPlus = 0;
    for (let i = 0; i < PER; i++) {
      const res = rollRarityWithPity({ luk: 0, pityCounter: pity, rng });
      counts[res.rarity]++;
      if (EPIC_PLUS.includes(res.rarity)) {
        epicPlus++;
        batchEpicPlus++;
      }
      pity = res.pityCounter; // pity persists across pulls AND across batches
    }
    if (batchEpicPlus > 0) batchesWithEpicPlus++;
  }
  const total = BATCHES * PER;

  test("aggregate distribution matches single pulls (ten-pull is not better odds)", () => {
    // Pity threads identically whether you pull one-at-a-time or in tens, so the
    // aggregate Epic+ rate should equal the single-pull campaign within tolerance.
    expect(counts.common / total).toBeGreaterThan(0.58);
    expect(counts.common / total).toBeLessThan(0.61);
    expect(epicPlus / total).toBeGreaterThan(0.05);
    expect(epicPlus / total).toBeLessThan(0.06);
  });

  test("most ten-pulls yield at least one Epic+ less than half the time", () => {
    // With ~5% Epic+ per pull, P(>=1 in 10) = 1 - 0.95^10 ≈ 0.40.
    const frac = batchesWithEpicPlus / BATCHES;
    expect(frac).toBeGreaterThan(0.35);
    expect(frac).toBeLessThan(0.45);
    console.log(`[ten-pull LUK=0] ${(frac * 100).toFixed(1)}% of ten-pulls contained an Epic+`);
  });
});

describe("LUK thresholds shift the distribution", () => {
  const N = 120_000;
  // shift = LUK * 0.005, capped at 0.20 — so LUK 40 already hits the cap.
  const luks = [0, 10, 20, 40];
  const campaigns = luks.map((luk, i) => ({ luk, c: runCampaign(luk, N, 0xa11ce + i) }));

  test("higher LUK monotonically lowers Common and raises Epic+", () => {
    for (let i = 1; i < campaigns.length; i++) {
      const prev = campaigns[i - 1]!;
      const cur = campaigns[i]!;
      expect(share(cur.c, "common")).toBeLessThan(share(prev.c, "common"));
      expect(epicPlusShare(cur.c)).toBeGreaterThan(epicPlusShare(prev.c));
    }
    for (const { luk, c } of campaigns) {
      console.log(
        `[LUK=${luk}] common ${(share(c, "common") * 100).toFixed(1)}%  ` +
          `epic+ ${(epicPlusShare(c) * 100).toFixed(2)}%`,
      );
    }
  });

  test("realized Common tracks the analytic 0.60 - shift", () => {
    const expected: Record<number, number> = { 0: 0.6, 10: 0.55, 20: 0.5, 40: 0.4 };
    for (const { luk, c } of campaigns) {
      // a touch below analytic because pity upgrades a sliver of pulls
      expect(share(c, "common")).toBeGreaterThan(expected[luk]! - 0.03);
      expect(share(c, "common")).toBeLessThan(expected[luk]! + 0.01);
    }
  });

  test("the LUK shift is capped at 20% (LUK 40 == LUK 1000)", () => {
    // Pure-function check: weights are identical once the cap is reached.
    const at40 = rarityWeights(40);
    const at1000 = rarityWeights(1000);
    for (const r of RARITIES) expect(at1000[r]).toBeCloseTo(at40[r], 9);
    expect(at40.common).toBeCloseTo(0.4, 9); // 0.60 base - 0.20 cap
  });
});

describe("pity activation frequency", () => {
  const N = 400_000;
  const low = runCampaign(0, N, 0x1234);
  const high = runCampaign(40, N, 0x5678);

  test("at LUK 0 pity fires on roughly 0.3%-0.6% of pulls", () => {
    const rate = pityRate(low);
    // Analytic: P(49 dry pulls) = 0.95^49 ≈ 0.081 per cycle; mean cycle ≈ 18.5
    // pulls → ~0.44% of pulls are pity-forced (about 1 in ~225).
    expect(rate).toBeGreaterThan(0.003);
    expect(rate).toBeLessThan(0.006);
    console.log(
      `[pity LUK=0] ${low.pityActivations}/${N} pulls forced by pity = ` +
        `${(rate * 100).toFixed(3)}% (about 1 in ${Math.round(1 / rate)})`,
    );
  });

  test("higher LUK makes pity fire less often (Epic+ comes naturally sooner)", () => {
    const lowRate = pityRate(low);
    const highRate = pityRate(high);
    expect(highRate).toBeLessThan(lowRate);
    console.log(
      `[pity LUK=40] ${high.pityActivations}/${N} pulls forced by pity = ` +
        `${(highRate * 100).toFixed(3)}% (about 1 in ${Math.round(1 / highRate)})`,
    );
  });

  test("pity never lets a dry streak exceed the threshold", () => {
    // Walk a single long stream and assert the gap between Epic+ pulls never
    // exceeds PITY_THRESHOLD.
    const rng = mulberry32(0x9001);
    let pity = 0;
    let sinceEpicPlus = 0;
    let maxGap = 0;
    for (let i = 0; i < 200_000; i++) {
      const res = rollRarityWithPity({ luk: 0, pityCounter: pity, rng });
      sinceEpicPlus++;
      if (EPIC_PLUS.includes(res.rarity)) {
        maxGap = Math.max(maxGap, sinceEpicPlus);
        sinceEpicPlus = 0;
      }
      pity = res.pityCounter;
    }
    expect(maxGap).toBeLessThanOrEqual(ECON.PITY_THRESHOLD);
  });
});
