// Static item catalog (design §6 / v1.2.1). Primary stat is fixed per item.
// Idempotent: upserts so existing rows get their primary stat updated.
import type { Database } from "bun:sqlite";
import type { Rarity, Slot, StatKey, QuestKind } from "../config.ts";

export type ItemSeed = { name: string; primary: StatKey };
export const NAMES: Record<Slot, Record<Rarity, ItemSeed[]>> = {
  weapon: {
    // 5/8 STR
    common: [
      { name: "Worn Shortsword", primary: "str" },
      { name: "Cracked Club", primary: "str" },
      { name: "Splintered Spear", primary: "str" },
      { name: "Notched Hatchet", primary: "str" },
      { name: "Threshing Flail", primary: "str" },
      { name: "Rusty Dagger", primary: "luk" },
      { name: "Bent Pitchfork", primary: "cha" }, // the rabble-rouser's standard
      { name: "Cobbler's Hammer", primary: "int" },
    ],
    // 5/8 STR
    uncommon: [
      { name: "Iron Mace", primary: "str" },
      { name: "Footman's Halberd", primary: "str" },
      { name: "Riveted Morningstar", primary: "str" },
      { name: "Watchman's Billhook", primary: "str" },
      { name: "Bronze Falchion", primary: "str" },
      { name: "Hunter's Bow", primary: "luk" },
      { name: "Balanced Sabre", primary: "cha" }, // the duelist's flair
      { name: "Oaken Quarterstaff", primary: "int" }, // the wandering scholar's arm
    ],
    // 4/6 STR
    rare: [
      { name: "Frostbite Axe", primary: "str" },
      { name: "Pilgrim's Bane", primary: "str" },
      { name: "Runed Warhammer", primary: "str" },
      { name: "Serpentine Estoc", primary: "str" },
      { name: "Silver Rapier", primary: "cha" },
      { name: "Vesper Blade", primary: "int" },
    ],
    // 2/4 STR
    epic: [
      { name: "Voidpiercer Lance", primary: "str" },
      { name: "Hollowfang Scythe", primary: "str" },
      { name: "Stormcaller Glaive", primary: "int" },
      { name: "Litany of Edges", primary: "cha" },
    ],
    // 2/4 STR
    legendary: [
      { name: "Dawnbreaker, Sword of Kings", primary: "str" },
      { name: "Ruin of Crowns", primary: "str" },
      { name: "Last Psalm, the Silencing Blade", primary: "int" },
      { name: "Eclipse Reaver", primary: "luk" },
    ],
  },

  // "garb" — everyday wear and vestments; battle pieces are the STR exceptions
  armor: {
    common: [
      { name: "Tattered Tunic", primary: "luk" },
      { name: "Moth-Eaten Cloak", primary: "luk" },
      { name: "Homespun Robe", primary: "int" },
      { name: "Friar's Habit", primary: "int" },
      { name: "Drover's Coat", primary: "cha" },
      { name: "Salt-Stained Surcoat", primary: "cha" },
      { name: "Almsgiver's Shawl", primary: "cha" },
      { name: "Patchwork Gambeson", primary: "str" }, // battle piece
    ],
    uncommon: [
      { name: "Scholar's Gown", primary: "int" },
      { name: "Cartographer's Greatcoat", primary: "int" },
      { name: "Studded Vestments", primary: "int" },
      { name: "Chorister's Cassock", primary: "cha" },
      { name: "Velvet Doublet", primary: "cha" },
      { name: "Bordered Tabard", primary: "cha" },
      { name: "Wayfarer's Mantle", primary: "luk" },
      { name: "Chainmail Shirt", primary: "str" }, // battle piece
    ],
    rare: [
      { name: "Magister's Robe", primary: "int" },
      { name: "Cloak of the Quiet Hours", primary: "int" },
      { name: "Cathedral Mail", primary: "cha" },
      { name: "Courtier's Brocade", primary: "cha" },
      { name: "Gambler's Longcoat", primary: "luk" },
      { name: "Dragonhide Mantle", primary: "str" }, // battle piece
    ],
    epic: [
      { name: "Nightfall Pallium", primary: "int" },
      { name: "Raiment of the Unburned Saint", primary: "cha" },
      { name: "Phoenix-Feather Mantle", primary: "luk" },
      { name: "Aegis of the Bastion", primary: "str" }, // battle piece
    ],
    legendary: [
      { name: "Shroud of the First Vigil", primary: "int" },
      { name: "Mantle of the Undying Choir", primary: "cha" },
      { name: "Beggar-King's Regalia", primary: "luk" },
      { name: "Bulwark of the Eternal Watch", primary: "str" }, // THE battle outfit
    ],
  },

  // the wildcard slot — broad spread, slight LUK lean
  trinket: {
    common: [
      { name: "Chipped Bead", primary: "luk" },
      { name: "Frayed Charm", primary: "luk" },
      { name: "Bent Horseshoe Nail", primary: "luk" },
      { name: "Copper Ring", primary: "cha" },
      { name: "Wax-Sealed Locket", primary: "cha" },
      { name: "Tin Pilgrim Badge", primary: "cha" },
      { name: "Knotted Prayer Cord", primary: "int" },
      { name: "River Pebble", primary: "str" },
    ],
    uncommon: [
      { name: "Lucky Coin", primary: "luk" },
      { name: "Reliquary Splinter", primary: "luk" },
      { name: "Merchant's Weighted Die", primary: "luk" },
      { name: "Jade Amulet", primary: "int" },
      { name: "Owl Feather Talisman", primary: "int" },
      { name: "Vial of Holy Water", primary: "int" },
      { name: "Hawthorn Rosary", primary: "cha" },
      { name: "Signet of the Lesser House", primary: "cha" },
    ],
    rare: [
      { name: "Band of Insight", primary: "int" },
      { name: "Astrolabe of the Drowned Scholar", primary: "int" },
      { name: "Sapphire Sigil", primary: "cha" },
      { name: "Emberglass Locket", primary: "cha" },
      { name: "Censer of Cold Smoke", primary: "luk" },
      { name: "Martyr's Knucklebone", primary: "str" },
    ],
    epic: [
      { name: "Oracle's Eye", primary: "int" },
      { name: "Bell of the Sunken Parish", primary: "cha" },
      { name: "Key to the Seventh Seal", primary: "luk" },
      { name: "Heart of the Tempest", primary: "str" },
    ],
    legendary: [
      { name: "The Unspent Hour", primary: "int" },
      { name: "Grail of the Hollow Star", primary: "cha" },
      { name: "Crown of Boundless Fortune", primary: "luk" },
      { name: "Worldroot Pendant", primary: "str" },
    ],
  },
};

