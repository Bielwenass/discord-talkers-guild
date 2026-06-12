import { MessageFlags } from "discord.js";
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "./types.ts";
import { tx } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { claimIdle, getOrCreateUser } from "../../game/users.ts";
import { resolveExpeditionIfDue } from "../../game/expeditions.ts";
import { resolveQuestIfDue } from "../../game/quests.ts";
import { pullEmbed } from "../embeds.ts";

export const claim: Command = {
  data: new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Collect your idle gold (and resolve a finished expedition)"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const now = nowS();

    const { claimed, exp, questRes, balance } = tx(() => {
      const exp = resolveExpeditionIfDue(guildId, userId, now);
      const questRes = resolveQuestIfDue(guildId, userId, now);
      const claimed = claimIdle(guildId, userId, now);
      const balance = getOrCreateUser(guildId, userId).gold;
      return { claimed, exp, questRes, balance };
    });

    const embed = new EmbedBuilder()
      .setTitle("💰 Claim")
      .setColor(0xe3b341)
      .setDescription(
        `Idle income: **+${claimed.gold}** gold _(rate ${claimed.rate.toFixed(1)}/h)_\n` +
          `Balance: **${balance}** gold`,
      );

    const embeds = [embed];
    if (exp) {
      embed.addFields({
        name: `🧭 ${exp.tier[0]!.toUpperCase() + exp.tier.slice(1)} expedition returned`,
        value: `**+${exp.gold}** gold` + (exp.items.length ? ` and ${exp.items.length} item(s):` : ""),
      });
      if (exp.items.length) embeds.push(pullEmbed(exp.items));
    }
    if (questRes) {
      const mine = questRes.rewards.find((r) => r.userId === userId);
      embed.addFields({
        name: `✅ Quest complete: ${questRes.template.name}`,
        value:
          `**+${mine?.gold ?? 0}** gold · **+${mine?.xp ?? 0}** XP` +
          (mine && mine.items.length ? ` and ${mine.items.length} item(s):` : ""),
      });
      if (mine && mine.items.length) embeds.push(pullEmbed(mine.items));
    }

    await interaction.reply({ embeds });
  },
};
