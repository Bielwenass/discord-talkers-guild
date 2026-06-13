// discord.js client with the intents the design relies on.
// NOTE: MessageContent and GuildMembers are *privileged* intents — enable them
// in the Discord Developer Portal (Bot → Privileged Gateway Intents) or the bot
// won't receive message text / be able to grant level roles.
import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // privileged — needed to read message text for XP
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMembers, // privileged — for L5/10/25/50 role rewards
    ],
    // Reactions on uncached (older) messages arrive as partials; enable so we
    // can still credit social XP to the message author.
    partials: [Partials.Message, Partials.Reaction, Partials.User],
  });
}
