// Registers slash commands with Discord. If DEV_GUILD_ID is set, registers to
// that guild (updates instantly — best for development); otherwise registers
// globally (can take up to ~1h to propagate).
import { REST, Routes } from "discord.js";
import { env } from "../config.ts";
import { commands } from "./commands/index.ts";

export async function registerCommands(): Promise<void> {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(env.token);

  if (env.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.appId, env.devGuildId), { body });
    console.log(`Registered ${body.length} commands to dev guild ${env.devGuildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(env.appId), { body });
    console.log(`Registered ${body.length} global commands.`);
  }
}
