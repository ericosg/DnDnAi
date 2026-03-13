import type { TextChannel } from "discord.js";
import { generateAgentAction, loadAgentPersonality } from "../ai/agent.js";
import { compressNarrative, dmNarrate } from "../ai/dm.js";
import { getNextAction } from "../ai/orchestrator.js";
import { AGENT_DELAY_MS, COMPRESS_EVERY, HISTORY_WINDOW } from "../config.js";
import { dmNarrationEmbed } from "../discord/formatter.js";
import { sendAsIdentity } from "../discord/webhooks.js";
import { appendHistory, loadHistory, saveGameState } from "../state/store.js";
import type { DiceResult, GameState, TurnEntry } from "../state/types.js";
import { advanceTurn, endCombat, startCombat } from "./combat.js";
import { formatDiceResult, parseDiceDirective, roll } from "./dice.js";

// Track who has responded this round per game
const roundResponses = new Map<string, Set<string>>();

function getResponded(gameId: string): Set<string> {
  if (!roundResponses.has(gameId)) {
    roundResponses.set(gameId, new Set());
  }
  // biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
  return roundResponses.get(gameId)!;
}

export function clearRound(gameId: string): void {
  roundResponses.set(gameId, new Set());
}

export function markResponded(gameId: string, playerId: string): void {
  getResponded(gameId).add(playerId);
}

/**
 * Process a new turn entry and drive the game forward.
 * Called after a human player acts or a system event occurs.
 */
export async function processTurn(
  gameState: GameState,
  entry: TurnEntry,
  channel: TextChannel,
): Promise<void> {
  // Record the entry
  await appendHistory(gameState.id, entry);
  gameState.turnCount++;

  // Mark this player as having responded
  markResponded(gameState.id, entry.playerId);

  // Run the orchestrator loop
  await orchestratorLoop(gameState, channel);

  // Auto-persist state
  await saveGameState(gameState);

  // Compress narrative if needed
  if (gameState.turnCount % COMPRESS_EVERY === 0) {
    const history = await loadHistory(gameState.id);
    gameState.narrativeSummary = await compressNarrative(gameState, history);
    await saveGameState(gameState);
  }
}

async function orchestratorLoop(gameState: GameState, channel: TextChannel): Promise<void> {
  const maxIterations = gameState.players.length + 2; // prevent infinite loops
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    const history = await loadHistory(gameState.id);
    const lastEntry = history[history.length - 1];
    if (!lastEntry) break;

    const responded = getResponded(gameState.id);
    const decision = await getNextAction(gameState, history, lastEntry, responded);

    switch (decision.action) {
      case "prompt_agent": {
        if (!decision.targetPlayerId) break;
        await handleAgentTurn(gameState, decision.targetPlayerId, history, channel);
        break;
      }

      case "prompt_dm": {
        await handleDMTurn(gameState, history, channel);
        // After DM resolves, clear round for next cycle
        clearRound(gameState.id);

        // If combat, advance turn
        if (gameState.combat.active) {
          advanceTurn(gameState);
        }
        return; // DM narration ends this orchestration cycle
      }

      case "wait_for_human": {
        return; // Stop and wait for human input
      }

      case "advance_combat": {
        if (gameState.combat.active) {
          advanceTurn(gameState);
        }
        break;
      }

      case "skip": {
        return;
      }
    }
  }
}

async function handleAgentTurn(
  gameState: GameState,
  agentPlayerId: string,
  history: TurnEntry[],
  channel: TextChannel,
): Promise<void> {
  const player = gameState.players.find((p) => p.id === agentPlayerId);
  if (!player || !player.agentFile) return;

  // Pacing delay
  await new Promise((r) => setTimeout(r, AGENT_DELAY_MS));

  try {
    const personality = await loadAgentPersonality(player.agentFile.replace(/\.md$/, ""));

    const recentHistory = history.slice(-HISTORY_WINDOW);
    const currentSituation = recentHistory
      .slice(-3)
      .map((t) => `[${t.playerName}] ${t.content}`)
      .join("\n");

    const response = await generateAgentAction(
      personality,
      gameState,
      recentHistory,
      currentSituation,
    );

    // Post as agent identity via webhook
    await sendAsIdentity(channel, player.name, response, {
      avatarUrl: personality.avatarUrl,
    });

    // Record in history
    const entry: TurnEntry = {
      id: history.length + 1,
      timestamp: new Date().toISOString(),
      playerId: player.id,
      playerName: player.name,
      type: "ic",
      content: response,
    };

    await appendHistory(gameState.id, entry);
    markResponded(gameState.id, player.id);
    gameState.turnCount++;
  } catch (err) {
    console.error(`Error generating agent action for ${player.name}:`, err);
  }
}

async function handleDMTurn(
  gameState: GameState,
  history: TurnEntry[],
  channel: TextChannel,
): Promise<void> {
  // Collect recent player actions for DM to resolve
  const responded = getResponded(gameState.id);
  const recentActions = history
    .filter((t) => responded.has(t.playerId) && t.type === "ic")
    .slice(-gameState.players.length)
    .map((t) => `${t.playerName}: ${t.content}`)
    .join("\n");

  try {
    let dmResponse = await dmNarrate(gameState, history, recentActions);

    if (!dmResponse || !dmResponse.trim()) {
      await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
      return;
    }

    // Process dice directives
    const directives = parseDiceDirective(dmResponse);
    const diceResults: DiceResult[] = [];

    for (const directive of directives) {
      const result = roll(directive.notation, `${directive.forName}: ${directive.reason}`);
      diceResults.push(result);

      // Replace the directive in the DM text with the result
      dmResponse = dmResponse.replace(
        `[[ROLL:${directive.notation} FOR:${directive.forName} REASON:${directive.reason}]]`,
        formatDiceResult(result),
      );
    }

    // Check for combat start/end signals
    if (dmResponse.includes("[[COMBAT:START]]")) {
      dmResponse = dmResponse.replace("[[COMBAT:START]]", "");
      const initResults = startCombat(gameState);
      const initText = initResults.map(formatDiceResult).join("\n");
      dmResponse += `\n\n**Initiative Order:**\n${initText}`;
    }

    if (dmResponse.includes("[[COMBAT:END]]")) {
      dmResponse = dmResponse.replace("[[COMBAT:END]]", "");
      endCombat(gameState);
      dmResponse += "\n\n*Combat has ended.*";
    }

    // Post DM narration as embed via webhook
    await sendAsIdentity(channel, "Dungeon Master", "", {
      embeds: [dmNarrationEmbed(dmResponse)],
    });

    // Record in history
    const entry: TurnEntry = {
      id: history.length + 1,
      timestamp: new Date().toISOString(),
      playerId: "dm",
      playerName: "Dungeon Master",
      type: "dm-narration",
      content: dmResponse,
      diceResults: diceResults.length > 0 ? diceResults : undefined,
    };

    await appendHistory(gameState.id, entry);
    gameState.turnCount++;
  } catch (err) {
    console.error("Error generating DM narration:", err);
    await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
  }
}
