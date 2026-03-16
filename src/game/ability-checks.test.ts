import { describe, expect, test } from "bun:test";
import type { CharacterSheet } from "../state/types.js";
import {
  abilityModifier,
  getPassiveScore,
  getSavingThrowModifier,
  getSavingThrowSummary,
  getSkillModifier,
  resolveAbility,
  SKILL_ABILITY_MAP,
} from "./ability-checks.js";

function makeSheet(overrides?: Partial<CharacterSheet>): CharacterSheet {
  return {
    name: "Fūsetsu",
    race: "Variant Human",
    class: "Rogue",
    level: 3,
    background: "Hermit",
    alignment: "Neutral",
    abilityScores: {
      strength: 8,
      dexterity: 16,
      constitution: 12,
      wisdom: 14,
      intelligence: 10,
      charisma: 10,
    },
    proficiencyBonus: 2,
    savingThrows: ["Dexterity", "Intelligence"],
    skills: ["Stealth", "Acrobatics", "Perception", "Deception"],
    hp: { max: 24, current: 24, temp: 0 },
    armorClass: 14,
    initiative: 3,
    speed: 30,
    equipment: [],
    features: [],
    backstory: "",
    ...overrides,
  };
}

describe("abilityModifier", () => {
  test("10 → 0", () => expect(abilityModifier(10)).toBe(0));
  test("16 → 3", () => expect(abilityModifier(16)).toBe(3));
  test("8 → -1", () => expect(abilityModifier(8)).toBe(-1));
  test("20 → 5", () => expect(abilityModifier(20)).toBe(5));
  test("1 → -5", () => expect(abilityModifier(1)).toBe(-5));
  test("11 → 0", () => expect(abilityModifier(11)).toBe(0));
  test("13 → 1", () => expect(abilityModifier(13)).toBe(1));
});

describe("resolveAbility", () => {
  test("full names", () => {
    expect(resolveAbility("strength")).toBe("strength");
    expect(resolveAbility("dexterity")).toBe("dexterity");
    expect(resolveAbility("wisdom")).toBe("wisdom");
  });

  test("abbreviations", () => {
    expect(resolveAbility("str")).toBe("strength");
    expect(resolveAbility("dex")).toBe("dexterity");
    expect(resolveAbility("con")).toBe("constitution");
    expect(resolveAbility("int")).toBe("intelligence");
    expect(resolveAbility("wis")).toBe("wisdom");
    expect(resolveAbility("cha")).toBe("charisma");
  });

  test("case insensitive", () => {
    expect(resolveAbility("STR")).toBe("strength");
    expect(resolveAbility("Dexterity")).toBe("dexterity");
  });

  test("invalid returns null", () => {
    expect(resolveAbility("luck")).toBeNull();
  });
});

describe("getSavingThrowModifier", () => {
  test("proficient save: DEX +3 mod + 2 prof = +5", () => {
    const sheet = makeSheet();
    expect(getSavingThrowModifier(sheet, "dexterity")).toBe(5);
  });

  test("proficient save: INT +0 mod + 2 prof = +2", () => {
    const sheet = makeSheet();
    expect(getSavingThrowModifier(sheet, "intelligence")).toBe(2);
  });

  test("non-proficient save: STR -1 mod only", () => {
    const sheet = makeSheet();
    expect(getSavingThrowModifier(sheet, "strength")).toBe(-1);
  });

  test("non-proficient save: WIS +2 mod only", () => {
    const sheet = makeSheet();
    expect(getSavingThrowModifier(sheet, "wisdom")).toBe(2);
  });

  test("works with abbreviations", () => {
    const sheet = makeSheet();
    expect(getSavingThrowModifier(sheet, "dex")).toBe(5);
    expect(getSavingThrowModifier(sheet, "str")).toBe(-1);
  });

  test("invalid ability returns 0", () => {
    const sheet = makeSheet();
    expect(getSavingThrowModifier(sheet, "luck")).toBe(0);
  });
});

describe("getSavingThrowSummary", () => {
  test("shows all saves with proficient marked", () => {
    const sheet = makeSheet();
    const summary = getSavingThrowSummary(sheet);
    expect(summary).toContain("STR -1");
    expect(summary).toContain("DEX +5*");
    expect(summary).toContain("CON +1");
    expect(summary).toContain("INT +2*");
    expect(summary).toContain("WIS +2");
    expect(summary).toContain("CHA +0");
  });
});

describe("getSkillModifier", () => {
  test("proficient skill: Stealth = DEX +3 + 2 prof = +5", () => {
    const sheet = makeSheet();
    expect(getSkillModifier(sheet, "Stealth")).toBe(5);
  });

  test("non-proficient skill: Athletics = STR -1 only", () => {
    const sheet = makeSheet();
    expect(getSkillModifier(sheet, "Athletics")).toBe(-1);
  });

  test("proficient skill: Perception = WIS +2 + 2 prof = +4", () => {
    const sheet = makeSheet();
    expect(getSkillModifier(sheet, "Perception")).toBe(4);
  });

  test("unknown skill returns 0", () => {
    const sheet = makeSheet();
    expect(getSkillModifier(sheet, "Basketweaving")).toBe(0);
  });
});

describe("getPassiveScore", () => {
  test("Passive Perception: 10 + skill mod", () => {
    const sheet = makeSheet();
    // Perception is proficient: WIS +2 + prof +2 = +4, passive = 14
    expect(getPassiveScore(sheet, "Perception")).toBe(14);
  });

  test("non-proficient passive", () => {
    const sheet = makeSheet();
    // Investigation not proficient: INT +0, passive = 10
    expect(getPassiveScore(sheet, "Investigation")).toBe(10);
  });
});

describe("SKILL_ABILITY_MAP", () => {
  test("has all 18 skills", () => {
    expect(Object.keys(SKILL_ABILITY_MAP).length).toBe(18);
  });

  test("stealth maps to dexterity", () => {
    expect(SKILL_ABILITY_MAP.stealth).toBe("dexterity");
  });

  test("perception maps to wisdom", () => {
    expect(SKILL_ABILITY_MAP.perception).toBe("wisdom");
  });

  test("arcana maps to intelligence", () => {
    expect(SKILL_ABILITY_MAP.arcana).toBe("intelligence");
  });
});
