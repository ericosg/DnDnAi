import { describe, expect, test } from "bun:test";
import type { CharacterSheet } from "../state/types.js";
import {
  deriveSpellSlots,
  getFeatureChargeSummary,
  getSpellSlotSummary,
  parseFeatureCharge,
  parseSpellSlotLine,
  resetResources,
  useFeatureCharge,
  useSpellSlot,
} from "./resources.js";

function makeSheet(overrides?: Partial<CharacterSheet>): CharacterSheet {
  return {
    name: "Test",
    race: "Human",
    class: "Cleric",
    level: 3,
    background: "Acolyte",
    alignment: "Neutral",
    abilityScores: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      wisdom: 16,
      intelligence: 10,
      charisma: 10,
    },
    proficiencyBonus: 2,
    savingThrows: [],
    skills: [],
    hp: { max: 24, current: 24, temp: 0 },
    armorClass: 16,
    initiative: 0,
    speed: 30,
    equipment: [],
    features: [],
    backstory: "",
    ...overrides,
  };
}

describe("useSpellSlot", () => {
  test("deducts a slot when available", () => {
    const sheet = makeSheet({
      spellSlots: [{ level: 1, max: 2, current: 2 }],
    });
    expect(useSpellSlot(sheet, 1)).toBe(true);
    expect(sheet.spellSlots?.[0].current).toBe(1);
  });

  test("returns false when no slots left", () => {
    const sheet = makeSheet({
      spellSlots: [{ level: 1, max: 2, current: 0 }],
    });
    expect(useSpellSlot(sheet, 1)).toBe(false);
  });

  test("returns false when no slots of that level", () => {
    const sheet = makeSheet({
      spellSlots: [{ level: 1, max: 2, current: 2 }],
    });
    expect(useSpellSlot(sheet, 2)).toBe(false);
  });

  test("returns false when spellSlots is undefined", () => {
    const sheet = makeSheet();
    expect(useSpellSlot(sheet, 1)).toBe(false);
  });
});

describe("useFeatureCharge", () => {
  test("deducts a charge when available", () => {
    const sheet = makeSheet({
      featureCharges: [{ name: "Action Surge", max: 1, current: 1, resetsOn: "short" }],
    });
    expect(useFeatureCharge(sheet, "Action Surge")).toBe(true);
    expect(sheet.featureCharges?.[0].current).toBe(0);
  });

  test("returns false when no charges left", () => {
    const sheet = makeSheet({
      featureCharges: [{ name: "Action Surge", max: 1, current: 0, resetsOn: "short" }],
    });
    expect(useFeatureCharge(sheet, "Action Surge")).toBe(false);
  });

  test("case-insensitive matching", () => {
    const sheet = makeSheet({
      featureCharges: [{ name: "Bardic Inspiration", max: 3, current: 3, resetsOn: "long" }],
    });
    expect(useFeatureCharge(sheet, "bardic inspiration")).toBe(true);
    expect(sheet.featureCharges?.[0].current).toBe(2);
  });
});

describe("resetResources", () => {
  test("long rest restores all spell slots", () => {
    const sheet = makeSheet({
      spellSlots: [
        { level: 1, max: 4, current: 1 },
        { level: 2, max: 2, current: 0 },
      ],
    });
    const restored = resetResources(sheet, "long");
    expect(sheet.spellSlots?.[0].current).toBe(4);
    expect(sheet.spellSlots?.[1].current).toBe(2);
    expect(restored.length).toBe(2);
  });

  test("short rest only resets short-rest features", () => {
    const sheet = makeSheet({
      featureCharges: [
        { name: "Action Surge", max: 1, current: 0, resetsOn: "short" },
        { name: "Bardic Inspiration", max: 3, current: 1, resetsOn: "long" },
      ],
    });
    const restored = resetResources(sheet, "short");
    expect(sheet.featureCharges?.[0].current).toBe(1);
    expect(sheet.featureCharges?.[1].current).toBe(1); // not reset
    expect(restored).toEqual(["Action Surge → 1"]);
  });

  test("long rest resets all features", () => {
    const sheet = makeSheet({
      featureCharges: [
        { name: "Action Surge", max: 1, current: 0, resetsOn: "short" },
        { name: "Bardic Inspiration", max: 3, current: 1, resetsOn: "long" },
      ],
    });
    const restored = resetResources(sheet, "long");
    expect(sheet.featureCharges?.[0].current).toBe(1);
    expect(sheet.featureCharges?.[1].current).toBe(3);
    expect(restored.length).toBe(2);
  });

  test("skips resources already at max", () => {
    const sheet = makeSheet({
      featureCharges: [{ name: "Action Surge", max: 1, current: 1, resetsOn: "short" }],
    });
    const restored = resetResources(sheet, "short");
    expect(restored).toEqual([]);
  });
});

describe("getSpellSlotSummary", () => {
  test("formats slots correctly", () => {
    const sheet = makeSheet({
      spellSlots: [
        { level: 1, max: 4, current: 2 },
        { level: 2, max: 2, current: 1 },
      ],
    });
    expect(getSpellSlotSummary(sheet)).toBe("1st: 2/4 | 2nd: 1/2");
  });

  test("returns null when no slots", () => {
    expect(getSpellSlotSummary(makeSheet())).toBeNull();
  });
});

