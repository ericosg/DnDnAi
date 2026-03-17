import { models } from "../config.js";
import type { GameState, OrchestratorDecision, TurnEntry } from "../state/types.js";
import { chat } from "./claude.js";

const _ORCHESTRATOR_SYSTEM = `You are the flow controller for a D&D game running in Discord. Your job is to decide what happens next.

You will receive the current game state, recent history, and the last message. You must decide:
1. Is this message in-character (IC) or out-of-character (OOC)?
2. Who should respond next?
3. Should the DM be called to narrate/resolve?

## Rules
- After a human player acts IC, prompt each AI agent that hasn't responded this round
- After all players (human + AI) have acted, call the DM to resolve/narrate
- In combat, follow initiative order strictly — only prompt the current combatant
- If a human hasn't responded and it's their turn, WAIT — never skip humans
- OOC messages (no > prefix) don't advance the game state
- /pass counts as taking no action — move to next player

Respond with EXACTLY one JSON object:
{
  "action": "prompt_agent" | "prompt_dm" | "wait_for_human" | "advance_combat" | "skip",
  "targetPlayerId": "<player id if action=prompt_agent or wait_for_human>",
  "reason": "<brief explanation>",
  "isIC": true | false
}`;

export async function getNextAction(
  gameState: GameState,
  history: TurnEntry[],
  lastEntry: TurnEntry,
  respondedThisRound: Set<string>,
): Promise<OrchestratorDecision> {
  // Fast path: pending rolls — check if we're waiting on player dice
  if (gameState.pendingRolls?.length) {
    const unfulfilled = gameState.pendingRolls.find((r) => !r.result);
    if (unfulfilled) {
      return {
        action: "wait_for_human",
        targetPlayerId: unfulfilled.playerId,
        reason: `Waiting for ${unfulfilled.playerName} to roll ${unfulfilled.notation} (${unfulfilled.reason})`,
        isIC: true,
      };
    }
    // All rolls fulfilled — DM should resolve
    return {
      action: "prompt_dm",
      reason: "All pending rolls fulfilled — DM resolves outcomes",
      isIC: true,
    };
  }

  // Fast path: combat mode — follow initiative order
  if (gameState.combat.active) {
    return getCombatNextAction(gameState, respondedThisRound);
  }

  // Fast path: OOC messages don't need orchestration
  if (lastEntry.type === "ooc") {
    return { action: "skip", reason: "OOC message, no game action needed", isIC: false };
  }

  const _recentHistory = history.slice(-6);
  const humanPlayers = gameState.players.filter((p) => !p.isAgent);
  const agentPlayers = gameState.players.filter((p) => p.isAgent);

  // Check which agents haven't responded
  const unrespondedAgents = agentPlayers.filter((p) => !respondedThisRound.has(p.id));

  // If there are agents that haven't responded, prompt the next one
  if (unrespondedAgents.length > 0) {
    return {
      action: "prompt_agent",
      targetPlayerId: unrespondedAgents[0].id,
      reason: `${unrespondedAgents[0].name} hasn't acted this round`,
      isIC: true,
    };
  }

  // Check if any human hasn't responded
  const unrespondedHumans = humanPlayers.filter((p) => !respondedThisRound.has(p.id));

  if (unrespondedHumans.length > 0) {
    return {
      action: "wait_for_human",
      targetPlayerId: unrespondedHumans[0].id,
      reason: `Waiting for ${unrespondedHumans[0].name} to act`,
      isIC: true,
    };
  }

  // Everyone has acted — call DM
  return {
    action: "prompt_dm",
    reason: "All players have acted, DM should resolve and narrate",
    isIC: true,
  };
}

function getCombatNextAction(
  gameState: GameState,
  respondedThisRound: Set<string>,
): OrchestratorDecision {
  const combat = gameState.combat;
  const currentCombatant = combat.combatants[combat.turnIndex];

  if (!currentCombatant) {
    return {
      action: "prompt_dm",
      reason: "Combat turn index out of bounds, DM should resolve",
      isIC: true,
    };
  }

  const player = gameState.players.find((p) => p.id === currentCombatant.playerId);
  if (!player) {
    return {
      action: "advance_combat",
      reason: `Combatant ${currentCombatant.name} not found in players, skip`,
      isIC: true,
    };
  }

  if (respondedThisRound.has(player.id)) {
    // Current combatant already acted — DM resolves, then advance
    return {
      action: "prompt_dm",
      reason: `${player.name} has acted, DM should resolve their action`,
      isIC: true,
    };
  }

  if (player.isAgent) {
    return {
      action: "prompt_agent",
      targetPlayerId: player.id,
      reason: `It's ${player.name}'s turn in combat`,
      isIC: true,
    };
  }

  return {
    action: "wait_for_human",
    targetPlayerId: player.id,
    reason: `Waiting for ${player.name}'s combat action`,
    isIC: true,
  };
}

/**
 * Use AI to determine if ambiguous messages are IC or OOC
 * (Used as fallback when > prefix detection isn't clear)
 */
export async function classifyMessage(message: string, context: string): Promise<boolean> {
  const response = await chat(
    models.orchestrator,
    "You classify Discord messages in a D&D game as in-character (IC) or out-of-character (OOC). Respond with just 'IC' or 'OOC'.",
    [
      {
        role: "user",
        content: `Context: ${context}\n\nMessage: "${message}"\n\nIs this IC or OOC?`,
      },
    ],
  );
  return response.trim().toUpperCase() === "IC";
}
