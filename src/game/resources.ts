/**
 * Spell slot and feature charge management.
 * Pure functions — no side effects.
 */

import type { CharacterSheet } from "../state/types.js";

/** Deduct a spell slot of the given level. Returns false if none available. */
export function useSpellSlot(sheet: CharacterSheet, level: number): boolean {
  if (!sheet.spellSlots) return false;
  const slot = sheet.spellSlots.find((s) => s.level === level && s.current > 0);
  if (!slot) return false;
  slot.current--;
  return true;
}

/** Deduct a feature charge by name. Returns false if none available. */
export function useFeatureCharge(sheet: CharacterSheet, featureName: string): boolean {
  if (!sheet.featureCharges) return false;
  const charge = sheet.featureCharges.find(
    (c) => c.name.toLowerCase() === featureName.toLowerCase() && c.current > 0,
  );
  if (!charge) return false;
  charge.current--;
  return true;
}

/** Reset resources based on rest type. Returns names of resources restored. */
export function resetResources(sheet: CharacterSheet, restType: "short" | "long"): string[] {
  const restored: string[] = [];

  if (sheet.spellSlots) {
    for (const slot of sheet.spellSlots) {
      if (restType === "long" && slot.current < slot.max) {
        slot.current = slot.max;
        restored.push(`${ordinal(slot.level)}-level slots → ${slot.max}`);
      }
    }
  }

  if (sheet.featureCharges) {
    for (const charge of sheet.featureCharges) {
      if (charge.current < charge.max) {
        if (restType === "long" || charge.resetsOn === "short") {
          charge.current = charge.max;
          restored.push(`${charge.name} → ${charge.max}`);
        }
      }
    }
  }

  return restored;
}

/** Compact summary of spell slots: "1st: 1/2 | 2nd: 0/1" */
export function getSpellSlotSummary(sheet: CharacterSheet): string | null {
  if (!sheet.spellSlots?.length) return null;
  return sheet.spellSlots.map((s) => `${ordinal(s.level)}: ${s.current}/${s.max}`).join(" | ");
}

