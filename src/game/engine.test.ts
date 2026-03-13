import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { GameState, Player, TurnEntry } from "../state/types.js";

// Track calls to mocked functions
let appendedHistory: TurnEntry[] = [];
let savedStates: GameState[] = [];

mock.module("../config.js", () => ({
  config: { discordToken: "test", anthropicApiKey: "test", guildId: "test" },
  models: { dm: "test-model", agent: "test-model", orchestrator: "test-model" },
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  AGENT_DELAY_MS: 0,
  DATA_DIR: "data/games",
  AGENTS_DIR: "agents",
}));

mock.module("../ai/claude.js", () => ({
  chat: async () => "mocked",
}));

// Mock external dependencies
mock.module("../state/store.js", () => ({
  appendHistory: async (_id: string, entry: TurnEntry) => {
    appendedHistory.push(entry);
  },
  loadHistory: async (_id: string) => appendedHistory,
  saveHistory: async () => {},
  saveGameState: async (gs: GameState) => {
    savedStates.push(gs);
  },
  createGameState: () => {},
  findGameByChannel: async () => null,
  saveCharacter: async () => {},
}));

let dmNarrateResponse = "The party advances through the dungeon.";
let agentResponse = "> Grimbold grumbles and follows.";

mock.module("../ai/dm.js", () => ({
  dmNarrate: async () => dmNarrateResponse,
  compressNarrative: async () => "Compressed narrative.",
  dmRecap: async () => "Previously on...",
  dmLook: async () => "You see a dark room.",
}));

mock.module("../ai/agent.js", () => ({
  loadAgentPersonality: async () => ({
    name: "Grimbold",
    race: "Dwarf",
    class: "Fighter",
    level: 3,
    description: "A grumpy dwarf",
    voice: "Gruff",
    traits: [],
    flaws: [],
    goals: [],
    characterSpec: "",
    rawContent: "## Personality\nGrumpy dwarf.",
    avatarUrl: null,
  }),
  generateAgentAction: async () => agentResponse,
  generateBackstory: async () => "A backstory.",
}));

// Mock Discord webhooks and formatter
let sentMessages: { name: string; content: string; embeds?: unknown[] }[] = [];

mock.module("../discord/webhooks.js", () => ({
  sendAsIdentity: async (
    _channel: unknown,
    name: string,
    content: string,
    options?: { embeds?: unknown[] },
  ) => {
    sentMessages.push({ name, content, embeds: options?.embeds });
  },
}));

mock.module("../discord/formatter.js", () => ({
  dmNarrationEmbed: (text: string) => ({ description: text, color: 0x7b2d8b }),
}));

const { processTurn, markResponded } = await import("./engine.js");

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
    },
    agentFile: "grimbold.md",
    joinedAt: new Date().toISOString(),
  };
}

function makeGameState(): GameState {
  return {
    id: "test-game",
    channelId: "ch1",
    guildId: "g1",
    status: "active",
    players: [makePlayer(), makeAgent()],
    combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

// Minimal mock channel with send method
const mockChannel = { send: async () => {} } as unknown;

beforeEach(() => {
  appendedHistory = [];
  savedStates = [];
  sentMessages = [];
  dmNarrateResponse = "The party advances through the dungeon.";
  agentResponse = "> Grimbold grumbles and follows.";
});

describe("engine — full round", () => {
  test("human action triggers agent then DM", async () => {
    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I sneak forward and check for traps.",
    };

    await processTurn(gs, entry, mockChannel as never);

    // Agent should have responded
    const agentEntries = appendedHistory.filter((e) => e.playerId === "agent:grimbold");
    expect(agentEntries.length).toBeGreaterThanOrEqual(1);

    // DM should have narrated
    const dmEntries = appendedHistory.filter((e) => e.playerId === "dm");
    expect(dmEntries.length).toBeGreaterThanOrEqual(1);

    // Webhook messages should have been sent
    const agentMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentMessages.length).toBeGreaterThanOrEqual(1);

    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    expect(dmMessages.length).toBeGreaterThanOrEqual(1);
  });

  test("DM dice directives are substituted", async () => {
    dmNarrateResponse =
      "Fusetsu searches carefully. [[ROLL:d20+5 FOR:Fusetsu REASON:perception check]] The trap springs!";

    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I check for traps.",
    };

    // Pre-mark agent as responded so we go straight to DM
    markResponded(gs.id, "agent:grimbold");

    await processTurn(gs, entry, mockChannel as never);

    // DM entry should have dice results
    const dmEntry = appendedHistory.find((e) => e.playerId === "dm");
    expect(dmEntry).toBeTruthy();
    expect(dmEntry?.diceResults?.length).toBeGreaterThanOrEqual(1);

    // The directive should have been replaced in the content
    expect(dmEntry?.content).not.toContain("[[ROLL:");
  });

  test("combat signal handling", async () => {
    dmNarrateResponse = "Enemies appear from the shadows! [[COMBAT:START]]";

    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I kick open the door.",
    };

    markResponded(gs.id, "agent:grimbold");
    await processTurn(gs, entry, mockChannel as never);

    // Combat should now be active
    expect(gs.combat.active).toBe(true);
    expect(gs.combat.combatants.length).toBe(2);
  });

  test("empty DM response is handled gracefully", async () => {
    dmNarrateResponse = "";

    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I wait.",
    };

    markResponded(gs.id, "agent:grimbold");

    // Should not throw
    await processTurn(gs, entry, mockChannel as never);

    // No DM entry should be recorded (guard caught it)
    const dmEntries = appendedHistory.filter((e) => e.playerId === "dm");
    expect(dmEntries).toHaveLength(0);
  });
});
