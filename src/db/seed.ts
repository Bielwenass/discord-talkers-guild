// Static item catalog (design §6). Names per slot × rarity; the stat spread is
// rolled at drop time, not stored here. Idempotent: only seeds an empty table.
import type { Database } from "bun:sqlite";
import type { Rarity, Slot } from "../config.ts";

type Def = { name: string; slot: Slot; rarity: Rarity };

const NAMES: Record<Slot, Record<Rarity, string[]>> = {
  weapon: {
    common: ["Rusty Dagger", "Worn Shortsword", "Cracked Club"],
    uncommon: ["Iron Mace", "Hunter's Bow", "Balanced Sabre"],
    rare: ["Silver Rapier", "Runed Warhammer", "Frostbite Axe"],
    epic: ["Stormcaller Glaive", "Voidpiercer Lance"],
    legendary: ["Dawnbreaker, Sword of Kings", "Eclipse Reaver"],
  },
  armor: {
    common: ["Tattered Tunic", "Padded Vest", "Leather Jerkin"],
    uncommon: ["Chainmail Shirt", "Scaled Hauberk", "Reinforced Brigandine"],
    rare: ["Mithril Plate", "Wardens Cuirass", "Dragonhide Mantle"],
    epic: ["Aegis of the Bastion", "Phoenix Carapace"],
    legendary: ["Bulwark of the Eternal Watch", "Titanforged Aegis"],
  },
  trinket: {
    common: ["Chipped Bead", "Copper Ring", "Frayed Charm"],
    uncommon: ["Jade Amulet", "Owl Feather Talisman", "Lucky Coin"],
    rare: ["Sapphire Sigil", "Band of Insight", "Emberglass Locket"],
    epic: ["Oracle's Eye", "Heart of the Tempest"],
    legendary: ["Crown of Boundless Fortune", "Worldroot Pendant"],
  },
};

export function seedItemDefs(db: Database): void {
  const count = (db.query(`SELECT COUNT(*) AS n FROM item_defs`).get() as { n: number }).n;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO item_defs (name, slot, rarity) VALUES (?, ?, ?)`,
  );
  const defs: Def[] = [];
  for (const slot of Object.keys(NAMES) as Slot[]) {
    for (const rarity of Object.keys(NAMES[slot]) as Rarity[]) {
      for (const name of NAMES[slot][rarity]) defs.push({ name, slot, rarity });
    }
  }
  db.transaction(() => {
    for (const d of defs) insert.run(d.name, d.slot, d.rarity);
  })();
}
