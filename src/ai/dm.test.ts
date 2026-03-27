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

const {
  buildDMPrompt,
  buildAskPrompt,
  buildPausePrompt,
  buildResumePrompt,
  DM_IDENTITY,
  DM_ALLOWED_TOOLS,
} = await import("./dm-prompt.js");

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

  test("contains critical directive selection rules", () => {
    expect(DM_IDENTITY).toContain("ROLL NEVER changes HP");
    expect(DM_IDENTITY).toContain("WRONG vs CORRECT");
    expect(DM_IDENTITY).toContain("DAMAGE");
    expect(DM_IDENTITY).toContain("HEAL");
  });

  test("contains XP directive instructions", () => {
    expect(DM_IDENTITY).toContain("[[XP:");
    expect(DM_IDENTITY).toContain("TARGET:party");
  });

  test("contains SPELL/USE/CONCENTRATE/CONDITION directive instructions", () => {
    expect(DM_IDENTITY).toContain("[[SPELL:");
    expect(DM_IDENTITY).toContain("[[USE:");
    expect(DM_IDENTITY).toContain("[[CONCENTRATE:");
    expect(DM_IDENTITY).toContain("[[CONDITION:");
  });

  test("contains combat signal instructions", () => {
    expect(DM_IDENTITY).toContain("[[COMBAT:START]]");
    expect(DM_IDENTITY).toContain("[[COMBAT:END]]");
  });

  test("instructs DM to check Character Reference before making claims", () => {
    expect(DM_IDENTITY).toContain("Character Reference section");
    expect(DM_IDENTITY).toContain("if it's not listed, they don't have it");
  });

  test("instructs DM to use correct pronouns", () => {
    expect(DM_IDENTITY).toContain("gender");
    expect(DM_IDENTITY).toContain("they/them");
  });

  test("instructs DM about data access and SRD", () => {
    expect(DM_IDENTITY).toContain("docs/srd/");
    expect(DM_IDENTITY).toContain("look it up");
  });

  test("instructs DM about persistent notes", () => {
    expect(DM_IDENTITY).toContain("DM Notes");
    expect(DM_IDENTITY).toContain("dm-notes/");
    expect(DM_IDENTITY).toContain("world.md");
    expect(DM_IDENTITY).toContain("plot.md");
  });
});

