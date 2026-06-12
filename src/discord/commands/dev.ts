// Dev-only command (registered only when DEVMODE is truthy — see config.ts and
// commands/index.ts). Lets anyone set a member's gold or XP directly for testing.
// This mints arbitrary balances, so DEVMODE should stay off in production.
import { MessageFlags } from "discord.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "./types.ts";
import { tx } from "../../db/db.ts";
import { setGold, setXp } from "../../game/users.ts";

export const dev: Command = {
  data: new SlashCommandBuilder()
    .setName("dev")
    .setDescription("Dev tools (DEVMODE only): set a member's gold or XP")
    .addSubcommand((s) =>
      s
        .setName("set-gold")
        .setDescription("Set a member's gold to an exact amount")
        .addIntegerOption((o) =>
          o.setName("amount").setDescription("Gold to set").setRequired(true).setMinValue(0),
        )
        .addUserOption((o) => o.setName("user").setDescription("Target (default: you)")),
    )
    .addSubcommand((s) =>
      s
        .setName("set-xp")
        .setDescription("Set a member's total XP (level is recomputed)")
        .addIntegerOption((o) =>
          o.setName("amount").setDescription("Total XP to set").setRequired(true).setMinValue(0),
        )
        .addUserOption((o) => o.setName("user").setDescription("Target (default: you)")),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser("user") ?? interaction.user;
    const amount = interaction.options.getInteger("amount", true);

    if (sub === "set-gold") {
      tx(() => setGold(guildId, target.id, amount));
      await interaction.reply({
        content: `🛠️ Set <@${target.id}>'s gold to **${amount}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // set-xp
    const { level } = tx(() => setXp(guildId, target.id, amount));
    await interaction.reply({
      content: `🛠️ Set <@${target.id}>'s XP to **${amount}** (now level **${level}**).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
