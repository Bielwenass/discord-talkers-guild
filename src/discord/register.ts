// Registers slash commands with Discord. If DEV_GUILD_ID is set, registers to
// that guild (updates instantly — best for development); otherwise registers
// globally (can take up to ~1h to propagate).
//
// Always clears the opposite scope to prevent duplicate commands when switching
// between dev (guild-scoped) and production (global) deployments.
import { REST, Routes, type Client } from "discord.js";
import { env } from "../config.ts";
import { commands } from "./commands/index.ts";

export async function clearDevGuildCommands(): Promise<void> {
  if (!env.devGuildId) return;
  const rest = new REST({ version: "10" }).setToken(env.token);
  await rest.put(Routes.applicationGuildCommands(env.appId, env.devGuildId), { body: [] });
  console.log(`Dev guild commands cleared.`);
}

export async function registerCommands(client: Client<true>): Promise<void> {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(env.token);

  if (env.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.appId, env.devGuildId), { body });
    await rest.put(Routes.applicationCommands(env.appId), { body: [] });
    console.log(`Registered ${body.length} commands to dev guild ${env.devGuildId} (global cleared).`);
  } else {
    await rest.put(Routes.applicationCommands(env.appId), { body });
    // Clear guild-scoped commands in every guild the bot is in, so leftover dev
    // registrations don't show alongside the global ones.
    const guildIds = [...client.guilds.cache.keys()];
    await Promise.all(
      guildIds.map((guildId) =>
        rest.put(Routes.applicationGuildCommands(env.appId, guildId), { body: [] }),
      ),
    );
    console.log(`Registered ${body.length} global commands (guild commands cleared in ${guildIds.length} guild(s)).`);
  }
}
