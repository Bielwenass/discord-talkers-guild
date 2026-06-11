// The one scheduled job in the system (design otherwise computes everything
// lazily): post each guild's daily leaderboard at 00:00 UTC for the day that
// just ended, then prune old activity rows.
import type { Client, GuildTextBasedChannel } from "discord.js";
import { getDb } from "./db/db.ts";
import { ECON } from "./config.ts";
import { knownGuildIds, getSettings } from "./game/guilds.ts";
import { previewIdle, recentlyActiveUserIds } from "./game/users.ts";
import {
  leaderboardEmbed,
  idleDigestEmbed,
  type LeaderEntry,
  type IdleDigestEntry,
} from "./discord/embeds.ts";
import { msUntilNextUtcMidnight, nowS, previousUtcDay, utcDayString } from "./util/time.ts";

/** Top 10 XP earners for a specific UTC day. */
function topForDay(guildId: string, day: string): LeaderEntry[] {
  return getDb()
    .query(
      `SELECT user_id, xp AS value FROM activity_daily
       WHERE guild_id = ? AND day = ? AND xp > 0
       ORDER BY xp DESC LIMIT 10`,
    )
    .all(guildId, day) as LeaderEntry[];
}

/** Fetch a usable guild text channel by id, or null. */
async function fetchTextChannel(
  client: Client,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  try {
    const fetched = await client.channels.fetch(channelId);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      return fetched as GuildTextBasedChannel;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Post a guild's leaderboard for `day` to its configured channel. Returns false
 * if no channel is configured, the channel is unusable, or there was no activity.
 */
export async function postLeaderboardForGuild(
  client: Client,
  guildId: string,
  day: string,
): Promise<boolean> {
  const channelId = getSettings(guildId).leaderboard_channel_id;
  if (!channelId) return false;

  const entries = topForDay(guildId, day);
  if (entries.length === 0) return false;

  const channel = await fetchTextChannel(client, channelId);
  if (!channel) return false;

  const embed = leaderboardEmbed(`📅 Daily Leaderboard — ${day}`, entries, (id) => `<@${id}>`, "XP");
  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

/** Top recently-active users by uncollected idle gold (read-only preview). */
function idleDigestEntries(guildId: string, now: number): { entries: IdleDigestEntry[]; total: number } {
  const all: IdleDigestEntry[] = [];
  let total = 0;
  for (const userId of recentlyActiveUserIds(guildId, now)) {
    const { rate, pending } = previewIdle(guildId, userId, now);
    if (pending <= 0) continue;
    all.push({ user_id: userId, rate, pending });
    total += pending;
  }
  all.sort((a, b) => b.pending - a.pending);
  return { entries: all.slice(0, 10), total };
}

/**
 * Post the opt-in idle digest: an aggregate "claim your gold" nudge to the
 * configured channel. Read-only — it never credits or mutates state. Returns
 * false if no channel is configured, it's unusable, or nobody has idle waiting.
 */
export async function postIdleDigestForGuild(
  client: Client,
  guildId: string,
  now: number = nowS(),
): Promise<boolean> {
  const channelId = getSettings(guildId).idle_digest_channel_id;
  if (!channelId) return false;

  const { entries, total } = idleDigestEntries(guildId, now);
  if (entries.length === 0) return false;

  const channel = await fetchTextChannel(client, channelId);
  if (!channel) return false;

  try {
    await channel.send({ embeds: [idleDigestEmbed(entries, total)] });
    return true;
  } catch {
    return false;
  }
}

function pruneOldActivity(): void {
  const cutoff = utcDayString(nowS() - ECON.ACTIVITY_PRUNE_DAYS * 86400);
  getDb().run(`DELETE FROM activity_daily WHERE day < ?`, [cutoff]);
}

async function runDailyJob(client: Client): Promise<void> {
  const now = nowS();
  const day = previousUtcDay(now);
  for (const guildId of knownGuildIds()) {
    try {
      await postLeaderboardForGuild(client, guildId, day);
      await postIdleDigestForGuild(client, guildId, now);
    } catch (err) {
      console.error(`Daily job failed for guild ${guildId}:`, err);
    }
  }
  pruneOldActivity();
  console.log(`Daily job complete for ${day}.`);
}

/** Schedule the next run at the upcoming UTC midnight, then re-arm. */
export function startScheduler(client: Client): void {
  const arm = () => {
    const delay = msUntilNextUtcMidnight();
    setTimeout(async () => {
      await runDailyJob(client);
      arm(); // schedule the following day
    }, delay).unref?.();
    console.log(`Next daily leaderboard in ${(delay / 3_600_000).toFixed(2)}h (00:00 UTC).`);
  };
  arm();
}
