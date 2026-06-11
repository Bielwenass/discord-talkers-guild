import { MessageFlags } from "discord.js";
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "./types.ts";
import { nowS } from "../../util/time.ts";
import { ECON } from "../../config.ts";
import { validateWager, powerOf } from "../../game/duels.ts";
import { duelWinProbability } from "../../game/formulas.ts";
import { duelOnCooldown } from "../state.ts";

export const duel: Command = {
  data: new SlashCommandBuilder()
    .setName("duel")
    .setDescription("Challenge another member to a gold duel")
    .addUserOption((o) => o.setName("user").setDescription("Who to challenge").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("wager").setDescription("Gold to wager").setRequired(true).setMinValue(ECON.DUEL_MIN_WAGER),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const challenger = interaction.user;
    const target = interaction.options.getUser("user", true);
    const wager = interaction.options.getInteger("wager", true);
    const now = nowS();

    if (target.bot || target.id === challenger.id) {
      await interaction.reply({ content: "Pick another (non-bot) member.", flags: MessageFlags.Ephemeral });
      return;
    }
    const cd = duelOnCooldown(challenger.id, target.id, now);
    if (cd > 0) {
      await interaction.reply({ content: `⏳ This pair is on cooldown for ${cd}s.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const valid = validateWager(guildId, challenger.id, target.id, wager, now);
    if (!valid.ok) {
      await interaction.reply({ content: `❌ ${valid.reason}`, flags: MessageFlags.Ephemeral });
      return;
    }

    const pWin = duelWinProbability(powerOf(guildId, challenger.id), powerOf(guildId, target.id));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`duel:accept:${challenger.id}:${target.id}:${wager}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`duel:decline:${challenger.id}:${target.id}:${wager}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      content:
        `⚔️ <@${challenger.id}> challenges <@${target.id}> for **${wager}** gold each!\n` +
        `Challenger win chance: **${(pWin * 100).toFixed(0)}%**. <@${target.id}>, do you accept?`,
      components: [row],
    });
  },
};
