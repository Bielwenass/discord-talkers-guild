// Time helpers. Days are UTC ('YYYY-MM-DD') to match activity_daily keys and the
// daily leaderboard boundary (design §12).

export function utcDayString(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 10);
}

export function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/** ms from `nowMs` until the next 00:00:00 UTC. */
export function msUntilNextUtcMidnight(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return next - nowMs;
}

/** The UTC day string for the day that just ended, relative to `nowS`. */
export function previousUtcDay(nowS: number): string {
  return utcDayString(nowS - 86400);
}
