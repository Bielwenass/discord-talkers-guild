// messageCreate (design §3.1, §3.2 replies, §9 raid damage).
import type { Message, GuildTextBasedChannel } from "discord.js";
import { ECON } from "../../config.ts";
import { tx } from "../../db/db.ts";
import { nowS } from "../../util/time.ts";
import { messageXp, replyXp } from "../../game/formulas.ts";
import {
  bumpMessageStats,
  bumpRepliesRecv,
  effectiveStats,
  getOrCreateUser,
  grantXp,
} from "../../game/users.ts";
import { channelWeight } from "../../game/guilds.ts";
import { recordServerQuestProgress } from "../../game/quests.ts";
import { replyCounts, admitMessage } from "../state.ts";
import { applyLevelRewards, applyRaidForGrant } from "../rewards.ts";

export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.guild || !message.inGuild()) return;
  if (!("content" in message)) return;

  const guildId = message.guild.id;
  const userId = message.author.id;
  const content = message.content ?? "";
  const nonWs = content.replace(/\s/g, "").length;
  if (nonWs < ECON.MIN_CHARS) return; // too short to count at all (spam filter)

  const channel = message.channel as GuildTextBasedChannel;
  const now = nowS();
  const nowMs = now * 1000;

  // --- sender's own message XP (token bucket) ---
  const admitted = admitMessage(guildId, userId, nowMs);

  const senderGrant = tx(() => {
    const user = getOrCreateUser(guildId, userId);
    bumpMessageStats(guildId, userId); // always, even when bucket rejects

    if (!admitted) return null;

    const eff = effectiveStats(user);
    const xp = Math.floor(
      messageXp({
        channelWeight: channelWeight(guildId, message.channelId),
        intStat: eff.int,
        prestige: user.prestige,
      }),
    );
    const g = grantXp(guildId, userId, xp, { nowS: now, countedMsg: true, setLastXpAt: true });
    recordServerQuestProgress(guildId, userId, now); // this counted msg advances the server quest
    return g;
  });

  if (senderGrant) {
    await applyRaidForGrant(message.guild, channel, userId, senderGrant.xp, now);
    await applyLevelRewards(message.guild, channel, userId, senderGrant, now);
  }

  // --- reply social XP, credited to the replied-to author (§3.2, no cooldown) ---
  if (message.reference?.messageId) {
    await creditReply(message, guildId, userId, now, channel);
  }
}

async function creditReply(
  message: Message,
  guildId: string,
  replierId: string,
  now: number,
  channel: GuildTextBasedChannel,
): Promise<void> {
  const refId = message.reference!.messageId!;
  let recipientId: string | null = null;
  try {
    const ref = await message.fetchReference();
    if (ref.author.bot) return;
    recipientId = ref.author.id;
  } catch {
    return; // referenced message gone / inaccessible
  }
  if (!recipientId || recipientId === replierId) return; // no self-replies

  const credited = replyCounts.get(refId) ?? 0;
  if (credited >= ECON.REPLY_CAP_PER_MSG) return;
  replyCounts.set(refId, credited + 1);

  const grant = tx(() => {
    const recipient = getOrCreateUser(guildId, recipientId!);
    const xp = Math.floor(replyXp(effectiveStats(recipient).cha));
    bumpRepliesRecv(guildId, recipientId!, now);
    return grantXp(guildId, recipientId!, xp, { nowS: now });
  });

  await applyRaidForGrant(message.guild!, channel, recipientId, grant.xp, now);
  await applyLevelRewards(message.guild!, channel, recipientId, grant, now);
}
