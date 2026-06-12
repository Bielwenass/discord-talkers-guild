// User persistence + the grantXp hub (design §3, §4). This is the only module
// that both touches the DB and orchestrates the core economy. Discord-specific
// side effects (role grants, free-pull rolls, raid damage) are returned to the
// caller rather than performed here, keeping this importable from tests.
import { getDb } from "../db/db.ts";
import { ECON, type StatKey } from "../config.ts";
import type { UserRow } from "../types.ts";
import { goldFromXp, levelFromTotalXp } from "./formulas.ts";
import { idleRate, accrueIdle } from "./idle.ts";
import { utcDayString } from "../util/time.ts";

const ROLE_THRESHOLDS = [5, 10, 25, 50];

/** Whether a user row already exists (no side effects). Used to greet first-timers. */
export function userExists(guildId: string, userId: string): boolean {
  return (
    getDb()
      .query(`SELECT 1 FROM users WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) != null
  );
}

export function getOrCreateUser(guildId: string, userId: string): UserRow {
  const db = getDb();
  const existing = db
    .query(`SELECT * FROM users WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as UserRow | null;
  if (existing) return existing;
  const now = Math.floor(Date.now() / 1000);
  db.run(
    `INSERT INTO users (guild_id, user_id, created_at, idle_accrued_at) VALUES (?, ?, ?, ?)`,
    [guildId, userId, now, now],
  );
  return db
    .query(`SELECT * FROM users WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as UserRow;
}

/** Sum of stat points on the user's equipped gear. */
export function equippedStats(
  guildId: string,
  userId: string,
): { str: number; int: number; cha: number; luk: number } {
  const row = getDb()
    .query(
      `SELECT COALESCE(SUM(str),0) AS str, COALESCE(SUM(int),0) AS int,
              COALESCE(SUM(cha),0) AS cha, COALESCE(SUM(luk),0) AS luk
       FROM inventory WHERE guild_id = ? AND user_id = ? AND equipped = 1`,
    )
    .get(guildId, userId) as { str: number; int: number; cha: number; luk: number };
  return row;
}

/** Effective stat = allocated + equipped gear. */
export function effectiveStats(
  user: UserRow,
): { str: number; int: number; cha: number; luk: number } {
  const gear = equippedStats(user.guild_id, user.user_id);
  return {
    str: user.str + gear.str,
    int: user.int + gear.int,
    cha: user.cha + gear.cha,
    luk: user.luk + gear.luk,
  };
}

export interface GrantResult {
  xp: number;
  gold: number;
  fromLevel: number;
  toLevel: number;
  leveledUp: boolean;
  statPointsGained: number;
  freePulls: number; // free standard pulls earned (every 5 levels)
  roleThresholds: number[]; // L5/10/25/50 newly crossed
}

/**
 * Apply a pre-computed XP grant: writes XP + gold (=xp/4), recomputes level,
 * awards stat points / free-pull credits / role thresholds, and books the XP
 * into activity_daily for the given UTC day. `countedMsg` bumps activity msgs.
 */
export function grantXp(
  guildId: string,
  userId: string,
  xp: number,
  opts: { nowS: number; countedMsg?: boolean; setLastXpAt?: boolean } = { nowS: 0 },
): GrantResult {
  const db = getDb();
  const nowS = opts.nowS || Math.floor(Date.now() / 1000);
  const user = getOrCreateUser(guildId, userId);
  const xpInt = Math.max(0, Math.floor(xp));
  const gold = goldFromXp(xpInt);

  const fromLevel = user.level;
  const toLevel = levelFromTotalXp(user.xp + xpInt);
  const statPointsGained = Math.max(0, toLevel - fromLevel);

  let freePulls = 0;
  const roleThresholds: number[] = [];
  for (let l = fromLevel + 1; l <= toLevel; l++) {
    if (l % ECON.FREE_PULL_EVERY_LEVELS === 0) freePulls++;
    if (ROLE_THRESHOLDS.includes(l)) roleThresholds.push(l);
  }

  db.run(
    `UPDATE users
       SET xp = xp + ?, gold = gold + ?, level = ?, stat_points = stat_points + ?
           ${opts.setLastXpAt ? ", last_xp_at = ?" : ""}
     WHERE guild_id = ? AND user_id = ?`,
    opts.setLastXpAt
      ? [xpInt, gold, toLevel, statPointsGained, nowS, guildId, userId]
      : [xpInt, gold, toLevel, statPointsGained, guildId, userId],
  );

  const day = utcDayString(nowS);
  db.run(
    `INSERT INTO activity_daily (guild_id, user_id, day, msgs, xp)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id, day)
       DO UPDATE SET msgs = msgs + excluded.msgs, xp = xp + excluded.xp`,
    [guildId, userId, day, opts.countedMsg ? 1 : 0, xpInt],
  );

  return {
    xp: xpInt,
    gold,
    fromLevel,
    toLevel,
    leveledUp: toLevel > fromLevel,
    statPointsGained,
    freePulls,
    roleThresholds,
  };
}

/** Always-on message stat bump (msg_count/char_count), independent of XP cooldown. */
export function bumpMessageStats(guildId: string, userId: string, chars: number): void {
  getDb().run(
    `UPDATE users SET msg_count = msg_count + 1, char_count = char_count + ?
     WHERE guild_id = ? AND user_id = ?`,
    [chars, guildId, userId],
  );
}

export function bumpRepliesRecv(guildId: string, userId: string): void {
  getDb().run(
    `UPDATE users SET replies_recv = replies_recv + 1 WHERE guild_id = ? AND user_id = ?`,
    [guildId, userId],
  );
}

export function bumpReactionsRecv(guildId: string, userId: string): void {
  getDb().run(
    `UPDATE users SET reactions_recv = reactions_recv + 1 WHERE guild_id = ? AND user_id = ?`,
    [guildId, userId],
  );
}

/** Activity rows within the idle look-back window, for idle-rate computation. */
export function recentActivity(
  guildId: string,
  userId: string,
  nowS: number,
): { day: string; msgs: number }[] {
  const cutoff = utcDayString(nowS - ECON.IDLE_LOOKBACK_DAYS * 86400);
  return getDb()
    .query(
      `SELECT day, msgs FROM activity_daily
       WHERE guild_id = ? AND user_id = ? AND day >= ? ORDER BY day`,
    )
    .all(guildId, userId, cutoff) as { day: string; msgs: number }[];
}

export function currentIdleRate(guildId: string, userId: string, nowS: number): number {
  return idleRate(recentActivity(guildId, userId, nowS), nowS);
}

/** User ids with activity inside the idle look-back window (for the digest). */
export function recentlyActiveUserIds(guildId: string, nowS: number): string[] {
  const cutoff = utcDayString(nowS - ECON.IDLE_LOOKBACK_DAYS * 86400);
  const rows = getDb()
    .query(
      `SELECT DISTINCT user_id FROM activity_daily WHERE guild_id = ? AND day >= ?`,
    )
    .all(guildId, cutoff) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

/** Read-only preview of a user's idle rate and uncollected gold — does NOT write. */
export function previewIdle(
  guildId: string,
  userId: string,
  nowS: number,
): { rate: number; pending: number } {
  const user = getOrCreateUser(guildId, userId);
  const rate = currentIdleRate(guildId, userId, nowS);
  const { gold } = accrueIdle({
    rate,
    prestige: user.prestige,
    idleAccruedAt: user.idle_accrued_at,
    nowS,
  });
  return { rate, pending: gold };
}

export interface ClaimResult {
  gold: number; // gold added this claim
  rate: number; // current gold/hour
  newBalance: number;
}

/**
 * Lazy idle accrual (design §4). Auto-run before any spend and by /claim.
 * Writes the gold delta + new idle_accrued_at.
 */
export function claimIdle(guildId: string, userId: string, nowS: number): ClaimResult {
  const db = getDb();
  const user = getOrCreateUser(guildId, userId);
  const rate = currentIdleRate(guildId, userId, nowS);
  const { gold, idleAccruedAt } = accrueIdle({
    rate,
    prestige: user.prestige,
    idleAccruedAt: user.idle_accrued_at,
    nowS,
  });
  db.run(
    `UPDATE users SET gold = gold + ?, idle_accrued_at = ? WHERE guild_id = ? AND user_id = ?`,
    [gold, idleAccruedAt, guildId, userId],
  );
  return { gold, rate, newBalance: user.gold + gold };
}

/** Spend gold atomically; returns false if insufficient. Auto-claims idle first. */
export function spendGold(guildId: string, userId: string, amount: number, nowS: number): boolean {
  claimIdle(guildId, userId, nowS);
  const db = getDb();
  const user = getOrCreateUser(guildId, userId);
  if (user.gold < amount) return false;
  db.run(`UPDATE users SET gold = gold - ? WHERE guild_id = ? AND user_id = ?`, [
    amount,
    guildId,
    userId,
  ]);
  return true;
}

export function addGold(guildId: string, userId: string, amount: number): void {
  getDb().run(`UPDATE users SET gold = gold + ? WHERE guild_id = ? AND user_id = ?`, [
    amount,
    guildId,
    userId,
  ]);
}

/**
 * Dev-only: set a user's gold to an absolute amount (clamped at 0).
 * Used by the /dev command, which is gated behind the DEVMODE env flag.
 */
export function setGold(guildId: string, userId: string, amount: number): void {
  getOrCreateUser(guildId, userId);
  getDb().run(`UPDATE users SET gold = ? WHERE guild_id = ? AND user_id = ?`, [
    Math.max(0, Math.floor(amount)),
    guildId,
    userId,
  ]);
}

/**
 * Dev-only: set a user's total XP absolutely and recompute their level to match.
 * Leaves already-spent stat points alone; grants the difference in unspent points
 * if the new level is higher than the current one.
 */
export function setXp(guildId: string, userId: string, totalXp: number): { level: number } {
  const db = getDb();
  const user = getOrCreateUser(guildId, userId);
  const xp = Math.max(0, Math.floor(totalXp));
  const level = levelFromTotalXp(xp);
  const gained = Math.max(0, level - user.level);
  db.run(
    `UPDATE users SET xp = ?, level = ?, stat_points = stat_points + ? WHERE guild_id = ? AND user_id = ?`,
    [xp, level, gained, guildId, userId],
  );
  return { level };
}

export function allocateStat(guildId: string, userId: string, stat: StatKey): boolean {
  const db = getDb();
  const user = getOrCreateUser(guildId, userId);
  if (user.stat_points < 1) return false;
  db.run(
    `UPDATE users SET ${stat} = ${stat} + 1, stat_points = stat_points - 1
     WHERE guild_id = ? AND user_id = ?`,
    [guildId, userId],
  );
  return true;
}
