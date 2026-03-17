import { describe, expect, test } from "bun:test";
import type { GameState, Player } from "../state/types.js";
import { processDirectives } from "./directives.js";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "human1",
    name: "Human",
    isAgent: false,
    characterSheet: {
      name: "Fusetsu",
      race: "Human",
      class: "Rogue",
      level: 3,
      background: "Hermit",
      alignment: "Neutral",
      abilityScores: {
        strength: 10,
        dexterity: 16,
        constitution: 12,
        wisdom: 14,
        intelligence: 10,
        charisma: 10,
      },
      proficiencyBonus: 2,
      savingThrows: [],
      skills: [],
      hp: { max: 24, current: 24, temp: 0 },
      armorClass: 14,
      initiative: 3,
      speed: 30,
      equipment: [],
      features: [],
      backstory: "",
    },
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgent(): Player {
  return {
    id: "agent:grimbold",
    name: "Grimbold",
    isAgent: true,
    characterSheet: {
      name: "Grimbold Ironforge",
      race: "Mountain Dwarf",
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
      hp: { max: 31, current: 31, temp: 0 },
      armorClass: 18,
      initiative: 1,
      speed: 25,
      equipment: [],
      features: [],
      backstory: "",
      spellSlots: [{ level: 1, max: 2, current: 2 }],
      featureCharges: [{ name: "Second Wind", max: 1, current: 1, resetsOn: "short" }],
    },
    agentFile: "grimbold.md",
    joinedAt: new Date().toISOString(),
  };
}

function makeCombatState(): GameState {
  return {
    id: "test-game",
    channelId: "ch1",
    guildId: "g1",
    status: "active",
    players: [makePlayer(), makeAgent()],
    combat: {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          playerId: "human1",
          name: "Fusetsu",
          initiative: 15,
          hp: { max: 24, current: 24, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
        {
          playerId: "agent:grimbold",
          name: "Grimbold Ironforge",
          initiative: 10,
          hp: { max: 31, current: 31, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

describe("directives — ROLL", () => {
  test("replaces ROLL directive with dice result", () => {
    const gs = makeCombatState();
    const text = "Fusetsu checks. [[ROLL:d20+5 FOR:Fusetsu REASON:perception check]] Done.";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[ROLL:");
    expect(ctx.diceResults.length).toBeGreaterThanOrEqual(1);
  });

  test("multiple ROLL directives are all processed", () => {
    const gs = makeCombatState();
    const text =
      "[[ROLL:d20+5 FOR:Fusetsu REASON:attack]] then [[ROLL:d20+3 FOR:Grimbold Ironforge REASON:attack]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[ROLL:");
    expect(ctx.diceResults).toHaveLength(2);
  });
});

describe("directives — DAMAGE", () => {
  test("applies damage and replaces directive", () => {
    const gs = makeCombatState();
    const text =
      "The goblin strikes! [[DAMAGE:1d6+2 TARGET:Grimbold Ironforge REASON:scimitar hit]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[DAMAGE:");
    expect(ctx.processedText).toContain("damage");
    expect(ctx.hpChanged).toBe(true);
    expect(ctx.damageTargets).toContain("Grimbold Ironforge");
    // HP should be reduced
    const grimbold = gs.combat.combatants.find((c) => c.name === "Grimbold Ironforge");
    expect(grimbold?.hp.current).toBeLessThan(31);
  });

  test("damage to non-PC doesn't crash", () => {
    const gs = makeCombatState();
    const text = "The arrow flies! [[DAMAGE:2d6+3 TARGET:Goblin King REASON:longbow hit]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[DAMAGE:");
    expect(ctx.processedText).toContain("Goblin King");
  });
});

describe("directives — HEAL", () => {
  test("applies healing and replaces directive", () => {
    const gs = makeCombatState();
    gs.combat.combatants[0].hp.current = 10;
    gs.players[0].characterSheet.hp.current = 10;
    const text = "Healing light! [[HEAL:1d8+3 TARGET:Fusetsu REASON:cure wounds]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[HEAL:");
    expect(ctx.hpChanged).toBe(true);
    expect(gs.combat.combatants[0].hp.current).toBeGreaterThan(10);
  });
});

describe("directives — SPELL", () => {
  test("deducts spell slot", () => {
    const gs = makeCombatState();
    const text = "Grimbold casts! [[SPELL:1 TARGET:Grimbold Ironforge]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[SPELL:");
    expect(ctx.spellsUsed).toBe(true);
    expect(gs.players[1].characterSheet.spellSlots?.[0].current).toBe(1);
  });

  test("warns when no slots available", () => {
    const gs = makeCombatState();
    // biome-ignore lint/style/noNonNullAssertion: test setup — spellSlots guaranteed in makeAgent
    gs.players[1].characterSheet.spellSlots![0].current = 0;
    const text = "Cast! [[SPELL:1 TARGET:Grimbold Ironforge]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).toContain("no level 1 spell slots remaining");
  });
});

describe("directives — USE", () => {
  test("deducts feature charge", () => {
    const gs = makeCombatState();
    const text = "Second wind! [[USE:Second Wind TARGET:Grimbold Ironforge]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[USE:");
    expect(ctx.featuresUsed).toBe(true);
    expect(
      gs.players[1].characterSheet.featureCharges?.find((c) => c.name === "Second Wind")?.current,
    ).toBe(0);
  });
});

describe("directives — UPDATE_HP", () => {
  test("sets HP to exact value", () => {
    const gs = makeCombatState();
    const text = "Correcting HP. [[UPDATE_HP:15 TARGET:Fusetsu]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[UPDATE_HP:");
    expect(ctx.hpChanged).toBe(true);
    expect(gs.combat.combatants[0].hp.current).toBe(15);
    expect(gs.players[0].characterSheet.hp.current).toBe(15);
  });

  test("clamps to max HP", () => {
    const gs = makeCombatState();
    const text = "[[UPDATE_HP:999 TARGET:Fusetsu]]";
    processDirectives(text, gs);
    expect(gs.combat.combatants[0].hp.current).toBe(24); // max is 24
  });

  test("clamps to 0 HP", () => {
    const gs = makeCombatState();
    const text = "[[UPDATE_HP:0 TARGET:Fusetsu]]";
    processDirectives(text, gs);
    expect(gs.combat.combatants[0].hp.current).toBe(0);
  });
});

