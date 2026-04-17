import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { GameState, Player, TurnEntry } from "../state/types.js";

// Track calls to mocked functions
let appendedHistory: TurnEntry[] = [];
let savedStates: GameState[] = [];
let mockGameStateForLoad: GameState | null = null;

mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test-model", agent: "test-model", orchestrator: "test-model" },
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  AGENT_DELAY_MS: 0,
  DATA_DIR: "data/games",
  AGENTS_DIR: "agents",
  AGENT_NOTES_DIR: "agent-notes",
  NARRATIVE_STYLE: "concise",
  STYLE_INSTRUCTIONS: {
    concise: { dm: "", agent: "" },
    standard: { dm: "", agent: "" },
    elaborate: { dm: "", agent: "" },
  },
}));

mock.module("../ai/claude.js", () => ({
  chat: async () => "mocked",
  chatAgentic: async () => "mocked",
}));

// Mock external dependencies
mock.module("../state/store.js", () => ({
  appendHistory: async (_id: string, entry: TurnEntry) => {
    appendedHistory.push(entry);
  },
  loadHistory: async (_id: string) => appendedHistory,
  loadGameState: async (_id: string) => mockGameStateForLoad,
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
let dmNarrateCalls: { actions: string; effort?: string }[] = [];

mock.module("../ai/dm.js", () => ({
  dmNarrate: async (
    _gs: unknown,
    _hist: unknown,
    actions: string,
    _askHistory?: unknown,
    effort?: string,
  ) => {
    dmNarrateCalls.push({ actions, effort });
    return dmNarrateResponse;
  },
  compressNarrative: async () => ({
    narrativeSummary: "Compressed narrative.",
    sceneState: {
      location: "Test location",
      timeOfDay: "Morning",
      presentNPCs: [],
      keyFacts: [],
    },
  }),
  dmRecap: async () => "Previously on...",
  dmLook: async () => "You see a dark room.",
  dmAsk: async () => "The DM answers.",
  loadCanonicalFacts: async () => null,
}));

let agentActionCalls: { effort?: string }[] = [];

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
  generateAgentAction: async (
    _p: unknown,
    _gs: unknown,
    _hist: unknown,
    _sit: unknown,
    effort?: string,
  ) => {
    agentActionCalls.push({ effort });
    return agentResponse;
  },
  generateBackstory: async () => "A backstory.",
}));

// Mock Discord webhooks and formatter
let sentMessages: { name: string; content: string; embeds?: unknown[] }[] = [];
let typingStarted = 0;
let typingStopped = 0;

mock.module("../discord/webhooks.js", () => ({
  sendAsIdentity: async (
    _channel: unknown,
    name: string,
    content: string,
    options?: { embeds?: unknown[] },
  ) => {
    sentMessages.push({ name, content, embeds: options?.embeds });
  },
  startTyping: (_channel: unknown) => {
    typingStarted++;
    return () => {
      typingStopped++;
    };
  },
}));

mock.module("../discord/formatter.js", () => ({
  formatDMNarration: (text: string) => `---\n${text}\n---`,
  combatStatusEmbed: () => ({ data: {} }),
  whisperEmbed: (from: string, to: string, msg: string) => ({
    data: { from, to, msg },
  }),
}));

let dmGuardrailResponses: { pass: boolean; violation?: string }[] = [];
let dmGuardrailCallIndex = 0;
let dmGuardrailCalls: { dmResponse: string; pcNames: string[]; statedActions?: string }[] = [];
let agentGuardrailResponses: { pass: boolean; violation?: string }[] = [];
let agentGuardrailCallIndex = 0;

mock.module("../ai/guardrail.js", () => ({
  checkDMResponse: async (dmResponse: string, pcNames: string[], statedActions?: string) => {
    dmGuardrailCalls.push({ dmResponse, pcNames, statedActions });
    if (dmGuardrailResponses.length > 0) {
      const response = dmGuardrailResponses[dmGuardrailCallIndex] ?? { pass: true };
      dmGuardrailCallIndex++;
      return response;
    }
    return { pass: true };
  },
  checkAgentResponse: async () => {
    if (agentGuardrailResponses.length > 0) {
      const response = agentGuardrailResponses[agentGuardrailCallIndex] ?? { pass: true };
      agentGuardrailCallIndex++;
      return response;
    }
    return { pass: true };
  },
}));

const {
  processTurn,
  resumeOrchestrator,
  markResponded,
  clearRound,
  getRoundStartTime,
  isToolMetaOnly,
} = await import("./engine.js");

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

// Minimal mock channel
let channelMessages: (string | { embeds?: unknown[] })[] = [];
const mockChannel = {
  send: async (msg: string | { embeds?: unknown[] }) => {
    channelMessages.push(msg);
  },
} as unknown;

