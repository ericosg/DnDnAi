import type { Combatant, DiceResult, GameState, Player } from "../state/types.js";
import { roll } from "./dice.js";

export function rollInitiative(player: Player): { combatant: Combatant; roll: DiceResult } {
  const initMod = player.characterSheet.initiative;
  const diceResult = roll(`d20+${initMod}`, `${player.characterSheet.name} initiative`);

  return {
    combatant: {
      playerId: player.id,
      name: player.characterSheet.name,
      initiative: diceResult.total,
      hp: { ...player.characterSheet.hp },
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
    },
    roll: diceResult,
  };
}

export function startCombat(gameState: GameState): DiceResult[] {
  const results: DiceResult[] = [];
  const combatants: Combatant[] = [];

  for (const player of gameState.players) {
    const { combatant, roll: diceResult } = rollInitiative(player);
    combatants.push(combatant);
    results.push(diceResult);
  }

  // Sort by initiative (highest first), break ties by dex
  combatants.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    const playerA = gameState.players.find((p) => p.id === a.playerId);
    const playerB = gameState.players.find((p) => p.id === b.playerId);
    return (
      (playerB?.characterSheet.abilityScores.dexterity ?? 0) -
      (playerA?.characterSheet.abilityScores.dexterity ?? 0)
    );
  });

  gameState.combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    combatants,
  };

  return results;
}

export function advanceTurn(gameState: GameState): void {
  const { combat } = gameState;
  if (!combat.active) return;

  combat.turnIndex++;

  // Skip dead/incapacitated combatants
  while (combat.turnIndex < combat.combatants.length) {
    const current = combat.combatants[combat.turnIndex];
    if (current.hp.current > 0 || hasCondition(current, "stable")) break;
    combat.turnIndex++;
  }

  if (combat.turnIndex >= combat.combatants.length) {
    combat.round++;
    combat.turnIndex = 0;

    // Skip dead at start of new round too
    while (combat.turnIndex < combat.combatants.length) {
      const current = combat.combatants[combat.turnIndex];
      if (current.hp.current > 0 || hasCondition(current, "stable")) break;
      combat.turnIndex++;
    }
  }

  // Auto-end combat when all combatants are dead
  if (isCombatOver(gameState)) {
    endCombat(gameState);
  }
}

/**
 * Peek at the next living combatant after the current turnIndex
 * without mutating state. Returns null if no valid next combatant.
 */
export function peekNextCombatant(combat: GameState["combat"]): Combatant | null {
  if (!combat.active || combat.combatants.length === 0) return null;

  let idx = combat.turnIndex + 1;

  // Skip dead in remainder of current round
  while (idx < combat.combatants.length) {
    const c = combat.combatants[idx];
    if (c.hp.current > 0 || hasCondition(c, "stable")) return c;
    idx++;
  }

  // Wrap to start of next round
  idx = 0;
  while (idx <= combat.turnIndex) {
    const c = combat.combatants[idx];
    if (c.hp.current > 0 || hasCondition(c, "stable")) return c;
    idx++;
  }

  return null;
}

export function applyDamage(
  gameState: GameState,
  targetName: string,
  damage: number,
): { combatant: Combatant; overkill: boolean } | null {
  const combatant = gameState.combat.combatants.find(
    (c) => c.name.toLowerCase() === targetName.toLowerCase(),
  );
  if (!combatant) return null;

  const originalTemp = combatant.hp.temp;
  combatant.hp.temp = Math.max(0, originalTemp - damage);
  const absorbed = originalTemp - combatant.hp.temp;
  const remaining = damage - absorbed;
  if (remaining > 0) {
    combatant.hp.current = Math.max(0, combatant.hp.current - remaining);
  }

  // Update the player's character sheet HP too
  const player = gameState.players.find((p) => p.id === combatant.playerId);
  if (player) {
    player.characterSheet.hp.current = combatant.hp.current;
    player.characterSheet.hp.temp = combatant.hp.temp;
  }

  const overkill = combatant.hp.current === 0 && remaining > combatant.hp.max;
  return { combatant, overkill };
}

export function applyHealing(
  gameState: GameState,
  targetName: string,
  healing: number,
): Combatant | null {
  const combatant = gameState.combat.combatants.find(
    (c) => c.name.toLowerCase() === targetName.toLowerCase(),
  );
  if (!combatant) return null;

  combatant.hp.current = Math.min(combatant.hp.max, combatant.hp.current + healing);

  const player = gameState.players.find((p) => p.id === combatant.playerId);
  if (player) {
    player.characterSheet.hp.current = combatant.hp.current;
  }

  // Clear death saves on healing from 0
  if (combatant.hp.current > 0) {
    combatant.deathSaves = { successes: 0, failures: 0 };
    combatant.conditions = combatant.conditions.filter(
      (c) => c !== "unconscious" && c !== "stable",
    );
  }

  return combatant;
}

export function rollDeathSave(combatant: Combatant): {
  roll: DiceResult;
  result: "success" | "failure" | "stabilized" | "revived" | "dead";
} {
  const diceResult = roll("d20", `${combatant.name} death save`);

  if (diceResult.total === 20) {
    // Nat 20: regain 1 HP
    combatant.hp.current = 1;
    combatant.deathSaves = { successes: 0, failures: 0 };
    combatant.conditions = combatant.conditions.filter((c) => c !== "unconscious");
    return { roll: diceResult, result: "revived" };
  }

  if (diceResult.total === 1) {
    // Nat 1: two failures
    combatant.deathSaves.failures += 2;
  } else if (diceResult.total >= 10) {
    combatant.deathSaves.successes++;
  } else {
    combatant.deathSaves.failures++;
  }

  if (combatant.deathSaves.failures >= 3) {
    return { roll: diceResult, result: "dead" };
  }
  if (combatant.deathSaves.successes >= 3) {
    addCondition(combatant, "stable");
    combatant.conditions = combatant.conditions.filter((c) => c !== "unconscious");
    return { roll: diceResult, result: "stabilized" };
  }

  return {
    roll: diceResult,
    result: diceResult.total >= 10 ? "success" : "failure",
  };
}

export function isCombatOver(gameState: GameState): boolean {
  if (!gameState.combat.active) return true;
  const alive = gameState.combat.combatants.filter((c) => c.hp.current > 0);
  // Combat ends if only one side remains (simplified — all players are same side)
  return alive.length <= 1;
}

export function endCombat(gameState: GameState): void {
  gameState.combat.active = false;
  gameState.combat.round = 0;
  gameState.combat.turnIndex = 0;
  gameState.combat.combatants = [];
}

function hasCondition(combatant: Combatant, condition: string): boolean {
  return combatant.conditions.includes(condition);
}

function addCondition(combatant: Combatant, condition: string): void {
  if (!hasCondition(combatant, condition)) {
    combatant.conditions.push(condition);
  }
}
