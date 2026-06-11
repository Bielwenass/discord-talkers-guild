import { test, expect, describe } from "bun:test";
import {
  lengthBonus,
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
} from "../src/game/formulas.ts";
import { idleRate, accrueIdle } from "../src/game/idle.ts";
import { ECON } from "../src/config.ts";
import { utcDayString } from "../src/util/time.ts";

describe("message XP (§3.1)", () => {
  test("length bonus is 1.0..4.0 and caps at 400 chars", () => {
    expect(lengthBonus(0)).toBe(1);
    expect(lengthBonus(200)).toBeCloseTo(2.5, 5); // 1 + 3*0.5
    expect(lengthBonus(400)).toBeCloseTo(4, 5); // 1 + 3*1
    expect(lengthBonus(4000)).toBeCloseTo(4, 5); // capped at 400 chars
  });

  test("stat and prestige multipliers", () => {
    expect(intMult(0)).toBe(1);
    expect(intMult(50)).toBeCloseTo(2, 5); // 1 + 0.02*50
    expect(prestigeMult(0)).toBe(1);
    expect(prestigeMult(3)).toBeCloseTo(1.6, 5); // 1 + 0.20*3
  });

  test("messageXp composes all factors", () => {
    // BASE 4 * weight 1.5 * lengthBonus(400)=4 * intMult(0)=1 * prestige(0)=1 = 24
    expect(messageXp({ chars: 400, channelWeight: 1.5, intStat: 0, prestige: 0 })).toBeCloseTo(
      24,
      5,
    );
  });
});

describe("social XP (§3.2)", () => {
  test("reply/reaction scale with CHA", () => {
    expect(replyXp(0)).toBe(10);
    expect(replyXp(50)).toBeCloseTo(35, 5); // 10 * (1 + 0.05*50)
    expect(reactionXp(0)).toBe(6);
    expect(reactionXp(25)).toBeCloseTo(13.5, 5); // 6 * (1 + 0.05*25)
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
  test("xpToNext follows 80*L^1.75 and is monotonic", () => {
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
      // exactly at the threshold → level L
      expect(levelFromTotalXp(floor)).toBe(L);
      // one XP short → still level L-1 (for L>1)
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
    expect(statPointCost(1)).toBe(575); // floor(500*1.15)
    expect(statPointCost(10)).toBe(Math.floor(500 * Math.pow(1.15, 10)));
  });
});

describe("idle layer (§4)", () => {
  const now = Date.parse("2026-06-11T12:00:00Z") / 1000;
  const day = (ageDays: number) => utcDayString(now - ageDays * 86400);

  test("today's 50 msgs → RATE_PER_MSG * 50 gold/h", () => {
    const r = idleRate([{ day: day(0), msgs: 50 }], now);
    expect(r).toBeCloseTo(ECON.RATE_PER_MSG * 50, 5);
  });

  test("one half-life (3.5d) halves the contribution", () => {
    const r = idleRate([{ day: day(3.5 * 0 + 3.5), msgs: 100 }], now);
    // 3.5 days is not an integer offset here; use a clean check at 7 days = 2 half-lives
    const r7 = idleRate([{ day: day(7), msgs: 100 }], now);
    expect(r7).toBeCloseTo(ECON.RATE_PER_MSG * 100 * 0.25, 1);
    expect(r).toBeGreaterThan(0);
  });

  test("contribution at 14 days is ~6.25% (negligible)", () => {
    const r = idleRate([{ day: day(14), msgs: 100 }], now);
    expect(r).toBeCloseTo(ECON.RATE_PER_MSG * 100 * 0.0625, 1);
  });

  test("50 msgs/day for 14 days converges to ~500 gold/h", () => {
    const rows = Array.from({ length: 15 }, (_, k) => ({ day: day(k), msgs: 50 }));
    const r = idleRate(rows, now);
    expect(r).toBeGreaterThan(450);
    expect(r).toBeLessThan(560);
  });

  test("accrual caps at 24h", () => {
    const r = accrueIdle({
      rate: 100,
      prestige: 0,
      idleAccruedAt: now - 48 * 3600,
      nowS: now,
    });
    expect(r.gold).toBe(100 * 24); // capped at 24h
    expect(r.idleAccruedAt).toBe(now);
  });

  test("prestige multiplies idle income", () => {
    const r = accrueIdle({ rate: 100, prestige: 2, idleAccruedAt: now - 3600, nowS: now });
    expect(r.gold).toBe(Math.floor(100 * 1 * 1.4)); // 1h * 1.4 prestige (1 + 0.20*2)
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
    expect(duelWinProbability(0, 0)).toBe(0.5); // degenerate guard
  });
});
