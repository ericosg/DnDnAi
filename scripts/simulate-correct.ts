/**
 * Simulate the /correct admin OOC slash command WITHOUT being able to invoke
 * a real slash command (Discord bots can't issue user-initiated interactions).
 *
 * This script replicates 3 of the 4 effects of the real handler:
 *   1. Posts the visible channel OOC message via REST
 *   2. Appends a `system` TurnEntry to history.json (so the next AI prompt's
 *      "Recent History" slice contains the correction)
 *   3. If --remember and target is an agent: appends to that agent's memory file
 *
 * The ONE thing this CAN'T do is push the correction into the running bot's
 * in-memory admin-corrections store. So the formatted "## ⚠️ Admin Correction
 * (READ FIRST)" block at the top of the next prompt does NOT fire here.
 * Instead the correction appears as a system entry in the history window.
 *
 * Usage:
 *   bun run scripts/simulate-correct.ts <game-id> <target> <message> [--remember]
 *
 *   target = "dm" | "all" | agent character name
 *
 * Example:
 *   bun run scripts/simulate-correct.ts ba7a6447-... dm "Please include the
 *     word PINEAPPLE in your next narration to confirm receipt." --remember
 */

import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { config } from "../src/config.js";
import { appendAgentMemory } from "../src/game/agent-notes.js";
import { appendHistory, loadGameState } from "../src/state/store.js";
import type { TurnEntry } from "../src/state/types.js";

const args = process.argv.slice(2);
const gameId = args[0];
const target = args[1];
const message = args[2];
const remember = args.includes("--remember");

if (!gameId || !target || !message) {
  console.error(
    "Usage: bun run scripts/simulate-correct.ts <game-id> <target> <message> [--remember]",
  );
  process.exit(2);
}

const gs = await loadGameState(gameId);
if (!gs) {
  console.error(`Game not found: ${gameId}`);
  process.exit(1);
}

// Resolve target label
let targetLabel: string;
const targetLower = target.toLowerCase();
if (targetLower === "dm") {
  targetLabel = "DM";
} else if (targetLower === "all" || targetLower === "everyone") {
  targetLabel = "ALL";
} else {
  const agent = gs.players.find(
    (p) => p.isAgent && p.characterSheet.name.toLowerCase() === targetLower,
  );
  if (!agent) {
    console.error(
      `No agent named "${target}" in game ${gameId}. Use 'dm', 'all', or an agent character name.`,
    );
    process.exit(1);
  }
  targetLabel = agent.characterSheet.name;
}

// 1. Append system history entry (the AI will see this in its recent history slice)
const sysEntry: TurnEntry = {
  id: 0,
  timestamp: new Date().toISOString(),
  playerId: "system",
  playerName: "Admin",
  type: "system",
  content: `[ADMIN OOC → ${targetLabel}${remember ? " · REMEMBERED" : ""}]: ${message}`,
};
await appendHistory(gameId, sysEntry);
console.log(`✓ Appended system TurnEntry to history.json (gameId=${gameId})`);

// 2. Append to agent memory if remember:true and target is an agent
if (remember && targetLabel !== "DM" && targetLabel !== "ALL") {
  try {
    await appendAgentMemory(gameId, targetLabel, message);
    console.log(`✓ Appended bullet to ${targetLabel}'s memory file`);
  } catch (err) {
    console.error(`✗ appendAgentMemory failed:`, err);
  }
}

// 3. Post the visible OOC message in the channel
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async (c) => {
  try {
    const channel = await c.channels.fetch(gs.channelId);
    if (!channel || !("send" in channel)) {
      console.error(`Channel ${gs.channelId} not found.`);
      process.exit(1);
    }
    await (channel as TextChannel).send(
      `🛠️ **[ADMIN OOC → ${targetLabel}${remember ? " · saved to memory" : ""}]**\n${message}`,
    );
    console.log(`✓ Posted visible OOC to #${(channel as TextChannel).name}`);
    console.log(
      `\nNote: this DID NOT push the correction into the running bot's in-memory store —`,
    );
    console.log(
      `      the high-salience "## ⚠️ Admin Correction (READ FIRST)" prompt block`,
    );
    console.log(
      `      won't fire. The AI will see the correction as a "system" entry in its`,
    );
    console.log(`      Recent History slice instead. Effect is similar but signal is softer.`);
  } catch (e) {
    console.error("Post failed:", e);
    process.exit(1);
  } finally {
    await c.destroy();
    process.exit(0);
  }
});
client.login(config.discordToken).catch((e) => {
  console.error("Login failed:", e);
  process.exit(1);
});