describe("getFeatureChargeSummary", () => {
  test("formats charges correctly", () => {
    const sheet = makeSheet({
      featureCharges: [
        { name: "Action Surge", max: 1, current: 1, resetsOn: "short" },
        { name: "Second Wind", max: 1, current: 0, resetsOn: "short" },
      ],
    });
    expect(getFeatureChargeSummary(sheet)).toBe("Action Surge: 1/1 | Second Wind: 0/1");
  });

  test("returns null when no charges", () => {
    expect(getFeatureChargeSummary(makeSheet())).toBeNull();
  });
});

describe("parseFeatureCharge", () => {
  test("parses short rest feature", () => {
    const result = parseFeatureCharge("Second Wind (1d10+3 HP, bonus action, 1/short rest)");
    expect(result).toEqual({ name: "Second Wind", max: 1, resetsOn: "short" });
  });

  test("parses long rest feature", () => {
    const result = parseFeatureCharge("Bardic Inspiration (d6, 3/long rest)");
    expect(result).toEqual({ name: "Bardic Inspiration", max: 3, resetsOn: "long" });
  });

  test("parses rage", () => {
    const result = parseFeatureCharge(
      "Rage (2/long rest, +2 damage, resistance to bludgeoning/piercing/slashing)",
    );
    expect(result).toEqual({ name: "Rage", max: 2, resetsOn: "long" });
  });

  test("parses action surge", () => {
    const result = parseFeatureCharge("Action Surge (1 additional action, 1/short rest)");
    expect(result).toEqual({ name: "Action Surge", max: 1, resetsOn: "short" });
  });

  test("parses channel divinity", () => {
    const result = parseFeatureCharge("Channel Divinity: Turn Undead (1/short rest)");
    expect(result).toEqual({ name: "Channel Divinity: Turn Undead", max: 1, resetsOn: "short" });
  });

  test("parses divine sense", () => {
    const result = parseFeatureCharge("Divine Sense (4/long rest)");
    expect(result).toEqual({ name: "Divine Sense", max: 4, resetsOn: "long" });
  });

  test("parses 'once per long rest' format", () => {
    const result = parseFeatureCharge(
      "Healing Hands (touch a creature, heal HP equal to level — once per long rest)",
    );
    expect(result).toEqual({ name: "Healing Hands", max: 1, resetsOn: "long" });
  });

  test("parses 'once per short rest' format", () => {
    const result = parseFeatureCharge("Breath Weapon (once per short rest)");
    expect(result).toEqual({ name: "Breath Weapon", max: 1, resetsOn: "short" });
  });

  test("returns null for non-charge features", () => {
    expect(parseFeatureCharge("Darkvision (60 ft)")).toBeNull();
    expect(parseFeatureCharge("Fighting Style: Defense (+1 AC)")).toBeNull();
    expect(parseFeatureCharge("Improved Critical (crit on 19-20)")).toBeNull();
  });
});

describe("parseSpellSlotLine", () => {
  test("parses 1st level slots", () => {
    expect(parseSpellSlotLine("- 1st level: 2")).toEqual({ level: 1, max: 2 });
  });

  test("parses 2nd level slots", () => {
    expect(parseSpellSlotLine("- 2nd level: 3")).toEqual({ level: 2, max: 3 });
  });

  test("parses 3rd level slots", () => {
    expect(parseSpellSlotLine("- 3rd level: 1")).toEqual({ level: 3, max: 1 });
  });

  test("returns null for non-slot lines", () => {
    expect(parseSpellSlotLine("Some other text")).toBeNull();
  });
});

describe("deriveSpellSlots", () => {
  test("level 1 Cleric gets 2 first-level slots", () => {
    const slots = deriveSpellSlots("Cleric", 1);
    expect(slots).toEqual([{ level: 1, max: 2, current: 2 }]);
  });

  test("level 3 Cleric gets 4 first-level + 2 second-level slots", () => {
    const slots = deriveSpellSlots("Cleric", 3);
    expect(slots).toEqual([
      { level: 1, max: 4, current: 4 },
      { level: 2, max: 2, current: 2 },
    ]);
  });

  test("level 3 Bard gets same as Cleric (full caster)", () => {
    const slots = deriveSpellSlots("Bard", 3);
    expect(slots).toEqual([
      { level: 1, max: 4, current: 4 },
      { level: 2, max: 2, current: 2 },
    ]);
  });

  test("handles class with subclass in parens", () => {
    const slots = deriveSpellSlots("Cleric (Life)", 1);
    expect(slots).toEqual([{ level: 1, max: 2, current: 2 }]);
  });

  test("level 2 Ranger gets slots (half caster, starts at 2)", () => {
    const slots = deriveSpellSlots("Ranger", 2);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].level).toBe(1);
  });

  test("level 1 Ranger gets no slots (half caster, no spells until 2)", () => {
    const slots = deriveSpellSlots("Ranger", 1);
    expect(slots).toEqual([]);
  });

  test("level 2 Warlock gets 2 first-level Pact Magic slots", () => {
    const slots = deriveSpellSlots("Warlock", 2);
    expect(slots).toEqual([{ level: 1, max: 2, current: 2 }]);
  });

  test("level 5 Warlock gets 2 third-level Pact Magic slots", () => {
    const slots = deriveSpellSlots("Warlock", 5);
    expect(slots).toEqual([{ level: 3, max: 2, current: 2 }]);
  });

  test("Fighter gets no slots", () => {
    const slots = deriveSpellSlots("Fighter", 3);
    expect(slots).toEqual([]);
  });

  test("Rogue gets no slots", () => {
    const slots = deriveSpellSlots("Rogue", 3);
    expect(slots).toEqual([]);
  });
});
