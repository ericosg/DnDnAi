import { describe, expect, test } from "bun:test";
import type { GameState } from "../state/types.js";
import { buildCombatHPSummary, detectDirectiveMisuse } from "./hp-reconciliation.js";

function makeGameState(combatActive: boolean): GameState {
  return {
    id: "test",
    channelId: "ch1",
    guildId: "g1",
    status: "active",
    players: [],
    combat: {
      active: combatActive,
      round: 1,
      turnIndex: 0,
      combatants: combatActive
        ? [
            {
              playerId: "p1",
              name: "Fūsetsu",
              initiative: 18,
              hp: { max: 10, current: 2, temp: 0 },
              conditions: [],
              deathSaves: { successes: 0, failures: 0 },
            },
            {
              playerId: "p2",
              name: "Grimbold",
              initiative: 12,
              hp: { max: 31, current: 31, temp: 0 },
              conditions: [],
              deathSaves: { successes: 0, failures: 0 },
            },
          ]
        : [],
    },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

describe("buildCombatHPSummary", () => {
  test("returns HP summary when combat is active", () => {
    const gs = makeGameState(true);
    const result = buildCombatHPSummary(gs);
    expect(result).toBe("Combat HP after DM turn: Fūsetsu 2/10, Grimbold 31/31");
  });

  test("returns null when combat is not active", () => {
    const gs = makeGameState(false);
    expect(buildCombatHPSummary(gs)).toBeNull();
  });
});

describe("detectDirectiveMisuse", () => {
  test("no warnings when narration matches directives", () => {
    const narration =
      "The goblin strikes! `2d6+3` [4, 2] +3 = **9 damage** to Grimbold (HP: 22/31)";
    const warnings = detectDirectiveMisuse(narration, ["Grimbold"], []);
    expect(warnings).toHaveLength(0);
  });

  test("warns when damage narrated without directive", () => {
    const narration = "Fūsetsu takes 4 damage from the goblin's strike.";
    const warnings = detectDirectiveMisuse(narration, [], []);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Fūsetsu");
    expect(warnings[0]).toContain("DAMAGE");
  });

  test("no warning when damage target was processed", () => {
    const narration = "Grimbold takes 8 damage from the fireball.";
    const warnings = detectDirectiveMisuse(narration, ["Grimbold"], []);
    expect(warnings).toHaveLength(0);
  });

  test("warns when healing narrated without directive", () => {
    const narration = "Nyx heals for 8 hit points as the spell washes over her.";
    const warnings = detectDirectiveMisuse(narration, [], []);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Nyx");
    expect(warnings[0]).toContain("HEAL");
  });

  test("no warning when heal target was processed", () => {
    const narration = "Nyx recovers 8 HP from the potion.";
    const warnings = detectDirectiveMisuse(narration, [], ["Nyx"]);
    expect(warnings).toHaveLength(0);
  });

  test("case-insensitive target matching", () => {
    const narration = "GRIMBOLD takes 5 damage!";
    const warnings = detectDirectiveMisuse(narration, ["Grimbold"], []);
    expect(warnings).toHaveLength(0);
  });

  test("detects multiple misuses", () => {
    const narration = "Fūsetsu takes 4 damage. Meanwhile, Grimbold heals for 10 hit points.";
    const warnings = detectDirectiveMisuse(narration, [], []);
    expect(warnings.length).toBe(2);
  });

  test("skips already-formatted directive output", () => {
    // This matches the format engine.ts produces after replacing DAMAGE directives
    const narration = "`2d6+3` [4, 2] +3 = **9** → **9 damage** to Grimbold (HP: 22/31)";
    const warnings = detectDirectiveMisuse(narration, ["Grimbold"], []);
    expect(warnings).toHaveLength(0);
  });
});