export function seedItemDefs(db: Database): void {
  // ON CONFLICT upserts primary stat so existing rows (from old DBs) get backfilled.
  const insert = db.prepare(
    `INSERT INTO item_defs (name, slot, rarity, "primary") VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET "primary" = excluded."primary"`,
  );
  db.transaction(() => {
  for (const slot of Object.keys(NAMES) as Slot[]) {
    for (const rarity of Object.keys(NAMES[slot]) as Rarity[]) {
        for (const { name, primary } of NAMES[slot][rarity]) {
          insert.run(name, slot, rarity, primary);
        }
    }
  }
  })();
}

// Static quest templates
// template_id is explicit and stable so deterministic daily offers stay reproducible.
type QTemplate = { id: number; name: string; stat: StatKey; kind: QuestKind };
const QUEST_TEMPLATES: QTemplate[] = [
  // ── STR ──────────────────────────────────────────────
  { id: 1, name: "Hold the Ford", stat: "str", kind: "bountiful" },
  { id: 2, name: "Guard the Caravan", stat: "str", kind: "bountiful" },
  { id: 3, name: "Clear the Pilgrim Road", stat: "str", kind: "swift" },
  { id: 4, name: "Rout the Bandit Camp", stat: "str", kind: "swift" },
  { id: 17, name: "Man the Night Watch", stat: "str", kind: "bountiful" },
  { id: 18, name: "Raise the Fallen Gate", stat: "str", kind: "bountiful" },
  { id: 19, name: "Escort the Tithe Wagon", stat: "str", kind: "bountiful" },
  { id: 20, name: "Break the Siege Line", stat: "str", kind: "swift" },
  { id: 21, name: "Drive Off the Wolves", stat: "str", kind: "swift" },
  { id: 22, name: "Carry the Bells to the Tower", stat: "str", kind: "swift" },
 
  // ── INT ──────────────────────────────────────────────
  { id: 5, name: "Transcribe the Burned Codex", stat: "int", kind: "bountiful" },
  { id: 6, name: "Chart the Astral Tables", stat: "int", kind: "bountiful" },
  { id: 7, name: "Decipher the Cartographer's Cipher", stat: "int", kind: "swift" },
  { id: 8, name: "Solve the Warding Glyph", stat: "int", kind: "swift" },
  { id: 23, name: "Illuminate the Psalter", stat: "int", kind: "bountiful" },
  { id: 24, name: "Catalogue the Ossuary", stat: "int", kind: "bountiful" },
  { id: 25, name: "Distill the Panacea", stat: "int", kind: "bountiful" },
  { id: 26, name: "Audit the Tithe Ledgers", stat: "int", kind: "swift" },
  { id: 27, name: "Read the Stars Before Dawn", stat: "int", kind: "swift" },
  { id: 28, name: "Date the Forged Charter", stat: "int", kind: "swift" },
 
  // ── CHA ──────────────────────────────────────────────
  { id: 9, name: "Parley at the Gate", stat: "cha", kind: "bountiful" },
  { id: 10, name: "Broker the Guild Accord", stat: "cha", kind: "bountiful" },
  { id: 11, name: "Plead Before the Synod", stat: "cha", kind: "swift" },
  { id: 12, name: "Rally the Market Square", stat: "cha", kind: "swift" },
  { id: 29, name: "Court the Distant Abbey", stat: "cha", kind: "bountiful" },
  { id: 30, name: "Soothe the Restless Levy", stat: "cha", kind: "bountiful" },
  { id: 31, name: "Host the Harvest Feast", stat: "cha", kind: "bountiful" },
  { id: 32, name: "Talk Down the Tollkeeper", stat: "cha", kind: "swift" },
  { id: 33, name: "Win the Wager of Words", stat: "cha", kind: "swift" },
  { id: 34, name: "Recant Before the Inquisitor", stat: "cha", kind: "swift" },
 
  // ── LUK ──────────────────────────────────────────────
  { id: 13, name: "Sift the Reliquary Ashes", stat: "luk", kind: "bountiful" },
  { id: 14, name: "Dredge the Wishing Well", stat: "luk", kind: "bountiful" },
  { id: 15, name: "Follow the Will-o'-Wisp", stat: "luk", kind: "swift" },
  { id: 16, name: "Chase the Comet's Tail", stat: "luk", kind: "swift" },
  { id: 35, name: "Comb the Shipwreck Shallows", stat: "luk", kind: "bountiful" },
  { id: 36, name: "Pan the Vespers Creek", stat: "luk", kind: "bountiful" },
  { id: 37, name: "Walk the Unmarked Barrow", stat: "luk", kind: "bountiful" },
  { id: 38, name: "Cut the Cards at Midnight", stat: "luk", kind: "swift" },
  { id: 39, name: "Pick the Crossroads Path", stat: "luk", kind: "swift" },
  { id: 40, name: "Open the Unclaimed Strongbox", stat: "luk", kind: "swift" },
];

export function seedQuestTemplates(db: Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO quest_templates (template_id, name, stat, kind) VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const t of QUEST_TEMPLATES) insert.run(t.id, t.name, t.stat, t.kind);
  })();
}
