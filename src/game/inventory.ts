// Inventory persistence + gacha-to-DB glue (design §6). Wraps the pure gacha
// rollers, picks a random item_def for the rolled rarity/slot, and writes an
// owned instance. Also handles equip (one per slot) and salvage.
import { getDb } from "../db/db.ts";
import { SLOTS, type Rarity, type Slot, type StatKey } from "../config.ts";
import type { InventoryRow, ItemDefRow, UserRow } from "../types.ts";
import { rollRarityWithPity, rollStatSpread, salvageValue } from "./gacha.ts";
import { getOrCreateUser } from "./users.ts";

export interface PullOutcome {
  instanceId: number;
  def: ItemDefRow;
  rarity: Rarity;
  spread: { str: number; int: number; cha: number; luk: number };
}

function randomDef(rarity: Rarity, slot: Slot): ItemDefRow | null {
  return getDb()
    .query(
      `SELECT * FROM item_defs WHERE rarity = ? AND slot = ? ORDER BY RANDOM() LIMIT 1`,
    )
    .get(rarity, slot) as ItemDefRow | null;
}

/**
 * Roll a single pull for a user, persisting the item and updating pity.
 * `lukBonus` adds LUK-equivalent for expeditions (design §7).
 */
export function rollPull(
  guildId: string,
  userId: string,
  effectiveLuk: number,
  lukBonus = 0,
  nowS: number = Math.floor(Date.now() / 1000),
): PullOutcome {
  const db = getDb();
  const user = getOrCreateUser(guildId, userId);

  const { rarity, pityCounter } = rollRarityWithPity({
    luk: effectiveLuk + lukBonus,
    pityCounter: user.pity_counter,
  });

  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)] as Slot;
  const def = randomDef(rarity, slot);
  if (!def) throw new Error(`No item_def for ${rarity}/${slot} — seed missing?`);

  const spread = rollStatSpread(rarity, def.primary);
  db.run(
    `INSERT INTO inventory (guild_id, user_id, item_def_id, str, int, cha, luk, equipped, obtained_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [guildId, userId, def.item_def_id, spread.str, spread.int, spread.cha, spread.luk, nowS],
  );
  const instanceId = Number(
    (db.query(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id,
  );
  db.run(`UPDATE users SET pity_counter = ? WHERE guild_id = ? AND user_id = ?`, [
    pityCounter,
    guildId,
    userId,
  ]);

  return { instanceId, def, rarity, spread };
}

export interface InventoryItem extends InventoryRow {
  name: string;
  slot: Slot;
  rarity: Rarity;
  primary: StatKey;
}

export function listInventory(guildId: string, userId: string): InventoryItem[] {
  return getDb()
    .query(
      `SELECT inv.*, d.name AS name, d.slot AS slot, d.rarity AS rarity, d."primary" AS "primary"
       FROM inventory inv JOIN item_defs d ON d.item_def_id = inv.item_def_id
       WHERE inv.guild_id = ? AND inv.user_id = ?
       ORDER BY inv.equipped DESC, d.rarity DESC, inv.obtained_at DESC`,
    )
    .all(guildId, userId) as InventoryItem[];
}

export function getItem(
  guildId: string,
  userId: string,
  instanceId: number,
): InventoryItem | null {
  return getDb()
    .query(
      `SELECT inv.*, d.name AS name, d.slot AS slot, d.rarity AS rarity, d."primary" AS "primary"
       FROM inventory inv JOIN item_defs d ON d.item_def_id = inv.item_def_id
       WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.instance_id = ?`,
    )
    .get(guildId, userId, instanceId) as InventoryItem | null;
}

/** Equip an item, unequipping any other item in the same slot (one per slot). */
export function equip(guildId: string, userId: string, instanceId: number): InventoryItem | null {
  const db = getDb();
  const item = getItem(guildId, userId, instanceId);
  if (!item) return null;
  db.transaction(() => {
    db.run(
      `UPDATE inventory SET equipped = 0
       WHERE guild_id = ? AND user_id = ? AND equipped = 1
         AND item_def_id IN (SELECT item_def_id FROM item_defs WHERE slot = ?)`,
      [guildId, userId, item.slot],
    );
    db.run(`UPDATE inventory SET equipped = 1 WHERE instance_id = ?`, [instanceId]);
  })();
  return item;
}

/** Salvage an item into gold. Returns gold gained, or null if not found. */
export function salvage(guildId: string, userId: string, instanceId: number): number | null {
  const db = getDb();
  const item = getItem(guildId, userId, instanceId);
  if (!item) return null;
  const gold = salvageValue(item.rarity);
  db.transaction(() => {
    db.run(`DELETE FROM inventory WHERE instance_id = ?`, [instanceId]);
    db.run(`UPDATE users SET gold = gold + ? WHERE guild_id = ? AND user_id = ?`, [
      gold,
      guildId,
      userId,
    ]);
  })();
  return gold;
}

export function equippedBySlot(
  guildId: string,
  userId: string,
): Partial<Record<Slot, InventoryItem>> {
  const rows = getDb()
    .query(
      `SELECT inv.*, d.name AS name, d.slot AS slot, d.rarity AS rarity, d."primary" AS "primary"
       FROM inventory inv JOIN item_defs d ON d.item_def_id = inv.item_def_id
       WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.equipped = 1`,
    )
    .all(guildId, userId) as InventoryItem[];
  const out: Partial<Record<Slot, InventoryItem>> = {};
  for (const r of rows) out[r.slot] = r;
  return out;
}

/** Total stat points across equipped gear — the duel gear_score */
export function gearScoreFor(user: UserRow): number {
  const row = getDb()
    .query(
      `SELECT COALESCE(SUM(str+int+cha+luk),0) AS s
       FROM inventory WHERE guild_id = ? AND user_id = ? AND equipped = 1`,
    )
    .get(user.guild_id, user.user_id) as { s: number };
  return row.s;
}
