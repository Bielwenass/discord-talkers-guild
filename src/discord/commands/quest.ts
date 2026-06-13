import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "./types.ts";
import type { StatKey } from "../../config.ts";
import { tx } from "../../db/db.ts";
import { nowS, utcDayString } from "../../util/time.ts";
import {
  dailyOffers,
  previewOffer,
  startSoloQuest,
  activeQuestFor,
  resolveQuestIfDue,
  getTemplate,
  serverQuestStatus,
  type QuestOffer,
} from "../../game/quests.ts";
import { openParty, userInPendingParty } from "../parties.ts";
import { pullEmbed } from "../embeds.ts";

const STAT_LABEL: Record<StatKey, string> = { str: "STR", int: "INT", cha: "CHA", luk: "LUK" };
const STAT_FLAVOR: Record<StatKey, string> = {
  str: "Plunder",
  int: "Study",
  cha: "Fellowship",
  luk: "Fortune",
};

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function offerLine(guildId: string, userId: string, o: QuestOffer, now: number): string {
  const p = previewOffer(guildId, userId, o, now);
  const stat = o.template.stat;
  const flavor = STAT_FLAVOR[stat];

  // Reward summary depends on stat profile
  let rewardStr: string;
  if (stat === "luk") {
    const pct1 = Math.round(p.itemPct * 100);
    const pct2 = Math.round(p.secondRollPct * 100);
    rewardStr = `🎁 ${pct1}% item${pct2 > 0 ? ` + ${pct2}% bonus` : ""}`;
  } else {
    const parts: string[] = [];
    if (p.gold > 0) parts.push(`💰 ${p.gold}`);
    if (p.xp > 0) parts.push(`✨ ${p.xp} XP`);
    rewardStr = parts.join(" · ") || "—";
    if (stat === "cha") rewardStr += " _(×0.6 solo)_";
  }

  return (
    `**${o.index + 1}. ${o.template.name}** — ${STAT_LABEL[stat]} · ${flavor} · ${o.template.kind} · ${o.tier}\n` +
    `   ⏱ ${fmtDuration(p.durationS)} · ${rewardStr} _(eff ×${p.eff.toFixed(2)})_`
  );
}

export const quest: Command = {
  data: new SlashCommandBuilder()
    .setName("quest")
    .setDescription("Daily quests: a board dealt to you, scaling off your stats")
    .addSubcommand((s) => s.setName("board").setDescription("Show today's quest board and the server quest"))
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Begin a solo quest from your board")
        .addIntegerOption((o) =>
          o.setName("offer").setDescription("Which offer (1-3)").setRequired(true).setMinValue(1).setMaxValue(3),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("party")
        .setDescription("Open a party quest from your board for others to join")
        .addIntegerOption((o) =>
          o.setName("offer").setDescription("Which offer (1-3)").setRequired(true).setMinValue(1).setMaxValue(3),
        ),
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

    // Lazily resolve a finished quest (settles all party members) and report it.
    const resolved = tx(() => resolveQuestIfDue(guildId, userId, now));
    if (resolved) {
      const mine = resolved.rewards.find((r) => r.userId === userId);
      const stat = resolved.template.stat;
      const rewardDesc =
        stat === "luk"
          ? mine && mine.items.length
            ? `${mine.items.length} item(s) found`
            : "Nothing found this time."
          : `**+${mine?.gold ?? 0}** gold · **+${mine?.xp ?? 0}** XP`;
      const embed = new EmbedBuilder()
        .setTitle(`✅ ${resolved.template.name} complete!`)
        .setColor(0x3fb950)
        .setDescription(
          (resolved.memberCount > 1 ? `Party of ${resolved.memberCount} — your share:\n` : "") +
            rewardDesc,
        );
      const embeds = [embed];
      if (mine && mine.items.length) embeds.push(pullEmbed(mine.items));
      await interaction.reply({ embeds });
      return;
    }

    if (sub === "start" || sub === "party") {
      const idx = interaction.options.getInteger("offer", true) - 1;
      const offers = dailyOffers(guildId, userId, utcDayString(now));
      const offer = offers[idx];
      if (!offer) {
        await interaction.reply({ content: "That offer isn't on today's board.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (activeQuestFor(guildId, userId) || userInPendingParty(guildId, userId)) {
        await interaction.reply({ content: "❌ You already have a quest or a pending party.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === "start") {
        const res = tx(() => startSoloQuest(guildId, userId, idx, now));
        if (!res.ok) {
          await interaction.reply({ content: `❌ ${res.reason}`, flags: MessageFlags.Ephemeral });
          return;
        }
        const q = res.quest;
        await interaction.reply({
          content: `🧭 **${q.template.name}** (${q.tier}, ${q.template.kind}) started — returns <t:${q.endsAt}:R> _(eff ×${q.eff.toFixed(2)})_.`,
        });
        return;
      }

      // party: open a recruiting lobby
      const partyId = `${interaction.id}`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`quest:join:${partyId}`).setLabel("Join").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`quest:pstart:${partyId}`).setLabel("Start now").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`quest:pcancel:${partyId}`).setLabel("Disband").setStyle(ButtonStyle.Danger),
      );
      await interaction.reply({
        content:
          `🧭 <@${userId}> is forming a party for **${offer.template.name}** ` +
          `(${STAT_LABEL[offer.template.stat]} · ${offer.template.kind} · ${offer.tier}).\n` +
          `Press **Join** to add yourself (up to 4). Efficiency = highest ${STAT_LABEL[offer.template.stat]} + 20% of the rest. ` +
          `Auto-starts in 15 min or when the opener presses **Start now**.`,
        components: [row],
      });
      const message = await interaction.fetchReply();
      openParty({
        partyId,
        guildId,
        templateId: offer.template.template_id,
        tier: offer.tier,
        openerId: userId,
        members: [userId],
        message,
      });
      return;
    }

    // board (default)
    const offers = dailyOffers(guildId, userId, utcDayString(now));
    const active = activeQuestFor(guildId, userId);
    const sq = serverQuestStatus(guildId, userId, now);
    const sqTpl = sq.template;

    const completionPct = Math.round(sq.completion * 100);
    const sqStatusLine = sq.isContributor
      ? `You: ${sq.myMsgs} msgs ✅ contributor`
      : sq.myMsgs > 0
        ? `You: ${sq.myMsgs} msg(s) — need ${3 - sq.myMsgs} more to contribute`
        : `You: no counted messages today — bystander payout if active in last 14d`;

    const embed = new EmbedBuilder()
      .setTitle("🗺️ Quest Board")
      .setColor(0x5865f2)
      .setDescription(offers.map((o) => offerLine(guildId, userId, o, now)).join("\n\n"))
      .addFields(
        {
          name: "Your slot",
          value: active
            ? `On **${getTemplate(active.template_id)?.name ?? "a quest"}** — returns <t:${active.ends_at}:R>.`
            : "Free — `/quest start <1-3>` or `/quest party <1-3>`.",
        },
        {
          name: `🏰 Server quest — ${STAT_LABEL[sqTpl.stat]}`,
          value:
            `${sq.quest.progress}/${sq.quest.goal} messages · completion **${completionPct}%**` +
            (sq.completion >= 0.5 ? " ✅" : " _(need ≥50%)_") +
            `\n${sqStatusLine}` +
            `\n_Payout is automatic at midnight UTC._`,
        },
      )
      .setFooter({ text: "Offers reroll at 00:00 UTC." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
