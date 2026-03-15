/**
 * Tests for DM prompt construction.
 * Uses dm-prompt.ts (pure functions) to avoid cross-file mock pollution.
 */

import { describe, expect, mock, test } from "bun:test";
import type { GameState, TurnEntry } from "../state/types.js";

mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test-model", agent: "test-model", orchestrator: "test-model" },
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  NARRATIVE_STYLE: "concise",
  STYLE_INSTRUCTIONS: {
    concise: { dm: "", agent: "" },
    standard: { dm: "", agent: "" },
    elaborate: { dm: "", agent: "" },
  },
}));

const { buildDMPrompt, buildAskPrompt, DM_IDENTITY } = await import("./dm-prompt.js");

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: "test-game",
    channelId: "ch1",
    guildId: "g1",
    status: "active",
    players: [
      {
        id: "human1",
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
          hp: { max: 24, current: 24, temp: 0 },
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
    ...overrides,
  };
}

function makeHistory(entries: Partial<TurnEntry>[] = []): TurnEntry[] {
  return entries.map((e, i) => ({
    id: i + 1,
    timestamp: new Date().toISOString(),
    playerId: "human1",
    playerName: "Fūsetsu",
    type: "ic" as const,
    content: "I move forward.",
    ...e,
  }));
}

describe("DM_IDENTITY", () => {
  test("contains core DM rules", () => {
    expect(DM_IDENTITY).toContain("Dungeon Master");
    expect(DM_IDENTITY).toContain("NEVER narrate");
    expect(DM_IDENTITY).toContain("dice directive");
  });

  test("contains player overreach rules", () => {
    expect(DM_IDENTITY).toContain("Player Overreach");
    expect(DM_IDENTITY).toContain("sole authority");
  });

  test("contains combat signal instructions", () => {
    expect(DM_IDENTITY).toContain("[[COMBAT:START]]");
    expect(DM_IDENTITY).toContain("[[COMBAT:END]]");
  });
});

describe("buildDMPrompt", () => {
  test("system prompt includes party info with human/AI labels", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test action");

    expect(system).toContain("Fūsetsu");
    expect(system).toContain("Variant Human");
    expect(system).toContain("[Human]");
    expect(system).toContain("Grimbold Ironforge");
    expect(system).toContain("[AI]");
  });

  test("party info includes HP and AC", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("HP: 24/24");
    expect(system).toContain("AC: 14");
    expect(system).toContain("HP: 31/31");
    expect(system).toContain("AC: 18");
  });

  test("system prompt includes narrative summary when present", () => {
    const gs = makeGameState({ narrativeSummary: "The party entered a dark cave." });
    const { system } = buildDMPrompt(gs, [], "test action");

    expect(system).toContain("## Story So Far");
    expect(system).toContain("The party entered a dark cave.");
  });

  test("system prompt omits narrative summary when empty", () => {
    const gs = makeGameState({ narrativeSummary: "" });
    const { system } = buildDMPrompt(gs, [], "test action");

    expect(system).not.toContain("## Story So Far");
  });

  test("system prompt includes combat state when active", () => {
    const gs = makeGameState({
      combat: {
        active: true,
        round: 2,
        turnIndex: 1,
        combatants: [
          {
            playerId: "human1",
            name: "Fūsetsu",
            hp: { max: 24, current: 20, temp: 0 },
            initiative: 18,
            conditions: [],
            deathSaves: { successes: 0, failures: 0 },
          },
          {
            playerId: "agent:grimbold",
            name: "Grimbold",
            hp: { max: 31, current: 31, temp: 0 },
            initiative: 12,
            conditions: ["prone"],
            deathSaves: { successes: 0, failures: 0 },
          },
        ],
      },
    });
    const { system } = buildDMPrompt(gs, [], "test action");

    expect(system).toContain("## Combat — Round 2");
    expect(system).toContain("Fūsetsu: 20/24 HP");
    expect(system).toContain(">> Grimbold");
    expect(system).toContain("[prone]");
  });

  test("combat omitted when not active", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).not.toContain("## Combat");
  });

  test("messages include recent history when present", () => {
    const gs = makeGameState();
    const history = makeHistory([
      { playerName: "Fūsetsu", content: "I sneak forward." },
      {
        playerId: "dm",
        playerName: "Dungeon Master",
        type: "dm-narration",
        content: "The corridor is dark.",
      },
    ]);
    const { messages } = buildDMPrompt(gs, history, "current action");

    expect(messages[0].content).toContain("## Recent History");
    expect(messages[0].content).toContain("[Fūsetsu] > I sneak forward.");
    expect(messages[0].content).toContain("[DM] The corridor is dark.");
    expect(messages[0].content).toContain("## Current Actions to Resolve");
    expect(messages[0].content).toContain("current action");
  });

  test("messages skip history section when no history", () => {
    const gs = makeGameState();
    const { messages } = buildDMPrompt(gs, [], "current action");

    expect(messages[0].content).not.toContain("## Recent History");
    expect(messages[0].content).toBe("current action");
  });

  test("history includes dice roll formatting", () => {
    const gs = makeGameState();
    const history = makeHistory([
      {
        type: "roll",
        playerName: "Fūsetsu",
        content: "",
        diceResults: [
          { notation: "d20+5", total: 18, rolls: [13], modifier: 5, label: "perception check" },
        ],
      },
    ]);
    const { messages } = buildDMPrompt(gs, history, "action");

    expect(messages[0].content).toContain("[ROLL] Fūsetsu: d20+5 = 18 (perception check)");
  });

  test("IC entries get > prefix in history", () => {
    const gs = makeGameState();
    const history = makeHistory([{ type: "ic", content: "I attack the goblin." }]);
    const { messages } = buildDMPrompt(gs, history, "action");

    expect(messages[0].content).toContain("> I attack the goblin.");
  });

  test("OOC entries do not get > prefix", () => {
    const gs = makeGameState();
    const history = makeHistory([{ type: "ooc", content: "How does flanking work?" }]);
    const { messages } = buildDMPrompt(gs, history, "action");

    expect(messages[0].content).toContain("[Fūsetsu] How does flanking work?");
    expect(messages[0].content).not.toContain("> How does flanking work?");
  });
});

describe("buildAskPrompt", () => {
  test("includes asker name when provided", () => {
    const prompt = buildAskPrompt("How does sneak attack work?", "Fūsetsu");

    expect(prompt).toContain("FROM Fūsetsu");
    expect(prompt).toContain("Address Fūsetsu");
    expect(prompt).toContain("How does sneak attack work?");
  });

  test("uses generic label when asker name is omitted", () => {
    const prompt = buildAskPrompt("How does sneak attack work?");

    expect(prompt).not.toContain("FROM ");
    expect(prompt).toContain("Address the player");
  });

  test("includes the question text", () => {
    const prompt = buildAskPrompt("Can I use cunning action to hide?", "Fūsetsu");

    expect(prompt).toContain("Can I use cunning action to hide?");
  });

  test("marks as out-of-character", () => {
    const prompt = buildAskPrompt("test?");

    expect(prompt).toContain("OUT-OF-CHARACTER QUESTION");
  });
});
