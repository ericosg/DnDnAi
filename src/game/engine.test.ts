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
  NARRATIVE_STYLE: "concise",
  STYLE_INSTRUCTIONS: {
    concise: { dm: "", agent: "" },
    standard: { dm: "", agent: "" },
    elaborate: { dm: "", agent: "" },
  },
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
}));

mock.module("../ai/guardrail.js", () => ({
  checkDMResponse: async () => ({ pass: true }),
  checkAgentResponse: async () => ({ pass: true }),
}));

const { processTurn, resumeOrchestrator, markResponded, clearRound } = await import("./engine.js");

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
const mockChannel = { send: async () => {} } as unknown;

beforeEach(() => {
  appendedHistory = [];
  savedStates = [];
  sentMessages = [];
  typingStarted = 0;
  typingStopped = 0;
  mockGameStateForLoad = null;
  dmNarrateResponse = "The party advances through the dungeon.";
  agentResponse = "> Grimbold grumbles and follows.";
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
