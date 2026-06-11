import { MessageFlags } from "discord.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "./types.ts";
import { tx, getDb } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { STAT_KEYS, type StatKey } from "../../config.ts";
import { allocateStat, getOrCreateUser, spendGold } from "../../game/users.ts";
import { statPointCost } from "../../game/formulas.ts";

const STAT_DESC: Record<StatKey, string> = {
  str: "STR — +2 duel power / point",
  int: "INT — +2% message XP / point",
  cha: "CHA — +5% reply & reaction XP / point",
  luk: "LUK — +0.5% better gacha odds / point",
};

interface UpgradeResult {
  ok: boolean;
  reason?: string;
  via?: "point" | "gold";
  cost?: number;
  newValue?: number;
}

export function upgradeStat(
  guildId: string,
  userId: string,
  stat: StatKey,
  method: "auto" | "point" | "gold",
  now: number,
): UpgradeResult {
  return tx(() => {
    const user = getOrCreateUser(guildId, userId);
    const usePoint = method === "point" || (method === "auto" && user.stat_points > 0);
    if (usePoint) {
      if (!allocateStat(guildId, userId, stat)) {
        return { ok: false, reason: "No unspent stat points." };
      }
      return { ok: true, via: "point", newValue: user[stat] + 1 };
    }
    // buy with gold at geometric cost
    const cost = statPointCost(user.bought_points);
    if (!spendGold(guildId, userId, cost, now)) {
      return { ok: false, reason: `Not enough gold (need ${cost}).` };
    }
    getDb().run(
      `UPDATE users SET ${stat} = ${stat} + 1, bought_points = bought_points + 1
       WHERE guild_id = ? AND user_id = ?`,
      [guildId, userId],
    );
    return { ok: true, via: "gold", cost, newValue: user[stat] + 1 };
  });
}

export const upgrade: Command = {
  data: new SlashCommandBuilder()
    .setName("upgrade")
    .setDescription("Spend a stat point (or gold) to raise a stat")
    .addStringOption((o) =>
      o
        .setName("stat")
        .setDescription("Which stat to raise")
        .setRequired(true)
        .addChoices(
          { name: "STR", value: "str" },
          { name: "INT", value: "int" },
          { name: "CHA", value: "cha" },
          { name: "LUK", value: "luk" },
        ),
    )
    .addStringOption((o) =>
      o
        .setName("with")
        .setDescription("Pay with a level-up point or gold (default: point if available)")
        .addChoices({ name: "Stat point", value: "point" }, { name: "Gold", value: "gold" }),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const stat = interaction.options.getString("stat", true) as StatKey;
    if (!STAT_KEYS.includes(stat)) {
      await interaction.reply({ content: "Unknown stat.", flags: MessageFlags.Ephemeral });
      return;
    }
    const method = (interaction.options.getString("with") ?? "auto") as "auto" | "point" | "gold";
    const res = upgradeStat(interaction.guildId!, interaction.user.id, stat, method, nowS());
    if (!res.ok) {
      await interaction.reply({ content: `❌ ${res.reason}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const paid = res.via === "gold" ? ` for **${res.cost}** gold` : " with a stat point";
    await interaction.reply({
      content: `✅ ${STAT_DESC[stat]}\n**${stat.toUpperCase()}** is now **${res.newValue}** (raised${paid}).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
