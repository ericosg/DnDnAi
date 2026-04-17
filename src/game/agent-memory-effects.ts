/**
 * Side-effect application for directive-driven agent memory updates.
 *
 * `processDirectives` is pure — it only records what should happen. This module
 * performs the actual file I/O the caller needs afterward:
 *
 * - `activatedAgents`: for each newly-activated dormant agent, ensure a starter
 *   memory file exists so the agent can begin writing to it on its first turn.
 * - `memoryAppends`: for each `[[REMEMBER:...]]` directive, append the bullet to
 *   the target agent's memory file.
 */

import { loadAgentPersonality } from "../ai/agent.js";
import { log } from "../logger.js";
import type { GameState } from "../state/types.js";
import { appendAgentMemory, seedAgentNotes } from "./agent-notes.js";
import type { DirectiveContext } from "./directives.js";

export async function applyAgentMemoryEffects(
  gameState: GameState,
  ctx: Pick<DirectiveContext, "activatedAgents" | "memoryAppends">,
): Promise<void> {
  // Seed memory files for newly activated dormant agents
  for (const name of ctx.activatedAgents) {
    const player = gameState.players.find((p) => p.characterSheet.name === name);
    if (!player?.agentFile) continue;
    try {
      const personality = await loadAgentPersonality(player.agentFile.replace(/\.md$/, ""));
      await seedAgentNotes(gameState.id, personality, player.characterSheet);
    } catch (err) {
      log.error(`Agent notes: failed to seed on activate for ${name}:`, err);
    }
  }

  // Apply DM-requested memory appends
  for (const { name, text } of ctx.memoryAppends) {
    try {
      await appendAgentMemory(gameState.id, name, text);
    } catch (err) {
      log.error(`Agent notes: failed to append for ${name}:`, err);
    }
  }
}
