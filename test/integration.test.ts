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
let quests: typeof import("../src/game/quests.ts");
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
  quests = await import("../src/game/quests.ts");
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
      expect(out.result.loserId).toBe("p2");
      // Even match, no prestige: loser XP = 0.4 * 500 = 200 (addendum A).
      expect(out.result.loserXp).toBe(200);
      // Gold is conserved except for the rake (leaves) and the loser's XP-rider
      // gold (xp/4, enters): a duel is no longer a strict sink.
      const loserGold = Math.floor(out.result.loserXp / 4);
      const totalAfter =
        users.getOrCreateUser(G, "p1").gold + users.getOrCreateUser(G, "p2").gold;
      expect(totalAfter).toBe(totalBefore - out.result.rake + loserGold);
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

describe("duel loser-XP budget (addendum A)", () => {
  test("a large loss can exhaust the daily budget; further losses pay 0 XP", () => {
    db.getDb().run(
      `UPDATE users SET gold=1000000, idle_accrued_at=?, loser_xp_today=0, last_duel_day='' WHERE guild_id=? AND user_id IN ('bud1','bud2')`,
      [now, G],
    );
    users.getOrCreateUser(G, "bud1");
    users.getOrCreateUser(G, "bud2");
    db.getDb().run(`UPDATE users SET gold=1000000 WHERE guild_id=? AND user_id IN ('bud1','bud2')`, [G]);

    // bud1 challenges, bud2 wins (rng=1 => challenger loses). Even match → 0.4*wager XP,
    // but capped at the 1000/day budget. wager 5000 → 2000 uncapped → 1000 granted.
    const first = duels.resolveDuel(G, "bud1", "bud2", 5000, now, () => 1);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.result.loserId).toBe("bud1");
      expect(first.result.loserXp).toBe(1000); // capped at the daily budget
      expect(first.result.loserXpBudgetLeft).toBe(0);
    }
    // Same day, bud1 loses again → budget already spent → 0 XP.
    const second = duels.resolveDuel(G, "bud1", "bud2", 500, now + 1, () => 1);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.result.loserId).toBe("bud1");
      expect(second.result.loserXp).toBe(0);
    }
    // Next UTC day, the budget resets, so the loss pays XP again (exact amount
    // depends on the now-divergent power ratio, but it must be > 0).
    const tomorrow = now + 86400;
    const third = duels.resolveDuel(G, "bud1", "bud2", 500, tomorrow, () => 1);
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.result.loserXp).toBeGreaterThan(0);
  });
});

describe("quests (addendum C)", () => {
  test("solo quest: start snapshots eff, resolves with gold + XP after ends_at", () => {
    users.grantXp(G, "qsolo", 2000, { nowS: now, countedMsg: true }); // give some level
    const offers = quests.dailyOffers(G, "qsolo", "2026-06-11");
    expect(offers.length).toBe(3);
    expect(new Set(offers.map((o) => o.template.stat)).size).toBeGreaterThanOrEqual(2); // C.2 constraint

    const start = quests.startSoloQuest(G, "qsolo", 0, now);
    expect(start.ok).toBe(true);
    expect(quests.activeQuestFor(G, "qsolo")).not.toBeNull();
    // not due yet
    expect(quests.resolveQuestIfDue(G, "qsolo", now)).toBeNull();

    const goldBefore = users.getOrCreateUser(G, "qsolo").gold;
    // force resolution far in the future; rng=0 so any item roll fires deterministically
    const res = quests.resolveQuestIfDue(G, "qsolo", now + 30 * 3600, () => 0);
    expect(res).not.toBeNull();
    expect(res!.rewards[0]!.gold).toBeGreaterThan(0);
    expect(res!.rewards[0]!.xp).toBeGreaterThan(0);
    expect(users.getOrCreateUser(G, "qsolo").gold).toBeGreaterThan(goldBefore);
    expect(quests.activeQuestFor(G, "qsolo")).toBeNull(); // slot freed
  });

  test("deterministic offers: same seed yields the same board", () => {
    const a = quests.dailyOffers(G, "stable", "2026-06-11");
    const b = quests.dailyOffers(G, "stable", "2026-06-11");
    expect(a.map((o) => [o.template.template_id, o.tier])).toEqual(
      b.map((o) => [o.template.template_id, o.tier]),
    );
  });

  test("server quest: progress, threshold, contributor gate, one claim", () => {
    const sq = quests.ensureServerQuest(G, now);
    expect(sq.goal).toBeGreaterThanOrEqual(50); // min goal
    // qcontrib sends 3 counted messages
    for (let i = 0; i < 3; i++) quests.recordServerQuestProgress(G, "qcontrib", now);
    // force the goal to met for the test
    db.getDb().run(`UPDATE server_quest SET progress = goal WHERE guild_id=? AND day=?`, [G, sq.day]);

    const ok = quests.claimServerQuest(G, "qcontrib", now);
    expect(ok.ok).toBe(true);
    // second claim is rejected
    const again = quests.claimServerQuest(G, "qcontrib", now);
    expect(again.ok).toBe(false);
    // a non-contributor (0 msgs) cannot claim
    const none = quests.claimServerQuest(G, "qlurker", now);
    expect(none.ok).toBe(false);
  });
});

describe("raid strikes (addendum B.3)", () => {
  test("strike deals %-of-max-HP, then is on a 4h cooldown", () => {
    users.grantXp(G, "striker", 1000, { nowS: now, countedMsg: true });
    db.getDb().run(`DELETE FROM raids WHERE guild_id=?`, [G]);
    const spawn = raids.spawnRaid(G, now);
    expect(spawn.ok).toBe(true);
    if (spawn.ok) {
      const first = raids.strikeRaid(G, "striker", now);
      expect(first.ok).toBe(true);
      if (first.ok) {
        // STR 0 → 1.2% of max HP
        expect(first.dealt).toBe(Math.min(Math.round(spawn.hp * 0.012), spawn.hp));
      }
      // immediate re-strike is on cooldown
      const second = raids.strikeRaid(G, "striker", now + 60);
      expect(second.ok).toBe(false);
      // after 4h it is ready again
      const third = raids.strikeRaid(G, "striker", now + 4 * 3600 + 1);
      expect(third.ok).toBe(true);
    }
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
