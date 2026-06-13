// Quests. Lazy throughout: `ends_at` is written at start
// and resolved on the first interaction afterward. Each governing stat pays one
// reward type exclusively (QUEST_PROFILES). Server quest pays out automatically
// at midnight — no user-facing claim.
import { getDb } from "../db/db.ts";
import {
  ECON,
  QUEST_TIERS,
  QUEST_TIER_KEYS,
  QUEST_PROFILES,
  type QuestTier,
  type StatKey,
} from "../config.ts";
import type { QuestRow, QuestTemplateRow, ServerQuestRow } from "../types.ts";
import { utcDayString } from "../util/time.ts";
import {
  questEff,
  questGoldRate,
  questXpRate,
  prestigeMult,
} from "./formulas.ts";
import { effectiveStats, getOrCreateUser, addGold, grantXp } from "./users.ts";
import { rollPull, type PullOutcome } from "./inventory.ts";

// --- templates ---

export function allTemplates(): QuestTemplateRow[] {
  return getDb()
    .query(`SELECT * FROM quest_templates ORDER BY template_id`)
    .all() as QuestTemplateRow[];
}

export function getTemplate(id: number): QuestTemplateRow | null {
  return getDb()
    .query(`SELECT * FROM quest_templates WHERE template_id = ?`)
    .get(id) as QuestTemplateRow | null;
}

// --- deterministic PRNG ---

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- daily board ---

export interface QuestOffer {
  index: number; // 0-based slot on the board, used by /quest start
  template: QuestTemplateRow;
  tier: QuestTier;
}

/**
 * The user's 3 offers for a UTC day, generated deterministically.
 * Guaranteed to span 3 distinct governing stats.
 */
export function dailyOffers(guildId: string, userId: string, day: string): QuestOffer[] {
  const templates = allTemplates();
  const rng = mulberry32(hashSeed(`${guildId}:${userId}:${day}`));

  const order = templates.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  // pick 3 with distinct governing stats
  const picks: QuestTemplateRow[] = [];
  const usedStats = new Set<string>();
  for (const t of order) {
    if (!usedStats.has(t.stat)) {
      picks.push(t);
      usedStats.add(t.stat);
      if (picks.length === ECON.QUEST_OFFERS_PER_DAY) break;
    }
  }

  return picks.map((template, index) => ({
    index,
    template,
    tier: QUEST_TIER_KEYS[Math.floor(rng() * QUEST_TIER_KEYS.length)]!,
  }));
}

// --- active quest / slot ---

/** The user's active (unresolved) quest, if any. One slot per user. */
export function activeQuestFor(guildId: string, userId: string): QuestRow | null {
  return getDb()
    .query(`SELECT * FROM quests WHERE guild_id = ? AND members LIKE ? LIMIT 1`)
    .get(guildId, `%"${userId}"%`) as QuestRow | null;
}

function questDurationS(tier: QuestTier, kind: string, eff: number): number {
  const baseHours = QUEST_TIERS[tier].hours;
  // swift: shorter duration (÷ eff); bountiful: full duration. Eff applies to rewards in both.
  const hours = kind === "swift" ? baseHours / eff : baseHours;
  return Math.round(hours * 3600);
}

