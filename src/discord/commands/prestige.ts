import { MessageFlags } from "discord.js";
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "./types.ts";
import { getOrCreateUser } from "../../game/users.ts";
import { prestigeRequirement } from "../../game/prestige.ts";

export const prestige: Command = {
  data: new SlashCommandBuilder()
    .setName("prestige")
    .setDescription("Reset for a permanent +10% income multiplier (keeps your gear)"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const user = getOrCreateUser(interaction.guildId!, interaction.user.id);
    const required = prestigeRequirement(user.prestige);
    if (user.level < required) {
      await interaction.reply({
        content: `🔒 Prestige unlocks at **level ${required}** (you're level ${user.level}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("prestige:confirm")
        .setLabel("Prestige now")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("✦"),
    );
    await interaction.reply({
      content:
        `✦ **Prestige ${user.prestige} → ${user.prestige + 1}**\n` +
        `This resets level, XP, gold, and stats. Your **inventory is kept**.\n` +
        `Permanent income bonus becomes **+${(user.prestige + 1) * 10}%**. Confirm?`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
