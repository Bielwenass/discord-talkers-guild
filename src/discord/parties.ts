// In-memory party-quest recruiting (addendum C.5). Like duel cooldowns and reaction
// caps, this state is ephemeral — losing it on restart only drops in-flight lobbies.
// A party starts when it fills (QUEST_PARTY_MAX) or QUEST_PARTY_FILL_MS after opening
// (whichever first); below QUEST_PARTY_MIN at that point it disbands.
import type { Message } from "discord.js";
import { ECON, type QuestTier } from "../config.ts";
import { tx } from "../db/db.ts";
import { nowS } from "../util/time.ts";
import { startPartyQuest, getTemplate } from "../game/quests.ts";

export interface PendingParty {
  partyId: string;
  guildId: string;
  templateId: number;
  tier: QuestTier;
  openerId: string;
  members: string[]; // ordered; includes the opener
  message?: Message;
  timer?: ReturnType<typeof setTimeout>;
}

const parties = new Map<string, PendingParty>();

export function getParty(partyId: string): PendingParty | undefined {
  return parties.get(partyId);
}

export function userInPendingParty(guildId: string, userId: string): boolean {
  for (const p of parties.values()) {
    if (p.guildId === guildId && p.members.includes(userId)) return true;
  }
  return false;
}

export function openParty(p: Omit<PendingParty, "timer">): PendingParty {
  const party: PendingParty = { ...p };
  party.timer = setTimeout(() => void finalizeParty(p.partyId, "timeout"), ECON.QUEST_PARTY_FILL_MS);
  parties.set(p.partyId, party);
  return party;
}

/** Add a member; auto-finalizes when the party is full. Returns the updated party. */
export function joinParty(partyId: string, userId: string): PendingParty | undefined {
  const p = parties.get(partyId);
  if (!p || p.members.includes(userId)) return p;
  p.members.push(userId);
  if (p.members.length >= ECON.QUEST_PARTY_MAX) void finalizeParty(partyId, "full");
  return p;
}

function discard(partyId: string): void {
  const p = parties.get(partyId);
  if (p?.timer) clearTimeout(p.timer);
  parties.delete(partyId);
}

/**
 * Conclude recruiting: start the quest if >=2 joined, else disband. Edits the
 * recruit message to reflect the outcome. Idempotent (no-op if already concluded).
 */
export async function finalizeParty(
  partyId: string,
  reason: "full" | "manual" | "timeout" | "cancel",
): Promise<void> {
  const p = parties.get(partyId);
  if (!p) return;
  discard(partyId);

  const tpl = getTemplate(p.templateId);
  if (reason === "cancel" || p.members.length < ECON.QUEST_PARTY_MIN) {
    await edit(
      p,
      reason === "cancel"
        ? "🚪 Party disbanded by the opener."
        : `🚪 **${tpl?.name ?? "Quest"}** party disbanded — not enough adventurers joined in time.`,
    );
    return;
  }

  const started = tx(() => startPartyQuest(p.guildId, p.templateId, p.tier, p.members, nowS()));
  if (!started.ok) {
    await edit(p, `❌ Couldn't start the party: ${started.reason}`);
    return;
  }
  const q = started.quest;
  const roster = p.members.map((id) => `<@${id}>`).join(", ");
  await edit(
    p,
    `🧭 **${q.template.name}** party (${q.tier}) set out with ${roster}!\n` +
      `Party efficiency ×${q.eff.toFixed(2)} · returns <t:${q.endsAt}:R>. ` +
      `Every member gets full rewards plus a party bonus.`,
  );
}

async function edit(p: PendingParty, content: string): Promise<void> {
  try {
    if (p.message) await p.message.edit({ content, components: [] });
  } catch {
    /* message gone / no perms — non-fatal */
  }
}
