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
      loser_xp_today  INTEGER NOT NULL DEFAULT 0,  -- addendum A: daily loser-XP draw-down
      last_duel_day   TEXT    NOT NULL DEFAULT '', -- UTC day the budget was last touched
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
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_item_defs_name ON item_defs(name);`);

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
      guild_id       TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      damage         INTEGER NOT NULL DEFAULT 0,
      last_strike_at INTEGER NOT NULL DEFAULT 0,  -- addendum B.3: /raid strike cooldown
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // --- addendum C: quests ---
  db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      quest_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      template_id INTEGER NOT NULL,
      tier        TEXT NOT NULL CHECK (tier IN ('errand','task','undertaking')),
      members     TEXT NOT NULL,        -- JSON array of user_ids (1-4)
      eff         REAL NOT NULL,        -- snapshotted at start (solo stat or party mean)
      started_at  INTEGER NOT NULL,
      ends_at     INTEGER NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_quests_guild ON quests(guild_id);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS quest_templates (
      template_id INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      stat        TEXT NOT NULL CHECK (stat IN ('str','int','cha','luk')),
      kind        TEXT NOT NULL CHECK (kind IN ('bountiful','swift'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS server_quest (
      guild_id    TEXT NOT NULL,
      day         TEXT NOT NULL,         -- 'YYYY-MM-DD' UTC
      template_id INTEGER NOT NULL,
      goal        INTEGER NOT NULL,
      progress    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS server_quest_claims (
      guild_id TEXT NOT NULL,
      day      TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      msgs     INTEGER NOT NULL DEFAULT 0,   -- counted msgs toward that day's quest
      claimed  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day, user_id)
    );
  `);

  migrateColumns(db);
}

/**
 * Additive column migrations for databases created before a schema change.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so new columns on
 * pre-existing tables are added here. Idempotent: checks table_info first.
 */
function migrateColumns(db: Database): void {
  const add = (table: string, column: string, decl: string): void => {
    const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  };
  add("users", "loser_xp_today", "INTEGER NOT NULL DEFAULT 0");
  add("users", "last_duel_day", "TEXT NOT NULL DEFAULT ''");
  add("raid_damage", "last_strike_at", "INTEGER NOT NULL DEFAULT 0");
}
