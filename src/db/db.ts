// Single bun:sqlite connection (WAL, single writer). All event/command handlers
// run their writes inside db.transaction(...) for atomicity.
import { Database } from "bun:sqlite";
import { env } from "../config.ts";
import { initSchema } from "./schema.ts";
import { seedItemDefs, seedQuestTemplates } from "./seed.ts";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const db = new Database(env.dbPath, { create: true });
  initSchema(db);
  seedItemDefs(db);
  seedQuestTemplates(db);
  _db = db;
  return db;
}

// Convenience: run a function inside a transaction. bun:sqlite's db.transaction
// returns a callable; we wrap to keep call sites terse.
export function tx<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
