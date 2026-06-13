// Idle layer. XP-based, sublinear decay.
import { ECON } from "../config.ts";
import { prestigeMult } from "./formulas.ts";
import { utcDayString } from "../util/time.ts";

/**
 * idle_rate = decayed_xp ^ IDLE_EXPONENT / IDLE_DIVISOR
 * decayed_xp = Σ_days xp(day) × 0.5^(age_days / IDLE_HALF_LIFE_DAYS)
 * Returns rate in gold/hour plus the weighted XP input (for /profile display).
 */
export function idleRate(
  rows: { day: string; xp: number }[],
  nowS: number,
): { rate: number; weightedXp: number } {
  const todayMs = Date.parse(utcDayString(nowS) + "T00:00:00Z");
  let sum = 0;
  for (const r of rows) {
    const dayMs = Date.parse(r.day + "T00:00:00Z");
    const ageDays = Math.round((todayMs - dayMs) / 86_400_000);
    if (ageDays < 0 || ageDays > ECON.IDLE_LOOKBACK_DAYS) continue;
    sum += r.xp * Math.pow(0.5, ageDays / ECON.IDLE_HALF_LIFE_DAYS);
  }
  return {
    rate: Math.pow(sum, ECON.IDLE_EXPONENT) / ECON.IDLE_DIVISOR,
    weightedXp: Math.round(sum),
  };
}

/**
 * Lazy accrual: gold earned since idle_accrued_at, capped at 24h.
 * Pure — returns the integer gold delta and the timestamp to store.
 */
export function accrueIdle(args: {
  rate: number; // gold/hour from idleRate().rate
  prestige: number;
  idleAccruedAt: number;
  nowS: number;
}): { gold: number; idleAccruedAt: number } {
  if (args.idleAccruedAt <= 0) {
    // first-ever check-in: start the clock, grant nothing
    return { gold: 0, idleAccruedAt: args.nowS };
  }
  const elapsedH = (args.nowS - args.idleAccruedAt) / 3600;
  const hours = Math.min(Math.max(elapsedH, 0), ECON.IDLE_OFFLINE_CAP_H);
  const gold = Math.floor(args.rate * hours * prestigeMult(args.prestige));
  return { gold, idleAccruedAt: args.nowS };
}