describe("DM_ALLOWED_TOOLS", () => {
  test("includes read-only tools", () => {
    expect(DM_ALLOWED_TOOLS).toContain("Read");
    expect(DM_ALLOWED_TOOLS).toContain("Glob");
    expect(DM_ALLOWED_TOOLS).toContain("Grep");
  });

  test("includes write tools for DM notes", () => {
    expect(DM_ALLOWED_TOOLS).toContain("Write");
    expect(DM_ALLOWED_TOOLS).toContain("Edit");
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
    expect(system).toContain("**CURRENT TURN: Grimbold**");
    expect(system).toContain("Fūsetsu: 20/24 HP");
    expect(system).toContain(">> Grimbold");
    expect(system).toContain("[prone]");
    // Next up should wrap to Fūsetsu (first living combatant after Grimbold)
    expect(system).toContain("Next up: Fūsetsu");
  });

  test("combat omitted when not active", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).not.toContain("## Combat");
  });

  test("system prompt includes pending rolls when present", () => {
    const gs = makeGameState({
      pendingRolls: [
        {
          id: "roll-1",
          playerId: "human1",
          playerName: "Fūsetsu",
          notation: "d20+5",
          reason: "Perception check",
        },
      ],
    });
    const { system } = buildDMPrompt(gs, [], "test");
    expect(system).toContain("## Waiting for Dice Rolls");
    expect(system).toContain("Fūsetsu");
    expect(system).toContain("d20+5");
    expect(system).toContain("Perception check");
  });

  test("pending rolls omitted when all fulfilled", () => {
    const gs = makeGameState({
      pendingRolls: [
        {
          id: "roll-1",
          playerId: "human1",
          playerName: "Fūsetsu",
          notation: "d20+5",
          reason: "Perception check",
          result: { notation: "d20+5", rolls: [15], modifier: 5, total: 20 },
        },
      ],
    });
    const { system } = buildDMPrompt(gs, [], "test");
    expect(system).not.toContain("## Waiting for Dice Rolls");
  });

  test("system prompt includes character reference with mechanical details", () => {
    const gs = makeGameState();
    // Add features and spells to verify they appear
    gs.players[0].characterSheet.features = ["Sneak Attack", "Cunning Action"];
    gs.players[0].characterSheet.skills = ["Stealth", "Perception"];
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("## Character Reference");
    expect(system).toContain("### Fūsetsu");
    expect(system).toContain("DEX 16(+3)");
    expect(system).toContain("Features: Sneak Attack, Cunning Action");
    expect(system).toContain("Skills: Stealth, Perception");
    expect(system).toContain("### Grimbold Ironforge");
    expect(system).toContain("STR 16(+3)");
  });

  test("character reference includes XP when present", () => {
    const gs = makeGameState();
    gs.players[0].characterSheet.experiencePoints = 450;
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("XP: 450/2700");
  });

  test("character reference omits XP when not set", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    // The character reference lines shouldn't contain XP stats
    expect(system).not.toContain("XP: 0/");
    expect(system).not.toContain("| XP:");
  });

  test("character reference includes spell slots when present", () => {
    const gs = makeGameState();
    gs.players[0].characterSheet.spellSlots = [{ level: 1, max: 4, current: 2 }];
    const { system } = buildDMPrompt(gs, [], "test");
    expect(system).toContain("Slots: 1st: 2/4");
  });

  test("character reference includes feature charges when present", () => {
    const gs = makeGameState();
    gs.players[1].characterSheet.featureCharges = [
      { name: "Action Surge", max: 1, current: 1, resetsOn: "short" },
    ];
    const { system } = buildDMPrompt(gs, [], "test");
    expect(system).toContain("Charges: Action Surge: 1/1");
  });

  test("character reference includes saving throw modifiers", () => {
    const gs = makeGameState();
    gs.players[0].characterSheet.savingThrows = ["Dexterity", "Intelligence"];
    const { system } = buildDMPrompt(gs, [], "test");
    // DEX 16 (+3) + prof 2 = +5*
    expect(system).toContain("DEX +5*");
    // STR 8 (-1), not proficient
    expect(system).toContain("STR -1");
  });

  test("character reference includes gender when present", () => {
    const gs = makeGameState();
    gs.players[0].characterSheet.gender = "Male";
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("Male");
  });

  test("character reference includes spells when present", () => {
    const gs = makeGameState();
    gs.players[1].characterSheet.spells = ["Sacred Flame", "Healing Word"];
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("Spells: Sacred Flame, Healing Word");
  });

  test("system prompt includes file paths with game-specific data dir", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("## File Paths");
    expect(system).toContain("data/games/test-game/history.json");
    expect(system).toContain("data/games/test-game/state.json");
    expect(system).toContain("data/games/test-game/dm-notes/");
  });

  test("file paths include SRD references", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("docs/srd/README.md");
    expect(system).toContain("docs/srd/02 classes.md");
    expect(system).toContain("docs/srd/08 spellcasting.md");
    expect(system).toContain("docs/srd/07 combat.md");
  });

  test("file paths include character sheet paths", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("data/games/test-game/characters/fūsetsu.json");
    expect(system).toContain("data/games/test-game/characters/grimbold-ironforge.json");
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

  test("instructs DM to verify character data before answering", () => {
    const prompt = buildAskPrompt("What can I do?", "Fūsetsu");

    expect(prompt).toContain("Read the character's JSON file");
    expect(prompt).toContain("never assume features from higher levels");
  });

  test("instructs DM to check rules and history when relevant", () => {
    const prompt = buildAskPrompt("How does grappling work?", "Fūsetsu");

    expect(prompt).toContain("docs/srd/");
    expect(prompt).toContain("history.json");
  });

  test("instructs DM to log rulings after answering", () => {
    const prompt = buildAskPrompt("Can I sneak attack with a thrown dagger?", "Fūsetsu");

    expect(prompt).toContain("rulings.md");
    expect(prompt).toContain("AFTER answering");
  });

  test("includes ACT NOW instruction", () => {
    const prompt = buildAskPrompt("Can you fix my HP?", "Fūsetsu");

    expect(prompt).toContain("ACT NOW");
    expect(prompt).toContain("do it NOW");
    expect(prompt).toContain("those promises are lost");
  });

  test("includes priorAsks when provided", () => {
    const prior = "## Recent /ask Exchanges\n- **Fūsetsu** asked: How many slots?";
    const prompt = buildAskPrompt("Another question?", "Fūsetsu", prior);

    expect(prompt).toContain("## Recent /ask Exchanges");
    expect(prompt).toContain("How many slots?");
    // priorAsks should appear before the question
    const priorIdx = prompt.indexOf("Recent /ask");
    const questionIdx = prompt.indexOf("Another question?");
    expect(priorIdx).toBeLessThan(questionIdx);
  });

  test("omits priorAsks when null", () => {
    const prompt = buildAskPrompt("Question?", "Fūsetsu", null);

    expect(prompt).not.toContain("Recent /ask Exchanges");
    expect(prompt).toContain("Question?");
  });
});

