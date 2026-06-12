// Central configuration: environment + the economy constants from the design doc.
// Game math lives in src/game/* and reads these constants; nothing here imports discord.js.

// --- Environment (Bun auto-loads .env) ---
export const env = {
  token: process.env.DISCORD_TOKEN ?? "",
  appId: process.env.DISCORD_APP_ID ?? "",
  // When set, slash commands register to this single guild instantly (dev). Otherwise global.
  devGuildId: process.env.DEV_GUILD_ID ?? "",
  dbPath: process.env.DB_PATH ?? "./talkers.db",
  // When DEVMODE is truthy, the privileged /dev command (set gold/xp) is registered.
  // Leave unset in production — it lets admins mint arbitrary balances.
  devMode: ["1", "true", "yes", "on"].includes((process.env.DEVMODE ?? "").toLowerCase()),
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

  // §8 duels (+ addendum A: loser XP)
  DUEL_RAKE: 0.05,
  DUEL_MIN_WAGER: 50, // no upper cap — a player may wager their entire balance
  DUEL_COOLDOWN_S: 120, // 2 min per pair
  // Consolation XP for the loser: 0.4 * wager * underdog_mult * prestige_mult.
  // Gold stays the winner's prize; the winner earns no XP (splitting the rewards
  // removes any XP-efficient win-trading configuration).
  DUEL_LOSER_XP_COEFF: 0.4,
  DUEL_UNDERDOG_MIN: 0.5, // underdog_mult = clamp(power_winner / power_loser, 0.5, 2.0)
  DUEL_UNDERDOG_MAX: 2.0,
  DUEL_LOSER_XP_PRESTIGE_PER: 0.1, // prestige_mult = 1 + 0.10 * prestige (loser's own)
  DUEL_LOSER_XP_BUDGET_BASE: 1000, // per-UTC-day loser-XP budget = 1000 * prestige_mult

  // §9 raids (⚠ addendum B: HP recalibration + STR + strikes)
  // hp = max(2 * weekly_guild_xp, 1500 * active_users). The old 40x formula
  // produced bosses ~20-40x beyond what event-window damage can deliver.
  RAID_HP_XP_MULT: 2,
  RAID_HP_PER_USER: 1500, // per-user floor keeps small/quiet servers' bosses meaningful
  RAID_HP_FLOOR: 1500, // absolute minimum so a boss is never trivial/zero
  RAID_WINDOW_H: 72,
  RAID_STR_DMG_PER: 0.05, // chat_damage = xp_earned * (1 + 0.05 * STR); 20 STR = 2x
  // /raid strike: strike_pct = 1.2% + 0.10% * STR (cap 8% at STR 68), per-max-HP
  RAID_STRIKE_PCT_BASE: 0.012,
  RAID_STRIKE_PCT_PER_STR: 0.001,
  RAID_STRIKE_PCT_CAP: 0.08,
  RAID_STRIKE_COOLDOWN_S: 4 * 3600, // 4h per user, only during an active raid
  RAID_PARTICIPANT_IDLE_H: 12, // gold = 12h of idle_rate (min 200)
  RAID_PARTICIPANT_MIN_GOLD: 200,

  // §10 prestige
  PRESTIGE_BASE_LEVEL: 50, // requirement rises by 5 each prestige
  PRESTIGE_LEVEL_STEP: 5,

  // §C quests (addendum C)
  QUEST_EFF_PER_STAT: 0.025, // eff = 1 + 0.025 * governing_stat, capped at 3.0
  QUEST_EFF_CAP: 3.0,
  QUEST_GOLD_RATE_BASE: 8, // gold/hour = 8 + 0.6 * level
  QUEST_GOLD_RATE_PER_LEVEL: 0.6,
  QUEST_XP_RATE_BASE: 5, // xp/hour = 5 + 0.4 * level
  QUEST_XP_RATE_PER_LEVEL: 0.4,
  QUEST_ITEM_CHANCE: 0.1, // 10% at base weights; bountiful = 10% * eff; LUK = guaranteed
  QUEST_OFFERS_PER_DAY: 3, // 3 offers/day spanning >=2 governing stats; 1 active slot
  QUEST_PARTY_BONUS_PER_MEMBER: 0.1, // reward * (1 + 0.10 * (member_count - 1))
  QUEST_PARTY_MIN: 2,
  QUEST_PARTY_MAX: 4,
  QUEST_PARTY_FILL_MS: 15 * 60 * 1000, // auto-start 15 min after opening (in-memory)
  QUEST_SERVER_GOAL_MULT: 1.2, // goal = 1.2 * trailing 7-day daily avg counted msgs
  QUEST_SERVER_GOAL_MIN: 50,
  QUEST_SERVER_MIN_MSGS: 3, // counted msgs needed to claim the server quest

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
  uncommon: { weight: 0.25, budgetMin: 3, budgetMax: 5, salvage: 60 },
  rare: { weight: 0.1, budgetMin: 5, budgetMax: 8, salvage: 150 },
  epic: { weight: 0.04, budgetMin: 9, budgetMax: 13, salvage: 500 },
  legendary: { weight: 0.01, budgetMin: 14, budgetMax: 20, salvage: 2000 },
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

// §C quests: tier durations + commitment multipliers (addendum C.3)
export type QuestTier = "errand" | "task" | "undertaking";
export const QUEST_TIERS: Record<QuestTier, { hours: number; mult: number }> = {
  errand: { hours: 2, mult: 1.0 },
  task: { hours: 6, mult: 1.1 },
  undertaking: { hours: 12, mult: 1.25 },
};
export const QUEST_TIER_KEYS: QuestTier[] = ["errand", "task", "undertaking"];

export type QuestKind = "bountiful" | "swift";

export type Slot = "weapon" | "armor" | "trinket";
export const SLOTS: Slot[] = ["weapon", "armor", "trinket"];
export type StatKey = "str" | "int" | "cha" | "luk";
export const STAT_KEYS: StatKey[] = ["str", "int", "cha", "luk"];