function insertQuest(
  guildId: string,
  templateId: number,
  tier: QuestTier,
  members: string[],
  eff: number,
  startedAt: number,
  endsAt: number,
): number {
  const db = getDb();
  db.run(
    `INSERT INTO quests (guild_id, template_id, tier, members, eff, started_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guildId, templateId, tier, JSON.stringify(members), eff, startedAt, endsAt],
  );
  return Number((db.query(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id);
}

export interface StartedQuest {
  questId: number;
  template: QuestTemplateRow;
  tier: QuestTier;
  eff: number;
  endsAt: number;
  memberCount: number;
}

/** Start a solo quest from one of the user's board offers. */
export function startSoloQuest(
  guildId: string,
  userId: string,
  offerIndex: number,
  nowS: number,
): { ok: true; quest: StartedQuest } | { ok: false; reason: string } {
  if (activeQuestFor(guildId, userId)) {
    return { ok: false, reason: "You already have an active quest. Finish it first." };
  }
  const offers = dailyOffers(guildId, userId, utcDayString(nowS));
  const offer = offers[offerIndex];
  if (!offer) return { ok: false, reason: "That offer isn't on today's board." };

  const user = getOrCreateUser(guildId, userId);
  const stat = effectiveStats(user)[offer.template.stat];
  const eff = questEff(stat);
  const endsAt = nowS + questDurationS(offer.tier, offer.template.kind, eff);
  const questId = insertQuest(guildId, offer.template.template_id, offer.tier, [userId], eff, nowS, endsAt);

  return {
    ok: true,
    quest: { questId, template: offer.template, tier: offer.tier, eff, endsAt, memberCount: 1 },
  };
}

/**
 * Start a party quest. Party eff = questEff(max_stat + 0.20 * sum_of_rest):
 * the strongest member sets the baseline and every other member contributes 20% of their
 * stat on top. Shared by all members for both duration and rewards.
 */
export function startPartyQuest(
  guildId: string,
  templateId: number,
  tier: QuestTier,
  memberIds: string[],
  nowS: number,
): { ok: true; quest: StartedQuest } | { ok: false; reason: string } {
  const tpl = getTemplate(templateId);
  if (!tpl) return { ok: false, reason: "Unknown quest template." };
  if (memberIds.length < ECON.QUEST_PARTY_MIN) {
    return { ok: false, reason: "Not enough members to start a party." };
  }
  for (const id of memberIds) {
    if (activeQuestFor(guildId, id)) {
      return { ok: false, reason: `<@${id}> already has an active quest.` };
    }
  }
  const stats = memberIds.map((id) => effectiveStats(getOrCreateUser(guildId, id))[tpl.stat]);
  const maxStat = Math.max(...stats);
  const partyStat = maxStat + 0.20 * (stats.reduce((a, b) => a + b, 0) - maxStat);
  const eff = questEff(partyStat);
  const endsAt = nowS + questDurationS(tier, tpl.kind, eff);
  const questId = insertQuest(guildId, templateId, tier, memberIds, eff, nowS, endsAt);

  return {
    ok: true,
    quest: { questId, template: tpl, tier, eff, endsAt, memberCount: memberIds.length },
  };
}

export interface OfferPreview {
  eff: number;
  durationS: number;
  gold: number;
  xp: number;
  itemPct: number;       // first-roll item chance for LUK quests; 0 for others
  secondRollPct: number; // second-roll chance for LUK quests; 0 for others
}

/** Project a solo offer's reward for the board, without granting anything. */
export function previewOffer(
  guildId: string,
  userId: string,
  offer: QuestOffer,
  _nowS: number,
): OfferPreview {
  const user = getOrCreateUser(guildId, userId);
  const eff = questEff(effectiveStats(user)[offer.template.stat]);
  const cfg = QUEST_TIERS[offer.tier];
  const pm = prestigeMult(user.prestige);
  const profile = QUEST_PROFILES[offer.template.stat];
  const soloMult = profile.soloMult ?? 1.0;

  const baseGold = questGoldRate(user.level) * cfg.hours * cfg.mult * pm;
  const baseXp   = questXpRate(user.level)   * cfg.hours * cfg.mult * pm;

  let itemPct = 0;
  let secondRollPct = 0;
  if (profile.itemChance) {
    const ic = profile.itemChance;
    itemPct = Math.min(1.0, ic[offer.tier] * eff);
    secondRollPct = Math.min(1.0, ic.secondRoll * eff);
  }

  return {
    eff,
    durationS: questDurationS(offer.tier, offer.template.kind, eff),
    gold: Math.round(baseGold * profile.gold * eff * soloMult),
    xp:   Math.round(baseXp   * profile.xp   * eff * soloMult),
    itemPct,
    secondRollPct,
  };
}

// --- resolution ---

export interface QuestMemberReward {
  userId: string;
  gold: number;
  xp: number;
  items: PullOutcome[];
}

export interface QuestResolution {
  questId: number;
  template: QuestTemplateRow;
  tier: QuestTier;
  eff: number;
  memberCount: number;
  rewards: QuestMemberReward[];
}

function grantMemberReward(
  guildId: string,
  userId: string,
  template: QuestTemplateRow,
  tier: QuestTier,
  eff: number,
  memberCount: number,
  nowS: number,
  rng: () => number,
): QuestMemberReward {
  const user = getOrCreateUser(guildId, userId);
  const cfg = QUEST_TIERS[tier];
  const pm = prestigeMult(user.prestige);
  const profile = QUEST_PROFILES[template.stat];

  const bonusPerMember = profile.partyBonusPerMember ?? ECON.QUEST_PARTY_BONUS_PER_MEMBER;
  const partyBonus = 1 + bonusPerMember * (memberCount - 1);
  const isSolo = memberCount === 1;
  const soloMult = isSolo ? (profile.soloMult ?? 1.0) : 1.0;

  const baseGold = questGoldRate(user.level) * cfg.hours * cfg.mult * pm;
  const baseXp   = questXpRate(user.level)   * cfg.hours * cfg.mult * pm;

  const gold = Math.max(0, Math.round(baseGold * profile.gold * eff * partyBonus * soloMult));
  const xp   = Math.max(0, Math.round(baseXp   * profile.xp   * eff * partyBonus * soloMult));

  const items: PullOutcome[] = [];
  if (profile.itemChance) {
    const ic = profile.itemChance;
    const firstChance = Math.min(1.0, ic[tier] * eff);
    if (rng() < firstChance) {
  const luk = effectiveStats(user).luk;
      items.push(rollPull(guildId, userId, luk, 0, nowS));
      const secondChance = Math.min(1.0, ic.secondRoll * eff);
      if (rng() < secondChance) {
    items.push(rollPull(guildId, userId, luk, 0, nowS));
      }
    }
  }

  if (gold > 0) addGold(guildId, userId, gold);
  if (xp > 0) grantXp(guildId, userId, xp, { nowS });

  return { userId, gold, xp, items };
}

function resolveQuest(quest: QuestRow, nowS: number, rng: () => number): QuestResolution {
  const members = JSON.parse(quest.members) as string[];
  const template = getTemplate(quest.template_id)!;
  const rewards: QuestMemberReward[] = [];
  const db = getDb();
  db.transaction(() => {
    for (const memberId of members) {
      rewards.push(
        grantMemberReward(quest.guild_id, memberId, template, quest.tier, quest.eff, members.length, nowS, rng),
      );
    }
    db.run(`DELETE FROM quests WHERE quest_id = ?`, [quest.quest_id]);
  })();
  return {
    questId: quest.quest_id,
    template,
    tier: quest.tier,
    eff: quest.eff,
    memberCount: members.length,
    rewards,
  };
}

/** Resolve the user's quest if it has ended. Settles ALL party members at once. */
export function resolveQuestIfDue(
  guildId: string,
  userId: string,
  nowS: number,
  rng: () => number = Math.random,
): QuestResolution | null {
  const quest = activeQuestFor(guildId, userId);
  if (!quest || quest.ends_at > nowS) return null;
  return resolveQuest(quest, nowS, rng);
}

// --- server quest ---

function pickServerTemplate(guildId: string, day: string): QuestTemplateRow {
  const templates = allTemplates();
  const rng = mulberry32(hashSeed(`server:${guildId}:${day}`));
  return templates[Math.floor(rng() * templates.length)]!;
}

/** Trailing 7-day daily average of counted messages guild-wide. */
export function trailingDailyAvgMsgs(guildId: string, nowS: number): number {
  const cutoff = utcDayString(nowS - 7 * 86400);
  const row = getDb()
    .query(
      `SELECT COALESCE(SUM(msgs),0) AS m FROM activity_daily WHERE guild_id = ? AND day >= ?`,
    )
    .get(guildId, cutoff) as { m: number };
  return row.m / 7;
}

/** Get or lazily create today's server quest (one per guild per UTC day). */
export function ensureServerQuest(guildId: string, nowS: number): ServerQuestRow {
  const day = utcDayString(nowS);
  const db = getDb();
  const existing = db
    .query(`SELECT * FROM server_quest WHERE guild_id = ? AND day = ?`)
    .get(guildId, day) as ServerQuestRow | null;
  if (existing) return existing;

  const tpl = pickServerTemplate(guildId, day);
  const goal = Math.max(
    ECON.QUEST_SERVER_GOAL_MIN,
    Math.round(ECON.QUEST_SERVER_GOAL_MULT * trailingDailyAvgMsgs(guildId, nowS)),
  );
  db.run(
    `INSERT OR IGNORE INTO server_quest (guild_id, day, template_id, goal, progress) VALUES (?, ?, ?, ?, 0)`,
    [guildId, day, tpl.template_id, goal],
  );
  return db
    .query(`SELECT * FROM server_quest WHERE guild_id = ? AND day = ?`)
    .get(guildId, day) as ServerQuestRow;
}

/** Record one counted message toward today's server quest. Called from messageCreate. */
export function recordServerQuestProgress(guildId: string, userId: string, nowS: number): void {
  const sq = ensureServerQuest(guildId, nowS);
  const db = getDb();
  db.run(`UPDATE server_quest SET progress = progress + 1 WHERE guild_id = ? AND day = ?`, [
    guildId,
    sq.day,
  ]);
  db.run(
    `INSERT INTO server_quest_claims (guild_id, day, user_id, msgs, claimed) VALUES (?, ?, ?, 1, 0)
     ON CONFLICT(guild_id, day, user_id) DO UPDATE SET msgs = msgs + 1`,
    [guildId, sq.day, userId],
  );
}

export interface ServerQuestStatus {
  quest: ServerQuestRow;
  template: QuestTemplateRow;
  completion: number;
  myMsgs: number;
  isContributor: boolean;
}

export function serverQuestStatus(guildId: string, userId: string, nowS: number): ServerQuestStatus {
  const sq = ensureServerQuest(guildId, nowS);
  const claim = getDb()
    .query(`SELECT msgs FROM server_quest_claims WHERE guild_id = ? AND day = ? AND user_id = ?`)
    .get(guildId, sq.day, userId) as { msgs: number } | null;
  const myMsgs = claim?.msgs ?? 0;
  const completion = Math.min(1.5, Math.max(0, sq.progress / sq.goal));
  return {
    quest: sq,
    template: getTemplate(sq.template_id)!,
    completion,
    myMsgs,
    isContributor: myMsgs >= ECON.QUEST_SERVER_MIN_MSGS,
  };
}

/**
 * Automatic server-quest payout for a guild's completed day (called at midnight).
 * Contributors (≥3 counted msgs): Task-tier × their eff × completion.
 * Bystanders (≥1 msg in trailing 14d, not contributors): half payout, eff=1.0.
 * Returns summary lines for the leaderboard post.
 */
export function payServerQuestForGuild(
  guildId: string,
  day: string,
  nowS: number,
): { lines: string[] } {
  const db = getDb();
  const sq = db
    .query(`SELECT * FROM server_quest WHERE guild_id = ? AND day = ?`)
    .get(guildId, day) as ServerQuestRow | null;

  if (!sq) return { lines: [] };

  const completion = Math.min(1.5, Math.max(0, sq.progress / sq.goal));
  if (completion < 0.5) {
    return {
      lines: [
        `🏰 **Server quest** — ${sq.progress}/${sq.goal} messages — threshold not reached (need ≥50%).`,
      ],
    };
  }

  const template = getTemplate(sq.template_id)!;
  const taskHours = QUEST_TIERS.task.hours;
  const taskMult  = QUEST_TIERS.task.mult;

  // Contributors: unclaimed rows with enough msgs
  const contributors = db
    .query(
      `SELECT user_id FROM server_quest_claims
       WHERE guild_id = ? AND day = ? AND msgs >= ? AND claimed = 0`,
    )
    .all(guildId, day, ECON.QUEST_SERVER_MIN_MSGS) as { user_id: string }[];

  const contributorSet = new Set(contributors.map((r) => r.user_id));

  // Bystanders: any user active in trailing 14 days (excluding contributors)
  const cutoff = utcDayString(nowS - 14 * 86400);
  const recentUsers = db
    .query(
      `SELECT DISTINCT user_id FROM activity_daily WHERE guild_id = ? AND day >= ? AND day <= ?`,
    )
    .all(guildId, cutoff, day) as { user_id: string }[];

  const bystanders = recentUsers.filter((r) => !contributorSet.has(r.user_id));

  let cCount = 0;
  let bCount = 0;

  db.transaction(() => {
    for (const { user_id } of contributors) {
      const user = getOrCreateUser(guildId, user_id);
      const eff = questEff(effectiveStats(user)[template.stat]);
      const pm  = prestigeMult(user.prestige);
      const gold = Math.round(questGoldRate(user.level) * taskHours * taskMult * pm * eff * completion);
      const xp   = Math.round(questXpRate(user.level)   * taskHours * taskMult * pm * eff * completion);
      if (gold > 0) addGold(guildId, user_id, gold);
      if (xp   > 0) grantXp(guildId, user_id, xp, { nowS });
      db.run(
      `UPDATE server_quest_claims SET claimed = 1 WHERE guild_id = ? AND day = ? AND user_id = ?`,
        [guildId, day, user_id],
      );
      cCount++;
    }

    for (const { user_id } of bystanders) {
      const user = getOrCreateUser(guildId, user_id);
      const pm  = prestigeMult(user.prestige);
      const gold = Math.round(questGoldRate(user.level) * taskHours * taskMult * pm * 0.5 * completion);
      const xp   = Math.round(questXpRate(user.level)   * taskHours * taskMult * pm * 0.5 * completion);
      if (gold > 0) addGold(guildId, user_id, gold);
      if (xp   > 0) grantXp(guildId, user_id, xp, { nowS });
      bCount++;
    }
  })();

  return {
    lines: [
      `🏰 **Server quest** — ${sq.progress}/${sq.goal} · completion ×${completion.toFixed(2)}` +
        ` — ${cCount} contributor(s) + ${bCount} bystander(s) paid.`,
    ],
  };
}
