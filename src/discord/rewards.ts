// Applies the side effects of an XP grant that need Discord context: raid damage,
// level-up role rewards, free-pull rolls, and an optional announcement.
import type { Guild, GuildTextBasedChannel } from "discord.js";
import type { GrantResult } from "../game/users.ts";
import { effectiveStats, getOrCreateUser } from "../game/users.ts";
import { rollPull, type PullOutcome } from "../game/inventory.ts";
import { applyRaidDamage, resolveRaidIfDone } from "../game/raids.ts";
import { getSettings } from "../game/guilds.ts";
import { tx } from "../db/db.ts";
import { announceRaidResolution } from "./raidAnnounce.ts";

/** Apply raid damage for an earner's XP grant; resolve + announce on kill. */
export async function applyRaidForGrant(
  guild: Guild,
  channel: GuildTextBasedChannel | null,
  earnerId: string,
  xp: number,
  nowS: number,
): Promise<void> {
  const { justKilled } = tx(() => applyRaidDamage(guild.id, earnerId, xp, nowS));
  if (justKilled) {
    const resolution = tx(() => resolveRaidIfDone(guild.id, nowS));
    if (resolution && channel) await announceRaidResolution(channel, resolution);
  }
}

/**
 * Handle the level-up consequences of a grant: stat points are already written
 * by grantXp; here we roll free pulls, grant configured roles, and announce.
 */
export async function applyLevelRewards(
  guild: Guild,
  channel: GuildTextBasedChannel | null,
  userId: string,
  grant: GrantResult,
  nowS: number,
): Promise<void> {
  if (!grant.leveledUp) return;

  // Free standard pulls (every 5 levels)
  const freeItems: PullOutcome[] = [];
  if (grant.freePulls > 0) {
    tx(() => {
      const user = getOrCreateUser(guild.id, userId);
      const luk = effectiveStats(user).luk;
      for (let i = 0; i < grant.freePulls; i++) {
        freeItems.push(rollPull(guild.id, userId, luk, 0, nowS));
      }
    });
  }

  // Role rewards for crossed thresholds
  const settings = getSettings(guild.id);
  const grantedRoles: string[] = [];
  for (const threshold of grant.roleThresholds) {
    const roleId = settings.role_rewards?.[String(threshold)];
    if (!roleId) continue;
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.add(roleId);
      grantedRoles.push(`<@&${roleId}>`);
    } catch {
      // missing perms / role deleted — skip silently
    }
  }

  if (channel) {
    const extras: string[] = [];
    if (grant.freePulls > 0) extras.push(`🎁 ${grant.freePulls} free pull(s)`);
    if (grantedRoles.length) extras.push(`🏅 ${grantedRoles.join(", ")}`);
    const tail = extras.length ? ` — ${extras.join(" · ")}` : "";
    try {
      await channel.send(`🎉 <@${userId}> reached **level ${grant.toLevel}**!${tail}`);
    } catch {
      // channel send may fail (perms) — non-fatal
    }
  }
}
