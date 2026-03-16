import { describe, expect, test } from "bun:test";
import { CONDITION_EFFECTS, getConditionEffect, summarizeConditionEffects } from "./conditions.js";

describe("CONDITION_EFFECTS", () => {
  test("has all standard SRD conditions", () => {
    const expected = [
      "blinded",
      "charmed",
      "deafened",
      "frightened",
      "grappled",
      "incapacitated",
      "invisible",
      "paralyzed",
      "petrified",
      "poisoned",
      "prone",
      "restrained",
      "stunned",
      "unconscious",
    ];
    for (const cond of expected) {
      expect(CONDITION_EFFECTS[cond]).toBeDefined();
    }
  });

  test("has custom dodging condition", () => {
    expect(CONDITION_EFFECTS.dodging).toBeDefined();
    expect(CONDITION_EFFECTS.dodging.attackersHaveDisadvantage).toBe(true);
    expect(CONDITION_EFFECTS.dodging.saveAdvantage).toContain("dexterity");
  });
});

describe("getConditionEffect", () => {
  test("returns effect for known condition", () => {
    const prone = getConditionEffect("prone");
    expect(prone).not.toBeNull();
    expect(prone?.attackersHaveAdvantage).toBe(true);
    expect(prone?.selfAttackDisadvantage).toBe(true);
  });

  test("case insensitive", () => {
    expect(getConditionEffect("PRONE")).not.toBeNull();
    expect(getConditionEffect("Blinded")).not.toBeNull();
  });

  test("returns null for unknown condition", () => {
    expect(getConditionEffect("flying")).toBeNull();
  });

  test("paralyzed has auto-fail STR/DEX and melee crit", () => {
    const paralyzed = getConditionEffect("paralyzed");
    expect(paralyzed?.autoFailSaves).toContain("strength");
    expect(paralyzed?.autoFailSaves).toContain("dexterity");
    expect(paralyzed?.meleeCrit).toBe(true);
  });

  test("restrained has disadvantage on DEX saves", () => {
    const restrained = getConditionEffect("restrained");
    expect(restrained?.saveDisadvantage).toContain("dexterity");
  });
});

describe("summarizeConditionEffects", () => {
  test("empty conditions → empty notes", () => {
    expect(summarizeConditionEffects([])).toEqual([]);
  });

  test("prone gives attacker advantage and self disadvantage", () => {
    const notes = summarizeConditionEffects(["prone"]);
    expect(notes).toContain("Attackers have advantage");
    expect(notes).toContain("Attacks at disadvantage");
  });

  test("dodging gives attacker disadvantage", () => {
    const notes = summarizeConditionEffects(["dodging"]);
    expect(notes).toContain("Attackers have disadvantage");
  });

  test("paralyzed shows auto-crits and auto-fail saves", () => {
    const notes = summarizeConditionEffects(["paralyzed"]);
    expect(notes.some((n) => n.includes("auto-crits"))).toBe(true);
    expect(notes.some((n) => n.includes("Auto-fail"))).toBe(true);
  });

  test("unknown conditions are silently skipped", () => {
    const notes = summarizeConditionEffects(["flying", "enhanced"]);
    expect(notes).toEqual([]);
  });

  test("advantage and disadvantage from different conditions cancel out", () => {
    // invisible (attackers have disadvantage) + prone (attackers have advantage)
    const notes = summarizeConditionEffects(["invisible", "prone"]);
    // Both present → neither "Attackers have advantage" nor "Attackers have disadvantage"
    expect(notes.includes("Attackers have advantage")).toBe(false);
    expect(notes.includes("Attackers have disadvantage")).toBe(false);
  });
});
