// Raid resolution announcement (design §9).
import { EmbedBuilder, type GuildTextBasedChannel } from "discord.js";
import type { RaidResolution } from "../game/raids.ts";

export async function announceRaidResolution(
  channel: GuildTextBasedChannel,
  res: RaidResolution,
): Promise<void> {
  const top = res.rewards.slice(0, 5);
  const lines =
    top.length === 0
      ? "_No participants._"
      : top
          .map((r, i) => {
            const itemNote = r.items.length ? ` · 🎁 ${r.items.length} item(s)` : "";
            return `\`#${i + 1}\` <@${r.userId}> — ${r.damage.toLocaleString()} dmg · 💰 ${r.gold}${itemNote}`;
          })
          .join("\n");

  const embed = new EmbedBuilder()
    .setTitle(res.killed ? "🐉 Boss Defeated!" : "⌛ Raid Timed Out")
    .setColor(res.killed ? 0x3fb950 : 0xda3633)
    .setDescription(
      (res.killed
        ? `The guild felled a boss with **${res.hpMax.toLocaleString()}** HP. Spoils:`
        : `The boss survived (**${res.hpMax.toLocaleString()}** HP). Half rewards, no item drops:`) +
        `\n\n${lines}`,
    );
  try {
    await channel.send({ embeds: [embed] });
  } catch {
    /* non-fatal */
  }
}
