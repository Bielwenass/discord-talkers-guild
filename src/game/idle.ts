// Idle layer (design §4). Pure functions: rate from activity rows + lazy accrual.
import { ECON } from "../config.ts";
import { prestigeMult } from "./formulas.ts";
import { utcDayString } from "../util/time.ts";

/**
 * idle_rate(now) = RATE_PER_MSG * Σ_days msgs(day) * 0.5^(age_days / 3.5)
 * age_days measured in whole UTC days; today's messages have age 0.
 * Returns gold/hour.
 */
export function idleRate(
  rows: { day: string; msgs: number }[],
  nowS: number,
): number {
  const todayMs = Date.parse(utcDayString(nowS) + "T00:00:00Z");
  let sum = 0;
  for (const r of rows) {
    const dayMs = Date.parse(r.day + "T00:00:00Z");
    const ageDays = Math.round((todayMs - dayMs) / 86_400_000);
    if (ageDays < 0 || ageDays > ECON.IDLE_LOOKBACK_DAYS) continue;
    sum += r.msgs * Math.pow(0.5, ageDays / ECON.IDLE_HALF_LIFE_DAYS);
  }
  return ECON.RATE_PER_MSG * sum;
}

/**
 * Lazy accrual (design §4): gold earned since idle_accrued_at, capped at 24h.
 * Pure — returns the integer gold delta and the timestamp to store.
 */
export function accrueIdle(args: {
  rate: number; // gold/hour from idleRate()
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
