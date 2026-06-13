import { test, expect, describe } from "bun:test";
import {
  intMult,
  prestigeMult,
  messageXp,
  replyXp,
  reactionXp,
  goldFromXp,
  xpToNext,
  cumulativeXpForLevel,
  levelFromTotalXp,
  statPointCost,
  duelPower,
  duelWinProbability,
  duelLoserXp,
  loserXpDailyBudget,
  questEff,
  questGoldRate,
  questXpRate,
  raidStrDamageMult,
  raidStrikePct,
} from "../src/game/formulas.ts";
import { idleRate, accrueIdle } from "../src/game/idle.ts";
import { ECON } from "../src/config.ts";
import { utcDayString } from "../src/util/time.ts";

describe("message XP (§3.1 / v1.2.1)", () => {
  test("stat and prestige multipliers", () => {
    expect(intMult(0)).toBe(1);
    expect(intMult(50)).toBeCloseTo(2, 5); // 1 + 0.02*50
    expect(prestigeMult(0)).toBe(1);
    expect(prestigeMult(3)).toBeCloseTo(1.6, 5); // 1 + 0.20*3
  });

  test("messageXp: BASE_XP=3 * channelWeight * intMult * prestigeMult (no length term)", () => {
    // BASE 3 * weight 1.5 * intMult(0)=1 * prestige(0)=1 = 4.5
    expect(messageXp({ channelWeight: 1.5, intStat: 0, prestige: 0 })).toBeCloseTo(4.5, 5);
    // INT 50 doubles the stat mult: 3 * 1.0 * 2.0 * 1.0 = 6
    expect(messageXp({ channelWeight: 1.0, intStat: 50, prestige: 0 })).toBeCloseTo(6, 5);
  });
});

describe("social XP (§3.2 / v1.2.1)", () => {
  test("reply XP base is 8, reaction XP base is 12", () => {
    expect(replyXp(0)).toBe(8);
    expect(replyXp(50)).toBeCloseTo(28, 5); // 8 * (1 + 0.05*50)
    expect(reactionXp(0)).toBe(12);
    expect(reactionXp(25)).toBeCloseTo(27, 5); // 12 * (1 + 0.05*25)
  });
});

describe("gold (§3.3)", () => {
  test("gold is floor(xp/4)", () => {
    expect(goldFromXp(10)).toBe(2);
    expect(goldFromXp(100)).toBe(25);
    expect(goldFromXp(3)).toBe(0);
  });
});

