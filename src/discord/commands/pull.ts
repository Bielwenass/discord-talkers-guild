import { MessageFlags } from "discord.js";
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import type { Command } from "./types.ts";
import { tx } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { effectiveStats, getOrCreateUser, spendGold } from "../../game/users.ts";
import { rollPull, type PullOutcome } from "../../game/inventory.ts";
import { pullCost } from "../../game/gacha.ts";
import { pullEmbed } from "../embeds.ts";

export interface PullResponse {
  ok: boolean;
  reason?: string;
  outcomes?: PullOutcome[];
  balance?: number;
}

/** Shared pull logic used by /pull and the pull-again button. */
export function doPull(guildId: string, userId: string, tenPull: boolean, now: number): PullResponse {
  const cost = pullCost(tenPull);
  return tx(() => {
    if (!spendGold(guildId, userId, cost, now)) {
      const bal = getOrCreateUser(guildId, userId).gold;
      return { ok: false, reason: `Not enough gold (need ${cost}, have ${bal}).`, balance: bal };
    }
    const user = getOrCreateUser(guildId, userId);
    const luk = effectiveStats(user).luk;
    const n = tenPull ? 10 : 1;
    const outcomes: PullOutcome[] = [];
    for (let i = 0; i < n; i++) outcomes.push(rollPull(guildId, userId, luk, 0, now));
    return { ok: true, outcomes, balance: getOrCreateUser(guildId, userId).gold };
  });
}

export function pullReply(res: PullResponse): InteractionReplyOptions {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pull:again").setLabel("Pull Again (250)").setStyle(ButtonStyle.Primary).setEmoji("🎲"),
    new ButtonBuilder().setCustomId("pull:ten").setLabel("Ten-Pull (2250)").setStyle(ButtonStyle.Secondary).setEmoji("🎰"),
    new ButtonBuilder().setCustomId("pull:salvagecommons").setLabel("Salvage Commons").setStyle(ButtonStyle.Danger).setEmoji("♻️"),
  );
  return {
    embeds: [pullEmbed(res.outcomes!)],
    content: `💰 Balance: **${res.balance}** gold`,
    components: [row],
  };
}

export const pull: Command = {
  data: new SlashCommandBuilder()
    .setName("pull")
    .setDescription("Spend gold on a gacha pull")
    .addBooleanOption((o) =>
      o.setName("x10").setDescription("Ten-pull (2250 gold, 10% discount)"),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const tenPull = interaction.options.getBoolean("x10") ?? false;
    const res = doPull(interaction.guildId!, interaction.user.id, tenPull, nowS());
    if (!res.ok) {
      await interaction.reply({ content: `❌ ${res.reason}`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply(pullReply(res));
  },
};
