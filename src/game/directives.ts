/**
 * Directive processing — extracted from engine.ts for testability.
 * Pure function (no I/O). Mutates gameState as needed.
 */

import { log } from "../logger.js";
import type { DiceResult, GameState } from "../state/types.js";
import {
  applyDamage,
  applyHealing,
  endCombat,
  setConditions,
  setHP,
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
  parseRequestRollDirective,
  parseSpellDirective,
  parseUpdateConditionDirective,
  parseUpdateHPDirective,
  parseUseDirective,
  parseXPDirective,
  roll,
} from "./dice.js";
import {
  buildCombatHPSummary,
  buildResourceSummary,
  detectDirectiveMisuse,
} from "./hp-reconciliation.js";
import { checkLevelUp } from "./leveling.js";
import { useFeatureCharge, useSpellSlot } from "./resources.js";

export interface DirectiveContext {
  processedText: string;
  diceResults: DiceResult[];
  damageTargets: string[];
  healTargets: string[];
  spellsUsed: boolean;
  featuresUsed: boolean;
  conditionsChanged: boolean;
  hpChanged: boolean;
  combatStarted: boolean;
  combatEnded: boolean;
  misuseWarnings: string[];
  hpSummary: string | null;
  resourceSummary: string | null;
  pendingRolls: {
    id: string;
    playerId: string;
    playerName: string;
    notation: string;
    reason: string;
  }[];
}

/**
 * Process all directives in DM response text.
 * Returns a DirectiveContext with the processed text and metadata.
 * Mutates gameState (HP, conditions, spell slots, etc.).
 */
