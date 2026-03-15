import type { TextChannel } from "discord.js";
import { generateAgentAction, loadAgentPersonality } from "../ai/agent.js";
import { compressNarrative, dmNarrate } from "../ai/dm.js";
import { checkAgentResponse, checkDMResponse } from "../ai/guardrail.js";
import { getNextAction } from "../ai/orchestrator.js";
import { AGENT_DELAY_MS, COMPRESS_EVERY, HISTORY_WINDOW } from "../config.js";
import { dmNarrationEmbeds } from "../discord/formatter.js";
import { sendAsIdentity, startTyping } from "../discord/webhooks.js";
import { log } from "../logger.js";
import { appendHistory, loadHistory, saveGameState } from "../state/store.js";
import type { DiceResult, GameState, TurnEntry } from "../state/types.js";
import { advanceTurn, applyDamage, applyHealing, endCombat, startCombat } from "./combat.js";
import {
  formatDiceResult,
  parseDamageDirective,
  parseDiceDirective,
  parseHealDirective,
  roll,
} from "./dice.js";

// Per-game mutex: ensures only one processTurn runs at a time per game.
// Concurrent calls are queued and execute sequentially.
const gameLocks = new Map<string, Promise<void>>();

function withGameLock(gameId: string, fn: () => Promise<void>): Promise<void> {
  const prev = gameLocks.get(gameId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn after previous completes (even if it failed)
  gameLocks.set(gameId, next);
  // Clean up reference when chain settles to avoid memory leak
  next.then(() => {
    if (gameLocks.get(gameId) === next) gameLocks.delete(gameId);
  });
  return next;
}

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
 * Resume the orchestrator loop for an active game after bot restart.
 * Checks if AI agents need to act and prompts them if so.
 */
export function resumeOrchestrator(gameState: GameState, channel: TextChannel): Promise<void> {
  return withGameLock(gameState.id, async () => {
    log.info(`Resume: running orchestrator for game ${gameState.id}`);
    await orchestratorLoop(gameState, channel);
    await saveGameState(gameState);
  });
}

/**
 * Process a new turn entry and drive the game forward.
 * Called after a human player acts or a system event occurs.
 *
 * Uses a per-game mutex to prevent concurrent orchestrator loops
 * from causing duplicate agent/DM responses.
 */
export function processTurn(
  gameState: GameState,
  entry: TurnEntry,
  channel: TextChannel,
): Promise<void> {
  return withGameLock(gameState.id, () => processTurnInner(gameState, entry, channel));
}

async function processTurnInner(
  gameState: GameState,
  entry: TurnEntry,
  channel: TextChannel,
): Promise<void> {
  // Record the entry
  log.info(
    `Turn ${gameState.turnCount + 1}: ${entry.playerName} [${entry.type}] — ${entry.content.slice(0, 80)}`,
  );
  await appendHistory(gameState.id, entry);
  gameState.turnCount++;

  // Mark this player as having responded
  markResponded(gameState.id, entry.playerId);

  // Run the orchestrator loop
  log.info("Orchestrator loop starting");
  await orchestratorLoop(gameState, channel);
  log.info("Orchestrator loop finished");

  // Auto-persist state
  await saveGameState(gameState);

  // Compress narrative if needed
  if (gameState.turnCount % COMPRESS_EVERY === 0) {
    log.info(`Compressing narrative (turn ${gameState.turnCount})`);
    const history = await loadHistory(gameState.id);
    gameState.narrativeSummary = await compressNarrative(gameState, history);
    await saveGameState(gameState);
    log.info("Narrative compressed");
  }
}

async function orchestratorLoop(gameState: GameState, channel: TextChannel): Promise<void> {
  const maxIterations = gameState.players.length * 2 + 2; // prevent infinite loops
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    const history = await loadHistory(gameState.id);
    const lastEntry = history[history.length - 1];
    if (!lastEntry) break;

    const responded = getResponded(gameState.id);
    log.debug(
      `Orchestrator iteration ${iterations}/${maxIterations} — responded: [${[...responded].join(", ")}]`,
    );
    const decision = await getNextAction(gameState, history, lastEntry, responded);
    log.info(
      `Orchestrator → ${decision.action}${decision.targetPlayerId ? ` target=${decision.targetPlayerId}` : ""} (${decision.reason})`,
    );

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
        log.info("Round cleared — ready for next player input");

        // If combat, advance turn and continue loop (next combatant may be an AI agent)
        if (gameState.combat.active) {
          advanceTurn(gameState);
          log.info(
            `Combat: advanced to turn ${gameState.combat.turnIndex}, round ${gameState.combat.round}`,
          );
          break;
        }
        return; // Non-combat: DM narration ends this orchestration cycle
      }

      case "wait_for_human": {
        const waitPlayer = gameState.players.find((p) => p.id === decision.targetPlayerId);
        log.info(`Waiting for human: ${waitPlayer?.name ?? decision.targetPlayerId}`);
        return;
      }

      case "advance_combat": {
        if (gameState.combat.active) {
          advanceTurn(gameState);
          log.info(
            `Combat: advanced to turn ${gameState.combat.turnIndex}, round ${gameState.combat.round}`,
          );
        }
        break;
      }

      case "skip": {
        log.info("Orchestrator: skipping (no action needed)");
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

  log.info(`Agent turn: ${player.name} — generating response...`);
  const stopTyping = startTyping(channel);

  try {
    const personality = await loadAgentPersonality(player.agentFile.replace(/\.md$/, ""));

    // Pacing delay
    await new Promise((r) => setTimeout(r, AGENT_DELAY_MS));

    const recentHistory = history.slice(-HISTORY_WINDOW);
    const currentSituation = recentHistory
      .slice(-3)
      .map((t) => `[${t.playerName}] ${t.content}`)
      .join("\n");

    log.debug(`Agent ${player.name}: calling Claude (model=${personality.model ?? "default"})`);
    let response = await generateAgentAction(
      personality,
      gameState,
      recentHistory,
      currentSituation,
    );
    log.info(`Agent ${player.name}: response ready (${response.length} chars)`);

    // Guardrail: check agent isn't inventing world facts
    const dmContext = recentHistory
      .filter((t) => t.type === "dm-narration")
      .map((t) => t.content)
      .join("\n\n");
    const agentCheck = await checkAgentResponse(response, player.name, dmContext);
    if (!agentCheck.pass) {
      log.warn(`Agent guardrail violation (${player.name}): ${agentCheck.violation}`);
      log.info(`Agent ${player.name}: re-generating with guardrail feedback...`);
      response = await generateAgentAction(
        personality,
        gameState,
        recentHistory,
        `${currentSituation}\n\n[SYSTEM: Your previous response was rejected because you invented world details the DM hasn't described. Violation: "${agentCheck.violation}". You may ONLY reference things the DM has already narrated. Express intentions, speak in character, react emotionally — but do NOT describe what you perceive, detect, or discover. Only the DM decides what exists in the world.]`,
      );
      log.info(`Agent ${player.name}: re-generated response ready (${response.length} chars)`);
    } else {
      log.info(`Agent guardrail (${player.name}): pass`);
    }

    stopTyping();

    // Post as agent identity via webhook
    await sendAsIdentity(channel, player.name, response, {
      avatarUrl: personality.avatarUrl,
    });
    log.info(`Agent ${player.name}: posted to Discord`);

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
    stopTyping();
    log.error(`Agent ${player.name}: failed to generate action:`, err);
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

  log.info("DM turn: calling Claude for narration...");
  const stopTyping = startTyping(channel);
  log.debug(
    `DM prompt: resolving actions from ${responded.size} players (${recentActions.length} chars)`,
  );
  try {
    let dmResponse = await dmNarrate(gameState, history, recentActions);
    log.info(`DM turn: response ready (${dmResponse?.length ?? 0} chars)`);

    if (!dmResponse || !dmResponse.trim()) {
      log.warn("DM returned empty response");
      stopTyping();
      await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
      return;
    }

    // Guardrail: check for player agency violations
    const pcNames = gameState.players.map((p) => p.characterSheet.name);
    const guardrail = await checkDMResponse(dmResponse, pcNames);
    if (!guardrail.pass) {
      log.warn(`Guardrail violation: ${guardrail.violation}`);
      log.info("DM turn: re-generating with guardrail feedback...");
      const feedback = `${recentActions}\n\n[SYSTEM: Your previous response was rejected because it violated player agency. Violation: "${guardrail.violation}". Remember: NEVER narrate what player characters do, say, think, feel, or attempt. Only describe the world, NPCs, and outcomes of actions players have ALREADY stated. Re-write your response without controlling any player character.]`;
      dmResponse = await dmNarrate(gameState, history, feedback);
      log.info(`DM turn: re-generated response ready (${dmResponse?.length ?? 0} chars)`);

      if (!dmResponse || !dmResponse.trim()) {
        log.warn("DM returned empty response on retry");
        stopTyping();
        await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
        return;
      }
    } else {
      log.info("Guardrail: pass");
    }

    stopTyping();

    // Process dice directives
    const directives = parseDiceDirective(dmResponse);
    const diceResults: DiceResult[] = [];

    if (directives.length > 0) {
      log.info(`DM turn: processing ${directives.length} dice directive(s)`);
    }
    for (const directive of directives) {
      const result = roll(directive.notation, `${directive.forName}: ${directive.reason}`);
      diceResults.push(result);
      log.info(
        `  Dice: ${directive.notation} for ${directive.forName} → ${result.total} (${directive.reason})`,
      );

      // Replace the directive in the DM text with the result
      dmResponse = dmResponse.replace(
        `[[ROLL:${directive.notation} FOR:${directive.forName} REASON:${directive.reason}]]`,
        formatDiceResult(result),
      );
    }

    // Process damage directives
    const damageDirectives = parseDamageDirective(dmResponse);
    for (const directive of damageDirectives) {
      const result = roll(directive.notation, `${directive.targetName}: ${directive.reason}`);
      diceResults.push(result);
      const dmgResult = applyDamage(gameState, directive.targetName, result.total);
      if (dmgResult) {
        const hpAfter = dmgResult.combatant.hp.current;
        const hpMax = dmgResult.combatant.hp.max;
        log.info(
          `  Damage: ${result.total} to ${directive.targetName} (HP: ${hpAfter}/${hpMax}) — ${directive.reason}`,
        );
        dmResponse = dmResponse.replace(
          `[[DAMAGE:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          `${formatDiceResult(result)} → **${result.total} damage** to ${directive.targetName} (HP: ${hpAfter}/${hpMax})`,
        );
      } else {
        log.warn(`  Damage: target "${directive.targetName}" not found`);
        dmResponse = dmResponse.replace(
          `[[DAMAGE:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          formatDiceResult(result),
        );
      }
    }

    // Process heal directives
    const healDirectives = parseHealDirective(dmResponse);
    for (const directive of healDirectives) {
      const result = roll(directive.notation, `${directive.targetName}: ${directive.reason}`);
      diceResults.push(result);
      const healed = applyHealing(gameState, directive.targetName, result.total);
      if (healed) {
        const hpAfter = healed.hp.current;
        const hpMax = healed.hp.max;
        log.info(
          `  Heal: ${result.total} to ${directive.targetName} (HP: ${hpAfter}/${hpMax}) — ${directive.reason}`,
        );
        dmResponse = dmResponse.replace(
          `[[HEAL:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          `${formatDiceResult(result)} → **${result.total} healed** on ${directive.targetName} (HP: ${hpAfter}/${hpMax})`,
        );
      } else {
        log.warn(`  Heal: target "${directive.targetName}" not found`);
        dmResponse = dmResponse.replace(
          `[[HEAL:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          formatDiceResult(result),
        );
      }
    }

    // Check for combat start/end signals
    if (dmResponse.includes("[[COMBAT:START]]")) {
      log.info("DM turn: COMBAT START signal detected");
      dmResponse = dmResponse.replace("[[COMBAT:START]]", "");
      const initResults = startCombat(gameState);
      const initText = initResults.map(formatDiceResult).join("\n");
      dmResponse += `\n\n**Initiative Order:**\n${initText}`;
      log.info(`Combat started — ${initResults.length} combatants rolled initiative`);
    }

    if (dmResponse.includes("[[COMBAT:END]]")) {
      log.info("DM turn: COMBAT END signal detected");
      dmResponse = dmResponse.replace("[[COMBAT:END]]", "");
      endCombat(gameState);
      dmResponse += "\n\n*Combat has ended.*";
    }

    // Post DM narration as embed via webhook
    await sendAsIdentity(channel, "Dungeon Master", "", {
      embeds: dmNarrationEmbeds(dmResponse),
    });
    log.info("DM turn: narration posted to Discord");

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
    stopTyping();
    log.error("DM turn: failed to generate narration:", err);
    await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
  }
}
