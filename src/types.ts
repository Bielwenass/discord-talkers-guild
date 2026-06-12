// Shared row/domain types mirroring the SQLite schema (design §12).
import type { Rarity, Slot, ExpeditionTier, QuestTier, QuestKind, StatKey } from "./config.ts";

export interface UserRow {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  gold: number;
  prestige: number;
  str: number;
  int: number;
  cha: number;
  luk: number;
  stat_points: number;
  bought_points: number;
  msg_count: number;
  char_count: number;
  replies_recv: number;
  reactions_recv: number;
  last_xp_at: number;
  idle_accrued_at: number;
  pity_counter: number;
  loser_xp_today: number;
  last_duel_day: string;
  created_at: number;
}

export interface ActivityRow {
  guild_id: string;
  user_id: string;
  day: string;
  msgs: number;
  xp: number;
}

export interface ItemDefRow {
  item_def_id: number;
  name: string;
  slot: Slot;
  rarity: Rarity;
}

export interface InventoryRow {
  instance_id: number;
  guild_id: string;
  user_id: string;
  item_def_id: number;
  str: number;
  int: number;
  cha: number;
  luk: number;
  equipped: number;
  obtained_at: number;
}

export interface ExpeditionRow {
  guild_id: string;
  user_id: string;
  tier: ExpeditionTier;
  started_at: number;
  ends_at: number;
  rate_snap: number;
}

export interface RaidRow {
  guild_id: string;
  hp_max: number;
  hp_left: number;
  ends_at: number;
}

export interface QuestRow {
  quest_id: number;
  guild_id: string;
  template_id: number;
  tier: QuestTier;
  members: string; // JSON array of user ids
  eff: number;
  started_at: number;
  ends_at: number;
}

export interface QuestTemplateRow {
  template_id: number;
  name: string;
  stat: StatKey;
  kind: QuestKind;
}

export interface ServerQuestRow {
  guild_id: string;
  day: string;
  template_id: number;
  goal: number;
  progress: number;
}

export interface ServerQuestClaimRow {
  guild_id: string;
  day: string;
  user_id: string;
  msgs: number;
  claimed: number;
}

// Parsed guild_config.settings JSON.
export interface GuildSettings {
  channel_weights?: Record<string, number>;
  role_rewards?: Record<string, string>; // level threshold -> role id, e.g. { "5": "<id>" }
  leaderboard_channel_id?: string;
  idle_digest_channel_id?: string; // opt-in daily "claim your idle gold" digest
  raid?: { spawn_channel_id?: string };
}
