import { MessageFlags } from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";
import type { Command } from "./types.ts";
import { tx, getDb } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { ECON } from "../../config.ts";
import { activeRaid, spawnRaid, resolveRaidIfDone, strikeRaid } from "../../game/raids.ts";
import { announceRaidResolution } from "../raidAnnounce.ts";

export const raid: Command = {
  data: new SlashCommandBuilder()
    .setName("raid")
    .setDescription("Boss raid status, damage board, and (admin) spawning")
    .addSubcommand((s) => s.setName("status").setDescription("Show the active raid and damage board"))
    .addSubcommand((s) =>
      s.setName("strike").setDescription("Strike the boss for a STR-scaled chunk of its HP (4h cooldown)"),
    )
    .addSubcommand((s) =>
      s.setName("spawn").setDescription("(Admin) Spawn a boss scaled to recent activity"),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const now = nowS();
    const sub = interaction.options.getSubcommand();

    if (sub === "spawn") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "🔒 Needs Manage Server.", flags: MessageFlags.Ephemeral });
        return;
      }
      const res = tx(() => spawnRaid(guildId, now));
      if (!res.ok) {
        await interaction.reply({ content: `❌ ${res.reason}`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({
        content:
          `🐉 **A boss appears!** HP **${res.hp.toLocaleString()}**, flees <t:${res.endsAt}:R>.\n` +
          `For the next ${ECON.RAID_WINDOW_H}h, **all XP earned also damages the boss** ` +
          `(STR multiplies your hits). Chat to fight, or use **/raid strike** every 4h!`,
      });
      return;
    }

    if (sub === "strike") {
      const res = tx(() => strikeRaid(guildId, interaction.user.id, now));
      if (!res.ok) {
        const tail = res.cooldownS ? ` Ready <t:${now + res.cooldownS}:R>.` : "";
        await interaction.reply({ content: `❌ ${res.reason}${tail}`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({
        content:
          `🗡️ <@${interaction.user.id}> strikes for **${res.dealt.toLocaleString()}** ` +
          `(${(res.pct * 100).toFixed(1)}% of max HP)!`,
      });
      if (res.justKilled) {
        const resolution = tx(() => resolveRaidIfDone(guildId, now));
        if (resolution) {
          await announceRaidResolution(interaction.channel as GuildTextBasedChannel, resolution);
        }
      }
      return;
    }

    // status (also lazily resolves a finished raid)
    const resolution = tx(() => resolveRaidIfDone(guildId, now));
    if (resolution) {
      await announceRaidResolution(interaction.channel as GuildTextBasedChannel, resolution);
      await interaction.reply({ content: "The raid has concluded — see above!", flags: MessageFlags.Ephemeral });
      return;
    }

    const r = activeRaid(guildId);
    if (!r) {
      await interaction.reply({ content: "No active raid. An admin can `/raid spawn`.", flags: MessageFlags.Ephemeral });
      return;
    }
    const board = getDb()
      .query(
        `SELECT user_id, damage FROM raid_damage WHERE guild_id = ? ORDER BY damage DESC LIMIT 10`,
      )
      .all(guildId) as { user_id: string; damage: number }[];
    const pct = Math.max(0, Math.round((r.hp_left / r.hp_max) * 100));
    const lines =
      board.length === 0
        ? "_No damage yet._"
        : board
            .map((b, i) => `\`#${i + 1}\` <@${b.user_id}> — ${b.damage.toLocaleString()} dmg`)
            .join("\n");

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🐉 Active Raid")
          .setColor(0xda3633)
          .setDescription(
            `HP: **${r.hp_left.toLocaleString()} / ${r.hp_max.toLocaleString()}** (${pct}%)\n` +
              `Flees <t:${r.ends_at}:R>\n\n**Damage board**\n${lines}`,
          ),
      ],
    });
  },
};
