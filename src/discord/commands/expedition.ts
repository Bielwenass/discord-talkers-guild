import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import type { Command } from "./types.ts";
import { tx } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { EXPEDITIONS, type ExpeditionTier } from "../../config.ts";
import {
  activeExpedition,
  resolveExpeditionIfDue,
  startExpedition,
} from "../../game/expeditions.ts";
import { pullEmbed } from "../embeds.ts";

export const expedition: Command = {
  data: new SlashCommandBuilder()
    .setName("expedition")
    .setDescription("Send your character on an idle expedition")
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Begin an expedition")
        .addStringOption((o) =>
          o
            .setName("tier")
            .setDescription("Which expedition")
            .setRequired(true)
            .addChoices(
              { name: "Scout — 4h, 2× hourly gold, 1 roll", value: "scout" },
              { name: "Delve — 8h, 4× hourly gold, 1 roll at +5 LUK", value: "delve" },
              { name: "Vigil — 24h, 8× hourly gold, 2 rolls at +10 LUK", value: "vigil" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Check or collect your expedition"),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const now = nowS();
    const sub = interaction.options.getSubcommand();

    // always try to resolve a finished expedition first
    const resolved = tx(() => resolveExpeditionIfDue(guildId, userId, now));
    if (resolved) {
      const embed = new EmbedBuilder()
        .setTitle(`🧭 ${resolved.tier[0]!.toUpperCase() + resolved.tier.slice(1)} returned!`)
        .setColor(0x3fb950)
        .setDescription(
          `**+${resolved.gold}** gold` +
            (resolved.items.length ? ` and ${resolved.items.length} item(s):` : ""),
        );
      const embeds = [embed];
      if (resolved.items.length) embeds.push(pullEmbed(resolved.items));
      // fall through is fine; show result, and if they wanted to start, continue below
      if (sub === "status") {
        await interaction.reply({ embeds });
        return;
      }
      // for "start", post the result then proceed to start a new one
      await interaction.reply({ embeds });
    }

    if (sub === "status") {
      const active = activeExpedition(guildId, userId);
      if (!active) {
        await interaction.reply({
          content: "No active expedition. Start one with `/expedition start`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: `🧭 **${active.tier}** in progress — returns <t:${active.ends_at}:R> (snapshot rate ${active.rate_snap}/h).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // sub === "start"
    const tier = interaction.options.getString("tier", true) as ExpeditionTier;
    const start = tx(() => startExpedition(guildId, userId, tier, now));
    const cfg = EXPEDITIONS[tier];
    const payload: InteractionReplyOptions = start.ok
      ? {
          content: `🧭 **${tier}** started — returns <t:${start.endsAt}:R>. Snapshot idle rate: ${start.rateSnap}/h → ~${cfg.goldMult * start.rateSnap}g + ${cfg.rolls} roll(s).`,
        }
      : { content: `❌ ${start.reason}`, flags: MessageFlags.Ephemeral };

    if (resolved) await interaction.followUp(payload);
    else await interaction.reply(payload);
  },
};
