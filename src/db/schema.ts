// SQLite schema from design §12. Idempotent — safe to run on every startup.
import type { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.run(`PRAGMA journal_mode = WAL;`);
  db.run(`PRAGMA foreign_keys = ON;`);

  db.run(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id  TEXT PRIMARY KEY,
      settings  TEXT NOT NULL DEFAULT '{}'   -- JSON: channel_weights, role_rewards, raid, leaderboard_channel_id
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      guild_id        TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      xp              INTEGER NOT NULL DEFAULT 0,
      level           INTEGER NOT NULL DEFAULT 1,
      gold            INTEGER NOT NULL DEFAULT 0,
      prestige        INTEGER NOT NULL DEFAULT 0,
      str             INTEGER NOT NULL DEFAULT 0,
      int             INTEGER NOT NULL DEFAULT 0,
      cha             INTEGER NOT NULL DEFAULT 0,
      luk             INTEGER NOT NULL DEFAULT 0,
      stat_points     INTEGER NOT NULL DEFAULT 0,
      bought_points   INTEGER NOT NULL DEFAULT 0,
      msg_count       INTEGER NOT NULL DEFAULT 0,
      char_count      INTEGER NOT NULL DEFAULT 0,
      replies_recv    INTEGER NOT NULL DEFAULT 0,
      reactions_recv  INTEGER NOT NULL DEFAULT 0,
      last_xp_at      INTEGER NOT NULL DEFAULT 0,
      idle_accrued_at INTEGER NOT NULL DEFAULT 0,
      pity_counter    INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_daily (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      day       TEXT NOT NULL,                 -- 'YYYY-MM-DD' UTC
      msgs      INTEGER NOT NULL DEFAULT 0,     -- counted (non-cooldown) msgs only
      xp        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, day)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS item_defs (
      item_def_id INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      slot        TEXT NOT NULL CHECK (slot IN ('weapon','armor','trinket')),
      rarity      TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      instance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      item_def_id INTEGER NOT NULL REFERENCES item_defs(item_def_id),
      str         INTEGER NOT NULL DEFAULT 0,
      int         INTEGER NOT NULL DEFAULT 0,
      cha         INTEGER NOT NULL DEFAULT 0,
      luk         INTEGER NOT NULL DEFAULT 0,
      equipped    INTEGER NOT NULL DEFAULT 0,   -- 0/1; one per slot enforced in app code
      obtained_at INTEGER NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_inv_owner ON inventory(guild_id, user_id);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS expeditions (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      tier       TEXT NOT NULL CHECK (tier IN ('scout','delve','vigil')),
      started_at INTEGER NOT NULL,
      ends_at    INTEGER NOT NULL,
      rate_snap  INTEGER NOT NULL,              -- idle_rate at start, gold/h
      PRIMARY KEY (guild_id, user_id)           -- one active per user; delete on resolve
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS raids (
      guild_id   TEXT PRIMARY KEY,
      hp_max     INTEGER NOT NULL,
      hp_left    INTEGER NOT NULL,
      ends_at    INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS raid_damage (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      damage   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
}