export function processDirectives(text: string, gameState: GameState): DirectiveContext {
  let processedText = text;
  const diceResults: DiceResult[] = [];
  const damageTargets: string[] = [];
  const healTargets: string[] = [];
  let spellsUsed = false;
  let featuresUsed = false;
  let conditionsChanged = false;
  let hpChanged = false;
  let combatStarted = false;
  let combatEnded = false;

  // === REQUEST_ROLL directives (parsed but not auto-rolled for humans) ===
  const requestRollDirectives = parseRequestRollDirective(processedText);
  const pendingRolls: DirectiveContext["pendingRolls"] = [];
  for (const directive of requestRollDirectives) {
    const originalTag = `[[REQUEST_ROLL:${directive.notation} FOR:${directive.forName} REASON:${directive.reason}]]`;
    const player = gameState.players.find(
      (p) => p.characterSheet.name.toLowerCase() === directive.forName.toLowerCase(),
    );

    if (player && !player.isAgent) {
      // Human player — create pending roll
      pendingRolls.push({
        id: crypto.randomUUID(),
        playerId: player.id,
        playerName: directive.forName,
        notation: directive.notation,
        reason: directive.reason,
      });
      processedText = processedText.replace(
        originalTag,
        `🎲 **${directive.forName}**, roll \`${directive.notation}\` for **${directive.reason}**! Use \`/roll ${directive.notation}\` to roll.`,
      );
      log.info(
        `  Request roll: ${directive.forName} needs to roll ${directive.notation} (${directive.reason})`,
      );
    } else {
      // AI agent or unknown — auto-roll
      const result = roll(directive.notation, `${directive.forName}: ${directive.reason}`);
      diceResults.push(result);
      let rollText = formatDiceResult(result);
      if (gameState.combat.active) {
        const combatant = gameState.combat.combatants.find(
          (c) => c.name.toLowerCase() === directive.forName.toLowerCase(),
        );
        if (combatant?.conditions.length) {
          const effects = summarizeConditionEffects(combatant.conditions);
          if (effects.length > 0) {
            rollText += ` *(${effects.join("; ")})*`;
          }
        }
      }
      processedText = processedText.replace(originalTag, rollText);
      log.info(
        `  Auto-roll (agent): ${directive.notation} for ${directive.forName} → ${result.total}`,
      );
    }
  }

  // === ROLL directives ===
  const directives = parseDiceDirective(processedText);
  if (directives.length > 0) {
    log.info(`Processing ${directives.length} dice directive(s)`);
  }
  for (const directive of directives) {
    const result = roll(directive.notation, `${directive.forName}: ${directive.reason}`);
    diceResults.push(result);
    log.info(
      `  Dice: ${directive.notation} for ${directive.forName} → ${result.total} (${directive.reason})`,
    );

    let rollText = formatDiceResult(result);
    if (gameState.combat.active) {
      const combatant = gameState.combat.combatants.find(
        (c) => c.name.toLowerCase() === directive.forName.toLowerCase(),
      );
      if (combatant?.conditions.length) {
        const effects = summarizeConditionEffects(combatant.conditions);
        if (effects.length > 0) {
          rollText += ` *(${effects.join("; ")})*`;
        }
      }
    }
    processedText = processedText.replace(
      `[[ROLL:${directive.notation} FOR:${directive.forName} REASON:${directive.reason}]]`,
      rollText,
    );
  }

  // === DAMAGE directives ===
  const damageDirectives = parseDamageDirective(processedText);
  for (const directive of damageDirectives) {
    const result = roll(directive.notation, `${directive.targetName}: ${directive.reason}`);
    diceResults.push(result);
    damageTargets.push(directive.targetName);
    const dmgResult = applyDamage(gameState, directive.targetName, result.total);
    if (dmgResult) {
      hpChanged = true;
      const hpAfter = dmgResult.combatant.hp.current;
      const hpMax = dmgResult.combatant.hp.max;
      log.info(
        `  Damage: ${result.total} to ${directive.targetName} (HP: ${hpAfter}/${hpMax}) — ${directive.reason}`,
      );
      processedText = processedText.replace(
        `[[DAMAGE:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
        `${formatDiceResult(result)} → **${result.total} damage** to ${directive.targetName} (HP: ${hpAfter}/${hpMax})`,
      );
    } else {
      // Fallback: apply damage to character sheet directly (outside combat)
      const player = gameState.players.find(
        (p) => p.characterSheet.name.toLowerCase() === directive.targetName.toLowerCase(),
      );
      if (player) {
        const cs = player.characterSheet;
        const originalTemp = cs.hp.temp;
        cs.hp.temp = Math.max(0, originalTemp - result.total);
        const absorbed = originalTemp - cs.hp.temp;
        const remaining = result.total - absorbed;
        if (remaining > 0) {
          cs.hp.current = Math.max(0, cs.hp.current - remaining);
        }
        hpChanged = true;
        log.info(
          `  Damage: ${result.total} to ${directive.targetName} (HP: ${cs.hp.current}/${cs.hp.max}) — ${directive.reason} [non-combat]`,
        );
        processedText = processedText.replace(
          `[[DAMAGE:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          `${formatDiceResult(result)} → **${result.total} damage** to ${directive.targetName} (HP: ${cs.hp.current}/${cs.hp.max})`,
        );
      } else {
        log.info(
          `  Damage: ${result.total} to ${directive.targetName} (narrative HP only — not a PC)`,
        );
        processedText = processedText.replace(
          `[[DAMAGE:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          `${formatDiceResult(result)} → **${result.total} damage** to ${directive.targetName}`,
        );
      }
    }
  }

  // === HEAL directives ===
  const healDirectives = parseHealDirective(processedText);
  for (const directive of healDirectives) {
    const result = roll(directive.notation, `${directive.targetName}: ${directive.reason}`);
    diceResults.push(result);
    healTargets.push(directive.targetName);
    const healed = applyHealing(gameState, directive.targetName, result.total);
    if (healed) {
      hpChanged = true;
      const hpAfter = healed.hp.current;
      const hpMax = healed.hp.max;
      log.info(
        `  Heal: ${result.total} to ${directive.targetName} (HP: ${hpAfter}/${hpMax}) — ${directive.reason}`,
      );
      processedText = processedText.replace(
        `[[HEAL:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
        `${formatDiceResult(result)} → **${result.total} healed** on ${directive.targetName} (HP: ${hpAfter}/${hpMax})`,
      );
    } else {
      // Fallback: apply healing to character sheet directly (outside combat)
      const player = gameState.players.find(
        (p) => p.characterSheet.name.toLowerCase() === directive.targetName.toLowerCase(),
      );
      if (player) {
        const cs = player.characterSheet;
        cs.hp.current = Math.min(cs.hp.max, cs.hp.current + result.total);
        hpChanged = true;
        log.info(
          `  Heal: ${result.total} to ${directive.targetName} (HP: ${cs.hp.current}/${cs.hp.max}) — ${directive.reason} [non-combat]`,
        );
        processedText = processedText.replace(
          `[[HEAL:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          `${formatDiceResult(result)} → **${result.total} healed** on ${directive.targetName} (HP: ${cs.hp.current}/${cs.hp.max})`,
        );
      } else {
        log.info(
          `  Heal: ${result.total} to ${directive.targetName} (narrative HP only — not a PC)`,
        );
        processedText = processedText.replace(
          `[[HEAL:${directive.notation} TARGET:${directive.targetName} REASON:${directive.reason}]]`,
          `${formatDiceResult(result)} → **${result.total} healed** on ${directive.targetName}`,
        );
      }
    }
  }

  // === UPDATE_HP directives ===
  const updateHPDirectives = parseUpdateHPDirective(processedText);
  for (const directive of updateHPDirectives) {
    const originalTag = `[[UPDATE_HP:${directive.current} TARGET:${directive.target}]]`;
    const updated = setHP(gameState, directive.target, directive.current);
    if (updated) {
      hpChanged = true;
      const player = gameState.players.find(
        (p) => p.characterSheet.name.toLowerCase() === directive.target.toLowerCase(),
      );
      const hpAfter = player?.characterSheet.hp.current ?? directive.current;
      const hpMax = player?.characterSheet.hp.max ?? "?";
      log.info(`  Update HP: ${directive.target} → ${hpAfter}/${hpMax}`);
      processedText = processedText.replace(
        originalTag,
        `*[${directive.target} HP set to ${hpAfter}/${hpMax}]*`,
      );
    } else {
      log.warn(`  Update HP: target "${directive.target}" not found`);
      processedText = processedText.replace(originalTag, "");
    }
  }

  // === UPDATE_CONDITION directives ===
  const updateCondDirectives = parseUpdateConditionDirective(processedText);
  for (const directive of updateCondDirectives) {
    const condStr = directive.conditions.length === 0 ? "none" : directive.conditions.join(",");
    const originalTag = `[[UPDATE_CONDITION:SET ${condStr} TARGET:${directive.target}]]`;
    const updated = setConditions(gameState, directive.target, directive.conditions);
    if (updated) {
      conditionsChanged = true;
      const display =
        directive.conditions.length === 0 ? "cleared" : directive.conditions.join(", ");
      log.info(`  Update conditions: ${directive.target} → ${display}`);
      processedText = processedText.replace(originalTag, "");
    } else {
      log.warn(`  Update conditions: target "${directive.target}" not found`);
      processedText = processedText.replace(originalTag, "");
    }
  }

  // === SPELL directives ===
  const spellDirectives = parseSpellDirective(processedText);
  for (const directive of spellDirectives) {
    const originalTag = `[[SPELL:${directive.level} TARGET:${directive.target}]]`;
    const player = gameState.players.find(
      (p) => p.characterSheet.name.toLowerCase() === directive.target.toLowerCase(),
    );
    if (player) {
      const used = useSpellSlot(player.characterSheet, directive.level);
      if (used) {
        spellsUsed = true;
        const remaining =
          player.characterSheet.spellSlots?.find((s) => s.level === directive.level)?.current ?? 0;
        log.info(
          `  Spell: ${directive.target} used a level ${directive.level} slot (${remaining} remaining)`,
        );
        processedText = processedText.replace(originalTag, "");
      } else {
        log.warn(`  Spell: ${directive.target} has no level ${directive.level} slots available!`);
        processedText = processedText.replace(
          originalTag,
          `*[${directive.target} has no level ${directive.level} spell slots remaining!]*`,
        );
      }
    } else {
      log.warn(`  Spell: target "${directive.target}" not found`);
      processedText = processedText.replace(originalTag, "");
    }
  }

  // === USE directives ===
  const useDirectives = parseUseDirective(processedText);
  for (const directive of useDirectives) {
    const originalTag = `[[USE:${directive.featureName} TARGET:${directive.target}]]`;
    const player = gameState.players.find(
      (p) => p.characterSheet.name.toLowerCase() === directive.target.toLowerCase(),
    );
    if (player) {
      const used = useFeatureCharge(player.characterSheet, directive.featureName);
      if (used) {
        featuresUsed = true;
        const charge = player.characterSheet.featureCharges?.find(
          (c) => c.name.toLowerCase() === directive.featureName.toLowerCase(),
        );
        log.info(
          `  Use: ${directive.target} used ${directive.featureName} (${charge?.current ?? 0} remaining)`,
        );
        processedText = processedText.replace(originalTag, "");
      } else {
        log.warn(`  Use: ${directive.target} has no ${directive.featureName} charges!`);
        processedText = processedText.replace(
          originalTag,
          `*[${directive.target} has no ${directive.featureName} charges remaining!]*`,
        );
      }
    } else {
      log.warn(`  Use: target "${directive.target}" not found`);
      processedText = processedText.replace(originalTag, "");
    }
  }

  // === CONCENTRATE directives ===
  const concentrateDirectives = parseConcentrateDirective(processedText);
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
        processedText = processedText.replace(
          originalTag,
          `*[${directive.target} breaks concentration on ${combatant.concentration.spell}]*`,
        );
      } else {
        processedText = processedText.replace(originalTag, "");
      }
      combatant.concentration = { spell: directive.spell };
      log.info(`  Concentration: ${directive.target} now concentrating on ${directive.spell}`);
    } else {
      processedText = processedText.replace(originalTag, "");
    }
  }

  // === CONDITION directives ===
  const conditionDirectives = parseConditionDirective(processedText);
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
      conditionsChanged = true;
      processedText = processedText.replace(originalTag, "");
    } else {
      log.warn(`  Condition: target "${directive.target}" not found`);
      processedText = processedText.replace(originalTag, "");
    }
  }

  // === Concentration damage check ===
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
        processedText += `\n*${combatant.name} maintains concentration on ${combatant.concentration.spell} (CON save: ${conSave.total} vs DC ${dc})*`;
      } else {
        log.info(
          `  Concentration: ${combatant.name} fails CON save (${conSave.total} vs DC ${dc}), loses ${combatant.concentration.spell}`,
        );
        processedText += `\n*${combatant.name} loses concentration on ${combatant.concentration.spell}! (CON save: ${conSave.total} vs DC ${dc})*`;
        combatant.concentration = undefined;
      }
    }
  }

  // === XP directives ===
  const xpDirectives = parseXPDirective(processedText);
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
      processedText = processedText.replace(originalTag, replacement);
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
        processedText = processedText.replace(originalTag, replacement);
      } else {
        log.warn(`  XP: target "${directive.target}" not found`);
        processedText = processedText.replace(
          originalTag,
          `**+${directive.amount} XP** (${directive.reason})`,
        );
      }
    }
  }

  // === Combat signals ===
  if (processedText.includes("[[COMBAT:START]]")) {
    log.info("COMBAT START signal detected");
    processedText = processedText.replace("[[COMBAT:START]]", "");
    const initResults = startCombat(gameState);
    const initText = initResults.map(formatDiceResult).join("\n");
    processedText += `\n\n**Initiative Order:**\n${initText}`;
    combatStarted = true;
    log.info(`Combat started — ${initResults.length} combatants rolled initiative`);
  }

  if (processedText.includes("[[COMBAT:END]]")) {
    log.info("COMBAT END signal detected");
    processedText = processedText.replace("[[COMBAT:END]]", "");
    endCombat(gameState);
    processedText += "\n\n*Combat has ended.*";
    combatEnded = true;
  }

  // === Directive misuse detection ===
  const misuseWarnings = detectDirectiveMisuse(processedText, damageTargets, healTargets);
  for (const warning of misuseWarnings) {
    log.warn(`Directive misuse: ${warning}`);
  }

  // === HP and resource summaries ===
  const hpSummary = gameState.combat.active ? buildCombatHPSummary(gameState) : null;
  const resourceSummary = spellsUsed || featuresUsed ? buildResourceSummary(gameState) : null;

  return {
    processedText,
    diceResults,
    damageTargets,
    healTargets,
    spellsUsed,
    featuresUsed,
    conditionsChanged,
    hpChanged,
    combatStarted,
    combatEnded,
    misuseWarnings,
    hpSummary,
    resourceSummary,
    pendingRolls,
  };
}
