import { MessageFlags } from "discord.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "./types.ts";
import { tx } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { claimIdle, getOrCreateUser } from "../../game/users.ts";
import { resolveExpeditionIfDue } from "../../game/expeditions.ts";
import { profileEmbed } from "../embeds.ts";

export const profile: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your guild RPG profile (or another member's)")
    .addUserOption((o) => o.setName("user").setDescription("Whose profile to view")),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const target = interaction.options.getUser("user") ?? interaction.user;
    const now = nowS();

    const user = tx(() => {
      // own profile: settle idle + any finished expedition first
      if (target.id === interaction.user.id) {
        claimIdle(guildId, target.id, now);
        resolveExpeditionIfDue(guildId, target.id, now);
      }
      return getOrCreateUser(guildId, target.id);
    });

    const displayName =
      interaction.guild?.members.cache.get(target.id)?.displayName ?? target.username;
    await interaction.reply({ embeds: [profileEmbed(user, displayName, now)] });
  },
};
