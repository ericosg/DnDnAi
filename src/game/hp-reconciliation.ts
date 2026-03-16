/**
 * HP reconciliation and directive misuse detection.
 * Pure functions — no side effects.
 */

import type { GameState } from "../state/types.js";

/**
 * Build a one-line HP summary for all combatants when combat is active.
 * Returns null when not in combat.
 */
export function buildCombatHPSummary(gameState: GameState): string | null {
  if (!gameState.combat.active) return null;

  const parts = gameState.combat.combatants.map((c) => `${c.name} ${c.hp.current}/${c.hp.max}`);

  return `Combat HP after DM turn: ${parts.join(", ")}`;
}

/**
 * Scan DM narration for HP-change language that wasn't backed by a directive.
 * Returns warning strings for each mismatch.
 *
 * @param narration - The DM's narration text (after directive replacement)
 * @param processedDamageTargets - Names of characters who had DAMAGE directives processed
 * @param processedHealTargets - Names of characters who had HEAL directives processed
 */
export function detectDirectiveMisuse(
  narration: string,
  processedDamageTargets: string[],
  processedHealTargets: string[],
): string[] {
  const warnings: string[] = [];

  // Use [^\s,.:!] to match name characters including Unicode (ū, etc.)
  const nameChar = "[^\\s,.:!]";
  const namePat = `(${nameChar}(?:${nameChar}|\\s)*?${nameChar})`;

  // Patterns that indicate damage was narrated
  const damagePatterns = [
    new RegExp(`${namePat}\\s+takes?\\s+(\\d+)\\s+(?:points?\\s+of\\s+)?damage`, "gi"),
    new RegExp(`(\\d+)\\s+(?:points?\\s+of\\s+)?damage\\s+to\\s+${namePat}(?:\\.|,|!|\\s|$)`, "gi"),
    new RegExp(
      `dealing\\s+(\\d+)\\s+(?:points?\\s+of\\s+)?damage\\s+to\\s+${namePat}(?:\\.|,|!|\\s|$)`,
      "gi",
    ),
  ];

  // Patterns that indicate healing was narrated
  const healPatterns = [
    new RegExp(
      `${namePat}\\s+(?:heals?|recovers?|regains?|restores?)\\s+(?:for\\s+)?(\\d+)\\s+(?:hit\\s+points?|HP)`,
      "gi",
    ),
    new RegExp(
      `(\\d+)\\s+(?:hit\\s+points?|HP)\\s+(?:healed|restored|recovered)\\s+(?:to|on|for)\\s+${namePat}(?:\\.|,|!|\\s|$)`,
      "gi",
    ),
  ];

  const damageLower = processedDamageTargets.map((n) => n.toLowerCase());
  const healLower = processedHealTargets.map((n) => n.toLowerCase());

  // Check damage patterns
  for (const pattern of damagePatterns) {
    let match: RegExpExecArray | null = null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
    while ((match = pattern.exec(narration)) !== null) {
      // First pattern: name is group 1; second/third: name is group 2
      const nameGroup = match[1].match(/^\d+$/) ? match[2] : match[1];
      if (!nameGroup) continue;
      const name = nameGroup.trim();
      if (name.length < 2 || name.length > 30) continue;
      // Skip if this looks like formatted directive output (already processed)
      if (narration.includes(`damage** to ${name}`)) continue;
      if (!damageLower.includes(name.toLowerCase())) {
        warnings.push(
          `Narration mentions damage to ${name} but no [[DAMAGE:...]] directive was used. HP may be out of sync.`,
        );
      }
    }
  }

  // Check heal patterns
  for (const pattern of healPatterns) {
    let match: RegExpExecArray | null = null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
    while ((match = pattern.exec(narration)) !== null) {
      const nameGroup = match[1].match(/^\d+$/) ? match[2] : match[1];
      if (!nameGroup) continue;
      const name = nameGroup.trim();
      if (name.length < 2 || name.length > 30) continue;
      if (narration.includes(`healed** on ${name}`)) continue;
      if (!healLower.includes(name.toLowerCase())) {
        warnings.push(
          `Narration mentions healing for ${name} but no [[HEAL:...]] directive was used. HP may be out of sync.`,
        );
      }
    }
  }

  return warnings;
}
