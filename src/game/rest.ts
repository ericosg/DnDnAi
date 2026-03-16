/**
 * Rest system — short and long rest logic.
 * Pure functions — no side effects.
 */

import type { GameState } from "../state/types.js";
import { resetResources } from "./resources.js";

/**
 * Apply a short rest to all players.
 * Resets short-rest features (Action Surge, Second Wind, Warlock slots, etc.)
 * Returns a summary of what was restored per character.
 */
export function shortRest(gameState: GameState): string[] {
  const summary: string[] = [];

  for (const player of gameState.players) {
    const restored = resetResources(player.characterSheet, "short");
    if (restored.length > 0) {
      summary.push(`**${player.characterSheet.name}**: ${restored.join(", ")}`);
    }
  }

  return summary;
}

/**
 * Apply a long rest to all players.
 * Resets ALL spell slots, ALL feature charges, and restores HP to max.
 * Returns a summary of what was restored per character.
 */
export function longRest(gameState: GameState): string[] {
  const summary: string[] = [];

  for (const player of gameState.players) {
    const cs = player.characterSheet;
    const parts: string[] = [];

    // Restore HP
    if (cs.hp.current < cs.hp.max) {
      parts.push(`HP ${cs.hp.current} → ${cs.hp.max}`);
      cs.hp.current = cs.hp.max;
      cs.hp.temp = 0;
    }

    // Reset resources
    const restored = resetResources(cs, "long");
    parts.push(...restored);

    if (parts.length > 0) {
      summary.push(`**${cs.name}**: ${parts.join(", ")}`);
    }
  }

  return summary;
}
