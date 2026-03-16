import type { TextChannel } from "discord.js";
import { generateAgentAction, loadAgentPersonality } from "../ai/agent.js";
import { compressNarrative, dmNarrate } from "../ai/dm.js";
import { checkAgentResponse, checkDMResponse } from "../ai/guardrail.js";
import { getNextAction } from "../ai/orchestrator.js";
import { AGENT_DELAY_MS, COMPRESS_EVERY, HISTORY_WINDOW } from "../config.js";
import { formatDMNarration } from "../discord/formatter.js";
import { sendAsIdentity, startTyping } from "../discord/webhooks.js";
import { log } from "../logger.js";
import { appendHistory, loadHistory, saveGameState } from "../state/store.js";
import type { DiceResult, GameState, TurnEntry } from "../state/types.js";
import {
  advanceTurn,
  applyDamage,
  applyHealing,
  endCombat,
  rollDeathSave,
  startCombat,
} from "./combat.js";
import { summarizeConditionEffects } from "./conditions.js";
import {
  formatDiceResult,
  parseConcentrateDirective,
  parseConditionDirective,
  parseDamageDirective,
  parseDiceDirective,
  parseHealDirective,
  parseSpellDirective,
  parseUseDirective,
  parseXPDirective,
  roll,
} from "./dice.js";
import { buildCombatHPSummary, detectDirectiveMisuse } from "./hp-reconciliation.js";
import { checkLevelUp } from "./leveling.js";
import { useFeatureCharge, useSpellSlot } from "./resources.js";

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
        await handleDMTurn(gameState, history, channel);
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

    // Guardrail: check for player agency violations (only human PCs — AI agents
    // have already declared actions, so DM is expected to narrate their outcomes)
    const pcNames = gameState.players.filter((p) => !p.isAgent).map((p) => p.characterSheet.name);
    const guardrail = await checkDMResponse(dmResponse, pcNames, recentActions);
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
      let rollText = formatDiceResult(result);

      // Annotate with condition effects if the character has relevant conditions
      if (gameState.combat.active) {
        const combatant = gameState.combat.combatants.find(
          (c) => c.name.toLowerCase() === directive.forName.toLowerCase(),
        );
        if (combatant && combatant.conditions.length > 0) {
          const effects = summarizeConditionEffects(combatant.conditions);
          if (effects.length > 0) {
            rollText += ` *(${effects.join("; ")})*`;
          }
        }
      }

      dmResponse = dmResponse.replace(
        `[[ROLL:${directive.notation} FOR:${directive.forName} REASON:${directive.reason}]]`,
        rollText,
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

    // Process spell slot directives
    const spellDirectives = parseSpellDirective(dmResponse);
    for (const directive of spellDirectives) {
      const originalTag = `[[SPELL:${directive.level} TARGET:${directive.target}]]`;
      const player = gameState.players.find(
        (p) => p.characterSheet.name.toLowerCase() === directive.target.toLowerCase(),
      );
      if (player) {
        const used = useSpellSlot(player.characterSheet, directive.level);
        if (used) {
          const remaining =
            player.characterSheet.spellSlots?.find((s) => s.level === directive.level)?.current ??
            0;
          log.info(
            `  Spell: ${directive.target} used a level ${directive.level} slot (${remaining} remaining)`,
          );
          dmResponse = dmResponse.replace(originalTag, "");
        } else {
          log.warn(`  Spell: ${directive.target} has no level ${directive.level} slots available!`);
          dmResponse = dmResponse.replace(
            originalTag,
            `*[${directive.target} has no level ${directive.level} spell slots remaining!]*`,
          );
        }
      } else {
        log.warn(`  Spell: target "${directive.target}" not found`);
        dmResponse = dmResponse.replace(originalTag, "");
      }
    }

    // Process feature use directives
    const useDirectives = parseUseDirective(dmResponse);
    for (const directive of useDirectives) {
      const originalTag = `[[USE:${directive.featureName} TARGET:${directive.target}]]`;
      const player = gameState.players.find(
        (p) => p.characterSheet.name.toLowerCase() === directive.target.toLowerCase(),
      );
      if (player) {
        const used = useFeatureCharge(player.characterSheet, directive.featureName);
        if (used) {
          const charge = player.characterSheet.featureCharges?.find(
            (c) => c.name.toLowerCase() === directive.featureName.toLowerCase(),
          );
          log.info(
            `  Use: ${directive.target} used ${directive.featureName} (${charge?.current ?? 0} remaining)`,
          );
          dmResponse = dmResponse.replace(originalTag, "");
        } else {
          log.warn(`  Use: ${directive.target} has no ${directive.featureName} charges!`);
          dmResponse = dmResponse.replace(
            originalTag,
            `*[${directive.target} has no ${directive.featureName} charges remaining!]*`,
          );
        }
      } else {
        log.warn(`  Use: target "${directive.target}" not found`);
        dmResponse = dmResponse.replace(originalTag, "");
      }
    }

    // Process concentration directives
    const concentrateDirectives = parseConcentrateDirective(dmResponse);
    for (const directive of concentrateDirectives) {
      const originalTag = `[[CONCENTRATE:${directive.spell} TARGET:${directive.target}]]`;
      const combatant = gameState.combat.combatants.find(
        (c) => c.name.toLowerCase() === directive.target.toLowerCase(),
      );
      if (combatant) {
        if (combatant.concentration) {
          log.info(
            `  Concentration: ${directive.target} breaks concentration on ${combatant.concentration.spell} to cast ${directive.spell}`,
          );
          dmResponse = dmResponse.replace(
            originalTag,
            `*[${directive.target} breaks concentration on ${combatant.concentration.spell}]*`,
          );
        } else {
          dmResponse = dmResponse.replace(originalTag, "");
        }
        combatant.concentration = { spell: directive.spell };
        log.info(`  Concentration: ${directive.target} now concentrating on ${directive.spell}`);
      } else {
        dmResponse = dmResponse.replace(originalTag, "");
      }
    }

    // Process condition directives
    const conditionDirectives = parseConditionDirective(dmResponse);
    for (const directive of conditionDirectives) {
      const originalTag = `[[CONDITION:${directive.action.toUpperCase()} ${directive.condition} TARGET:${directive.target}]]`;
      const combatant = gameState.combat.combatants.find(
        (c) => c.name.toLowerCase() === directive.target.toLowerCase(),
      );
      if (combatant) {
        if (directive.action === "add") {
          if (!combatant.conditions.includes(directive.condition)) {
            combatant.conditions.push(directive.condition);
            log.info(`  Condition: ${directive.target} gains ${directive.condition}`);
          }
        } else {
          combatant.conditions = combatant.conditions.filter((c) => c !== directive.condition);
          log.info(`  Condition: ${directive.target} loses ${directive.condition}`);
        }
        dmResponse = dmResponse.replace(originalTag, "");
      } else {
        log.warn(`  Condition: target "${directive.target}" not found`);
        dmResponse = dmResponse.replace(originalTag, "");
      }
    }

    // Check concentration on damage — auto-roll CON save
    for (const directive of damageDirectives) {
      const combatant = gameState.combat.combatants.find(
        (c) => c.name.toLowerCase() === directive.targetName.toLowerCase(),
      );
      if (combatant?.concentration) {
        const dc = Math.max(10, Math.floor(diceResults[diceResults.length - 1]?.total ?? 10) / 2);
        const player = gameState.players.find((p) => p.id === combatant.playerId);
        const conMod = player
          ? Math.floor((player.characterSheet.abilityScores.constitution - 10) / 2)
          : 0;
        const conSave = roll(`d20+${conMod}`, `${combatant.name} concentration save`);
        diceResults.push(conSave);
        if (conSave.total >= dc) {
          log.info(
            `  Concentration: ${combatant.name} passes CON save (${conSave.total} vs DC ${dc}), maintains ${combatant.concentration.spell}`,
          );
          dmResponse += `\n*${combatant.name} maintains concentration on ${combatant.concentration.spell} (CON save: ${conSave.total} vs DC ${dc})*`;
        } else {
          log.info(
            `  Concentration: ${combatant.name} fails CON save (${conSave.total} vs DC ${dc}), loses ${combatant.concentration.spell}`,
          );
          dmResponse += `\n*${combatant.name} loses concentration on ${combatant.concentration.spell}! (CON save: ${conSave.total} vs DC ${dc})*`;
          combatant.concentration = undefined;
        }
      }
    }

    // Process XP directives
    const xpDirectives = parseXPDirective(dmResponse);
    for (const directive of xpDirectives) {
      const originalTag = `[[XP:${directive.amount} TARGET:${directive.target} REASON:${directive.reason}]]`;
      if (directive.target.toLowerCase() === "party") {
        const playerCount = gameState.players.length;
        const perPlayer = Math.floor(directive.amount / playerCount);
        const levelUps: string[] = [];
        for (const p of gameState.players) {
          p.characterSheet.experiencePoints = (p.characterSheet.experiencePoints ?? 0) + perPlayer;
          log.info(
            `  XP: +${perPlayer} to ${p.characterSheet.name} (total: ${p.characterSheet.experiencePoints})`,
          );
          if (checkLevelUp(p.characterSheet.experiencePoints, p.characterSheet.level)) {
            levelUps.push(p.characterSheet.name);
          }
        }
        let replacement = `**+${perPlayer} XP each** (${directive.reason})`;
        if (levelUps.length > 0) {
          replacement += ` — ${levelUps.map((n) => `**${n}** is ready to level up!`).join(" ")}`;
        }
        dmResponse = dmResponse.replace(originalTag, replacement);
      } else {
        const player = gameState.players.find(
          (p) => p.characterSheet.name.toLowerCase() === directive.target.toLowerCase(),
        );
        if (player) {
          player.characterSheet.experiencePoints =
            (player.characterSheet.experiencePoints ?? 0) + directive.amount;
          log.info(
            `  XP: +${directive.amount} to ${player.characterSheet.name} (total: ${player.characterSheet.experiencePoints})`,
          );
          let replacement = `**+${directive.amount} XP** to ${player.characterSheet.name} (${directive.reason})`;
          if (checkLevelUp(player.characterSheet.experiencePoints, player.characterSheet.level)) {
            replacement += ` — **${player.characterSheet.name}** is ready to level up!`;
          }
          dmResponse = dmResponse.replace(originalTag, replacement);
        } else {
          log.warn(`  XP: target "${directive.target}" not found`);
          dmResponse = dmResponse.replace(
            originalTag,
            `**+${directive.amount} XP** (${directive.reason})`,
          );
        }
      }
    }

    // Detect directive misuse (narrated damage/healing without matching directives)
    const processedDamageTargets = damageDirectives.map((d) => d.targetName);
    const processedHealTargets = healDirectives.map((d) => d.targetName);
    const misuseWarnings = detectDirectiveMisuse(
      dmResponse,
      processedDamageTargets,
      processedHealTargets,
    );
    for (const warning of misuseWarnings) {
      log.warn(`Directive misuse: ${warning}`);
    }

    // HP reconciliation: append system entry so DM sees HP state next turn
    if (gameState.combat.active) {
      const hpSummary = buildCombatHPSummary(gameState);
      if (hpSummary) {
        const systemEntries: TurnEntry[] = [];
        systemEntries.push({
          id: history.length + 2,
          timestamp: new Date().toISOString(),
          playerId: "system",
          playerName: "System",
          type: "system",
          content: hpSummary,
        });
        if (misuseWarnings.length > 0) {
          systemEntries.push({
            id: history.length + 3,
            timestamp: new Date().toISOString(),
            playerId: "system",
            playerName: "System",
            type: "system",
            content: `Warning: ${misuseWarnings.join(" ")}`,
          });
        }
        for (const sysEntry of systemEntries) {
          await appendHistory(gameState.id, sysEntry);
        }
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

    // Post DM narration as plain text via webhook
    await sendAsIdentity(channel, "Dungeon Master", formatDMNarration(dmResponse));
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
