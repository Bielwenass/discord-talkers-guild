// messageReactionAdd (design §3.2 reactions, §9 raid damage).
import type {
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
  GuildTextBasedChannel,
} from "discord.js";
import { ECON } from "../../config.ts";
import { tx } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { reactionXp } from "../../game/formulas.ts";
import {
  bumpReactionsRecv,
  effectiveStats,
  getOrCreateUser,
  grantXp,
} from "../../game/users.ts";
import { reactionCredits } from "../state.ts";
import { applyLevelRewards, applyRaidForGrant } from "../rewards.ts";

export async function onReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  reactor: User | PartialUser,
): Promise<void> {
  if (reactor.bot) return;
  try {
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch {
    return;
  }
  const message = reaction.message;
  if (!message.guild || !message.author || message.author.bot) return;

  const guildId = message.guild.id;
  const recipientId = message.author.id;
  if (recipientId === reactor.id) return; // no self-reactions (§3.2)

  // cap: REACT_CAP_PER_MSG distinct reactors per message, 1 credit per reactor
  const set = reactionCredits.getOrSet(message.id, () => new Set<string>());
  if (set.has(reactor.id) || set.size >= ECON.REACT_CAP_PER_MSG) return;
  set.add(reactor.id);

  const now = nowS();
  const grant = tx(() => {
    const recipient = getOrCreateUser(guildId, recipientId);
    const xp = Math.floor(reactionXp(effectiveStats(recipient).cha));
    bumpReactionsRecv(guildId, recipientId);
    return grantXp(guildId, recipientId, xp, { nowS: now });
  });

  const channel = message.channel as GuildTextBasedChannel;
  await applyRaidForGrant(message.guild, channel, recipientId, grant.xp, now);
  await applyLevelRewards(message.guild, channel, recipientId, grant, now);
}
