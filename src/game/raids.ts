// Boss raids (design §9). Self-scaling HP, XP doubles as damage during the
// window, lazy resolution on kill or timeout.
import { getDb } from "../db/db.ts";
import { ECON } from "../config.ts";
import type { RaidRow } from "../types.ts";
import { utcDayString } from "../util/time.ts";
import { currentIdleRate, effectiveStats, getOrCreateUser, addGold } from "./users.ts";
import { rollPull, type PullOutcome } from "./inventory.ts";
import { EXPEDITIONS } from "../config.ts";

export function activeRaid(guildId: string): RaidRow | null {
  return getDb()
    .query(`SELECT * FROM raids WHERE guild_id = ?`)
    .get(guildId) as RaidRow | null;
}

/** Guild-wide XP earned over the previous 7 days (drives raid HP). */
export function guildXpLast7Days(guildId: string, nowS: number): number {
  const cutoff = utcDayString(nowS - 7 * 86400);
  const row = getDb()
    .query(
      `SELECT COALESCE(SUM(xp),0) AS xp FROM activity_daily WHERE guild_id = ? AND day >= ?`,
    )
    .get(guildId, cutoff) as { xp: number };
  return row.xp;
}

export function spawnRaid(
  guildId: string,
  nowS: number,
): { ok: true; hp: number; endsAt: number } | { ok: false; reason: string } {
  if (activeRaid(guildId)) return { ok: false, reason: "A raid is already active." };
  const guildXp = guildXpLast7Days(guildId, nowS);
  const hp = Math.max(1000, Math.round(ECON.RAID_HP_PER_XP * guildXp));
  const endsAt = nowS + ECON.RAID_WINDOW_H * 3600;
  const db = getDb();
  db.transaction(() => {
    db.run(`DELETE FROM raid_damage WHERE guild_id = ?`, [guildId]);
    db.run(`INSERT INTO raids (guild_id, hp_max, hp_left, ends_at) VALUES (?, ?, ?, ?)`, [
      guildId,
      hp,
      hp,
      endsAt,
    ]);
  })();
  return { ok: true, hp, endsAt };
}

/**
 * Apply XP as boss damage during an active window (design §9). Returns the
 * damage dealt and whether the boss just hit 0 HP (so the caller can resolve).
 */
export function applyRaidDamage(
  guildId: string,
  userId: string,
  xp: number,
  nowS: number,
): { dealt: number; justKilled: boolean } {
  const raid = activeRaid(guildId);
  if (!raid || raid.ends_at <= nowS || raid.hp_left <= 0 || xp <= 0) {
    return { dealt: 0, justKilled: false };
  }
  const dealt = Math.min(xp, raid.hp_left);
  const db = getDb();
  db.run(`UPDATE raids SET hp_left = hp_left - ? WHERE guild_id = ?`, [dealt, guildId]);
  db.run(
    `INSERT INTO raid_damage (guild_id, user_id, damage) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET damage = damage + excluded.damage`,
    [guildId, userId, dealt],
  );
  return { dealt, justKilled: raid.hp_left - dealt <= 0 };
}

export interface RaidReward {
  userId: string;
  damage: number;
  gold: number;
  items: PullOutcome[];
}

export interface RaidResolution {
  killed: boolean; // true = boss defeated, false = timed out
  hpMax: number;
  rewards: RaidReward[];
}

/**
 * Resolve the raid if the boss is dead or the window has expired. On kill:
 * each participant gets gold = 12h idle (min 200) + 1 roll; top-3 damage get an
 * extra roll at Delve odds. On timeout: half gold, no item rolls. Returns null
 * if no resolution is due.
 */
export function resolveRaidIfDone(guildId: string, nowS: number): RaidResolution | null {
  const raid = activeRaid(guildId);
  if (!raid) return null;
  const killed = raid.hp_left <= 0;
  const expired = raid.ends_at <= nowS;
  if (!killed && !expired) return null;

  const damageRows = getDb()
    .query(
      `SELECT user_id, damage FROM raid_damage WHERE guild_id = ? AND damage > 0 ORDER BY damage DESC`,
    )
    .all(guildId) as { user_id: string; damage: number }[];

  const rewards: RaidReward[] = [];
  const db = getDb();
  db.transaction(() => {
    damageRows.forEach((row, idx) => {
      const user = getOrCreateUser(guildId, row.user_id);
      const rate = currentIdleRate(guildId, row.user_id, nowS);
      let gold = Math.max(
        ECON.RAID_PARTICIPANT_MIN_GOLD,
        Math.round(rate * ECON.RAID_PARTICIPANT_IDLE_H),
      );
      const items: PullOutcome[] = [];
      if (killed) {
        const luk = effectiveStats(user).luk;
        items.push(rollPull(guildId, row.user_id, luk, 0, nowS));
        if (idx < 3) items.push(rollPull(guildId, row.user_id, luk, EXPEDITIONS.delve.lukBonus, nowS));
      } else {
        gold = Math.round(gold / 2); // timeout: half rewards, no items
      }
      addGold(guildId, row.user_id, gold);
      rewards.push({ userId: row.user_id, damage: row.damage, gold, items });
    });
    db.run(`DELETE FROM raids WHERE guild_id = ?`, [guildId]);
    db.run(`DELETE FROM raid_damage WHERE guild_id = ?`, [guildId]);
  })();

  return { killed, hpMax: raid.hp_max, rewards };
}
