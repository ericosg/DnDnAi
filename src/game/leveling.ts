/**
 * XP thresholds and level-up checks.
 * Pure functions — no side effects.
 * Source: SRD 5.1 Character Advancement table (docs/srd/03 beyond1st.md)
 */

/** XP required to reach each level (index = level). Level 1 = 0 XP. */
export const XP_TABLE: readonly number[] = [
  0, // placeholder (no level 0)
  0, // level 1
  300, // level 2
  900, // level 3
  2_700, // level 4
  6_500, // level 5
  14_000, // level 6
  23_000, // level 7
  34_000, // level 8
  48_000, // level 9
  64_000, // level 10
  85_000, // level 11
  100_000, // level 12
  120_000, // level 13
  140_000, // level 14
  165_000, // level 15
  195_000, // level 16
  225_000, // level 17
  265_000, // level 18
  305_000, // level 19
  355_000, // level 20
];

/** XP needed to reach the next level from `currentLevel`. Returns Infinity at level 20. */
export function xpForNextLevel(currentLevel: number): number {
  if (currentLevel >= 20 || currentLevel < 1) return Number.POSITIVE_INFINITY;
  return XP_TABLE[currentLevel + 1];
}

/** How much more XP is needed to level up. Returns 0 if already eligible. */
export function xpToNextLevel(currentXP: number, currentLevel: number): number {
  const threshold = xpForNextLevel(currentLevel);
  if (threshold === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.max(0, threshold - currentXP);
}

/** True if `currentXP` is enough to level up from `currentLevel`. */
export function checkLevelUp(currentXP: number, currentLevel: number): boolean {
  if (currentLevel >= 20) return false;
  return currentXP >= XP_TABLE[currentLevel + 1];
}

/** Proficiency bonus for a given level (SRD). */
export function proficiencyBonus(level: number): number {
  if (level < 5) return 2;
  if (level < 9) return 3;
  if (level < 13) return 4;
  if (level < 17) return 5;
  return 6;
}

/** Hit die size by class name. */
export function hitDieSize(className: string): number {
  const cls = className.toLowerCase().replace(/\s*\(.*\)/, "");
  switch (cls) {
    case "barbarian":
      return 12;
    case "fighter":
    case "paladin":
    case "ranger":
      return 10;
    case "bard":
    case "cleric":
    case "druid":
    case "monk":
    case "rogue":
    case "warlock":
      return 8;
    case "sorcerer":
    case "wizard":
      return 6;
    default:
      return 8; // fallback
  }
}

/** Fixed HP gain per level (average of hit die, rounded up). */
export function fixedHPGain(className: string): number {
  return Math.ceil(hitDieSize(className) / 2) + 1;
}

/** Levels that grant an Ability Score Improvement (ASI). */
export function isASILevel(level: number): boolean {
  return [4, 8, 12, 16, 19].includes(level);
}
