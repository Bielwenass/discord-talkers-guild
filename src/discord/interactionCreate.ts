import { MessageFlags } from "discord.js";
// Routes incoming interactions to slash-command handlers or component handlers.
import type { Interaction } from "discord.js";
import { commandMap } from "./commands/index.ts";
import { handleComponent } from "./components.ts";

export async function onInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }
    if (interaction.isMessageComponent()) {
      await handleComponent(interaction);
    }
  } catch (err) {
    console.error(`Interaction error (${interaction.isCommand() ? interaction.commandName : "component"}):`, err);
    if (interaction.isRepliable()) {
      const msg = { content: "⚠️ Something went wrong handling that.", flags: MessageFlags.Ephemeral } as const;
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch {
        /* ignore */
      }
    }
  }
}