describe("directives — UPDATE_CONDITION", () => {
  test("replaces all conditions", () => {
    const gs = makeCombatState();
    gs.combat.combatants[0].conditions = ["prone"];
    const text = "[[UPDATE_CONDITION:SET frightened,poisoned TARGET:Fusetsu]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).not.toContain("[[UPDATE_CONDITION:");
    expect(ctx.conditionsChanged).toBe(true);
    expect(gs.combat.combatants[0].conditions).toEqual(["frightened", "poisoned"]);
  });

  test("SET none clears all conditions", () => {
    const gs = makeCombatState();
    gs.combat.combatants[0].conditions = ["prone", "frightened"];
    const text = "[[UPDATE_CONDITION:SET none TARGET:Fusetsu]]";
    processDirectives(text, gs);
    expect(gs.combat.combatants[0].conditions).toEqual([]);
  });
});

describe("directives — CONDITION (add/remove)", () => {
  test("adds condition", () => {
    const gs = makeCombatState();
    const text = "[[CONDITION:ADD prone TARGET:Fusetsu]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.conditionsChanged).toBe(true);
    expect(gs.combat.combatants[0].conditions).toContain("prone");
  });

  test("removes condition", () => {
    const gs = makeCombatState();
    gs.combat.combatants[0].conditions = ["prone"];
    const text = "[[CONDITION:REMOVE prone TARGET:Fusetsu]]";
    processDirectives(text, gs);
    expect(gs.combat.combatants[0].conditions).not.toContain("prone");
  });
});

describe("directives — COMBAT signals", () => {
  test("COMBAT:START starts combat", () => {
    const gs = makeCombatState();
    gs.combat = { active: false, round: 0, turnIndex: 0, combatants: [] };
    const text = "Enemies appear! [[COMBAT:START]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.combatStarted).toBe(true);
    expect(gs.combat.active).toBe(true);
    expect(gs.combat.combatants.length).toBe(2);
    expect(ctx.processedText).toContain("Initiative Order");
  });

  test("COMBAT:END ends combat", () => {
    const gs = makeCombatState();
    const text = "Victory! [[COMBAT:END]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.combatEnded).toBe(true);
    expect(gs.combat.active).toBe(false);
    expect(ctx.processedText).toContain("Combat has ended");
  });
});

describe("directives — XP", () => {
  test("party XP splits evenly", () => {
    const gs = makeCombatState();
    const text = "Well done! [[XP:200 TARGET:party REASON:defeated goblins]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).toContain("+100 XP each");
    expect(gs.players[0].characterSheet.experiencePoints).toBe(100);
    expect(gs.players[1].characterSheet.experiencePoints).toBe(100);
  });

  test("individual XP awards to one player", () => {
    const gs = makeCombatState();
    const text = "[[XP:50 TARGET:Fusetsu REASON:clever trap disarm]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.processedText).toContain("+50 XP");
    expect(gs.players[0].characterSheet.experiencePoints).toBe(50);
  });
});

describe("directives — REQUEST_ROLL", () => {
  test("creates pending roll for human player", () => {
    const gs = makeCombatState();
    const text = "Roll for perception! [[REQUEST_ROLL:d20+5 FOR:Fusetsu REASON:Perception check]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.pendingRolls).toHaveLength(1);
    expect(ctx.pendingRolls[0].playerName).toBe("Fusetsu");
    expect(ctx.pendingRolls[0].notation).toBe("d20+5");
    expect(ctx.pendingRolls[0].reason).toBe("Perception check");
    expect(ctx.processedText).toContain("/roll d20+5");
  });

  test("auto-rolls for AI agent", () => {
    const gs = makeCombatState();
    const text =
      "The dwarf checks! [[REQUEST_ROLL:d20+3 FOR:Grimbold Ironforge REASON:Athletics check]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.pendingRolls).toHaveLength(0); // auto-rolled, no pending
    expect(ctx.diceResults.length).toBeGreaterThanOrEqual(1);
    expect(ctx.processedText).not.toContain("[[REQUEST_ROLL:");
  });
});

describe("directives — misuse detection", () => {
  test("detects narrated damage without directive", () => {
    const gs = makeCombatState();
    const text = "Fusetsu takes 5 damage from the fall.";
    const ctx = processDirectives(text, gs);
    expect(ctx.misuseWarnings.length).toBeGreaterThanOrEqual(1);
    expect(ctx.misuseWarnings[0]).toContain("damage");
  });
});

describe("directives — HP and resource summaries", () => {
  test("HP summary generated in combat", () => {
    const gs = makeCombatState();
    const text = "Strike! [[DAMAGE:1d6+2 TARGET:Grimbold Ironforge REASON:sword]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.hpSummary).not.toBeNull();
    expect(ctx.hpSummary).toContain("Combat HP");
  });

  test("resource summary generated after spell use", () => {
    const gs = makeCombatState();
    const text = "Cast! [[SPELL:1 TARGET:Grimbold Ironforge]]";
    const ctx = processDirectives(text, gs);
    expect(ctx.resourceSummary).not.toBeNull();
    expect(ctx.resourceSummary).toContain("Resources");
  });
});
