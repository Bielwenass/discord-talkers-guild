// Static item catalog (design §6). Names per slot × rarity; the stat spread is
// rolled at drop time, not stored here. Idempotent: only seeds an empty table.
import type { Database } from "bun:sqlite";
import type { Rarity, Slot, StatKey, QuestKind } from "../config.ts";

type Def = { name: string; slot: Slot; rarity: Rarity };

const NAMES: Record<Slot, Record<Rarity, string[]>> = {
  weapon: {
    common: [
      "Rusty Dagger",
      "Worn Shortsword",
      "Cracked Club",
      "Bent Pitchfork",
      "Splintered Spear",
      "Notched Hatchet",
      "Threshing Flail",
      "Cobbler's Hammer",
    ],
    uncommon: [
      "Iron Mace",
      "Hunter's Bow",
      "Balanced Sabre",
      "Footman's Halberd",
      "Oaken Quarterstaff",
      "Riveted Morningstar",
      "Watchman's Billhook",
      "Bronze Falchion",
    ],
    rare: [
      "Silver Rapier",
      "Runed Warhammer",
      "Frostbite Axe",
      "Vesper Blade",
      "Pilgrim's Bane",
      "Serpentine Estoc",
    ],
    epic: [
      "Stormcaller Glaive",
      "Voidpiercer Lance",
      "Litany of Edges",
      "Hollowfang Scythe",
    ],
    legendary: [
      "Dawnbreaker, Sword of Kings",
      "Eclipse Reaver",
      "Last Psalm, the Silencing Blade",
      "Ruin of Crowns",
    ],
  },
  armor: {
    common: [
      "Tattered Tunic",
      "Padded Vest",
      "Leather Jerkin",
      "Moth-Eaten Cloak",
      "Patchwork Gambeson",
      "Drover's Coat",
      "Salt-Stained Surcoat",
      "Friar's Habit",
    ],
    uncommon: [
      "Chainmail Shirt",
      "Scaled Hauberk",
      "Reinforced Brigandine",
      "Boiled Leather Cuirass",
      "Pikeman's Plackart",
      "Wayfarer's Mantle",
      "Studded Vestments",
      "Bordered Tabard",
    ],
    rare: [
      "Mithril Plate",
      "Wardens Cuirass",
      "Dragonhide Mantle",
      "Cathedral Mail",
      "Gravewrought Harness",
      "Cloak of the Quiet Hours",
    ],
    epic: [
      "Aegis of the Bastion",
      "Phoenix Carapace",
      "Raiment of the Unburned Saint",
      "Nightfall Pallium",
    ],
    legendary: [
      "Bulwark of the Eternal Watch",
      "Titanforged Aegis",
      "Shroud of the First Vigil",
      "Mantle of the Undying Choir",
    ],
  },
  trinket: {
    common: [
      "Chipped Bead",
      "Copper Ring",
      "Frayed Charm",
      "Bent Horseshoe Nail",
      "Wax-Sealed Locket",
      "River Pebble",
      "Knotted Prayer Cord",
      "Tin Pilgrim Badge",
    ],
    uncommon: [
      "Jade Amulet",
      "Owl Feather Talisman",
      "Lucky Coin",
      "Reliquary Splinter",
      "Hawthorn Rosary",
      "Merchant's Weighted Die",
      "Vial of Holy Water",
      "Signet of the Lesser House",
    ],
    rare: [
      "Sapphire Sigil",
      "Band of Insight",
      "Emberglass Locket",
      "Martyr's Knucklebone",
      "Astrolabe of the Drowned Scholar",
      "Censer of Cold Smoke",
    ],
    epic: [
      "Oracle's Eye",
      "Heart of the Tempest",
      "Key to the Seventh Seal",
      "Bell of the Sunken Parish",
    ],
    legendary: [
      "Crown of Boundless Fortune",
      "Worldroot Pendant",
      "The Unspent Hour",
      "Grail of the Hollow Star",
    ],
  },
};

export function seedItemDefs(db: Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO item_defs (name, slot, rarity) VALUES (?, ?, ?)`,
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
