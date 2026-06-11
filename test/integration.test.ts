// End-to-end exercise of the DB-backed game layer against an in-memory SQLite.
// DB_PATH must be set before the db module is imported, so we use dynamic import.
import { test, expect, describe, beforeAll } from "bun:test";

process.env.DB_PATH = ":memory:";
process.env.DISCORD_TOKEN = "test";
process.env.DISCORD_APP_ID = "test";

let users: typeof import("../src/game/users.ts");
let inventory: typeof import("../src/game/inventory.ts");
let duels: typeof import("../src/game/duels.ts");
let expeditions: typeof import("../src/game/expeditions.ts");
let prestige: typeof import("../src/game/prestige.ts");
let raids: typeof import("../src/game/raids.ts");
let db: typeof import("../src/db/db.ts");

const G = "guild1";
const now = Math.floor(Date.parse("2026-06-11T12:00:00Z") / 1000);

beforeAll(async () => {
  db = await import("../src/db/db.ts");
  db.getDb(); // init schema + seed
  users = await import("../src/game/users.ts");
  inventory = await import("../src/game/inventory.ts");
  duels = await import("../src/game/duels.ts");
  expeditions = await import("../src/game/expeditions.ts");
  prestige = await import("../src/game/prestige.ts");
  raids = await import("../src/game/raids.ts");
});

describe("users + grantXp", () => {
  test("creates a user and grants xp + gold (=xp/4)", () => {
    const u = users.getOrCreateUser(G, "alice");
    expect(u.level).toBe(1);
    const res = users.grantXp(G, "alice", 100, { nowS: now, countedMsg: true });
    expect(res.xp).toBe(100);
    expect(res.gold).toBe(25);
    const after = users.getOrCreateUser(G, "alice");
    expect(after.xp).toBe(100);
    expect(after.gold).toBe(25);
  });

  test("levels up and awards stat points + free pulls at multiples of 5", () => {
    // grant a big chunk to cross several levels
    const res = users.grantXp(G, "bob", 20000, { nowS: now });
    expect(res.toLevel).toBeGreaterThan(5);
    expect(res.statPointsGained).toBe(res.toLevel - 1);
    expect(res.freePulls).toBeGreaterThanOrEqual(1);
  });
});

describe("idle claim", () => {
  test("accrues gold from recent activity, capped at 24h", () => {
    // give carol activity today, then set her idle clock back 48h
    users.grantXp(G, "carol", 500, { nowS: now, countedMsg: true });
    db.getDb().run(`UPDATE users SET idle_accrued_at = ? WHERE guild_id=? AND user_id=?`, [
      now - 48 * 3600,
      G,
      "carol",
    ]);
    const before = users.getOrCreateUser(G, "carol").gold;
    const claim = users.claimIdle(G, "carol", now);
    expect(claim.rate).toBeGreaterThan(0);
    expect(claim.gold).toBeGreaterThan(0);
    const after = users.getOrCreateUser(G, "carol").gold;
    expect(after).toBe(before + claim.gold);
  });
});

describe("gacha + equip + salvage", () => {
  test("pull creates an item, equip marks it, salvage returns gold", () => {
    const out = db.tx(() => inventory.rollPull(G, "dave", 0, 0, now));
    expect(out.instanceId).toBeGreaterThan(0);
    const equipped = inventory.equip(G, "dave", out.instanceId);
    expect(equipped?.instance_id).toBe(out.instanceId);
    const inv = inventory.listInventory(G, "dave");
    expect(inv.find((i) => i.instance_id === out.instanceId)?.equipped).toBe(1);

    // a second pull then salvage it
    const out2 = db.tx(() => inventory.rollPull(G, "dave", 0, 0, now));
    const goldBefore = users.getOrCreateUser(G, "dave").gold;
    const gained = inventory.salvage(G, "dave", out2.instanceId);
    expect(gained).toBeGreaterThan(0);
    expect(users.getOrCreateUser(G, "dave").gold).toBe(goldBefore + gained!);
  });

  test("equipping a second item in the same slot unequips the first", () => {
    db.getDb().run(`DELETE FROM inventory WHERE user_id='evan'`);
    const a = db.tx(() => inventory.rollPull(G, "evan", 0, 0, now));
    const b = db.tx(() => inventory.rollPull(G, "evan", 0, 0, now));
    // force both into the weapon slot for a deterministic check
    const weaponDef = db.getDb().query(`SELECT item_def_id FROM item_defs WHERE slot='weapon' LIMIT 1`).get() as { item_def_id: number };
    db.getDb().run(`UPDATE inventory SET item_def_id=? WHERE instance_id IN (?,?)`, [
      weaponDef.item_def_id,
      a.instanceId,
      b.instanceId,
    ]);
    inventory.equip(G, "evan", a.instanceId);
    inventory.equip(G, "evan", b.instanceId);
    const inv = inventory.listInventory(G, "evan");
    expect(inv.find((i) => i.instance_id === a.instanceId)?.equipped).toBe(0);
    expect(inv.find((i) => i.instance_id === b.instanceId)?.equipped).toBe(1);
  });
});

