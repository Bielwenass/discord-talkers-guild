// In-memory caps & cooldowns (design §12 notes — losing these on restart is fine).
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
