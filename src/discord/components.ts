import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
// Routes button / select-menu interactions by customId convention "action:args…".
import {
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type MessageComponentInteraction,
} from "discord.js";
import { tx } from "../db/db.ts";
import { nowS } from "../util/time.ts";
import { doPull, pullReply } from "./commands/pull.ts";
import { buildInventoryReply, salvageCommons } from "./commands/inventory.ts";
import { equip, salvage, getItem } from "../game/inventory.ts";
import { resolveDuel } from "../game/duels.ts";
import { doPrestige } from "../game/prestige.ts";
import { activeQuestFor, getTemplate } from "../game/quests.ts";
import { duelOnCooldown, markDuel } from "./state.ts";
import { getParty, joinParty, finalizeParty, userInPendingParty } from "./parties.ts";

export async function handleComponent(interaction: MessageComponentInteraction): Promise<void> {
  if (!interaction.inGuild()) return;
  const [action, ...args] = interaction.customId.split(":");

  if (interaction.isButton()) {
    switch (action) {
      case "pull":
        return handlePullButton(interaction, args[0]!);
      case "duel":
        return handleDuelButton(interaction, args);
      case "prestige":
        return handlePrestigeButton(interaction);
      case "quest":
        return handleQuestButton(interaction, args);
    }
  }
  if (interaction.isStringSelectMenu() && action === "inv") {
    return handleInventorySelect(interaction, args[0]!);
  }
}

async function handlePullButton(interaction: ButtonInteraction, kind: string): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const now = nowS();

  if (kind === "salvagecommons") {
    const { count, gold } = salvageCommons(guildId, userId);
    await interaction.reply({
      content: count ? `♻️ Salvaged ${count} common/uncommon item(s) for **${gold}** gold.` : "Nothing to salvage.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const res = doPull(guildId, userId, kind === "ten", now);
  if (!res.ok) {
    await interaction.reply({ content: `❌ ${res.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ ...pullReply(res), flags: MessageFlags.Ephemeral });
}

async function handleInventorySelect(
  interaction: StringSelectMenuInteraction,
  kind: string,
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const instanceId = Number(interaction.values[0]);

  if (kind === "equip") {
    const item = tx(() => equip(guildId, userId, instanceId));
    await interaction.update(buildInventoryReply(guildId, userId));
    if (item) await interaction.followUp({ content: `✅ Equipped **${item.name}**.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (kind === "salvage") {
    const item = getItem(guildId, userId, instanceId);
    const gold = tx(() => salvage(guildId, userId, instanceId));
    await interaction.update(buildInventoryReply(guildId, userId));
    if (gold != null) {
      await interaction.followUp({ content: `♻️ Salvaged **${item?.name}** for **${gold}** gold.`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleDuelButton(interaction: ButtonInteraction, args: string[]): Promise<void> {
  const [decision, challengerId, targetId, wagerStr] = args;
  const wager = Number(wagerStr);
  const now = nowS();
  const clicker = interaction.user.id;

  if (decision === "decline") {
    if (clicker !== targetId && clicker !== challengerId) {
      await interaction.reply({ content: "This duel isn't yours.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.update({ content: `🚫 Duel declined.`, components: [] });
    return;
  }

  // accept — only the challenged target may accept
  if (clicker !== targetId) {
    await interaction.reply({ content: "Only the challenged member can accept.", flags: MessageFlags.Ephemeral });
    return;
  }
  const cd = duelOnCooldown(challengerId!, targetId!, now);
  if (cd > 0) {
    await interaction.reply({ content: `⏳ On cooldown for ${cd}s.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const outcome = tx(() => resolveDuel(interaction.guildId!, challengerId!, targetId!, wager, now));
  if (!outcome.ok) {
    await interaction.update({ content: `❌ ${outcome.reason}`, components: [] });
    return;
  }
  markDuel(challengerId!, targetId!, now);
  const r = outcome.result;
  const loserLine =
    r.loserXp > 0
      ? `<@${r.loserId}> earns **${r.loserXp}** XP for the effort.`
      : `<@${r.loserId}> has spent their daily loser-XP budget — no XP this time.`;
  await interaction.update({
    content:
      `⚔️ <@${r.winnerId}> defeats <@${r.loserId}>!\n` +
      `Pot **${r.pot}** → winner gets **${r.payout}** (rake ${r.rake}).\n` +
      loserLine,
    components: [],
  });
}

async function handleQuestButton(interaction: ButtonInteraction, args: string[]): Promise<void> {
  const [act, partyId] = args;
  const party = getParty(partyId!);
  if (!party) {
    await interaction.reply({ content: "This party has already closed.", flags: MessageFlags.Ephemeral });
    return;
  }
  const guildId = interaction.guildId!;
  const clicker = interaction.user.id;

  if (act === "join") {
    if (party.members.includes(clicker)) {
      await interaction.reply({ content: "You're already in this party.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (activeQuestFor(guildId, clicker) || userInPendingParty(guildId, clicker)) {
      await interaction.reply({ content: "❌ You already have a quest or pending party.", flags: MessageFlags.Ephemeral });
      return;
    }
    joinParty(partyId!, clicker); // may auto-finalize when full (edits the lobby message)
    const after = getParty(partyId!);
    if (after) {
      // Party still open — update the lobby message to show current roster.
      const tpl = getTemplate(after.templateId);
      const stat = tpl?.stat.toUpperCase() ?? "?";
      const roster = after.members.map((id) => `<@${id}>`).join(", ");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`quest:join:${partyId}`).setLabel("Join").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`quest:pstart:${partyId}`).setLabel("Start now").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`quest:pcancel:${partyId}`).setLabel("Disband").setStyle(ButtonStyle.Danger),
      );
      await interaction.update({
        content:
          `🧭 <@${after.openerId}> is forming a party for **${tpl?.name ?? "a quest"}** ` +
          `(${stat} · ${tpl?.kind ?? ""} · ${after.tier}).\n` +
          `**Party:** ${roster} (${after.members.length}/4) — ` +
          `Efficiency = highest ${stat} + 20% of the rest. ` +
          `Auto-starts in 15 min or when the opener presses **Start now**.`,
        components: [row],
      });
    } else {
      // Party just filled and finalizeParty is already editing the message.
      await interaction.deferUpdate();
    }
    return;
  }

  if (act === "pstart" || act === "pcancel") {
    if (clicker !== party.openerId) {
      await interaction.reply({ content: "Only the party opener can do that.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferUpdate();
    await finalizeParty(partyId!, act === "pstart" ? "manual" : "cancel");
  }
}

async function handlePrestigeButton(interaction: ButtonInteraction): Promise<void> {
  const res = tx(() => doPrestige(interaction.guildId!, interaction.user.id));
  if (!res.ok) {
    await interaction.update({ content: `❌ ${res.reason}`, components: [] });
    return;
  }
  await interaction.update({
    content: `✦ Prestige complete! You are now **Prestige ${res.newPrestige}** with a permanent **+${res.newPrestige * 10}%** income bonus. Your gear was kept.`,
    components: [],
  });
}