beforeEach(() => {
  appendedHistory = [];
  savedStates = [];
  sentMessages = [];
  channelMessages = [];
  typingStarted = 0;
  typingStopped = 0;
  mockGameStateForLoad = null;
  dmNarrateResponse = "The party advances through the dungeon.";
  agentResponse = "> Grimbold grumbles and follows.";
  dmNarrateCalls = [];
  agentActionCalls = [];
  dmGuardrailResponses = [];
  dmGuardrailCallIndex = 0;
  dmGuardrailCalls = [];
  agentGuardrailResponses = [];
  agentGuardrailCallIndex = 0;
  clearRound("test-game");
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

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

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

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

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
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

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
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // No DM entry should be recorded (guard caught it)
    const dmEntries = appendedHistory.filter((e) => e.playerId === "dm");
    expect(dmEntries).toHaveLength(0);
  });

  test("DM failure preserves round so agents are not re-prompted on retry", async () => {
    // DM returns an invalid damage directive that will throw during processing
    dmNarrateResponse =
      "The stone burns! [[DAMAGE:abc TARGET:Grimbold Ironforge REASON:necrotic pulse]]";

    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I check for traps.",
    };

    markResponded(gs.id, "agent:grimbold");
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // DM failed — no DM message posted via webhook
    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    expect(dmMessages).toHaveLength(0);

    // Reset sent messages to track the retry
    sentMessages = [];

    // Resume the orchestrator — it should go straight to DM, NOT re-prompt agents
    // Fix DM response so retry succeeds
    dmNarrateResponse = "The party advances through the dungeon.";
    await resumeOrchestrator(gs.id, mockChannel as never);

    const agentRetries = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentRetries).toHaveLength(0);
  });
});

describe("engine — concurrency", () => {
  test("concurrent processTurn calls are serialized (no double agent responses)", async () => {
    const gs = makeGameState();
    // Add a second human so the first human's action doesn't immediately trigger DM
    gs.players.push(makePlayer({ id: "human2", name: "Human2" }));

    const entry1: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I move forward.",
    };
    const entry2: TurnEntry = {
      id: 2,
      timestamp: new Date().toISOString(),
      playerId: "human2",
      playerName: "Human2",
      type: "ic",
      content: "I follow behind.",
    };

    // Fire both concurrently — without the mutex, this would cause double agent responses
    mockGameStateForLoad = gs;
    await Promise.all([
      processTurn(gs.id, entry1, mockChannel as never),
      processTurn(gs.id, entry2, mockChannel as never),
    ]);

    // Agent should have responded exactly once
    const agentMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentMessages).toHaveLength(1);

    // DM should have narrated exactly once
    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    expect(dmMessages).toHaveLength(1);
  });

  test("sequential processTurn calls still work correctly", async () => {
    const gs = makeGameState();
    const entry1: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I move forward.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry1, mockChannel as never);

    const agentMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentMessages).toHaveLength(1);
    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    expect(dmMessages).toHaveLength(1);
  });
});

