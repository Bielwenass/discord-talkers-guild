import type { Command } from "./types.ts";
import { profile } from "./profile.ts";
import { claim } from "./claim.ts";
import { pull } from "./pull.ts";
import { inventory } from "./inventory.ts";
import { upgrade } from "./upgrade.ts";
import { expedition } from "./expedition.ts";
import { duel } from "./duel.ts";
import { leaderboard } from "./leaderboard.ts";
import { prestige } from "./prestige.ts";
import { raid } from "./raid.ts";
import { config } from "./config.ts";

export const commands: Command[] = [
  profile,
  claim,
  pull,
  inventory,
  upgrade,
  expedition,
  duel,
  leaderboard,
  prestige,
  raid,
  config,
];

export const commandMap = new Map<string, Command>(commands.map((c) => [c.data.name, c]));
