import { describe, expect, mock, test } from "bun:test";
import type { GameState, Player, TurnEntry } from "../state/types.js";

// Mock the claude module to avoid config/API dependency
mock.module("./claude.js", () => ({
  chat: async () => '{"action":"skip","reason":"mocked","isIC":false}',
}));

// Mock config to avoid env var requirement
mock.module("../config.js", () => ({
  config: {
    discordToken: "test",
    guildId: "test",
  },
  models: {
    dm: "test-model",
    agent: "test-model",
    orchestrator: "test-model",
  },
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  AGENT_DELAY_MS: 0,
  DATA_DIR: "data/games",
  AGENTS_DIR: "agents",
}));

// Import after mocks are set up
const { getNextAction } = await import("./orchestrator.js");

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "human1",
    name: "Human",
    isAgent: false,
    characterSheet: {
      name: "HumanChar",
      race: "Human",
      class: "Fighter",
      level: 1,
      background: "Soldier",
      alignment: "Neutral",
      abilityScores: {
        strength: 10,
        dexterity: 10,
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
      initiative: 0,
      speed: 30,
      equipment: [],
      features: [],
      backstory: "",
    },
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Player> = {}): Player {
  return makePlayer({
    id: "agent:grimbold",
    name: "Grimbold",
    isAgent: true,
    agentFile: "grimbold.md",
    ...overrides,
  });
}

function makeGameState(players: Player[]): GameState {
  return {
    id: "test",
    channelId: "ch1",
    guildId: "g1",
    status: "active",
    players,
    combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
    narrativeSummary: "",
    turnCount: 5,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

function makeEntry(overrides: Partial<TurnEntry> = {}): TurnEntry {
  return {
    id: 1,
    timestamp: new Date().toISOString(),
    playerId: "human1",
    playerName: "HumanChar",
    type: "ic",
    content: "I swing my sword",
    ...overrides,
  };
}

describe("getNextAction — exploration mode", () => {
  test("skips OOC messages", async () => {
    const gs = makeGameState([makePlayer()]);
    const entry = makeEntry({ type: "ooc", content: "brb" });
    const responded = new Set<string>();

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("skip");
    expect(decision.isIC).toBe(false);
  });

  test("prompts unresponded agent first", async () => {
    const human = makePlayer();
    const agent = makeAgent();
    const gs = makeGameState([human, agent]);
    const entry = makeEntry({ playerId: "human1" });
    const responded = new Set(["human1"]);

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("prompt_agent");
    expect(decision.targetPlayerId).toBe("agent:grimbold");
  });

  test("waits for human when agents all responded", async () => {
    const human = makePlayer();
    const agent = makeAgent();
    const gs = makeGameState([human, agent]);
    const entry = makeEntry({ playerId: "agent:grimbold" });
    const responded = new Set(["agent:grimbold"]);

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("wait_for_human");
    expect(decision.targetPlayerId).toBe("human1");
  });

  test("prompts DM when all players have acted", async () => {
    const human = makePlayer();
    const agent = makeAgent();
    const gs = makeGameState([human, agent]);
    const entry = makeEntry();
    const responded = new Set(["human1", "agent:grimbold"]);

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("prompt_dm");
  });

  test("agent prompting follows player order", async () => {
    const human = makePlayer();
    const agent1 = makeAgent({ id: "agent:a1", name: "Agent1" });
    const agent2 = makeAgent({ id: "agent:a2", name: "Agent2" });
    const gs = makeGameState([human, agent1, agent2]);
    const entry = makeEntry();
    const responded = new Set(["human1"]);

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("prompt_agent");
    expect(decision.targetPlayerId).toBe("agent:a1");
  });
});

describe("getNextAction — combat mode", () => {
  test("prompts agent on their combat turn", async () => {
    const human = makePlayer();
    const agent = makeAgent();
    const gs = makeGameState([human, agent]);
    gs.combat = {
      active: true,
      round: 1,
      turnIndex: 1,
      combatants: [
        {
          playerId: "human1",
          name: "HumanChar",
          initiative: 20,
          hp: { max: 20, current: 20, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
        {
          playerId: "agent:grimbold",
          name: "Grimbold",
          initiative: 15,
          hp: { max: 20, current: 20, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };
    const entry = makeEntry();
    const responded = new Set<string>();

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("prompt_agent");
    expect(decision.targetPlayerId).toBe("agent:grimbold");
  });

  test("waits for human on their combat turn", async () => {
    const human = makePlayer();
    const agent = makeAgent();
    const gs = makeGameState([human, agent]);
    gs.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          playerId: "human1",
          name: "HumanChar",
          initiative: 20,
          hp: { max: 20, current: 20, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
        {
          playerId: "agent:grimbold",
          name: "Grimbold",
          initiative: 15,
          hp: { max: 20, current: 20, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };
    const entry = makeEntry();
    const responded = new Set<string>();

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("wait_for_human");
  });

  test("prompts DM after current combatant has acted", async () => {
    const human = makePlayer();
    const gs = makeGameState([human]);
    gs.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          playerId: "human1",
          name: "HumanChar",
          initiative: 20,
          hp: { max: 20, current: 20, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };
    const entry = makeEntry();
    const responded = new Set(["human1"]);

    const decision = await getNextAction(gs, [entry], entry, responded);
    expect(decision.action).toBe("prompt_dm");
  });
});