/** Compact summary of feature charges: "Action Surge: 1/1 | Second Wind: 0/1" */
export function getFeatureChargeSummary(sheet: CharacterSheet): string | null {
  if (!sheet.featureCharges?.length) return null;
  return sheet.featureCharges.map((c) => `${c.name}: ${c.current}/${c.max}`).join(" | ");
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

/**
 * Parse feature charges from feature description text.
 * Matches patterns like:
 *   "Second Wind (1d10+3 HP, bonus action, 1/short rest)" → {name: "Second Wind", max: 1, resetsOn: "short"}
 *   "Bardic Inspiration (d6, 3/long rest)" → {name: "Bardic Inspiration", max: 3, resetsOn: "long"}
 *   "Rage (2/long rest, ...)" → {name: "Rage", max: 2, resetsOn: "long"}
 */
export function parseFeatureCharge(
  featureText: string,
): { name: string; max: number; resetsOn: "short" | "long" } | null {
  // Match "N/short rest" or "N/long rest"
  const numericMatch = featureText.match(/^(.+?)\s*\(.*?(\d+)\/(short|long)\s+rest.*?\)/i);
  if (numericMatch) {
    return {
      name: numericMatch[1].trim(),
      max: parseInt(numericMatch[2], 10),
      resetsOn: numericMatch[3].toLowerCase() as "short" | "long",
    };
  }
  // Match "once per short/long rest"
  const onceMatch = featureText.match(/^(.+?)\s*\(.*?once\s+per\s+(short|long)\s+rest.*?\)/i);
  if (onceMatch) {
    return {
      name: onceMatch[1].trim(),
      max: 1,
      resetsOn: onceMatch[2].toLowerCase() as "short" | "long",
    };
  }
  return null;
}

/**
 * Parse spell slot count from a Spellcasting feature line or ## Spell Slots section.
 * Handles:
 *   "Spellcasting (WIS, spell save DC 12, +4 to hit, 2 slots)" → [{level: 1, max: 2}]
 *   "Pact Magic (2 slots, 1st level, recharge on short rest)" → [{level: 1, max: 2}]
 * For explicit ## Spell Slots section lines:
 *   "- 1st level: 2" → {level: 1, max: 2}
 *   "- 2nd level: 1" → {level: 2, max: 1}
 */
export function parseSpellSlotLine(line: string): { level: number; max: number } | null {
  // "- 1st level: 2" or "- 2nd level: 1"
  const explicit = line.match(/(\d+)(?:st|nd|rd|th)\s+level\s*:\s*(\d+)/i);
  if (explicit) {
    return { level: parseInt(explicit[1], 10), max: parseInt(explicit[2], 10) };
  }
  return null;
}

/**
 * Derive spell slots from class/level when not explicitly specified.
 * Uses SRD slot tables for full casters, half casters, etc.
 */
export function deriveSpellSlots(
  className: string,
  level: number,
): { level: number; max: number; current: number }[] {
  const cls = className.toLowerCase().replace(/\s*\(.*\)/, "");

  // Full casters: Bard, Cleric, Druid, Sorcerer, Wizard
  const fullCasters = ["bard", "cleric", "druid", "sorcerer", "wizard"];
  // Half casters: Paladin, Ranger (spellcasting from level 2)
  const halfCasters = ["paladin", "ranger"];
  // Warlock uses Pact Magic (special)
  if (cls === "warlock") return deriveWarlockSlots(level);

  if (fullCasters.includes(cls)) return deriveFullCasterSlots(level);
  if (halfCasters.includes(cls)) return deriveHalfCasterSlots(level);

  return []; // Non-caster
}

function deriveFullCasterSlots(level: number): { level: number; max: number; current: number }[] {
  // SRD Spell Slots per Spell Level (full caster)
  const table: Record<number, number[]> = {
    1: [2],
    2: [3],
    3: [4, 2],
    4: [4, 3],
    5: [4, 3, 2],
    6: [4, 3, 3],
    7: [4, 3, 3, 1],
    8: [4, 3, 3, 2],
    9: [4, 3, 3, 3, 1],
    10: [4, 3, 3, 3, 2],
    11: [4, 3, 3, 3, 2, 1],
    12: [4, 3, 3, 3, 2, 1],
    13: [4, 3, 3, 3, 2, 1, 1],
    14: [4, 3, 3, 3, 2, 1, 1],
    15: [4, 3, 3, 3, 2, 1, 1, 1],
    16: [4, 3, 3, 3, 2, 1, 1, 1],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
  };
  const slots = table[Math.min(level, 20)] ?? [];
  return slots.map((max, i) => ({ level: i + 1, max, current: max }));
}

function deriveHalfCasterSlots(level: number): { level: number; max: number; current: number }[] {
  // Half casters get spells at level 2, use half-level (rounded up) on full-caster table
  if (level < 2) return [];
  const effectiveLevel = Math.ceil(level / 2);
  return deriveFullCasterSlots(effectiveLevel);
}

function deriveWarlockSlots(level: number): { level: number; max: number; current: number }[] {
  // Warlock Pact Magic: all slots at same level, recharge on short rest
  const table: Record<number, { slots: number; level: number }> = {
    1: { slots: 1, level: 1 },
    2: { slots: 2, level: 1 },
    3: { slots: 2, level: 2 },
    4: { slots: 2, level: 2 },
    5: { slots: 2, level: 3 },
    6: { slots: 2, level: 3 },
    7: { slots: 2, level: 4 },
    8: { slots: 2, level: 4 },
    9: { slots: 2, level: 5 },
    10: { slots: 2, level: 5 },
    11: { slots: 3, level: 5 },
    12: { slots: 3, level: 5 },
    13: { slots: 3, level: 5 },
    14: { slots: 3, level: 5 },
    15: { slots: 3, level: 5 },
    16: { slots: 3, level: 5 },
    17: { slots: 4, level: 5 },
    18: { slots: 4, level: 5 },
    19: { slots: 4, level: 5 },
    20: { slots: 4, level: 5 },
  };
  const entry = table[Math.min(level, 20)];
  if (!entry) return [];
  return [{ level: entry.level, max: entry.slots, current: entry.slots }];
}
