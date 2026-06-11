// Expeditions (design §7). Lazy idle timers: start snapshots idle_rate, and the
// result resolves on the next command after ends_at. One active per user.
import { getDb } from "../db/db.ts";
import { EXPEDITIONS, EXPEDITION_GOLD_VARIANCE, type ExpeditionTier } from "../config.ts";
import type { ExpeditionRow } from "../types.ts";
import { currentIdleRate, effectiveStats, getOrCreateUser, addGold } from "./users.ts";
import { rollPull, type PullOutcome } from "./inventory.ts";

export function activeExpedition(guildId: string, userId: string): ExpeditionRow | null {
  return getDb()
    .query(`SELECT * FROM expeditions WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as ExpeditionRow | null;
}

export function startExpedition(
  guildId: string,
  userId: string,
  tier: ExpeditionTier,
  nowS: number,
): { ok: true; endsAt: number; rateSnap: number } | { ok: false; reason: string } {
  if (activeExpedition(guildId, userId)) {
    return { ok: false, reason: "You already have an active expedition." };
  }
  const rate = Math.round(currentIdleRate(guildId, userId, nowS));
  const cfg = EXPEDITIONS[tier];
  const endsAt = nowS + cfg.hours * 3600;
  getDb().run(
    `INSERT INTO expeditions (guild_id, user_id, tier, started_at, ends_at, rate_snap)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, userId, tier, nowS, endsAt, rate],
  );
  return { ok: true, endsAt, rateSnap: rate };
}

export interface ExpeditionResult {
  tier: ExpeditionTier;
  gold: number;
  items: PullOutcome[];
}

/**
 * Resolve the expedition if it has ended (design §7): gold = goldMult * rate_snap
 * with ±15% variance, plus item rolls at the tier's LUK bonus. Returns null if no
 * expedition is due. Deletes the row on resolve.
 */
export function resolveExpeditionIfDue(
  guildId: string,
  userId: string,
  nowS: number,
): ExpeditionResult | null {
  const exp = activeExpedition(guildId, userId);
  if (!exp || exp.ends_at > nowS) return null;

  const cfg = EXPEDITIONS[exp.tier];
  const variance = 1 + (Math.random() * 2 - 1) * EXPEDITION_GOLD_VARIANCE;
  const gold = Math.max(0, Math.round(cfg.goldMult * exp.rate_snap * variance));

  const user = getOrCreateUser(guildId, userId);
  const luk = effectiveStats(user).luk;
  const items: PullOutcome[] = [];

  const db = getDb();
  db.transaction(() => {
    addGold(guildId, userId, gold);
    for (let i = 0; i < cfg.rolls; i++) {
      items.push(rollPull(guildId, userId, luk, cfg.lukBonus, nowS));
    }
    db.run(`DELETE FROM expeditions WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);
  })();

  return { tier: exp.tier, gold, items };
}
