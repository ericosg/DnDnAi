import { describe, expect, test } from "bun:test";
import type { Combatant } from "../state/types.js";

function makeCombatant(overrides?: Partial<Combatant>): Combatant {
  return {
    playerId: "p1",
    name: "Hierophantis",
    initiative: 10,
    hp: { max: 9, current: 9, temp: 0 },
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    ...overrides,
  };
}

describe("concentration tracking", () => {
  test("setting concentration stores the spell", () => {
    const c = makeCombatant();
    c.concentration = { spell: "Bless" };
    expect(c.concentration.spell).toBe("Bless");
  });

  test("breaking concentration clears the field", () => {
    const c = makeCombatant({ concentration: { spell: "Bless" } });
    c.concentration = undefined;
    expect(c.concentration).toBeUndefined();
  });

  test("replacing concentration with a new spell", () => {
    const c = makeCombatant({ concentration: { spell: "Bless" } });
    const oldSpell = c.concentration?.spell;
    c.concentration = { spell: "Hold Person" };
    expect(oldSpell).toBe("Bless");
    expect(c.concentration.spell).toBe("Hold Person");
  });

  test("concentration is undefined by default", () => {
    const c = makeCombatant();
    expect(c.concentration).toBeUndefined();
  });

  test("CON save DC calculation: max(10, damage/2)", () => {
    // DC = max(10, floor(damage/2))
    expect(Math.max(10, Math.floor(6 / 2))).toBe(10); // 6 damage → DC 10
    expect(Math.max(10, Math.floor(22 / 2))).toBe(11); // 22 damage → DC 11
    expect(Math.max(10, Math.floor(30 / 2))).toBe(15); // 30 damage → DC 15
    expect(Math.max(10, Math.floor(1 / 2))).toBe(10); // 1 damage → DC 10
  });
});
