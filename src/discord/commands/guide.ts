// /guide — a concise, self-contained primer on the stats, the core gameplay loop,
// and the main commands. New members are pointed here on their first /profile.
import { MessageFlags } from "discord.js";
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "./types.ts";

const guideEmbed = new EmbedBuilder()
  .setTitle("📖 Talkers Guild — Quick Guide")
  .setColor(0x5865f2)
  .setDescription(
    "Just by **chatting** you earn XP and gold. XP raises your level (and grants stat " +
      "points + free gacha pulls); gold buys pulls, stats, and duel wagers. Even while " +
      "you're away, recent activity trickles in **idle gold** — collect it with `/claim` " +
      "(it caps at 24h, so check in daily).",
  )
  .addFields(
    {
      name: "Stats (spend points or gold to raise them)",
      value: [
        "**STR** — duel power (+2 per point) AND raid might: it multiplies your boss damage from chatting and powers `/raid strike`. INT earns more for *you*; STR makes you matter more to the *server*.",
        "**INT** — message XP. Each point is +2% XP on everything you say.",
        "**CHA** — social XP. Boosts the XP you get from replies and reactions.",
        "**LUK** — gacha luck. Shifts pull odds off Common toward rarer gear (up to +20%), and makes loot quests (the LUK ones) guarantee an item.",
      ].join("\n"),
    },
    {
      name: "Every stat also scales quests",
      value:
        "Quests are *dealt* to you daily and test a stat — but never gate. The governing stat only " +
        "scales efficiency: `eff = 1 + 0.05 × stat` (up to ×3). Bountiful quests pay more; Swift " +
        "quests finish faster.",
    },
    {
      name: "The loop",
      value: [
        "1. **Talk** → XP + gold (longer messages and replies/reactions earn more).",
        "2. **Level up** → stat points every level, a free pull every 5 levels.",
        "3. **Spend** → `/pull` for gear, `/upgrade` for stats, `/expedition` for idle hauls.",
        "4. **Adventure** → `/quest` for a daily board (solo, party, or the server goal).",
        "5. **Compete** → `/duel` (the loser earns XP) and join guild `/raid`s (chat + `/raid strike`).",
        "6. At level 50, `/prestige` for a permanent income bonus (keeps your gear).",
      ].join("\n"),
    },
    {
      name: "Main commands",
      value: [
        "`/profile` — your level, stats, gear, gold, idle rate",
        "`/claim` — collect idle gold (and finished expeditions/quests)",
        "`/pull` — roll for gear (single or ten-pull)",
        "`/inventory` — equip or salvage items",
        "`/upgrade` — spend points/gold on stats",
        "`/expedition` — send yourself off for a timed gold + gear haul",
        "`/quest` — daily quest board: solo, party, or the server quest",
        "`/duel` — wager gold against another member (the loser still earns XP)",
        "`/raid` — fight the guild boss; `/raid strike` every 4h for a STR-scaled hit",
        "`/leaderboard` — see the top talkers",
      ].join("\n"),
    },
  )
  .setFooter({ text: "Tip: gear contributes to duel power and stats once equipped." });

export const guide: Command = {
  data: new SlashCommandBuilder()
    .setName("guide")
    .setDescription("How the game works: stats, the core loop, and the main commands"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({ embeds: [guideEmbed], flags: MessageFlags.Ephemeral });
  },
};
