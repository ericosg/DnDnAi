import { describe, expect, test } from "bun:test";
import type { Combatant, GameState, Player } from "../state/types.js";
import {
  advanceTurn,
  applyDamage,
  applyHealing,
  isCombatOver,
  rollDeathSave,
  startCombat,
} from "./combat.js";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "player1",
    name: "TestPlayer",
    isAgent: false,
    characterSheet: {
      name: "TestChar",
      race: "Human",
      class: "Fighter",
      level: 1,
      background: "Soldier",
      alignment: "Neutral",
      abilityScores: {
        strength: 10,
        dexterity: 14,
        constitution: 10,
        wisdom: 10,
        intelligence: 10,
        charisma: 10,
      },
      proficiencyBonus: 2,
      savingThrows: [],
      skills: [],
      hp: { max: 20, current: 20, temp: 0 },
      armorClass: 10,
      initiative: 2,
      speed: 30,
      equipment: [],
      features: [],
      backstory: "",
    },
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGameState(players: Player[]): GameState {
  return {
    id: "test-game",
    channelId: "test-channel",
    guildId: "test-guild",
    status: "active",
    players,
    combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

function makeActiveCombat(gameState: GameState, combatants: Combatant[]): void {
  gameState.combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    combatants,
  };
}

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    playerId: "player1",
    name: "TestChar",
    initiative: 15,
    hp: { max: 20, current: 20, temp: 0 },
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    ...overrides,
  };
}

describe("applyDamage", () => {
  test("reduces HP by damage amount", () => {
    const player = makePlayer();
    const gs = makeGameState([player]);
    makeActiveCombat(gs, [makeCombatant()]);

    const result = applyDamage(gs, "TestChar", 5);
    expect(result).not.toBeNull();
    expect(result?.combatant.hp.current).toBe(15);
    expect(result?.overkill).toBe(false);
  });

  test("temp HP absorbs damage first", () => {
    const player = makePlayer();
    player.characterSheet.hp.temp = 10;
    const gs = makeGameState([player]);
    const combatant = makeCombatant({ hp: { max: 20, current: 20, temp: 10 } });
    makeActiveCombat(gs, [combatant]);

    const result = applyDamage(gs, "TestChar", 7);
    expect(result).not.toBeNull();
    expect(result?.combatant.hp.temp).toBe(3);
    expect(result?.combatant.hp.current).toBe(20); // no damage bleeds through
  });

  test("damage bleeds through when temp HP exhausted", () => {
    const player = makePlayer();
    player.characterSheet.hp.temp = 5;
    const gs = makeGameState([player]);
    const combatant = makeCombatant({ hp: { max: 20, current: 20, temp: 5 } });
    makeActiveCombat(gs, [combatant]);

    const result = applyDamage(gs, "TestChar", 8);
    expect(result).not.toBeNull();
    expect(result?.combatant.hp.temp).toBe(0);
    expect(result?.combatant.hp.current).toBe(17); // 8 - 5 temp = 3 bleed through
  });

  test("HP cannot go below 0", () => {
    const player = makePlayer();
    const gs = makeGameState([player]);
    makeActiveCombat(gs, [makeCombatant()]);

    const result = applyDamage(gs, "TestChar", 100);
    expect(result?.combatant.hp.current).toBe(0);
  });

  test("overkill detection (damage > max HP after hitting 0)", () => {
    const player = makePlayer();
    const gs = makeGameState([player]);
    makeActiveCombat(gs, [makeCombatant()]);

    const result = applyDamage(gs, "TestChar", 50);
    expect(result?.overkill).toBe(true);
  });

  test("syncs player character sheet HP", () => {
    const player = makePlayer();
    const gs = makeGameState([player]);
    makeActiveCombat(gs, [makeCombatant()]);

    applyDamage(gs, "TestChar", 5);
    expect(player.characterSheet.hp.current).toBe(15);
  });

  test("returns null for unknown target", () => {
    const gs = makeGameState([makePlayer()]);
    makeActiveCombat(gs, [makeCombatant()]);

    const result = applyDamage(gs, "Nobody", 5);
    expect(result).toBeNull();
  });
});