describe("buildDMPrompt — new features", () => {
  test("includes ask history when provided", () => {
    const gs = makeGameState();
    const askHistory = "## Recent /ask Exchanges\n- **Fūsetsu** asked: Can I sneak attack?";
    const { system } = buildDMPrompt(gs, [], "test", askHistory);

    expect(system).toContain("## Recent /ask Exchanges");
    expect(system).toContain("Can I sneak attack?");
  });

  test("omits ask history when null", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test", null);

    expect(system).not.toContain("Recent /ask Exchanges");
  });

  test("combat state includes spell slots per combatant", () => {
    const gs = makeGameState({
      combat: {
        active: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            playerId: "human1",
            name: "Fūsetsu",
            hp: { max: 24, current: 24, temp: 0 },
            initiative: 18,
            conditions: [],
            deathSaves: { successes: 0, failures: 0 },
          },
        ],
      },
    });
    gs.players[0].characterSheet.spellSlots = [{ level: 1, max: 2, current: 1 }];
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("Slots: 1st: 1/2");
  });

  test("combat state includes feature charges per combatant", () => {
    const gs = makeGameState({
      combat: {
        active: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            playerId: "agent:grimbold",
            name: "Grimbold Ironforge",
            hp: { max: 31, current: 31, temp: 0 },
            initiative: 12,
            conditions: [],
            deathSaves: { successes: 0, failures: 0 },
          },
        ],
      },
    });
    gs.players[1].characterSheet.featureCharges = [
      { name: "Second Wind", max: 1, current: 1, resetsOn: "short" },
    ];
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("Second Wind: 1/1");
  });

  test("DM_IDENTITY contains UPDATE_HP directive instructions", () => {
    expect(DM_IDENTITY).toContain("UPDATE_HP");
    expect(DM_IDENTITY).toContain("[[UPDATE_HP:");
  });

  test("DM_IDENTITY contains UPDATE_CONDITION directive instructions", () => {
    expect(DM_IDENTITY).toContain("UPDATE_CONDITION");
    expect(DM_IDENTITY).toContain("[[UPDATE_CONDITION:SET");
  });

  test("DM_IDENTITY contains REQUEST_ROLL directive instructions", () => {
    expect(DM_IDENTITY).toContain("REQUEST_ROLL");
    expect(DM_IDENTITY).toContain("[[REQUEST_ROLL:");
  });

  test("DM_IDENTITY contains MANDATORY: Narrate Every Roll Outcome", () => {
    expect(DM_IDENTITY).toContain("MANDATORY: Narrate Every Roll Outcome");
  });

  test("DM_IDENTITY contains MANDATORY: State Updates", () => {
    expect(DM_IDENTITY).toContain("MANDATORY: State Updates");
    expect(DM_IDENTITY).toContain("Narration alone does NOT update game");
  });

  test("DM_IDENTITY contains next-player prompt rule", () => {
    expect(DM_IDENTITY).toContain("End EVERY response by addressing who should act next");
  });

  test("DM_IDENTITY contains resource verification rules", () => {
    expect(DM_IDENTITY).toContain("MANDATORY before referencing character resources");
    expect(DM_IDENTITY).toContain("NEVER guess at spell slots");
  });

  test("DM_IDENTITY contains REST directive instructions", () => {
    expect(DM_IDENTITY).toContain("[[REST:");
    expect(DM_IDENTITY).toContain("REST");
    expect(DM_IDENTITY).toContain("narration alone does NOT reset resources");
  });

  test("DM_IDENTITY contains rules authority instruction", () => {
    expect(DM_IDENTITY).toContain("hold firm");
    expect(DM_IDENTITY).toContain("Do not capitulate");
  });

  test("buildAskPrompt contains rules authority section", () => {
    const prompt = buildAskPrompt("What spells do I have?", "TestPlayer");
    expect(prompt).toContain("RULES AUTHORITY");
    expect(prompt).toContain("DO NOT capitulate");
    expect(prompt).toContain("Quote the exact SRD text");
  });

  test("canonical facts are injected into system prompt", () => {
    const gs = makeGameState();
    const facts = "- Tavern name: **The Sheaf & Stone**\n- Barkeep: **Marta**";
    const { system } = buildDMPrompt(gs, [], "test", null, facts);
    expect(system).toContain("⚠️ CANONICAL FACTS");
    expect(system).toContain("The Sheaf & Stone");
    expect(system).toContain("Marta");
  });

  test("canonical facts appear before narrative summary", () => {
    const gs = makeGameState({ narrativeSummary: "The party explored the mines." });
    const facts = "- Tavern: The Sheaf & Stone";
    const { system } = buildDMPrompt(gs, [], "test", null, facts);
    const factsIdx = system.indexOf("CANONICAL FACTS");
    const summaryIdx = system.indexOf("Story So Far");
    expect(factsIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(factsIdx).toBeLessThan(summaryIdx);
  });

  test("null canonical facts are not injected", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test", null, null);
    expect(system).not.toContain("⚠️ CANONICAL FACTS — DO NOT CONTRADICT");
  });
});