describe("duels", () => {
  test("winner gains, loser loses, pot is conserved minus rake", () => {
    db.getDb().run(`UPDATE users SET gold=10000, idle_accrued_at=? WHERE guild_id=? AND user_id IN ('p1','p2')`, [now, G]);
    users.getOrCreateUser(G, "p1");
    users.getOrCreateUser(G, "p2");
    db.getDb().run(`UPDATE users SET gold=10000 WHERE guild_id=? AND user_id IN ('p1','p2')`, [G]);
    const totalBefore =
      users.getOrCreateUser(G, "p1").gold + users.getOrCreateUser(G, "p2").gold;
    const out = duels.resolveDuel(G, "p1", "p2", 500, now, () => 0); // challenger wins
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.winnerId).toBe("p1");
      const totalAfter =
        users.getOrCreateUser(G, "p1").gold + users.getOrCreateUser(G, "p2").gold;
      expect(totalAfter).toBe(totalBefore - out.result.rake); // rake leaves the economy
    }
  });
});

describe("expeditions", () => {
  test("start then resolve grants gold + items", () => {
    users.grantXp(G, "frank", 1000, { nowS: now, countedMsg: true });
    const start = expeditions.startExpedition(G, "frank", "scout", now);
    expect(start.ok).toBe(true);
    // not yet due
    expect(expeditions.resolveExpeditionIfDue(G, "frank", now)).toBeNull();
    // after 4h
    const res = expeditions.resolveExpeditionIfDue(G, "frank", now + 5 * 3600);
    expect(res).not.toBeNull();
    expect(res!.items.length).toBe(1);
  });
});

describe("raids", () => {
  test("spawn, damage, and kill distributes rewards", () => {
    // seed guild activity so HP is bounded
    users.grantXp(G, "rg", 1000, { nowS: now, countedMsg: true });
    const spawn = raids.spawnRaid(G, now);
    expect(spawn.ok).toBe(true);
    if (spawn.ok) {
      const dmg = raids.applyRaidDamage(G, "rg", spawn.hp, now); // one-shot
      expect(dmg.justKilled).toBe(true);
      const res = raids.resolveRaidIfDone(G, now);
      expect(res?.killed).toBe(true);
      expect(res!.rewards[0]!.gold).toBeGreaterThanOrEqual(200);
    }
  });
});

describe("idle digest (read-only preview)", () => {
  test("previewIdle reports pending gold WITHOUT crediting or moving the clock", () => {
    users.grantXp(G, "digestu", 800, { nowS: now, countedMsg: true });
    db.getDb().run(`UPDATE users SET idle_accrued_at=? WHERE guild_id=? AND user_id='digestu'`, [
      now - 6 * 3600,
      G,
    ]);
    const before = users.getOrCreateUser(G, "digestu");
    const preview = users.previewIdle(G, "digestu", now);
    expect(preview.rate).toBeGreaterThan(0);
    expect(preview.pending).toBeGreaterThan(0);
    const after = users.getOrCreateUser(G, "digestu");
    // crucially: gold and the idle clock are untouched by a preview
    expect(after.gold).toBe(before.gold);
    expect(after.idle_accrued_at).toBe(before.idle_accrued_at);
  });

  test("recentlyActiveUserIds includes users with recent activity", () => {
    const ids = users.recentlyActiveUserIds(G, now);
    expect(ids).toContain("digestu");
  });
});

describe("prestige", () => {
  test("requires the level gate, then resets and bumps prestige", () => {
    expect(prestige.doPrestige(G, "alice").ok).toBe(false); // too low
    db.getDb().run(`UPDATE users SET level=50, gold=999, str=5 WHERE guild_id=? AND user_id='alice'`, [G]);
    const res = prestige.doPrestige(G, "alice");
    expect(res.ok).toBe(true);
    const u = users.getOrCreateUser(G, "alice");
    expect(u.prestige).toBe(1);
    expect(u.level).toBe(1);
    expect(u.gold).toBe(0);
    expect(u.str).toBe(0);
  });
});