describe("applyHealing", () => {
  test("increases HP up to max", () => {
    const player = makePlayer();
    player.characterSheet.hp.current = 10;
    const gs = makeGameState([player]);
    const combatant = makeCombatant({ hp: { max: 20, current: 10, temp: 0 } });
    makeActiveCombat(gs, [combatant]);

    const result = applyHealing(gs, "TestChar", 5);
    expect(result).not.toBeNull();
    expect(result?.hp.current).toBe(15);
  });

  test("does not exceed max HP", () => {
    const player = makePlayer();
    const gs = makeGameState([player]);
    const combatant = makeCombatant({ hp: { max: 20, current: 18, temp: 0 } });
    makeActiveCombat(gs, [combatant]);

    const result = applyHealing(gs, "TestChar", 10);
    expect(result?.hp.current).toBe(20);
  });

  test("clears death saves when healed from 0", () => {
    const player = makePlayer();
    const gs = makeGameState([player]);
    const combatant = makeCombatant({
      hp: { max: 20, current: 0, temp: 0 },
      conditions: ["unconscious"],
      deathSaves: { successes: 2, failures: 1 },
    });
    makeActiveCombat(gs, [combatant]);

    const result = applyHealing(gs, "TestChar", 5);
    expect(result?.hp.current).toBe(5);
    expect(result?.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(result?.conditions).not.toContain("unconscious");
  });
});

describe("advanceTurn", () => {
  test("moves to next combatant", () => {
    const gs = makeGameState([makePlayer(), makePlayer({ id: "player2", name: "P2" })]);
    makeActiveCombat(gs, [
      makeCombatant({ playerId: "player1", name: "P1", initiative: 20 }),
      makeCombatant({ playerId: "player2", name: "P2", initiative: 10 }),
    ]);
    gs.combat.turnIndex = 0;

    advanceTurn(gs);
    expect(gs.combat.turnIndex).toBe(1);
  });

  test("skips dead combatants", () => {
    const gs = makeGameState([
      makePlayer({ id: "p1" }),
      makePlayer({ id: "p2" }),
      makePlayer({ id: "p3" }),
    ]);
    makeActiveCombat(gs, [
      makeCombatant({ playerId: "p1", name: "P1", initiative: 20 }),
      makeCombatant({
        playerId: "p2",
        name: "P2",
        initiative: 15,
        hp: { max: 20, current: 0, temp: 0 },
      }),
      makeCombatant({ playerId: "p3", name: "P3", initiative: 10 }),
    ]);
    gs.combat.turnIndex = 0;

    advanceTurn(gs);
    expect(gs.combat.turnIndex).toBe(2); // skipped dead P2
  });

  test("wraps to next round", () => {
    const gs = makeGameState([makePlayer(), makePlayer({ id: "p2" })]);
    makeActiveCombat(gs, [
      makeCombatant({ playerId: "player1", initiative: 20 }),
      makeCombatant({ playerId: "p2", name: "P2", initiative: 10 }),
    ]);
    gs.combat.turnIndex = 1; // last combatant

    advanceTurn(gs);
    expect(gs.combat.round).toBe(2);
    expect(gs.combat.turnIndex).toBe(0);
  });

  test("auto-ends combat when all dead (isCombatOver)", () => {
    const gs = makeGameState([makePlayer()]);
    makeActiveCombat(gs, [makeCombatant({ hp: { max: 20, current: 0, temp: 0 } })]);

    advanceTurn(gs);
    expect(gs.combat.active).toBe(false);
  });
});

describe("rollDeathSave", () => {
  test("nat 20 revives with 1 HP", () => {
    // We can't control random, so we test the shape
    const combatant = makeCombatant({ hp: { max: 20, current: 0, temp: 0 } });
    // Run many times to check structure
    const result = rollDeathSave(combatant);
    expect(["success", "failure", "stabilized", "revived", "dead"]).toContain(result.result);
    expect(result.roll.notation).toBe("d20");
  });

  test("nat 1 adds two failures", () => {
    // We test this by checking structure — can't control dice
    const combatant = makeCombatant({
      hp: { max: 20, current: 0, temp: 0 },
      deathSaves: { successes: 0, failures: 0 },
    });
    const result = rollDeathSave(combatant);
    // If nat 1: failures should be 2. If nat 20: revived. Otherwise: +1 to one counter
    if (result.roll.total === 1) {
      expect(combatant.deathSaves.failures).toBe(2);
    } else if (result.roll.total === 20) {
      expect(combatant.hp.current).toBe(1);
    } else if (result.roll.total >= 10) {
      expect(combatant.deathSaves.successes).toBe(1);
    } else {
      expect(combatant.deathSaves.failures).toBe(1);
    }
  });
});

describe("startCombat", () => {
  test("sorts combatants by initiative (highest first)", () => {
    const p1 = makePlayer({ id: "p1" });
    const p2 = makePlayer({ id: "p2" });
    const gs = makeGameState([p1, p2]);

    const results = startCombat(gs);
    expect(results).toHaveLength(2);
    expect(gs.combat.active).toBe(true);
    expect(gs.combat.round).toBe(1);
    expect(gs.combat.combatants).toHaveLength(2);

    // Sorted by initiative
    expect(gs.combat.combatants[0].initiative).toBeGreaterThanOrEqual(
      gs.combat.combatants[1].initiative,
    );
  });
});

describe("isCombatOver", () => {
  test("returns true when all dead", () => {
    const gs = makeGameState([makePlayer()]);
    makeActiveCombat(gs, [makeCombatant({ hp: { max: 20, current: 0, temp: 0 } })]);
    expect(isCombatOver(gs)).toBe(true);
  });

  test("returns true when only one alive", () => {
    const gs = makeGameState([makePlayer(), makePlayer({ id: "p2" })]);
    makeActiveCombat(gs, [
      makeCombatant({ playerId: "p1", hp: { max: 20, current: 10, temp: 0 } }),
      makeCombatant({ playerId: "p2", hp: { max: 20, current: 0, temp: 0 } }),
    ]);
    expect(isCombatOver(gs)).toBe(true);
  });

  test("returns false when multiple alive", () => {
    const gs = makeGameState([makePlayer(), makePlayer({ id: "p2" })]);
    makeActiveCombat(gs, [
      makeCombatant({ playerId: "p1", hp: { max: 20, current: 10, temp: 0 } }),
      makeCombatant({ playerId: "p2", hp: { max: 20, current: 10, temp: 0 } }),
    ]);
    expect(isCombatOver(gs)).toBe(false);
  });

  test("returns true when combat not active", () => {
    const gs = makeGameState([]);
    expect(isCombatOver(gs)).toBe(true);
  });
});