describe("buildPausePrompt", () => {
  test("instructs DM to save context to dm-notes/resume.md", () => {
    const prompt = buildPausePrompt();
    expect(prompt).toContain("dm-notes/resume.md");
  });

  test("instructs DM to read existing notes and history", () => {
    const prompt = buildPausePrompt();
    expect(prompt).toContain("history.json");
    expect(prompt).toContain("dm-notes/");
  });

  test("instructs DM to save secret plans", () => {
    const prompt = buildPausePrompt();
    expect(prompt).toContain("Secret plans");
    expect(prompt).toContain("plot.md");
  });

  test("instructs DM to update world and session log", () => {
    const prompt = buildPausePrompt();
    expect(prompt).toContain("world.md");
    expect(prompt).toContain("session-log.md");
  });

  test("identifies as a system pause request", () => {
    const prompt = buildPausePrompt();
    expect(prompt).toContain("GRACEFUL PAUSE");
  });

  test("warns DM that memory is lost without notes", () => {
    const prompt = buildPausePrompt();
    expect(prompt).toContain("no memory of this session except what's in dm-notes");
  });
});

describe("buildResumePrompt", () => {
  test("instructs DM to read resume.md", () => {
    const prompt = buildResumePrompt();
    expect(prompt).toContain("dm-notes/resume.md");
  });

  test("instructs DM to read all note files", () => {
    const prompt = buildResumePrompt();
    expect(prompt).toContain("plot.md");
    expect(prompt).toContain("world.md");
    expect(prompt).toContain("session-log.md");
  });

  test("instructs DM to continue seamlessly", () => {
    const prompt = buildResumePrompt();
    expect(prompt).toContain("seamless continuity");
  });

  test("identifies as a system resume request", () => {
    const prompt = buildResumePrompt();
    expect(prompt).toContain("RESUMING FROM PAUSE");
  });

  test("instructs DM not to summarize but to continue the scene", () => {
    const prompt = buildResumePrompt();
    expect(prompt).toContain("Do not summarize");
  });
});

describe("buildDMPrompt with pause/resume prompts", () => {
  test("pause prompt integrates into full DM prompt", () => {
    const gs = makeGameState({ turnCount: 42 });
    const pauseAction = buildPausePrompt();
    const { system, messages } = buildDMPrompt(gs, [], pauseAction);

    // System prompt still has DM identity and party info
    expect(system).toContain("Dungeon Master");
    expect(system).toContain("Fūsetsu");
    // User message contains the pause instructions
    expect(messages[0].content).toContain("GRACEFUL PAUSE");
    expect(messages[0].content).toContain("dm-notes/resume.md");
  });

  test("resume prompt integrates into full DM prompt", () => {
    const gs = makeGameState({ turnCount: 42 });
    const resumeAction = buildResumePrompt();
    const { system, messages } = buildDMPrompt(gs, [], resumeAction);

    expect(system).toContain("Dungeon Master");
    expect(messages[0].content).toContain("RESUMING FROM PAUSE");
  });
});
