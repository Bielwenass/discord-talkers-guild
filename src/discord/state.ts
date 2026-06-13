// In-memory caps, cooldowns, and rate-limit state (design §12 notes — losing these on restart is fine).
import { LruMap } from "../util/lru.ts";
import { ECON } from "../config.ts";

// messageId -> number of replies already credited (cap REPLY_CAP_PER_MSG)
export const replyCounts = new LruMap<string, number>(5000);

// messageId -> set of reactor ids already credited (cap REACT_CAP_PER_MSG, 1/reactor)
export const reactionCredits = new LruMap<string, Set<string>>(5000);

// pairKey -> last duel resolution epoch seconds (DUEL_COOLDOWN_S per pair)
const duelCooldowns = new LruMap<string, number>(2000);

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export function duelOnCooldown(a: string, b: string, nowS: number): number {
  const last = duelCooldowns.get(pairKey(a, b));
  if (last === undefined) return 0;
  const remaining = ECON.DUEL_COOLDOWN_S - (nowS - last);
  return remaining > 0 ? remaining : 0;
}

export function markDuel(a: string, b: string, nowS: number): void {
  duelCooldowns.set(pairKey(a, b), nowS);
}

// --- Token bucket (v1.2.1) ---
// (guild_id, user_id) -> { tokens: number, lastMs: number }; starts full on first message.
interface Bucket { tokens: number; lastMs: number }
const buckets = new LruMap<string, Bucket>(10000);

/**
 * Admit a message to the XP bucket. Returns true if this message is counted
 * (full XP granted), false if the bucket is empty (zero XP, not counted).
 * Token refill: 1 per BUCKET_REFILL_S seconds; burst up to BUCKET_CAP.
 */
export function admitMessage(guildId: string, userId: string, nowMs: number): boolean {
  const key = `${guildId}:${userId}`;
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: ECON.BUCKET_CAP, lastMs: nowMs };
    buckets.set(key, b);
  }

  // refill
  b.tokens = Math.min(
    ECON.BUCKET_CAP,
    b.tokens + (nowMs - b.lastMs) / (ECON.BUCKET_REFILL_S * 1000),
  );
  b.lastMs = nowMs;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}
