// The one scheduled job in the system: post each guild's daily leaderboard at
// 00:00 UTC for the day that just ended, award crowns, pay out the server quest,
// and prune old activity rows.
import type { Client, GuildTextBasedChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { getDb } from "./db/db.ts";
import { ECON } from "./config.ts";
import { knownGuildIds, getSettings } from "./game/guilds.ts";
import { previewIdle, recentlyActiveUserIds, getOrCreateUser, effectiveStats } from "./game/users.ts";
import { rollPull } from "./game/inventory.ts";
import { payServerQuestForGuild } from "./game/quests.ts";
import {
  leaderboardEmbed,
  idleDigestEmbed,
  pullEmbed,
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

// --- §F crowns ---

interface CrownWinners {
  mostActive: string[];     // 🗡 Most Active (msg count)
  mostEsteemed: string[];   // 👑 Most Esteemed (replies + reactions)
}

function crownWinnersForDay(guildId: string, day: string): CrownWinners {
  const db = getDb();

  const activeRows = db
    .query(
      `SELECT user_id, msgs FROM activity_daily
       WHERE guild_id = ? AND day = ? AND msgs >= ?
       ORDER BY msgs DESC`,
    )
    .all(guildId, day, ECON.CROWN_ACTIVE_THRESHOLD) as { user_id: string; msgs: number }[];

  let mostActive: string[] = [];
  if (activeRows.length > 0) {
    const maxMsgs = activeRows[0]!.msgs;
    mostActive = activeRows.filter((r) => r.msgs === maxMsgs).map((r) => r.user_id);
  }

  const esteemRows = db
    .query(
      `SELECT user_id,
              COALESCE(replies_recv, 0) + COALESCE(reactions_recv, 0) AS social
       FROM activity_daily
       WHERE guild_id = ? AND day = ?
         AND (COALESCE(replies_recv, 0) + COALESCE(reactions_recv, 0)) >= ?
       ORDER BY social DESC`,
    )
    .all(guildId, day, ECON.CROWN_ESTEEM_THRESHOLD) as { user_id: string; social: number }[];

  let mostEsteemed: string[] = [];
  if (esteemRows.length > 0) {
    const maxSocial = esteemRows[0]!.social;
    mostEsteemed = esteemRows.filter((r) => r.social === maxSocial).map((r) => r.user_id);
  }

  return { mostActive, mostEsteemed };
}

/**
 * Award crowns: one free pull each for 🗡 Most Active and 👑 Most Esteemed.
 * Returns embeds to append to the leaderboard post.
 */
function awardCrowns(
  guildId: string,
  day: string,
  now: number,
): EmbedBuilder[] {
  const { mostActive, mostEsteemed } = crownWinnersForDay(guildId, day);
  const embeds: EmbedBuilder[] = [];

  const rollForUsers = (
    emoji: string,
    title: string,
    threshold: string,
    winners: string[],
    noAward: string,
  ): void => {
    if (winners.length === 0) {
      embeds.push(
        new EmbedBuilder()
          .setTitle(`${emoji} ${title}`)
          .setColor(0xe3b341)
          .setDescription(`_No one reached the threshold (${threshold}) today._\n${noAward}`),
      );
      return;
    }

    const pullLines: string[] = [];
    for (const userId of winners) {
      try {
        const user = getOrCreateUser(guildId, userId);
        const luk = effectiveStats(user).luk;
        const outcome = rollPull(guildId, userId, luk, 0, now);
        const [line] = pullEmbed([outcome]).data.description?.split("\n") ?? ["?"];
        pullLines.push(`<@${userId}>: ${line}`);
      } catch {
        pullLines.push(`<@${userId}>: _roll failed_`);
      }
    }
    embeds.push(
      new EmbedBuilder()
        .setTitle(`${emoji} ${title}`)
        .setColor(0xe3b341)
        .setDescription(
          winners.map((id) => `<@${id}>`).join(", ") +
            "\n\n" +
            pullLines.join("\n"),
        ),
    );
  };

  rollForUsers(
    "🗡",
    "Most Active",
    `≥${ECON.CROWN_ACTIVE_THRESHOLD} msgs`,
    mostActive,
    "No crown awarded.",
  );
  rollForUsers(
    "👑",
    "Most Esteemed",
    `≥${ECON.CROWN_ESTEEM_THRESHOLD} social`,
    mostEsteemed,
    "No crown awarded.",
  );

  return embeds;
}

// --- leaderboard + crowns + server quest payout ---

export async function postLeaderboardForGuild(
  client: Client,
  guildId: string,
  day: string,
  now: number,
): Promise<boolean> {
  const channelId = getSettings(guildId).leaderboard_channel_id;
  if (!channelId) return false;

  const entries = topForDay(guildId, day);
  if (entries.length === 0) return false;

  const channel = await fetchTextChannel(client, channelId);
  if (!channel) return false;

  const leaderEmbed = leaderboardEmbed(
    `📅 Daily Leaderboard — ${day}`,
    entries,
    (id) => `<@${id}>`,
    "XP",
  );

  // Server quest payout (runs inside this same midnight trigger)
  const { lines: sqLines } = payServerQuestForGuild(guildId, day, now);

  if (sqLines.length > 0) {
    const existing = leaderEmbed.data.description ?? "";
    leaderEmbed.setDescription(existing + "\n\n" + sqLines.join("\n"));
  }

  // Crown award embeds
  const crownEmbeds = awardCrowns(guildId, day, now);

  try {
    await channel.send({ embeds: [leaderEmbed, ...crownEmbeds] });
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
      await postLeaderboardForGuild(client, guildId, day, now);
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
