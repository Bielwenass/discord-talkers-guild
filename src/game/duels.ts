// Duels (design §8). Resolved in one interaction flow; no table needed. Gold
// deltas are written atomically. Per-pair cooldown is enforced in the handler.
import { getDb } from "../db/db.ts";
import { ECON } from "../config.ts";
import { duelPower, duelWinProbability } from "./formulas.ts";
import { getOrCreateUser, claimIdle } from "./users.ts";
import { gearScoreFor } from "./inventory.ts";

export function powerOf(guildId: string, userId: string): number {
  const u = getOrCreateUser(guildId, userId);
  // STR term uses allocated STR; gear contributes via gear_score (design §8).
  return duelPower(u.level, u.str, gearScoreFor(u));
}

export function validateWager(
  guildId: string,
  aId: string,
  bId: string,
  wager: number,
  nowS: number,
): { ok: true } | { ok: false; reason: string } {
  if (wager < ECON.DUEL_MIN_WAGER) {
    return { ok: false, reason: `Minimum wager is ${ECON.DUEL_MIN_WAGER}g.` };
  }
  // Realize idle income for both first, so the balances we check are current.
  // There is no upper cap: a player may wager up to their entire balance.
  claimIdle(guildId, aId, nowS);
  claimIdle(guildId, bId, nowS);
  const short = [aId, bId]
    .map((id) => ({ id, gold: getOrCreateUser(guildId, id).gold }))
    .filter((p) => p.gold < wager)
    .map((p) => `<@${p.id}> has **${p.gold}g** (needs ${wager}g)`);
  if (short.length > 0) {
    return { ok: false, reason: `Can't cover the **${wager}g** wager — ${short.join(" and ")}.` };
  }
  return { ok: true };
}

export interface DuelResult {
  winnerId: string;
  loserId: string;
  pot: number;
  rake: number;
  payout: number; // gold paid to the winner from the pot
  winnerProbability: number;
}

/**
 * Resolve a duel: both wager equal gold, winner takes pot minus 5% rake.
 * Auto-claims idle, re-validates affordability, writes deltas in a transaction.
 */
export function resolveDuel(
  guildId: string,
  challengerId: string,
  targetId: string,
  wager: number,
  nowS: number,
  rng: () => number = Math.random,
): { ok: true; result: DuelResult } | { ok: false; reason: string } {
  const valid = validateWager(guildId, challengerId, targetId, wager, nowS);
  if (!valid.ok) return valid;

  const db = getDb();
  const challenger = getOrCreateUser(guildId, challengerId);
  const target = getOrCreateUser(guildId, targetId);
  if (challenger.gold < wager || target.gold < wager) {
    return { ok: false, reason: "Someone no longer has enough gold." };
  }

  const pA = powerOf(guildId, challengerId);
  const pB = powerOf(guildId, targetId);
  const pWin = duelWinProbability(pA, pB);
  const challengerWins = rng() < pWin;

  const winnerId = challengerWins ? challengerId : targetId;
  const loserId = challengerWins ? targetId : challengerId;
  const pot = wager * 2;
  const payout = Math.round(pot * (1 - ECON.DUEL_RAKE));
  const rake = pot - payout;

  db.transaction(() => {
    // both stake the wager, winner receives the payout
    db.run(`UPDATE users SET gold = gold - ? WHERE guild_id = ? AND user_id = ?`, [
      wager,
      guildId,
      challengerId,
    ]);
    db.run(`UPDATE users SET gold = gold - ? WHERE guild_id = ? AND user_id = ?`, [
      wager,
      guildId,
      targetId,
    ]);
    db.run(`UPDATE users SET gold = gold + ? WHERE guild_id = ? AND user_id = ?`, [
      payout,
      guildId,
      winnerId,
    ]);
  })();

  return {
    ok: true,
    result: { winnerId, loserId, pot, rake, payout, winnerProbability: pWin },
  };
}
