import type { TextChannel } from "discord.js";
import { generateAgentAction, loadAgentPersonality } from "../ai/agent.js";
import { compressNarrative, dmNarrate, loadCanonicalFacts } from "../ai/dm.js";
import { checkAgentResponse, checkDMResponse } from "../ai/guardrail.js";
import { getNextAction } from "../ai/orchestrator.js";
import { AGENT_DELAY_MS, COMPRESS_EVERY, HISTORY_WINDOW } from "../config.js";
import { combatStatusEmbed, formatDMNarration } from "../discord/formatter.js";
import { sendAsIdentity, startTyping } from "../discord/webhooks.js";
import { log } from "../logger.js";
import { appendHistory, loadGameState, loadHistory, saveGameState } from "../state/store.js";
import type { GameState, PendingRoll, TurnEntry } from "../state/types.js";
import { formatAskHistoryForPrompt } from "./ask-history.js";
import { advanceTurn, peekNextCombatant, rollDeathSave } from "./combat.js";
import { formatDiceResult } from "./dice.js";
import { processDirectives } from "./directives.js";

const NARRATION_MIN_LENGTH = 150;
const TOOL_META_PATTERNS = /\b(updated|wrote|edited|checked|read|noted|recorded|saved|modified)\b/i;
const NARRATIVE_MARKERS = /[*>]|\[\[/;

/**
 * Detect DM responses that are only meta-commentary about tool operations
 * (e.g. "Updated dm-notes with merchant transaction.") rather than actual narration.
 */
export function isToolMetaOnly(response: string): boolean {
  const trimmed = response.trim();
  if (trimmed.length >= NARRATION_MIN_LENGTH) return false;
  if (NARRATIVE_MARKERS.test(trimmed)) return false;
  return TOOL_META_PATTERNS.test(trimmed);
}

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
// Track when each round started (ISO timestamp) to detect stale queued messages
const roundStartTimes = new Map<string, string>();
// Track who has already been pinged this round (prevents duplicate @mentions)
const roundPings = new Map<string, Set<string>>();

function getResponded(gameId: string): Set<string> {
  if (!roundResponses.has(gameId)) {
    roundResponses.set(gameId, new Set());
  }
  // biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
  return roundResponses.get(gameId)!;
}

export function getRoundStartTime(gameId: string): string {
  return roundStartTimes.get(gameId) ?? new Date(0).toISOString();
}

export function clearRound(gameId: string): void {
  roundResponses.set(gameId, new Set());
  roundStartTimes.set(gameId, new Date().toISOString());
  roundPings.set(gameId, new Set());
}

function hasPinged(gameId: string, playerId: string): boolean {
  return roundPings.get(gameId)?.has(playerId) ?? false;
}

function markPinged(gameId: string, playerId: string): void {
  if (!roundPings.has(gameId)) roundPings.set(gameId, new Set());
  roundPings.get(gameId)?.add(playerId);
}

export function markResponded(gameId: string, playerId: string): void {
  getResponded(gameId).add(playerId);
}

/**
 * Resume the orchestrator loop for an active game after bot restart.
 * Checks if AI agents need to act and prompts them if so.
 */
export function resumeOrchestrator(gameId: string, channel: TextChannel): Promise<void> {
  return withGameLock(gameId, async () => {
    const gameState = await loadGameState(gameId);
    if (!gameState || gameState.status !== "active") return;
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
export function processTurn(gameId: string, entry: TurnEntry, channel: TextChannel): Promise<void> {
  return withGameLock(gameId, async () => {
    const gameState = await loadGameState(gameId);
    if (!gameState || gameState.status !== "active") return;
    await processTurnInner(gameState, entry, channel);
  });
}

async function processTurnInner(
  gameState: GameState,
  entry: TurnEntry,
  channel: TextChannel,
): Promise<void> {
  // Check if this entry was created before the current round started.
  // This happens when a player sends multiple IC messages quickly — the second
  // message gets queued behind the lock and processed after the round clears.
  // Without this check, the stale message would count as the player's action in
  // the NEW round, stealing their turn.
  const roundStart = getRoundStartTime(gameState.id);
  const isStale = entry.timestamp < roundStart;

  // Record the entry (always — even stale messages are valid history)
  log.info(
    `Turn ${gameState.turnCount + 1}: ${entry.playerName} [${entry.type}] — ${entry.content.slice(0, 80)}${isStale ? " (stale)" : ""}`,
  );
  await appendHistory(gameState.id, entry);

  if (isStale) {
    log.info(
      `Stale entry from ${entry.playerName} (sent ${entry.timestamp}, round started ${roundStart}) — recorded but not counting as round action`,
    );
    return;
  }

  gameState.turnCount++;

  // Mark this player as having responded
  markResponded(gameState.id, entry.playerId);

  // Clear waitingFor now that someone has acted
  if (gameState.waitingFor?.playerId === entry.playerId) {
    gameState.waitingFor = null;
  }

  // Run the orchestrator loop
  const restCountBefore = gameState.longRestCount ?? 0;
  log.info("Orchestrator loop starting");
  await orchestratorLoop(gameState, channel);
  log.info("Orchestrator loop finished");

  // Auto-persist state
  await saveGameState(gameState);

  // Compress narrative if needed
  let compressed = false;
  if (gameState.turnCount % COMPRESS_EVERY === 0) {
    log.info(`Compressing narrative (turn ${gameState.turnCount})`);
    const history = await loadHistory(gameState.id);
    const canonicalFacts = await loadCanonicalFacts(gameState.id);
    const result = await compressNarrative(gameState, history, canonicalFacts);
    gameState.narrativeSummary = result.narrativeSummary;
    gameState.sceneState = result.sceneState;
    await saveGameState(gameState);
    log.info("Narrative compressed");
    compressed = true;
  }

  // Also compress after long rest — major time-of-day change that must update sceneState
  const longRestOccurred = (gameState.longRestCount ?? 0) > restCountBefore;
  if (longRestOccurred && !compressed) {
    log.info("Compressing narrative after long rest");
    const history = await loadHistory(gameState.id);
    const canonicalFacts = await loadCanonicalFacts(gameState.id);
    const result = await compressNarrative(gameState, history, canonicalFacts);
    gameState.narrativeSummary = result.narrativeSummary;
    gameState.sceneState = result.sceneState;
    await saveGameState(gameState);
    log.info("Narrative compressed after long rest");
  }
}

/**
 * Check if the current combatant needs a death save. Auto-roll if at 0 HP.
 * Posts result to channel and records in history. Returns true if a death save was rolled.
 */
async function handleDeathSaveIfNeeded(
  gameState: GameState,
  channel: TextChannel,
): Promise<boolean> {
  if (!gameState.combat.active) return false;
  const combatant = gameState.combat.combatants[gameState.combat.turnIndex];
  if (!combatant || combatant.hp.current > 0) return false;
  if (combatant.conditions.includes("stable") || combatant.conditions.includes("dead")) {
    return false;
  }

  const { roll: diceResult, result } = rollDeathSave(combatant);
  log.info(`Death save: ${combatant.name} rolled ${diceResult.total} → ${result}`);

  let message: string;
  switch (result) {
    case "revived":
      message = `**${combatant.name}** rolls a death save: ${formatDiceResult(diceResult)} — **Natural 20! ${combatant.name} regains consciousness with 1 HP!**`;
      break;
    case "dead":
      message = `**${combatant.name}** rolls a death save: ${formatDiceResult(diceResult)} — **${combatant.name} has died.** (${combatant.deathSaves.failures} failures)`;
      combatant.conditions.push("dead");
      break;
    case "stabilized":
      message = `**${combatant.name}** rolls a death save: ${formatDiceResult(diceResult)} — **Stabilized!** (${combatant.deathSaves.successes} successes)`;
      break;
    default: {
      const counter =
        result === "success" ? combatant.deathSaves.successes : combatant.deathSaves.failures;
      const label = result === "success" ? "successes" : "failures";
      message = `**${combatant.name}** rolls a death save: ${formatDiceResult(diceResult)} — ${result} (${counter} ${label})`;
    }
  }

  await channel.send(message);

  const entry: TurnEntry = {
    id: 0,
    timestamp: new Date().toISOString(),
    playerId: "system",
    playerName: "System",
    type: "system",
    content: message,
    diceResults: [diceResult],
  };
  await appendHistory(gameState.id, entry);

  // If dead or stable, advance past this combatant
  if (result === "dead" || result === "stabilized") {
    advanceTurn(gameState);
    await saveGameState(gameState);
  }

  return true;
}

async function orchestratorLoop(gameState: GameState, channel: TextChannel): Promise<void> {
  const maxIterations = gameState.players.length * 2 + 2; // prevent infinite loops
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    const history = await loadHistory(gameState.id);
    const lastEntry = history[history.length - 1];
    if (!lastEntry) break;

    // Auto-roll death saves at the start of a combatant's turn
    if (gameState.combat.active) {
      const deathSaveRolled = await handleDeathSaveIfNeeded(gameState, channel);
      if (deathSaveRolled) continue; // Re-evaluate after death save
    }

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
        try {
          // Check if this is a resolution phase (all pending rolls fulfilled)
          if (gameState.pendingRolls?.length && gameState.pendingRolls.every((r) => r.result)) {
            await handleDMResolution(gameState, history, channel);
          } else {
            await handleDMTurn(gameState, history, channel);
          }
        } catch {
          // DM failed — do NOT clear round so actions are retried next loop
          log.warn("DM turn failed — round preserved for retry");
          return;
        }

        // If pending rolls were created, ping the players and wait for input
        if (gameState.pendingRolls?.length) {
          const unfulfilled = gameState.pendingRolls.filter((r) => !r.result);
          for (const roll of unfulfilled) {
            const player = gameState.players.find((p) => p.id === roll.playerId);
            if (player && !player.isAgent && !hasPinged(gameState.id, roll.playerId)) {
              markPinged(gameState.id, roll.playerId);
              await channel.send(
                `<@${roll.playerId}> — roll \`${roll.notation}\` for **${roll.reason}** (\`/roll ${roll.notation}\`)`,
              );
            }
          }
          log.info("Pending rolls — waiting for player input before advancing");
          return;
        }

        // After DM resolves, clear round for next cycle
        clearRound(gameState.id);
        log.info("Round cleared — ready for next player input");

        // If combat, advance turn and persist immediately (prevents state loss on kill)
        if (gameState.combat.active) {
          advanceTurn(gameState);
          await saveGameState(gameState);
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
        // Persist who we're waiting for so the DM can see it in /ask
        gameState.waitingFor = waitPlayer
          ? { playerId: waitPlayer.id, playerName: waitPlayer.name }
          : null;
        await saveGameState(gameState);
        // Ping the player in Discord so they get notified (even with channel muted)
        // Skip if already pinged this round (prevents duplicates)
        if (decision.targetPlayerId && !hasPinged(gameState.id, decision.targetPlayerId)) {
          markPinged(gameState.id, decision.targetPlayerId);
          const mention = `<@${decision.targetPlayerId}>`;
          const pending = gameState.pendingRolls?.find(
            (r) => r.playerId === decision.targetPlayerId && !r.result,
          );
          const prompt = pending
            ? `${mention} — roll \`${pending.notation}\` for **${pending.reason}** (\`/roll ${pending.notation}\`)`
            : gameState.combat.active
              ? `${mention} — it's your turn!`
              : `${mention} — what do you do?`;
          await channel.send(prompt);
        }
        return;
      }

      case "advance_combat": {
        if (gameState.combat.active) {
          advanceTurn(gameState);
          await saveGameState(gameState);
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
      log.info(`Agent ${player.name}: re-generating with guardrail feedback (effort: medium)...`);
      response = await generateAgentAction(
        personality,
        gameState,
        recentHistory,
        `${currentSituation}\n\n[SYSTEM: Your previous response was rejected because you invented world details the DM hasn't described. Violation: "${agentCheck.violation}". You may ONLY reference things the DM has already narrated. Express intentions, speak in character, react emotionally — but do NOT describe what you perceive, detect, or discover. Only the DM decides what exists in the world.]`,
        "medium",
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
    const askHistory = formatAskHistoryForPrompt(gameState.id);
    let dmResponse = await dmNarrate(gameState, history, recentActions, askHistory);
    log.info(`DM turn: response ready (${dmResponse?.length ?? 0} chars)`);

    if (!dmResponse || !dmResponse.trim()) {
      log.warn("DM returned empty response");
      stopTyping();
      await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
      return;
    }

    // Guardrail: check for narration quality — DM sometimes responds with only
    // meta-commentary about tool use ("Updated dm-notes") instead of actual narration
    if (isToolMetaOnly(dmResponse)) {
      log.warn(
        `DM returned tool meta-commentary instead of narration: "${dmResponse.trim().slice(0, 80)}"`,
      );
      log.info("DM turn: re-generating with narration feedback (effort: high)...");
      const feedback = `${recentActions}\n\n[SYSTEM: Your previous response contained only meta-commentary about tool operations (e.g. "updated notes", "checked files") instead of actual narration. Players cannot see your tool use — they only see your text output. You MUST respond with immersive prose narration that advances the scene and resolves the player actions above. Narrate what happens in the world.]`;
      dmResponse = await dmNarrate(gameState, history, feedback, askHistory, "high");
      log.info(`DM turn: re-generated response ready (${dmResponse?.length ?? 0} chars)`);

      if (!dmResponse || !dmResponse.trim()) {
        log.warn("DM returned empty response on narration retry");
        stopTyping();
        await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
        return;
      }
    }

    // Guardrail: check for player agency violations (ALL PCs — human and AI agent alike)
    const pcNames = gameState.players.map((p) => p.characterSheet.name);
    const guardrail = await checkDMResponse(dmResponse, pcNames, recentActions);
    if (!guardrail.pass) {
      log.warn(`Guardrail violation: ${guardrail.violation}`);
      log.info("DM turn: re-generating with guardrail feedback (effort: high)...");
      const feedback = `${recentActions}\n\n[SYSTEM: Your previous response was rejected because it violated player agency. Violation: "${guardrail.violation}". Remember: NEVER narrate what player characters do, say, think, feel, or attempt. Only describe the world, NPCs, and outcomes of actions players have ALREADY stated. Re-write your response without controlling any player character. IMPORTANT: You MUST still include all dice directives ([[REQUEST_ROLL:...]], [[ROLL:...]], [[DAMAGE:...]], [[HEAL:...]], etc.) for any checks, attacks, or mechanical actions. Do not drop game mechanics — only fix the narration.]`;
      dmResponse = await dmNarrate(gameState, history, feedback, askHistory, "high");
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

    // Process all directives
    const ctx = processDirectives(dmResponse, gameState);
    dmResponse = ctx.processedText;

    // HP reconciliation: append system entries so DM sees HP state next turn
    if (gameState.combat.active) {
      if (ctx.hpSummary) {
        const systemEntries: TurnEntry[] = [];
        systemEntries.push({
          id: history.length + 2,
          timestamp: new Date().toISOString(),
          playerId: "system",
          playerName: "System",
          type: "system",
          content: ctx.hpSummary,
        });
        if (ctx.misuseWarnings.length > 0) {
          systemEntries.push({
            id: history.length + 3,
            timestamp: new Date().toISOString(),
            playerId: "system",
            playerName: "System",
            type: "system",
            content: `Warning: ${ctx.misuseWarnings.join(" ")}`,
          });
        }
        for (const sysEntry of systemEntries) {
          await appendHistory(gameState.id, sysEntry);
        }
      }
    }

    // Resource reconciliation: record summary after spell/feature use
    if (ctx.resourceSummary) {
      await appendHistory(gameState.id, {
        id: 0,
        timestamp: new Date().toISOString(),
        playerId: "system",
        playerName: "System",
        type: "system",
        content: ctx.resourceSummary,
      });
    }

    // Safety net: if combat is active, ensure DM mentions next combatant
    if (gameState.combat.active && !ctx.combatEnded) {
      const nextUp = peekNextCombatant(gameState.combat);
      if (nextUp && !dmResponse.toLowerCase().includes(nextUp.name.toLowerCase())) {
        dmResponse += `\n\n*Next up: **${nextUp.name}***`;
      }
    }

    // Handle pending rolls (two-phase DM turn)
    if (ctx.pendingRolls.length > 0) {
      const pendingRolls: PendingRoll[] = ctx.pendingRolls.map((pr) => ({
        id: pr.id,
        playerId: pr.playerId,
        playerName: pr.playerName,
        notation: pr.notation,
        reason: pr.reason,
      }));
      gameState.pendingRolls = pendingRolls;
      log.info(
        `DM turn: ${pendingRolls.length} pending roll(s) created — pausing for player input`,
      );
    }

    // Post DM narration as plain text via webhook
    await sendAsIdentity(channel, "Dungeon Master", formatDMNarration(dmResponse));
    log.info("DM turn: narration posted to Discord");

    // Auto status embed after combat HP/condition changes
    if (gameState.combat.active && (ctx.hpChanged || ctx.conditionsChanged)) {
      await channel.send({
        embeds: [combatStatusEmbed(gameState.combat, gameState.players)],
      });
    }

    // Record in history
    const entry: TurnEntry = {
      id: history.length + 1,
      timestamp: new Date().toISOString(),
      playerId: "dm",
      playerName: "Dungeon Master",
      type: "dm-narration",
      content: dmResponse,
      diceResults: ctx.diceResults.length > 0 ? ctx.diceResults : undefined,
    };

    await appendHistory(gameState.id, entry);
    gameState.turnCount++;
  } catch (err) {
    stopTyping();
    log.error("DM turn: failed to generate narration:", err);
    await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
    throw err;
  }
}

/**
 * Resolution phase: called when all pending rolls have been fulfilled.
 * Sends roll results to DM for narrative resolution.
 */
async function handleDMResolution(
  gameState: GameState,
  history: TurnEntry[],
  channel: TextChannel,
): Promise<void> {
  const pending = gameState.pendingRolls ?? [];
  if (pending.length === 0) return;

  const rollSummary = pending
    .filter((r) => r.result)
    .map(
      (r) =>
        `${r.playerName} rolled ${r.notation} for ${r.reason}: **${r.result?.total}** [${r.result?.rolls.join(", ")}]`,
    )
    .join("\n");

  const askHistory = formatAskHistoryForPrompt(gameState.id);

  log.info("DM resolution: calling Claude with fulfilled roll results...");
  const stopTyping = startTyping(channel);
  try {
    const resolutionPrompt = `The following dice rolls have been made by the players:\n\n${rollSummary}\n\nNarrate the outcomes of these rolls. Apply any consequences (damage, success/failure, etc.) using the appropriate directives.`;
    let dmResponse = await dmNarrate(gameState, history, resolutionPrompt, askHistory);
    log.info(`DM resolution: response ready (${dmResponse?.length ?? 0} chars)`);

    if (!dmResponse || !dmResponse.trim()) {
      log.warn("DM returned empty resolution response");
      stopTyping();
      return;
    }

    stopTyping();

    // Process directives in resolution response
    const ctx = processDirectives(dmResponse, gameState);
    dmResponse = ctx.processedText;

    // Safety net for next combatant
    if (gameState.combat.active && !ctx.combatEnded) {
      const nextUp = peekNextCombatant(gameState.combat);
      if (nextUp && !dmResponse.toLowerCase().includes(nextUp.name.toLowerCase())) {
        dmResponse += `\n\n*Next up: **${nextUp.name}***`;
      }
    }

    // Post narration
    await sendAsIdentity(channel, "Dungeon Master", formatDMNarration(dmResponse));

    // Auto status embed
    if (gameState.combat.active && (ctx.hpChanged || ctx.conditionsChanged)) {
      await channel.send({
        embeds: [combatStatusEmbed(gameState.combat, gameState.players)],
      });
    }

    // HP reconciliation
    if (gameState.combat.active && ctx.hpSummary) {
      await appendHistory(gameState.id, {
        id: 0,
        timestamp: new Date().toISOString(),
        playerId: "system",
        playerName: "System",
        type: "system",
        content: ctx.hpSummary,
      });
    }

    // Resource reconciliation
    if (ctx.resourceSummary) {
      await appendHistory(gameState.id, {
        id: 0,
        timestamp: new Date().toISOString(),
        playerId: "system",
        playerName: "System",
        type: "system",
        content: ctx.resourceSummary,
      });
    }

    // Record in history
    const entry: TurnEntry = {
      id: history.length + 1,
      timestamp: new Date().toISOString(),
      playerId: "dm",
      playerName: "Dungeon Master",
      type: "dm-narration",
      content: dmResponse,
      diceResults: ctx.diceResults.length > 0 ? ctx.diceResults : undefined,
    };
    await appendHistory(gameState.id, entry);
    gameState.turnCount++;
  } catch (err) {
    stopTyping();
    log.error("DM resolution: failed:", err);
    await channel.send("*The Dungeon Master pauses to gather their thoughts...*");
    throw err;
  } finally {
    // Clear pending rolls
    gameState.pendingRolls = undefined;
    await saveGameState(gameState);
  }
}
