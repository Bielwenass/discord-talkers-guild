// Entry point: init DB, build the client, wire events, register commands, log in,
// and start the daily-leaderboard scheduler.
import { Events } from "discord.js";
import { assertEnv, env } from "./config.ts";
import { getDb } from "./db/db.ts";
import { createClient } from "./discord/client.ts";
import { registerCommands } from "./discord/register.ts";
import { onMessageCreate } from "./discord/events/messageCreate.ts";
import { onReactionAdd } from "./discord/events/reactionAdd.ts";
import { onInteraction } from "./discord/interactionCreate.ts";
import { startScheduler } from "./scheduler.ts";

async function main(): Promise<void> {
  assertEnv();
  getDb(); // open + migrate + seed

  const client = createClient();

  client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag} (serving ${c.guilds.cache.size} guild(s)).`);
    registerCommands(c).catch((err) => {
      console.error("Failed to register commands:", err);
      process.exit(1);
    });
    startScheduler(client);
  });

  client.on(Events.MessageCreate, (m) => {
    void onMessageCreate(m);
  });
  client.on(Events.MessageReactionAdd, (r, u) => {
    void onReactionAdd(r, u);
  });
  client.on(Events.InteractionCreate, (i) => {
    void onInteraction(i);
  });
  client.on(Events.Error, (err) => console.error("Client error:", err));

  await client.login(env.token);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
