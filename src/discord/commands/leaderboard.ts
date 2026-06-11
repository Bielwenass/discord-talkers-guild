import { MessageFlags } from "discord.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "./types.ts";
import { getDb } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { utcDayString } from "../../util/time.ts";
import { leaderboardEmbed, type LeaderEntry } from "../embeds.ts";

type Board = "xp" | "gold" | "weekly";

export function topEntries(guildId: string, board: Board, now: number): LeaderEntry[] {
  const db = getDb();
  if (board === "weekly") {
    const cutoff = utcDayString(now - 7 * 86400);
    return db
      .query(
        `SELECT user_id, SUM(xp) AS value FROM activity_daily
         WHERE guild_id = ? AND day >= ? GROUP BY user_id
         ORDER BY value DESC LIMIT 10`,
      )
      .all(guildId, cutoff) as LeaderEntry[];
  }
  const col = board === "gold" ? "gold" : "xp";
  return db
    .query(
      `SELECT user_id, ${col} AS value FROM users
       WHERE guild_id = ? ORDER BY ${col} DESC LIMIT 10`,
    )
    .all(guildId) as LeaderEntry[];
}

export const leaderboard: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top 10 members")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Which board")
        .addChoices(
          { name: "XP (all-time)", value: "xp" },
          { name: "Gold", value: "gold" },
          { name: "Weekly XP", value: "weekly" },
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const board = (interaction.options.getString("type") ?? "xp") as Board;
    const entries = topEntries(interaction.guildId!, board, nowS());
    const titles: Record<Board, string> = {
      xp: "🏆 XP Leaderboard",
      gold: "💰 Gold Leaderboard",
      weekly: "📅 Weekly XP Leaderboard",
    };
    const units: Record<Board, string> = { xp: "XP", gold: "gold", weekly: "XP this week" };
    await interaction.reply({
      embeds: [leaderboardEmbed(titles[board], entries, (id) => `<@${id}>`, units[board])],
    });
  },
};