describe("levels (§3.4)", () => {
  test("xpToNext follows 80*L^1.5 and is monotonic", () => {
    expect(xpToNext(1)).toBe(80);
    let prev = 0;
    for (let l = 1; l < 60; l++) {
      const n = xpToNext(l);
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
  });

  test("levelFromTotalXp is the exact inverse of cumulativeXpForLevel", () => {
    for (const L of [1, 2, 5, 10, 25, 50]) {
      const floor = cumulativeXpForLevel(L);
      expect(levelFromTotalXp(floor)).toBe(L);
      if (L > 1) expect(levelFromTotalXp(floor - 1)).toBe(L - 1);
    }
  });

  test("starts at level 1 with 0 xp", () => {
    expect(levelFromTotalXp(0)).toBe(1);
  });
});

describe("stat cost (§5)", () => {
  test("geometric 500 * 1.15^n", () => {
    expect(statPointCost(0)).toBe(500);
    expect(statPointCost(1)).toBe(575);
    expect(statPointCost(10)).toBe(Math.floor(500 * Math.pow(1.15, 10)));
  });
});

describe("idle layer (§4 / v1.2.1 — XP-based, sublinear)", () => {
  const now = Date.parse("2026-06-11T12:00:00Z") / 1000;
  const day = (ageDays: number) => utcDayString(now - ageDays * 86400);

  // Reference values from spec §D (±5% tolerance):
  // 100 XP/day sustained → steady ~27 g/h; 350 XP/day → ~72 g/h; 500 XP/day → ~96 g/h
  // Single-day acceptance:
  //   100 XP day-0 → ~10 g/h; 350 XP day-0 → ~27 g/h; 500 XP day-0 → ~35 g/h

  test("today 100 XP → ~10 g/h (spec ±5%)", () => {
    const { rate } = idleRate([{ day: day(0), xp: 100 }], now);
    expect(rate).toBeGreaterThan(9.5);
    expect(rate).toBeLessThan(10.5);
  });

  test("today 500 XP → ~35 g/h (spec ±5%)", () => {
    const { rate } = idleRate([{ day: day(0), xp: 500 }], now);
    expect(rate).toBeGreaterThan(33.25);
    expect(rate).toBeLessThan(36.75);
  });

  test("half-life 2d: 100 XP 2 days ago → ~50% weight", () => {
    const { weightedXp } = idleRate([{ day: day(2), xp: 100 }], now);
    expect(weightedXp).toBeCloseTo(50, 0);
  });

  test("weightedXp is returned for /profile display", () => {
    const { rate, weightedXp } = idleRate([{ day: day(0), xp: 200 }], now);
    expect(weightedXp).toBe(200); // age 0 → no decay
    expect(rate).toBeGreaterThan(0);
  });

  test("sustained 350 XP/day (~3.4× daily decayed) → ~72 g/h (spec ±5%)", () => {
    // Geometric series steady state ≈ 3.4× daily XP
    const rows = Array.from({ length: 10 }, (_, k) => ({ day: day(k), xp: 350 }));
    const { rate } = idleRate(rows, now);
    expect(rate).toBeGreaterThan(68.4);
    expect(rate).toBeLessThan(75.6);
  });

  test("accrual caps at 24h", () => {
    const r = accrueIdle({ rate: 100, prestige: 0, idleAccruedAt: now - 48 * 3600, nowS: now });
    expect(r.gold).toBe(100 * 24);
    expect(r.idleAccruedAt).toBe(now);
  });

  test("prestige multiplies idle income", () => {
    const r = accrueIdle({ rate: 100, prestige: 2, idleAccruedAt: now - 3600, nowS: now });
    expect(r.gold).toBe(Math.floor(100 * 1 * 1.4));
  });

  test("first check-in grants nothing, just starts the clock", () => {
    const r = accrueIdle({ rate: 999, prestige: 0, idleAccruedAt: 0, nowS: now });
    expect(r.gold).toBe(0);
    expect(r.idleAccruedAt).toBe(now);
  });
});

describe("duels (§8)", () => {
  test("power = level + 2*STR + gear_score", () => {
    expect(duelPower(10, 5, 8)).toBe(28);
  });

  test("win probability is power share", () => {
    expect(duelWinProbability(28, 28)).toBeCloseTo(0.5, 5);
    expect(duelWinProbability(30, 10)).toBeCloseTo(0.75, 5);
    expect(duelWinProbability(0, 0)).toBe(0.5);
  });

  test("loser XP = 0.4 * wager * underdog * prestige", () => {
    expect(duelLoserXp(50, 1, 1, 0)).toBe(20);
    expect(duelLoserXp(500, 1, 1, 0)).toBe(200);
    expect(duelLoserXp(1000, 2, 1, 0)).toBe(800);
  });

  test("underdog multiplier clamps to [0.5, 2.0]", () => {
    expect(duelLoserXp(100, 10, 1, 0)).toBe(80);
    expect(duelLoserXp(100, 1, 10, 0)).toBe(20);
  });

  test("loser-XP prestige bonus and daily budget", () => {
    expect(duelLoserXp(50, 1, 1, 5)).toBe(30);
    expect(loserXpDailyBudget(0)).toBe(1000);
    expect(loserXpDailyBudget(5)).toBe(1500);
  });
});

describe("quests (addendum C / v1.2.1)", () => {
  test("eff = 1 + 0.05*stat, cap 3.0 at stat 40", () => {
    expect(questEff(0)).toBeCloseTo(1, 9);
    expect(questEff(20)).toBeCloseTo(2, 9);  // 1 + 0.05*20
    expect(questEff(40)).toBeCloseTo(3, 9);  // cap
    expect(questEff(1000)).toBeCloseTo(3, 9);
  });

  test("per-hour rates scale with level", () => {
    expect(questGoldRate(20)).toBeCloseTo(20, 9); // 8 + 0.6*20
    expect(questXpRate(20)).toBeCloseTo(13, 9);  // 5 + 0.4*20
  });
});

describe("raids (addendum B)", () => {
  test("STR multiplies chat damage: 1 + 0.05*STR", () => {
    expect(raidStrDamageMult(0)).toBeCloseTo(1, 9);
    expect(raidStrDamageMult(20)).toBeCloseTo(2, 9);
    expect(raidStrDamageMult(40)).toBeCloseTo(3, 9);
  });

  test("strike pct = 1.2% + 0.10%*STR, capped at 8%", () => {
    expect(raidStrikePct(0)).toBeCloseTo(0.012, 9);
    expect(raidStrikePct(5)).toBeCloseTo(0.017, 9);
    expect(raidStrikePct(20)).toBeCloseTo(0.032, 9);
    expect(raidStrikePct(68)).toBeCloseTo(0.08, 9);
    expect(raidStrikePct(1000)).toBeCloseTo(0.08, 9);
  });
});
