import { describe, expect, test } from "bun:test";
import type { GameState } from "../state/types.js";
import { longRest, shortRest } from "./rest.js";

function makeGameState(): GameState {
  return {
    id: "test",
    channelId: "ch1",
    guildId: "g1",
    status: "active",
    players: [
      {
        id: "p1",
        name: "Eric",
        isAgent: false,
        characterSheet: {
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
          savingThrows: [],
          skills: [],
          hp: { max: 24, current: 15, temp: 0 },
          armorClass: 14,
          initiative: 3,
          speed: 30,
          equipment: [],
          features: [],
          backstory: "",
        },
        joinedAt: new Date().toISOString(),
      },
      {
        id: "agent:grimbold",
        name: "Grimbold",
        isAgent: true,
        characterSheet: {
          name: "Grimbold",
          race: "Dwarf",
          class: "Fighter",
          level: 3,
          background: "Soldier",
          alignment: "Lawful Neutral",
          abilityScores: {
            strength: 16,
            dexterity: 12,
            constitution: 16,
            wisdom: 13,
            intelligence: 10,
            charisma: 8,
          },
          proficiencyBonus: 2,
          savingThrows: [],
          skills: [],
          hp: { max: 31, current: 20, temp: 0 },
          armorClass: 18,
          initiative: 1,
          speed: 25,
          equipment: [],
          features: [],
          backstory: "",
          featureCharges: [
            { name: "Action Surge", max: 1, current: 0, resetsOn: "short" },
            { name: "Second Wind", max: 1, current: 0, resetsOn: "short" },
          ],
        },
        agentFile: "grimbold.md",
        joinedAt: new Date().toISOString(),
      },
    ],
    combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

describe("shortRest", () => {
  test("resets short-rest features", () => {
    const gs = makeGameState();
    const summary = shortRest(gs);
    expect(gs.players[1].characterSheet.featureCharges?.[0].current).toBe(1);
    expect(gs.players[1].characterSheet.featureCharges?.[1].current).toBe(1);
    expect(summary.length).toBe(1);
    expect(summary[0]).toContain("Grimbold");
    expect(summary[0]).toContain("Action Surge");
  });

  test("does not restore HP", () => {
    const gs = makeGameState();
    shortRest(gs);
    expect(gs.players[0].characterSheet.hp.current).toBe(15);
  });
});

describe("longRest", () => {
  test("restores HP to max", () => {
    const gs = makeGameState();
    longRest(gs);
    expect(gs.players[0].characterSheet.hp.current).toBe(24);
    expect(gs.players[1].characterSheet.hp.current).toBe(31);
  });

  test("resets all features", () => {
    const gs = makeGameState();
    longRest(gs);
    expect(gs.players[1].characterSheet.featureCharges?.[0].current).toBe(1);
    expect(gs.players[1].characterSheet.featureCharges?.[1].current).toBe(1);
  });

  test("returns summary of all restorations", () => {
    const gs = makeGameState();
    const summary = longRest(gs);
    expect(summary.length).toBe(2); // both characters had something to restore
    expect(summary[0]).toContain("HP 15 → 24");
    expect(summary[1]).toContain("Action Surge");
  });

  test("skips characters at full health with full resources", () => {
    const gs = makeGameState();
    gs.players[0].characterSheet.hp.current = 24; // full HP
    gs.players[1].characterSheet.hp.current = 31; // full HP
    const charges = gs.players[1].characterSheet.featureCharges;
    if (charges) {
      charges[0].current = 1;
      charges[1].current = 1;
    }
    const summary = longRest(gs);
    expect(summary).toEqual([]);
  });

  test("increments longRestCount from 0", () => {
    const gs = makeGameState();
    longRest(gs);
    expect(gs.longRestCount).toBe(1);
  });

  test("increments existing longRestCount", () => {
    const gs = makeGameState();
    gs.longRestCount = 5;
    longRest(gs);
    expect(gs.longRestCount).toBe(6);
  });

  test("handles undefined longRestCount (backward compat)", () => {
    const gs = makeGameState();
    expect(gs.longRestCount).toBeUndefined();
    longRest(gs);
    expect(gs.longRestCount).toBe(1);
  });
});

describe("shortRest — longRestCount", () => {
  test("does NOT increment longRestCount", () => {
    const gs = makeGameState();
    gs.longRestCount = 3;
    shortRest(gs);
    expect(gs.longRestCount).toBe(3);
  });
});