describe("engine — typing indicators", () => {
  test("typing started for agent and DM during full round", async () => {
    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I move forward.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Should have started typing for agent + DM
    expect(typingStarted).toBe(2);
  });

  test("typing stopped after responses", async () => {
    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I move forward.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // All typing indicators should be stopped
    expect(typingStopped).toBe(typingStarted);
  });

  test("typing started for DM-only turn", async () => {
    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I search the room.",
    };

    markResponded(gs.id, "agent:grimbold");
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Only DM typing
    expect(typingStarted).toBe(1);
    expect(typingStopped).toBe(1);
  });

  test("typing stopped even on empty DM response", async () => {
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
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    expect(typingStopped).toBe(typingStarted);
  });

  test("typing stopped after dice directive processing", async () => {
    dmNarrateResponse = "Fusetsu checks. [[ROLL:d20+5 FOR:Fusetsu REASON:perception check]] Done.";

    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I check for traps.",
    };

    markResponded(gs.id, "agent:grimbold");
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    expect(typingStarted).toBe(1);
    expect(typingStopped).toBe(1);
  });

  test("typing stopped after combat signal processing", async () => {
    dmNarrateResponse = "Enemies attack! [[COMBAT:START]]";

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
    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    expect(typingStopped).toBe(typingStarted);
  });

  test("no typing started when orchestrator waits for human", async () => {
    // Game with only humans, no agents — after one human acts,
    // orchestrator should wait for the other (no typing needed)
    const gs = makeGameState();
    gs.players = [
      makePlayer({ id: "human1", name: "Human1" }),
      makePlayer({ id: "human2", name: "Human2" }),
    ];
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I wait for my ally.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Orchestrator should wait for human2 — no AI calls, no typing
    expect(typingStarted).toBe(0);
  });

  test("damage directive applies damage to combatant HP", async () => {
    dmNarrateResponse =
      "The goblin strikes! [[DAMAGE:1d6+2 TARGET:Grimbold Ironforge REASON:scimitar hit]]";

    const gs = makeGameState();
    // Set up combat with combatants
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Damage was applied — HP should be reduced
    const grimbold = gs.combat.combatants.find((c) => c.name === "Grimbold Ironforge");
    expect(grimbold).toBeDefined();
    expect(grimbold?.hp.current).toBeLessThan(31);

    // Player sheet HP should also be synced
    const grimboldPlayer = gs.players.find((p) => p.id === "agent:grimbold");
    expect(grimboldPlayer?.characterSheet.hp.current).toBe(grimbold?.hp.current);

    // DM narration should contain the formatted result, not the raw directive
    const dmMessage = sentMessages.find((m) => m.name === "Dungeon Master");
    expect(dmMessage).toBeDefined();
    expect(dmMessage?.content).not.toContain("[[DAMAGE:");
    expect(dmMessage?.content).toContain("damage");
  });

  test("damage to non-PC target formats correctly without crashing", async () => {
    dmNarrateResponse =
      "The arrow flies true! [[DAMAGE:2d6+3 TARGET:Shadowstone Broodmother REASON:longbow hit]]";

    const gs = makeGameState();
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I fire my longbow at the Broodmother.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // No combatant HP should have changed (enemy not in combatants)
    expect(gs.combat.combatants[0].hp.current).toBe(24);
    expect(gs.combat.combatants[1].hp.current).toBe(31);

    // DM narration should still format the damage output (not raw directive)
    const dmMessage = sentMessages.find((m) => m.name === "Dungeon Master");
    expect(dmMessage).toBeDefined();
    expect(dmMessage?.content).not.toContain("[[DAMAGE:");
    expect(dmMessage?.content).toContain("damage");
    expect(dmMessage?.content).toContain("Shadowstone Broodmother");
  });

  test("heal directive restores HP", async () => {
    dmNarrateResponse = "Healing light! [[HEAL:1d8+3 TARGET:Fusetsu REASON:cure wounds]]";

    const gs = makeGameState();
    gs.players[0].characterSheet.hp.current = 10; // Damaged
    gs.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          playerId: "human1",
          name: "Fusetsu",
          initiative: 15,
          hp: { max: 24, current: 10, temp: 0 },
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I cast cure wounds.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    const fusetsu = gs.combat.combatants.find((c) => c.name === "Fusetsu");
    expect(fusetsu).toBeDefined();
    expect(fusetsu?.hp.current).toBeGreaterThan(10);
    expect(fusetsu?.hp.current).toBeLessThanOrEqual(24);
  });

  test("combat loop continues to prompt AI agent after DM resolves", async () => {
    // Set up combat where agent is next after DM resolves human's action
    const gs = makeGameState();
    gs.combat = {
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
    };

    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I swing my sword.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Agent should have been prompted and posted a message
    const agentMessage = sentMessages.find((m) => m.name === "Grimbold");
    expect(agentMessage).toBeDefined();

    // DM should have been called twice: once for human, once for agent
    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    expect(dmMessages.length).toBe(2);
  });

  test("resumeOrchestrator prompts agent when it is their turn", async () => {
    const gs = makeGameState();
    // Seed history (simulates restart with existing game)
    appendedHistory.push({
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "dm",
      playerName: "Dungeon Master",
      type: "dm-narration",
      content: "The party stands in the dungeon.",
    });
    // roundResponses is empty (simulates restart) — agent hasn't responded

    mockGameStateForLoad = gs;
    await resumeOrchestrator(gs.id, mockChannel as never);

    // Agent should have been prompted
    const agentMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentMessages).toHaveLength(1);
  });

  test("resumeOrchestrator prompts agent in combat when it is their turn", async () => {
    const gs = makeGameState();
    // Seed history
    appendedHistory.push({
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "dm",
      playerName: "Dungeon Master",
      type: "dm-narration",
      content: "Combat rages on.",
    });
    gs.combat = {
      active: true,
      round: 4,
      turnIndex: 1, // Agent's turn
      combatants: [
        {
          playerId: "human1",
          name: "Fusetsu",
          initiative: 25,
          hp: { max: 24, current: 24, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
        {
          playerId: "agent:grimbold",
          name: "Grimbold Ironforge",
          initiative: 6,
          hp: { max: 31, current: 31, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };

    mockGameStateForLoad = gs;
    await resumeOrchestrator(gs.id, mockChannel as never);

    // Agent should have been prompted
    const agentMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentMessages).toHaveLength(1);

    // DM should have resolved the agent's action
    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    expect(dmMessages.length).toBeGreaterThanOrEqual(1);
  });

  test("resumeOrchestrator does nothing when it is a human turn in combat", async () => {
    const gs = makeGameState();
    // Seed history
    appendedHistory.push({
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "dm",
      playerName: "Dungeon Master",
      type: "dm-narration",
      content: "Combat rages on.",
    });
    gs.combat = {
      active: true,
      round: 4,
      turnIndex: 0, // Human's turn
      combatants: [
        {
          playerId: "human1",
          name: "Fusetsu",
          initiative: 25,
          hp: { max: 24, current: 24, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
        {
          playerId: "agent:grimbold",
          name: "Grimbold Ironforge",
          initiative: 6,
          hp: { max: 31, current: 31, temp: 0 },
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };

    mockGameStateForLoad = gs;
    await resumeOrchestrator(gs.id, mockChannel as never);

    // No agent or DM messages — just waiting for human
    expect(sentMessages).toHaveLength(0);
  });

  test("typing count matches AI turns in multi-agent party", async () => {
    const gs = makeGameState();
    // Add a second agent
    gs.players.push({
      id: "agent:criella",
      name: "Criella",
      isAgent: true,
      characterSheet: {
        ...makeAgent().characterSheet,
        name: "Criella Arkalis",
      },
      agentFile: "criella.md",
      joinedAt: new Date().toISOString(),
    });

    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I move forward.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // 2 agents + 1 DM = 3 typing indicators
    expect(typingStarted).toBe(3);
    expect(typingStopped).toBe(3);
  });
});

describe("engine — next-player safety net", () => {
  test("appends next combatant when DM omits it", async () => {
    dmNarrateResponse = "The goblin snarls and retreats.";

    const gs = makeGameState();
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    const dmMessage = sentMessages.find((m) => m.name === "Dungeon Master");
    expect(dmMessage).toBeDefined();
    expect(dmMessage?.content).toContain("Next up:");
    expect(dmMessage?.content).toContain("Grimbold Ironforge");
  });

  test("does NOT append when DM already mentions next combatant", async () => {
    dmNarrateResponse = "The goblin retreats. Grimbold Ironforge, you're up!";

    const gs = makeGameState();
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    const dmMessage = sentMessages.find((m) => m.name === "Dungeon Master");
    expect(dmMessage).toBeDefined();
    // Should NOT have the engine-appended "Next up:" since DM already mentioned the name
    const content = dmMessage?.content ?? "";
    const nextUpCount = (content.match(/Next up:/g) || []).length;
    expect(nextUpCount).toBe(0);
  });

  test("does NOT append in non-combat mode", async () => {
    dmNarrateResponse = "The party rests by the fire.";

    const gs = makeGameState();
    // combat is inactive by default

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I rest.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    const dmMessage = sentMessages.find((m) => m.name === "Dungeon Master");
    expect(dmMessage?.content).not.toContain("Next up:");
  });
});

describe("engine — auto status embed", () => {
  test("sends combat status embed after HP changes", async () => {
    dmNarrateResponse =
      "The goblin strikes! [[DAMAGE:1d6+2 TARGET:Grimbold Ironforge REASON:scimitar hit]]";

    const gs = makeGameState();
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack.",
    };

    // Track channel.send calls for embeds
    let embedsSent = 0;
    const channelWithEmbeds = {
      send: async (msg: unknown) => {
        if (typeof msg === "object" && msg !== null && "embeds" in msg) {
          embedsSent++;
        }
      },
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, channelWithEmbeds as never);

    // Should have sent at least one embed for the status
    expect(embedsSent).toBeGreaterThanOrEqual(1);
  });
});

describe("engine — resource reconciliation", () => {
  test("appends resource summary after spell use", async () => {
    dmNarrateResponse =
      "A healing spell! [[HEAL:1d8+3 TARGET:Fusetsu REASON:cure wounds]] [[SPELL:1 TARGET:Grimbold Ironforge]]";

    const gs = makeGameState();
    gs.players[1].characterSheet.spellSlots = [{ level: 1, max: 2, current: 2 }];
    gs.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          playerId: "human1",
          name: "Fusetsu",
          initiative: 15,
          hp: { max: 24, current: 10, temp: 0 },
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I cast cure wounds.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Check that a system entry with resource summary was appended
    const resourceEntries = appendedHistory.filter(
      (e) => e.type === "system" && e.content.includes("Resources"),
    );
    expect(resourceEntries.length).toBeGreaterThanOrEqual(1);
  });
});

describe("engine — pending rolls", () => {
  test("REQUEST_ROLL creates pending rolls on game state", async () => {
    dmNarrateResponse =
      "Roll for perception! [[REQUEST_ROLL:d20+5 FOR:Fusetsu REASON:Perception check]]";

    const gs = makeGameState();
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I look around.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Should have pending rolls
    expect(gs.pendingRolls).toBeDefined();
    expect(gs.pendingRolls?.length).toBe(1);
    expect(gs.pendingRolls?.[0].notation).toBe("d20+5");
    expect(gs.pendingRolls?.[0].reason).toBe("Perception check");
    expect(gs.pendingRolls?.[0].playerId).toBe("human1");
  });

  test("DM narration shows roll prompt for pending rolls", async () => {
    dmNarrateResponse = "Make a check! [[REQUEST_ROLL:d20+5 FOR:Fusetsu REASON:Perception check]]";

    const gs = makeGameState();
    gs.combat = {
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
    };

    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I check for traps.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    const dmMessage = sentMessages.find((m) => m.name === "Dungeon Master");
    expect(dmMessage).toBeDefined();
    // Should show /roll prompt, not raw directive
    expect(dmMessage?.content).not.toContain("[[REQUEST_ROLL:");
    expect(dmMessage?.content).toContain("/roll d20+5");
  });
});

describe("engine — guardrail re-generation feedback", () => {
  test("re-generation feedback instructs DM to preserve directives", async () => {
    // First guardrail call fails, second passes
    dmGuardrailResponses = [
      { pass: false, violation: "DM narrated PC's jaw tightening" },
      { pass: true },
    ];

    const gs = makeGameState();
    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // dmNarrate should have been called twice (original + re-gen)
    expect(dmNarrateCalls.length).toBeGreaterThanOrEqual(2);

    // The second call's actions param should contain directive preservation instruction
    const regenCall = dmNarrateCalls[1];
    expect(regenCall.actions).toContain("[[REQUEST_ROLL:");
    expect(regenCall.actions).toContain("[[ROLL:");
    expect(regenCall.actions).toContain("[[DAMAGE:");
    expect(regenCall.actions).toContain("[[HEAL:");
    expect(regenCall.actions).toContain("Do not drop game mechanics");
  });

  test("DM re-generation escalates effort to high", async () => {
    dmGuardrailResponses = [{ pass: false, violation: "DM narrated PC action" }, { pass: true }];

    const gs = makeGameState();
    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    expect(dmNarrateCalls.length).toBeGreaterThanOrEqual(2);
    // First call: no effort override
    expect(dmNarrateCalls[0].effort).toBeUndefined();
    // Re-gen call: effort escalated to high
    expect(dmNarrateCalls[1].effort).toBe("high");
  });

  test("agent re-generation escalates effort to medium", async () => {
    agentGuardrailResponses = [
      { pass: false, violation: "Agent invented a hidden door" },
      { pass: true },
    ];

    const gs = makeGameState();
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I look around.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Agent should have been called twice (original + re-gen)
    expect(agentActionCalls.length).toBeGreaterThanOrEqual(2);
    // First call: default low effort (undefined means the function default applies)
    expect(agentActionCalls[0].effort).toBeUndefined();
    // Re-gen call: effort escalated to medium
    expect(agentActionCalls[1].effort).toBe("medium");
  });
});

describe("engine — isToolMetaOnly", () => {
  test("detects short tool meta-commentary", () => {
    expect(isToolMetaOnly("Updated dm-notes.")).toBe(true);
    expect(isToolMetaOnly("Updated dm-notes with merchant transaction.")).toBe(true);
    expect(isToolMetaOnly("Checked the character sheet.")).toBe(true);
    expect(isToolMetaOnly("Read the history file.")).toBe(true);
    expect(isToolMetaOnly("Noted the plot development.")).toBe(true);
    expect(isToolMetaOnly("Wrote session log entry.")).toBe(true);
  });

  test("passes real narration through", () => {
    expect(
      isToolMetaOnly(
        '*The merchant slides a leather pouch across the counter.* "Fifty gold, as promised."',
      ),
    ).toBe(false);
    expect(
      isToolMetaOnly("The dragon roars! [[DAMAGE:3d6 TARGET:Grimbold REASON:fire breath]]"),
    ).toBe(false);
    expect(isToolMetaOnly('> "You dare enter my domain?" the lich hisses.')).toBe(false);
  });

  test("passes long responses even with meta words", () => {
    const longResponse =
      "The party updated their plans and checked the map. " +
      "Grimbold noted the strange markings on the wall while Nyx read the ancient inscriptions. " +
      "The cave trembled as something massive stirred in the depths below.";
    expect(isToolMetaOnly(longResponse)).toBe(false);
  });

  test("passes responses with narrative markers even if short", () => {
    expect(isToolMetaOnly("*Updated the scene.*")).toBe(false);
    expect(isToolMetaOnly("[[ROLL:d20+5 FOR:Fusetsu REASON:check]]")).toBe(false);
    expect(isToolMetaOnly('> "Noted," she whispered.')).toBe(false);
  });

  test("passes empty and whitespace responses (handled by empty check)", () => {
    expect(isToolMetaOnly("")).toBe(false);
    expect(isToolMetaOnly("   ")).toBe(false);
  });

  test("passes normal short responses without meta patterns", () => {
    expect(isToolMetaOnly("The door creaks open.")).toBe(false);
    expect(isToolMetaOnly("Nothing happens.")).toBe(false);
  });
});

describe("engine — narration guardrail retry", () => {
  test("retries DM call when response is tool meta-commentary", async () => {
    const origResponse = dmNarrateResponse;
    // Set response to tool meta-commentary — triggers narration guardrail retry
    dmNarrateResponse = "Updated dm-notes.";

    const gs = makeGameState();
    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I search the room.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Should have retried (at least 2 calls)
    expect(dmNarrateCalls.length).toBeGreaterThanOrEqual(2);
    // Retry call should contain narration feedback
    const retryCall = dmNarrateCalls[1];
    expect(retryCall.actions).toContain("meta-commentary");
    expect(retryCall.actions).toContain("immersive prose narration");
    expect(retryCall.effort).toBe("high");

    dmNarrateResponse = origResponse;
  });

  test("posts retry response even if it is also meta-commentary (no infinite loop)", async () => {
    const origResponse = dmNarrateResponse;
    // Mock always returns meta-commentary — retry should still post (no infinite retry)
    dmNarrateResponse = "Checked the notes.";

    const gs = makeGameState();
    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I look around.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Should have retried exactly once (2 calls total), not looped
    expect(dmNarrateCalls.length).toBe(2);
    // Response should still be posted to Discord (sentMessages includes it)
    expect(sentMessages.length).toBeGreaterThan(0);

    dmNarrateResponse = origResponse;
  });
});

describe("engine — long rest triggers compression", () => {
  test("compression runs after long rest updates sceneState", async () => {
    const origResponse = dmNarrateResponse;
    // DM narration includes a long rest directive
    dmNarrateResponse =
      "The party settles in for the night. [[REST:long TARGET:party]] Dawn breaks over Thornwall.";

    const gs = makeGameState();
    gs.turnCount = 3; // NOT on a compression boundary (3 % 6 !== 0)
    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "We rest for the night.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // Long rest should have triggered compression — sceneState should be updated
    expect(gs.sceneState).toBeDefined();
    expect(gs.sceneState?.timeOfDay).toBe("Morning");
    expect(gs.narrativeSummary).toBe("Compressed narrative.");

    dmNarrateResponse = origResponse;
  });

  test("no double compression when long rest lands on compression boundary", async () => {
    const origResponse = dmNarrateResponse;
    dmNarrateResponse = "Rest time. [[REST:long TARGET:party]] Morning.";

    const gs = makeGameState();
    gs.turnCount = 5; // After increment becomes 6, which IS a compression boundary
    markResponded(gs.id, "agent:grimbold");
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "We rest.",
    };

    mockGameStateForLoad = gs;
    await processTurn(gs.id, entry, mockChannel as never);

    // sceneState should still be updated (from the boundary compression)
    expect(gs.sceneState).toBeDefined();
    // But compression should NOT have run twice — the flag prevents it

    dmNarrateResponse = origResponse;
  });
});

describe("engine — stale entry detection", () => {
  test("stale entry is recorded but does not count as round action", async () => {
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    // Simulate: round clears, then a stale message arrives with an old timestamp
    clearRound(gs.id);

    // Wait a tiny bit so the round start time is strictly after the entry timestamp
    const staleTimestamp = new Date(Date.now() - 5000).toISOString();

    const staleEntry: TurnEntry = {
      id: 1,
      timestamp: staleTimestamp,
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I catch the dagger",
    };

    await processTurn(gs.id, staleEntry, mockChannel as never);

    // Entry should be recorded in history
    expect(appendedHistory.length).toBe(1);
    expect(appendedHistory[0].content).toBe("I catch the dagger");

    // But orchestrator should NOT have run (no DM/agent calls)
    expect(dmNarrateCalls.length).toBe(0);
    expect(agentActionCalls.length).toBe(0);
    expect(sentMessages.length).toBe(0);
  });

  test("fresh entry in same round counts normally", async () => {
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    clearRound(gs.id);

    const freshEntry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I sneak forward",
    };

    await processTurn(gs.id, freshEntry, mockChannel as never);

    // Entry recorded in history
    expect(appendedHistory.length).toBeGreaterThanOrEqual(1);

    // Orchestrator should have run (agent + DM)
    expect(agentActionCalls.length).toBeGreaterThanOrEqual(1);
    expect(dmNarrateCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("clearRound updates round start time", () => {
    const before = new Date().toISOString();
    clearRound("test-game");
    const roundStart = getRoundStartTime("test-game");
    expect(roundStart >= before).toBe(true);
  });

  test("getRoundStartTime returns epoch for unknown game", () => {
    const start = getRoundStartTime("nonexistent-game");
    expect(start).toBe(new Date(0).toISOString());
  });
});

describe("engine — player @mention notifications", () => {
  test("orchestrator pings human player when waiting for their turn", async () => {
    // Set up a game with 2 humans + 1 agent where one human has already acted
    const gs = makeGameState();
    const human2 = makePlayer({ id: "human2", name: "Pastos" });
    human2.characterSheet.name = "Hierophantis";
    gs.players.push(human2);
    mockGameStateForLoad = gs;

    clearRound(gs.id);
    // Human1 acts — triggers agent then DM. After DM, round clears.
    // Then human2 acts in new round — triggers agent, but orchestrator waits for human1.
    // However in this test, we can just simulate: human2 acts, agent responds, then wait for human1.

    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human2",
      playerName: "Hierophantis",
      type: "ic",
      content: "I draw my blade",
    };
    await processTurn(gs.id, entry, mockChannel as never);

    // The orchestrator should have pinged human1 (Fusetsu) since they haven't acted
    const mentions = channelMessages.filter(
      (m) => typeof m === "string" && m.includes("<@human1>"),
    );
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    expect(mentions[0]).toContain("what do you do?");
  });

  test("combat mention says 'it's your turn'", async () => {
    // Set up combat where human acts, agent prompted, DM resolves, then turn
    // advances to human again — should ping on the next wait_for_human
    const gs = makeGameState();
    gs.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          playerId: "human1",
          name: "Fusetsu",
          hp: { max: 24, current: 24, temp: 0 },
          initiative: 18,
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
        {
          playerId: "agent:grimbold",
          name: "Grimbold Ironforge",
          hp: { max: 31, current: 31, temp: 0 },
          initiative: 12,
          conditions: [],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };
    mockGameStateForLoad = gs;

    clearRound(gs.id);

    // Human acts in combat — DM resolves human turn, advances to agent,
    // agent acts, DM resolves agent turn, advances back to human → ping
    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I attack the goblin",
    };
    await processTurn(gs.id, entry, mockChannel as never);

    const mentions = channelMessages.filter(
      (m) => typeof m === "string" && m.includes("<@human1>"),
    );
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    // In combat, the message should say "it's your turn"
    const combatMention = mentions.find((m) => typeof m === "string" && m.includes("your turn"));
    expect(combatMention).toBeDefined();
  });

  test("pending roll mention includes dice notation", async () => {
    const gs = makeGameState();
    // DM response creates pending rolls via directive processing
    dmNarrateResponse =
      "The goblin lunges! [[REQUEST_ROLL:d20+5 FOR:Fusetsu REASON:Dexterity saving throw]]";
    mockGameStateForLoad = gs;

    clearRound(gs.id);

    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I dodge",
    };
    await processTurn(gs.id, entry, mockChannel as never);

    // Should have a pending roll mention
    const rollMentions = channelMessages.filter(
      (m) => typeof m === "string" && m.includes("<@human1>") && m.includes("/roll"),
    );
    expect(rollMentions.length).toBeGreaterThanOrEqual(1);
    expect(rollMentions[0]).toContain("d20+5");
    expect(rollMentions[0]).toContain("Dexterity saving throw");
  });
});

describe("engine — guardrail receives all PC names", () => {
  test("DM guardrail receives both human and agent character names", async () => {
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    clearRound(gs.id);

    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I sneak forward",
    };
    await processTurn(gs.id, entry, mockChannel as never);

    // The guardrail should have been called with ALL PC names
    expect(dmGuardrailCalls.length).toBeGreaterThanOrEqual(1);
    const pcNames = dmGuardrailCalls[0].pcNames;
    expect(pcNames).toContain("Fusetsu"); // human
    expect(pcNames).toContain("Grimbold Ironforge"); // agent
  });
});

describe("engine — stale entry edge cases", () => {
  test("stale entry does NOT increment turnCount", async () => {
    const gs = makeGameState();
    gs.turnCount = 10;
    mockGameStateForLoad = gs;

    clearRound(gs.id);

    const staleEntry: TurnEntry = {
      id: 1,
      timestamp: new Date(Date.now() - 5000).toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "stale action",
    };
    await processTurn(gs.id, staleEntry, mockChannel as never);

    // turnCount should NOT have changed
    expect(gs.turnCount).toBe(10);
  });

  test("entry with timestamp equal to round start is NOT stale", async () => {
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    // Set round start to a known time
    clearRound(gs.id);
    const roundStart = getRoundStartTime(gs.id);

    const entry: TurnEntry = {
      id: 1,
      timestamp: roundStart, // exactly equal
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I act at the boundary",
    };
    await processTurn(gs.id, entry, mockChannel as never);

    // Should have triggered the orchestrator (agent + DM calls)
    expect(agentActionCalls.length).toBeGreaterThanOrEqual(1);
    expect(dmNarrateCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("engine — agent action directives (PASS, ASK, LOOK, WHISPER)", () => {
  test("agent [[PASS]] posts the holds-action placeholder", async () => {
    agentResponse = "[[PASS]]";
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    const entry: TurnEntry = {
      id: 1,
      timestamp: new Date().toISOString(),
      playerId: "human1",
      playerName: "Fusetsu",
      type: "ic",
      content: "I wait.",
    };
    await processTurn(gs.id, entry, mockChannel as never);

    // Agent webhook posted the placeholder (NOT the raw "[[PASS]]")
    const grimboldMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(grimboldMessages.length).toBe(1);
    expect(grimboldMessages[0].content).toContain("holds their action");
    expect(grimboldMessages[0].content).not.toContain("[[PASS]]");

    // The recorded history entry for the agent uses the passed placeholder
    const agentEntries = appendedHistory.filter((e) => e.playerId === "agent:grimbold");
    expect(agentEntries.length).toBeGreaterThanOrEqual(1);
    expect(agentEntries[0].content).not.toContain("[[PASS]]");
  });

  test("agent [[PASS]] with surrounding IC keeps the IC flavor only", async () => {
    agentResponse = "*Grimbold keeps watch.* [[PASS]]";
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    await processTurn(
      gs.id,
      {
        id: 1,
        timestamp: new Date().toISOString(),
        playerId: "human1",
        playerName: "Fusetsu",
        type: "ic",
        content: "I wait.",
      },
      mockChannel as never,
    );

    const agentMsg = sentMessages.find((m) => m.name === "Grimbold");
    expect(agentMsg?.content).toBe("*Grimbold keeps watch.*");
  });

  test("agent [[ASK:...]] posts DM answer and records system history entry", async () => {
    agentResponse = "I pause to think. [[ASK:can I use Second Wind right now?]]";
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    await processTurn(
      gs.id,
      {
        id: 1,
        timestamp: new Date().toISOString(),
        playerId: "human1",
        playerName: "Fusetsu",
        type: "ic",
        content: "I wait.",
      },
      mockChannel as never,
    );

    // IC text stripped of directive
    const agentMsg = sentMessages.find((m) => m.name === "Grimbold");
    expect(agentMsg?.content).toBe("I pause to think.");

    // DM webhook posted an OOC answer
    const dmMessages = sentMessages.filter((m) => m.name === "Dungeon Master");
    const askAnswer = dmMessages.find((m) => m.content.includes("OOC —"));
    expect(askAnswer).toBeTruthy();
    expect(askAnswer?.content).toContain("can I use Second Wind");
    expect(askAnswer?.content).toContain("The DM answers.");

    // System history captures the exchange
    const sysEntry = appendedHistory.find(
      (e) => e.type === "system" && e.content.includes("/ask from"),
    );
    expect(sysEntry).toBeTruthy();
  });

  test("agent [[LOOK:target]] posts DM description as narration", async () => {
    agentResponse = "[[LOOK:the stone altar]]";
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    await processTurn(
      gs.id,
      {
        id: 1,
        timestamp: new Date().toISOString(),
        playerId: "human1",
        playerName: "Fusetsu",
        type: "ic",
        content: "I wait.",
      },
      mockChannel as never,
    );

    // Agent had no residual IC content, so no agent message posted (no PASS fallback)
    const agentMessages = sentMessages.filter((m) => m.name === "Grimbold");
    expect(agentMessages.length).toBe(0);

    // DM description posted
    const lookMsg = sentMessages.find(
      (m) => m.name === "Dungeon Master" && m.content.includes("dark room"),
    );
    expect(lookMsg).toBeTruthy();

    // System history captures the look
    const sysEntry = appendedHistory.find(
      (e) => e.type === "system" && e.content.includes("/look from"),
    );
    expect(sysEntry).toBeTruthy();
    expect(sysEntry?.content).toContain("stone altar");
  });

  test("agent [[WHISPER:]] to human target records whisper entry with whisperTo", async () => {
    agentResponse = "[[WHISPER:Fusetsu TEXT:hold position, I'll flank left]]";
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    // channel.client.users.fetch is not on mockChannel — the handler catches the
    // failure and still writes history (best-effort Discord delivery).
    await processTurn(
      gs.id,
      {
        id: 1,
        timestamp: new Date().toISOString(),
        playerId: "human1",
        playerName: "Fusetsu",
        type: "ic",
        content: "I wait.",
      },
      mockChannel as never,
    );

    const whisperEntry = appendedHistory.find((e) => e.type === "whisper");
    expect(whisperEntry).toBeTruthy();
    expect(whisperEntry?.playerId).toBe("agent:grimbold");
    expect(whisperEntry?.content).toBe("hold position, I'll flank left");
    expect(whisperEntry?.whisperTo).toBe("human1");
  });

  test("agent with plain IC response (no directives) still posts IC", async () => {
    agentResponse = "I draw my warhammer and step forward.";
    const gs = makeGameState();
    mockGameStateForLoad = gs;

    await processTurn(
      gs.id,
      {
        id: 1,
        timestamp: new Date().toISOString(),
        playerId: "human1",
        playerName: "Fusetsu",
        type: "ic",
        content: "I wait.",
      },
      mockChannel as never,
    );

    const agentMsg = sentMessages.find((m) => m.name === "Grimbold");
    expect(agentMsg?.content).toBe("I draw my warhammer and step forward.");

    // No whisper or ask history entries
    expect(appendedHistory.filter((e) => e.type === "whisper")).toHaveLength(0);
    expect(
      appendedHistory.filter((e) => e.type === "system" && e.content.includes("/ask from")),
    ).toHaveLength(0);
  });
});
