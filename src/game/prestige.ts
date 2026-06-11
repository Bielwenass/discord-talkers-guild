// Prestige (design §10). Resets level/XP/gold/stats but keeps inventory; grants
// a permanent +10% income per prestige (already wired into the formulas).
import { getDb } from "../db/db.ts";
import { ECON } from "../config.ts";
import { getOrCreateUser } from "./users.ts";

/** Level required to prestige: rises by 5 each time (50, 55, 60 …). */
export function prestigeRequirement(prestige: number): number {
  return ECON.PRESTIGE_BASE_LEVEL + prestige * ECON.PRESTIGE_LEVEL_STEP;
}

export function canPrestige(guildId: string, userId: string): boolean {
  const u = getOrCreateUser(guildId, userId);
  return u.level >= prestigeRequirement(u.prestige);
}

export function doPrestige(
  guildId: string,
  userId: string,
): { ok: true; newPrestige: number } | { ok: false; reason: string } {
  const u = getOrCreateUser(guildId, userId);
  const required = prestigeRequirement(u.prestige);
  if (u.level < required) {
    return { ok: false, reason: `You must reach level ${required} to prestige.` };
  }
  // Reset level/XP/gold and refund stats to base (allocated stats cleared,
  // stat points zeroed); inventory and pity are kept.
  getDb().run(
    `UPDATE users
       SET prestige = prestige + 1, level = 1, xp = 0, gold = 0,
           str = 0, int = 0, cha = 0, luk = 0, stat_points = 0, bought_points = 0
     WHERE guild_id = ? AND user_id = ?`,
    [guildId, userId],
  );
  return { ok: true, newPrestige: u.prestige + 1 };
}
