/**
 * Saving throw and skill check calculators.
 * Pure functions — no side effects.
 */

import type { CharacterSheet } from "../state/types.js";

/** Map skill names to their governing ability. */
export const SKILL_ABILITY_MAP: Record<string, keyof CharacterSheet["abilityScores"]> = {
  athletics: "strength",
  acrobatics: "dexterity",
  "sleight of hand": "dexterity",
  stealth: "dexterity",
  arcana: "intelligence",
  history: "intelligence",
  investigation: "intelligence",
  nature: "intelligence",
  religion: "intelligence",
  "animal handling": "wisdom",
  insight: "wisdom",
  medicine: "wisdom",
  perception: "wisdom",
  survival: "wisdom",
  deception: "charisma",
  intimidation: "charisma",
  performance: "charisma",
  persuasion: "charisma",
};

/** All six abilities as they appear in abilityScores. */
const ABILITY_NAMES: Record<string, keyof CharacterSheet["abilityScores"]> = {
  strength: "strength",
  str: "strength",
  dexterity: "dexterity",
  dex: "dexterity",
  constitution: "constitution",
  con: "constitution",
  intelligence: "intelligence",
  int: "intelligence",
  wisdom: "wisdom",
  wis: "wisdom",
  charisma: "charisma",
  cha: "charisma",
};

/** Calculate the modifier for an ability score. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Resolve an ability name (full or abbreviated) to the abilityScores key. */
export function resolveAbility(name: string): keyof CharacterSheet["abilityScores"] | null {
  return ABILITY_NAMES[name.toLowerCase()] ?? null;
}

/**
 * Get the saving throw modifier for a given ability.
 * = ability modifier + proficiency bonus (if proficient in that save)
 */
export function getSavingThrowModifier(sheet: CharacterSheet, ability: string): number {
  const key = resolveAbility(ability);
  if (!key) return 0;
  const mod = abilityModifier(sheet.abilityScores[key]);
  const proficient = sheet.savingThrows.some((s) => s.toLowerCase() === key);
  return mod + (proficient ? sheet.proficiencyBonus : 0);
}

/**
 * Get all saving throw modifiers as a compact string.
 * "STR +5*, CON +5*, DEX +1, WIS +2, INT +0, CHA +0" (* = proficient)
 */
export function getSavingThrowSummary(sheet: CharacterSheet): string {
  const abilities: (keyof CharacterSheet["abilityScores"])[] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ];
  const abbrevs = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const profSet = new Set(sheet.savingThrows.map((s) => s.toLowerCase()));

  return abilities
    .map((a, i) => {
      const mod = getSavingThrowModifier(sheet, a);
      const sign = mod >= 0 ? "+" : "";
      const star = profSet.has(a) ? "*" : "";
      return `${abbrevs[i]} ${sign}${mod}${star}`;
    })
    .join(", ");
}

/**
 * Get the skill check modifier for a given skill.
 * = ability modifier + proficiency bonus (if proficient)
 * Does NOT handle expertise — that requires knowing which skills have it.
 */
export function getSkillModifier(sheet: CharacterSheet, skill: string): number {
  const ability = SKILL_ABILITY_MAP[skill.toLowerCase()];
  if (!ability) return 0;
  const mod = abilityModifier(sheet.abilityScores[ability]);
  const proficient = sheet.skills.some((s) => s.toLowerCase() === skill.toLowerCase());
  return mod + (proficient ? sheet.proficiencyBonus : 0);
}

/**
 * Get the passive score for a skill (10 + skill modifier).
 * Used for Passive Perception, Passive Investigation, etc.
 */
export function getPassiveScore(sheet: CharacterSheet, skill: string): number {
  return 10 + getSkillModifier(sheet, skill);
}
