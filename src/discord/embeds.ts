// Shared embed/format builders for the Discord UI.
import { EmbedBuilder } from "discord.js";
import type { Rarity, StatKey } from "../config.ts";
import type { UserRow } from "../types.ts";
import { cumulativeXpForLevel, xpToNext } from "../game/formulas.ts";
import { currentIdleInfo, effectiveStats } from "../game/users.ts";
import { equippedBySlot, type PullOutcome } from "../game/inventory.ts";
import { prestigeRequirement } from "../game/prestige.ts";

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x9aa0a6,
  uncommon: 0x3fb950,
  rare: 0x2f81f7,
  epic: 0xa371f7,
  legendary: 0xe3b341,
};

export const RARITY_EMOJI: Record<Rarity, string> = {
  common: "⚪",
  uncommon: "🟢",
  rare: "🔵",
  epic: "🟣",
  legendary: "🟡",
};

function progressBar(fraction: number, width = 16): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Render stat spread, leading with primary stat. Zero-point stats omitted. */
export function statSpread(
  s: { str: number; int: number; cha: number; luk: number },
  primary?: StatKey,
): string {
  const order: StatKey[] = primary
    ? [primary, ...["str", "int", "cha", "luk"].filter((k) => k !== primary) as StatKey[]]
    : ["str", "int", "cha", "luk"];
  const parts = order
    .filter((k) => s[k] > 0)
    .map((k) => `${k.toUpperCase()}+${s[k]}`);
  return parts.length ? parts.join(" ") : "—";
}

export function profileEmbed(user: UserRow, displayName: string, nowS: number): EmbedBuilder {
  const eff = effectiveStats(user);
  const levelFloor = cumulativeXpForLevel(user.level);
  const intoLevel = user.xp - levelFloor;
  const need = xpToNext(user.level);
  const { rate, weightedXp } = currentIdleInfo(user.guild_id, user.user_id, nowS);
  const gear = equippedBySlot(user.guild_id, user.user_id);

  const gearLines = (["weapon", "armor", "trinket"] as const)
    .map((slot) => {
      const it = gear[slot];
      const label = slot[0]!.toUpperCase() + slot.slice(1);
      return it
        ? `${RARITY_EMOJI[it.rarity]} **${label}:** ${it.name} _(${statSpread(it, it.primary)})_`
        : `▫️ **${label}:** _empty_`;
    })
    .join("\n");

  const statLine = (key: "str" | "int" | "cha" | "luk", label: string) => {
    const gearBonus = eff[key] - user[key];
    return `**${label}** ${user[key]}${gearBonus ? ` _(+${gearBonus})_` : ""}`;
  };

  return new EmbedBuilder()
    .setTitle(`${displayName}${user.prestige ? ` ✦${user.prestige}` : ""}`)
    .setColor(0x5865f2)
    .addFields(
      {
        name: `Level ${user.level}`,
        value: `${progressBar(need ? intoLevel / need : 0)}\n${intoLevel} / ${need} XP · ${user.xp} total`,
      },
      {
        name: "Stats",
        value: [
          statLine("str", "STR"),
          statLine("int", "INT"),
          statLine("cha", "CHA"),
          statLine("luk", "LUK"),
        ].join("\n") + (user.stat_points ? `\n🎟️ ${user.stat_points} unspent point(s)` : ""),
        inline: true,
      },
      {
        name: "Economy",
        value: [
          `💰 **${user.gold}** gold`,
          `⏳ idle **${rate.toFixed(1)}**/h _(${weightedXp.toLocaleString()} wXP)_`,
          `✦ prestige **${user.prestige}** (next @ L${prestigeRequirement(user.prestige)})`,
        ].join("\n"),
        inline: true,
      },
      { name: "Equipped", value: gearLines },
    )
    .setFooter({
      text: `✉️ ${user.msg_count} msgs · 💬 ${user.replies_recv} replies · 👍 ${user.reactions_recv} reactions received`,
    });
}

export function pullEmbed(outcomes: PullOutcome[]): EmbedBuilder {
  const best = outcomes.reduce<Rarity>((acc, o) => {
    const order: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
    return order.indexOf(o.rarity) > order.indexOf(acc) ? o.rarity : acc;
  }, "common");
  const lines = outcomes.map(
    (o) =>
      `${RARITY_EMOJI[o.rarity]} **${o.def.name}** _(${o.def.slot})_ · ${statSpread(o.spread, o.def.primary)}`,
  );
  return new EmbedBuilder()
    .setTitle(outcomes.length > 1 ? "Ten-Pull Results" : "Pull Result")
    .setColor(RARITY_COLOR[best])
    .setDescription(lines.join("\n"));
}

export interface IdleDigestEntry {
  user_id: string;
  rate: number;
  pending: number;
}

export function idleDigestEmbed(entries: IdleDigestEntry[], total: number): EmbedBuilder {
  const body = entries
    .map((e, i) => {
      const rank = i < 3 ? ["🥇", "🥈", "🥉"][i] : `\`#${i + 1}\``;
      return `${rank} <@${e.user_id}> — 💰 **${e.pending}** waiting _(${e.rate.toFixed(1)}/h)_`;
    })
    .join("\n");
  return new EmbedBuilder()
    .setTitle("💤 Daily Idle Digest")
    .setColor(0x57f287)
    .setDescription(
      `Gold is piling up! Run **/claim** to collect — idle income **caps at 24h**, so don't sleep on it.\n\n${body}`,
    )
    .setFooter({ text: `${total.toLocaleString()} gold waiting across the guild` });
}

export interface LeaderEntry {
  user_id: string;
  value: number;
}

export function leaderboardEmbed(
  title: string,
  entries: LeaderEntry[],
  resolveName: (userId: string) => string,
  unit: string,
): EmbedBuilder {
  const medals = ["🥇", "🥈", "🥉"];
  const body =
    entries.length === 0
      ? "_No activity yet._"
      : entries
          .map((e, i) => {
            const rank = i < 3 ? medals[i] : `\`#${i + 1}\``;
            return `${rank} **${resolveName(e.user_id)}** — ${e.value.toLocaleString()} ${unit}`;
          })
          .join("\n");
  return new EmbedBuilder().setTitle(title).setColor(0xe3b341).setDescription(body);
}
