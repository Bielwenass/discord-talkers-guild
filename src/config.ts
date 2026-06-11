// Central configuration: environment + the economy constants from the design doc.
// Game math lives in src/game/* and reads these constants; nothing here imports discord.js.

// --- Environment (Bun auto-loads .env) ---
export const env = {
  token: process.env.DISCORD_TOKEN ?? "",
  appId: process.env.DISCORD_APP_ID ?? "",
  // When set, slash commands register to this single guild instantly (dev). Otherwise global.
  devGuildId: process.env.DEV_GUILD_ID ?? "",
  dbPath: process.env.DB_PATH ?? "./talkers.db",
};

export function assertEnv(): void {
  const missing: string[] = [];
  if (!env.token) missing.push("DISCORD_TOKEN");
  if (!env.appId) missing.push("DISCORD_APP_ID");
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Set them in .env (see README).`,
    );
  }
}

// --- Economy constants (design §3–§10) ---
export const ECON = {
  // §3.1 message XP
  BASE_XP: 4,
  DEFAULT_CHANNEL_WEIGHT: 1.0,
  LENGTH_CHAR_CAP: 400, // length_bonus = 1 + 3 * min(chars, 400)/400  → caps at 4x
  LENGTH_MAX_BONUS: 3,
  MIN_CHARS: 3, // a message must be >= 3 non-whitespace chars to count at all
  XP_COOLDOWN_S: 10, // 10s per user per guild; in-cooldown msgs still bump counts, grant 0 XP
  INT_XP_PER_POINT: 0.02, // stat_mult = 1 + 0.02*INT
  PRESTIGE_PER_LEVEL: 0.2, // prestige_mult = 1 + 0.20*prestige

  // §3.2 social XP (credited to recipient)
  REPLY_XP_BASE: 10,
  REPLY_CHA_PER_POINT: 0.05,
  REPLY_CAP_PER_MSG: 10,
  REACT_XP_BASE: 6,
  REACT_CHA_PER_POINT: 0.05,
  REACT_CAP_PER_MSG: 5, // 1 per reactor

  // §3.3 gold
  GOLD_PER_XP: 1 / 4, // gold = xp_earned / 4 on every grant

  // §3.4 levels: xp_to_next(L) = 80 * L^1.75
  LEVEL_COEFF: 80,
  LEVEL_EXP: 1.75,
  STAT_POINTS_PER_LEVEL: 1,
  FREE_PULL_EVERY_LEVELS: 5,

  // §4 idle layer
  RATE_PER_MSG: 2, // gold/hour per (decayed) msg-equivalent
  IDLE_HALF_LIFE_DAYS: 3.5,
  IDLE_LOOKBACK_DAYS: 14, // beyond this the decay term is <6% and ignored
  IDLE_OFFLINE_CAP_H: 24, // accrual capped at 24h to force a daily check-in

  // §5 stats: cost(nth bought point) = 500 * 1.15^n
  STAT_COST_BASE: 500,
  STAT_COST_GROWTH: 1.15,
  STR_DUEL_POWER: 2, // +2 duel power per STR
  LUK_WEIGHT_SHIFT: 0.005, // 0.5% of weight from Common upward per LUK point
  LUK_MAX_SHIFT: 0.2, // capped at 20% total

  // §6 gacha
  PULL_COST_SINGLE: 250,
  PULL_COST_TEN: 2250, // 10% discount
  PITY_THRESHOLD: 50, // pull #50 without Epic+ guarantees Epic+

  // §8 duels
  DUEL_RAKE: 0.05,
  DUEL_MIN_WAGER: 50, // no upper cap — a player may wager their entire balance
  DUEL_COOLDOWN_S: 120, // 2 min per pair

  // §9 raids
  RAID_HP_PER_XP: 40, // hp = 40 * guild XP over previous 7 days
  RAID_WINDOW_H: 72,
  RAID_PARTICIPANT_IDLE_H: 12, // gold = 12h of idle_rate (min 200)
  RAID_PARTICIPANT_MIN_GOLD: 200,

  // §10 prestige
  PRESTIGE_BASE_LEVEL: 50, // requirement rises by 5 each prestige
  PRESTIGE_LEVEL_STEP: 5,

  // §12 maintenance
  ACTIVITY_PRUNE_DAYS: 30,
} as const;

// §6 base rarity table: weight + stat-budget range (total stat points on the item)
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export const RARITY_TABLE: Record<
  Rarity,
  { weight: number; budgetMin: number; budgetMax: number; salvage: number }
> = {
  common: { weight: 0.6, budgetMin: 1, budgetMax: 2, salvage: 15 },
  uncommon: { weight: 0.25, budgetMin: 2, budgetMax: 4, salvage: 60 },
  rare: { weight: 0.1, budgetMin: 4, budgetMax: 7, salvage: 150 },
  epic: { weight: 0.04, budgetMin: 7, budgetMax: 11, salvage: 500 },
  legendary: { weight: 0.01, budgetMin: 12, budgetMax: 18, salvage: 2000 },
};

// §7 expeditions
export type ExpeditionTier = "scout" | "delve" | "vigil";
export const EXPEDITIONS: Record<
  ExpeditionTier,
  { hours: number; goldMult: number; rolls: number; lukBonus: number }
> = {
  scout: { hours: 4, goldMult: 3, rolls: 1, lukBonus: 0 },
  delve: { hours: 8, goldMult: 6, rolls: 1, lukBonus: 5 },
  vigil: { hours: 24, goldMult: 16, rolls: 2, lukBonus: 10 },
};
export const EXPEDITION_GOLD_VARIANCE = 0.15; // ±15%

export type Slot = "weapon" | "armor" | "trinket";
export const SLOTS: Slot[] = ["weapon", "armor", "trinket"];
export type StatKey = "str" | "int" | "cha" | "luk";
export const STAT_KEYS: StatKey[] = ["str", "int", "cha", "luk"];
