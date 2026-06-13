import { MessageFlags } from "discord.js";
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type BaseMessageOptions,
} from "discord.js";
import type { Command } from "./types.ts";
import { tx, getDb } from "../../db/db.ts";
import { listInventory, salvage, type InventoryItem } from "../../game/inventory.ts";
import { salvageValue } from "../../game/gacha.ts";
import { RARITY_EMOJI, statSpread } from "../embeds.ts";

const RARITY_SORT_ORDER: Record<string, number> = {
  legendary: 4,
  epic: 3,
  rare: 2,
  uncommon: 1,
  common: 0,
};

function raritySort(items: InventoryItem[], direction: "asc" | "desc" = "desc"): InventoryItem[] {
  return items.sort((a, b) => {
    const aRarity = a.equipped ? 99 : 0 + (RARITY_SORT_ORDER[a.rarity] ?? 0);
    const bRarity = b.equipped ? 99 : 0 + (RARITY_SORT_ORDER[b.rarity] ?? 0);
    return direction === "asc" ? aRarity - bRarity : bRarity - aRarity;
  });
}

function itemLabel(it: InventoryItem): string {
  const stats = statSpread(it, it.primary);
  return `${it.name} · ${it.slot}${stats ? ` · ${stats}` : ""}`;
}

// Returns a message payload (no ephemeral flag) usable by both reply() and update().
export function buildInventoryReply(guildId: string, userId: string): BaseMessageOptions {
  const items = listInventory(guildId, userId);
  if (items.length === 0) {
    return { content: "🎒 Your inventory is empty — try `/pull`.", embeds: [], components: [] };
  }

  const lines = raritySort(items.slice(0, 40))
    .map((it) => `${it.equipped ? "✅" : "▫️"} ${RARITY_EMOJI[it.rarity]} ${itemLabel(it)}`);
  const embed = new EmbedBuilder()
    .setTitle("🎒 Inventory")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"));

  const equipOptions = raritySort(
    items.filter((it) => !it.equipped)
    .slice(0, 25)
  )
    .map((it) => ({
      label: itemLabel(it).slice(0, 100),
      value: String(it.instance_id),
      emoji: RARITY_EMOJI[it.rarity],
    }));
  const salvageOptions = raritySort(
    items.filter((it) => !it.equipped)
    .slice(0, 25),
    "asc"
  )
    .map((it) => ({
      label: `${it.name} (+${salvageValue(it.rarity)}g)`.slice(0, 100),
      value: String(it.instance_id),
      emoji: RARITY_EMOJI[it.rarity],
    }));

  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  if (equipOptions.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("inv:equip")
          .setPlaceholder("Equip an item…")
          .addOptions(equipOptions),
      ),
    );
  }
  if (salvageOptions.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("inv:salvage")
          .setPlaceholder("Salvage an item for gold…")
          .addOptions(salvageOptions),
      ),
    );
  }

  return { embeds: [embed], components: rows };
}

/** Salvage all unequipped common + uncommon items; returns total gold. */
export function salvageCommons(guildId: string, userId: string): { count: number; gold: number } {
  return tx(() => {
    const rows = getDb()
      .query(
        `SELECT inv.instance_id AS id FROM inventory inv
         JOIN item_defs d ON d.item_def_id = inv.item_def_id
         WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.equipped = 0
           AND d.rarity IN ('common','uncommon')`,
      )
      .all(guildId, userId) as { id: number }[];
    let gold = 0;
    for (const r of rows) {
      const g = salvage(guildId, userId, r.id);
      if (g != null) gold += g;
    }
    return { count: rows.length, gold };
  });
}

export const inventory: Command = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View and manage your gear (equip / salvage)"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      ...buildInventoryReply(interaction.guildId!, interaction.user.id),
      flags: MessageFlags.Ephemeral,
    });
  },
};
