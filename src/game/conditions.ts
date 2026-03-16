/**
 * Condition effects — maps D&D 5e conditions to mechanical modifiers.
 * Pure functions — no side effects.
 * Source: SRD 5.1 (docs/srd/12 conditions.md)
 */

export interface ConditionEffect {
  /** Attackers have advantage against this creature */
  attackersHaveAdvantage: boolean;
  /** Attackers have disadvantage against this creature */
  attackersHaveDisadvantage: boolean;
  /** This creature's attacks have disadvantage */
  selfAttackDisadvantage: boolean;
  /** Advantage on specific saving throws */
  saveAdvantage: string[];
  /** Disadvantage on specific saving throws */
  saveDisadvantage: string[];
  /** Disadvantage on ability checks */
  abilityCheckDisadvantage: boolean;
  /** Auto-fail specific saves */
  autoFailSaves: string[];
  /** Speed multiplier (0 = can't move, 0.5 = half) */
  speedMultiplier: number;
  /** Melee attacks within 5ft auto-crit */
  meleeCrit: boolean;
  /** Notes for the DM */
  notes: string;
}

const DEFAULT_EFFECT: ConditionEffect = {
  attackersHaveAdvantage: false,
  attackersHaveDisadvantage: false,
  selfAttackDisadvantage: false,
  saveAdvantage: [],
  saveDisadvantage: [],
  abilityCheckDisadvantage: false,
  autoFailSaves: [],
  speedMultiplier: 1,
  meleeCrit: false,
  notes: "",
};

/** Map of condition names to their mechanical effects. */
export const CONDITION_EFFECTS: Record<string, ConditionEffect> = {
  blinded: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    selfAttackDisadvantage: true,
    notes: "Can't see. Auto-fail checks requiring sight.",
  },
  charmed: {
    ...DEFAULT_EFFECT,
    notes: "Can't attack the charmer. Charmer has advantage on social checks.",
  },
  deafened: {
    ...DEFAULT_EFFECT,
    notes: "Can't hear. Auto-fail checks requiring hearing.",
  },
  frightened: {
    ...DEFAULT_EFFECT,
    selfAttackDisadvantage: true,
    abilityCheckDisadvantage: true,
    notes:
      "Disadvantage on attacks and ability checks while source of fear is in sight. Can't move closer.",
  },
  grappled: {
    ...DEFAULT_EFFECT,
    speedMultiplier: 0,
    notes: "Speed becomes 0. Ends if grappler is incapacitated or moved out of reach.",
  },
  incapacitated: {
    ...DEFAULT_EFFECT,
    notes: "Can't take actions or reactions.",
  },
  invisible: {
    ...DEFAULT_EFFECT,
    attackersHaveDisadvantage: true,
    notes: "Attacks have advantage. Heavily obscured for hiding.",
  },
  paralyzed: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    autoFailSaves: ["strength", "dexterity"],
    speedMultiplier: 0,
    meleeCrit: true,
    notes: "Incapacitated. Can't move or speak. Auto-fail STR/DEX saves. Melee hits are crits.",
  },
  petrified: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    autoFailSaves: ["strength", "dexterity"],
    speedMultiplier: 0,
    notes: "Incapacitated. Resistance to all damage. Immune to poison/disease.",
  },
  poisoned: {
    ...DEFAULT_EFFECT,
    selfAttackDisadvantage: true,
    abilityCheckDisadvantage: true,
    notes: "Disadvantage on attack rolls and ability checks.",
  },
  prone: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    selfAttackDisadvantage: true,
    notes:
      "Melee attackers within 5ft have advantage; ranged attackers have disadvantage. Must use half movement to stand.",
  },
  restrained: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    selfAttackDisadvantage: true,
    saveDisadvantage: ["dexterity"],
    speedMultiplier: 0,
    notes: "Speed 0. Disadvantage on DEX saves.",
  },
  stunned: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    autoFailSaves: ["strength", "dexterity"],
    notes: "Incapacitated. Can't move. Speaks falteringly. Auto-fail STR/DEX saves.",
  },
  unconscious: {
    ...DEFAULT_EFFECT,
    attackersHaveAdvantage: true,
    autoFailSaves: ["strength", "dexterity"],
    speedMultiplier: 0,
    meleeCrit: true,
    notes:
      "Incapacitated. Can't move or speak. Drops items. Falls prone. Auto-fail STR/DEX saves. Melee hits are crits.",
  },
  // Custom conditions for tracking combat actions
  dodging: {
    ...DEFAULT_EFFECT,
    attackersHaveDisadvantage: true,
    saveAdvantage: ["dexterity"],
    notes: "Took Dodge action. Attackers have disadvantage. Advantage on DEX saves.",
  },
};

/**
 * Get the mechanical effects for a condition.
 * Returns null for unknown conditions.
 */
export function getConditionEffect(condition: string): ConditionEffect | null {
  return CONDITION_EFFECTS[condition.toLowerCase()] ?? null;
}

/**
 * Summarize the active conditions' effects for a combatant.
 * Returns a list of mechanical notes relevant to rolling.
 */
export function summarizeConditionEffects(conditions: string[]): string[] {
  const notes: string[] = [];
  let hasAdvantageForAttackers = false;
  let hasDisadvantageForAttackers = false;
  let hasSelfAttackDisadvantage = false;

  for (const cond of conditions) {
    const effect = getConditionEffect(cond);
    if (!effect) continue;
    if (effect.attackersHaveAdvantage) hasAdvantageForAttackers = true;
    if (effect.attackersHaveDisadvantage) hasDisadvantageForAttackers = true;
    if (effect.selfAttackDisadvantage) hasSelfAttackDisadvantage = true;
    if (effect.autoFailSaves.length) {
      notes.push(`Auto-fail ${effect.autoFailSaves.join(", ").toUpperCase()} saves (${cond})`);
    }
    if (effect.meleeCrit) {
      notes.push(`Melee hits are auto-crits (${cond})`);
    }
  }

  if (hasAdvantageForAttackers && !hasDisadvantageForAttackers) {
    notes.unshift("Attackers have advantage");
  } else if (hasDisadvantageForAttackers && !hasAdvantageForAttackers) {
    notes.unshift("Attackers have disadvantage");
  }

  if (hasSelfAttackDisadvantage) {
    notes.push("Attacks at disadvantage");
  }

  return notes;
}
