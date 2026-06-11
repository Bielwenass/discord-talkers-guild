// guild_config helpers (design §12). Settings are a JSON blob: channel weights,
// role rewards, leaderboard channel, raid config.
import { getDb } from "../db/db.ts";
import { ECON } from "../config.ts";
import type { GuildSettings } from "../types.ts";

export function getSettings(guildId: string): GuildSettings {
  const row = getDb()
    .query(`SELECT settings FROM guild_config WHERE guild_id = ?`)
    .get(guildId) as { settings: string } | null;
  if (!row) return {};
  try {
    return JSON.parse(row.settings) as GuildSettings;
  } catch {
    return {};
  }
}

export function saveSettings(guildId: string, settings: GuildSettings): void {
  getDb().run(
    `INSERT INTO guild_config (guild_id, settings) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET settings = excluded.settings`,
    [guildId, JSON.stringify(settings)],
  );
}

export function updateSettings(
  guildId: string,
  mutate: (s: GuildSettings) => void,
): GuildSettings {
  const s = getSettings(guildId);
  mutate(s);
  saveSettings(guildId, s);
  return s;
}

export function channelWeight(guildId: string, channelId: string): number {
  const s = getSettings(guildId);
  return s.channel_weights?.[channelId] ?? ECON.DEFAULT_CHANNEL_WEIGHT;
}

/** All guild_ids the bot has any config or activity for (for the daily job). */
export function knownGuildIds(): string[] {
  const rows = getDb()
    .query(
      `SELECT guild_id FROM guild_config
       UNION SELECT DISTINCT guild_id FROM users`,
    )
    .all() as { guild_id: string }[];
  return rows.map((r) => r.guild_id);
}
