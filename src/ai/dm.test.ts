/**
 * Tests for DM prompt construction.
 * Uses dm-prompt.ts (pure functions) to avoid cross-file mock pollution.
 */

import { describe, expect, mock, test } from "bun:test";
import type { GameState, TurnEntry } from "../state/types.js";

mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test-model", agent: "test-model", orchestrator: "test-model" },
  HISTORY_WINDOW: 12,
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
  formatSceneState,
  parseSceneState,
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

  test("explicitly covers AI agents in agency rule", () => {
    expect(DM_IDENTITY).toContain("applies EQUALLY to AI agents");
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

  test("file paths include directives reference", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("docs/directives.md");
  });

  test("system prompt includes source code boundary", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("not a developer");
    expect(system).toContain("Never read or search source code");
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
    expect(DM_IDENTITY).toContain("ONLY updates character sheets through directives");
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

describe("buildDMPrompt — dormant agents", () => {
  test("dormant agents are excluded from active party list", () => {
    const gs = makeGameState();
    gs.players.push({
      id: "agent:sprocket",
      name: "Sprocket",
      isAgent: true,
      dormant: true,
      characterSheet: {
        name: "Sprocket",
        race: "Tiny Construct",
        class: "None",
        level: 1,
        background: "Familiar",
        alignment: "Neutral",
        abilityScores: {
          strength: 1,
          dexterity: 14,
          constitution: 1,
          wisdom: 16,
          intelligence: 18,
          charisma: 6,
        },
        proficiencyBonus: 2,
        savingThrows: [],
        skills: [],
        hp: { max: 1, current: 1, temp: 0 },
        armorClass: 12,
        initiative: 2,
        speed: 20,
        equipment: [],
        features: [],
        backstory: "",
      },
      agentFile: "sprocket.md",
      joinedAt: new Date().toISOString(),
    });
    const { system } = buildDMPrompt(gs, [], "test");

    // Active party section should not contain dormant agent
    const partySection = system.split("## Party")[1].split("##")[0];
    expect(partySection).not.toContain("Sprocket");
  });

  test("dormant agents appear in Dormant Agents section", () => {
    const gs = makeGameState();
    gs.players.push({
      id: "agent:sprocket",
      name: "Sprocket",
      isAgent: true,
      dormant: true,
      characterSheet: {
        name: "Sprocket",
        race: "Tiny Construct",
        class: "None",
        level: 1,
        background: "Familiar",
        alignment: "Neutral",
        abilityScores: {
          strength: 1,
          dexterity: 14,
          constitution: 1,
          wisdom: 16,
          intelligence: 18,
          charisma: 6,
        },
        proficiencyBonus: 2,
        savingThrows: [],
        skills: [],
        hp: { max: 1, current: 1, temp: 0 },
        armorClass: 12,
        initiative: 2,
        speed: 20,
        equipment: [],
        features: [],
        backstory: "",
      },
      agentFile: "sprocket.md",
      joinedAt: new Date().toISOString(),
    });
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("Dormant Agents");
    expect(system).toContain("Sprocket");
    expect(system).toContain("waiting to be introduced");
    expect(system).toContain("[[ACTIVATE:AgentName]]");
  });

  test("no dormant section when no dormant agents exist", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).not.toContain("## Dormant Agents (Awaiting Introduction)");
  });
});

describe("buildDMPrompt — waitingFor", () => {
  test("shows waiting-for section in exploration mode", () => {
    const gs = makeGameState({
      waitingFor: { playerId: "human1", playerName: "Eric" },
    });
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).toContain("Orchestrator: Waiting For");
    expect(system).toContain("Eric");
  });

  test("omits waiting-for section when null", () => {
    const gs = makeGameState({ waitingFor: null });
    const { system } = buildDMPrompt(gs, [], "test");

    expect(system).not.toContain("Orchestrator: Waiting For");
  });

  test("omits waiting-for section during combat", () => {
    const gs = makeGameState({
      waitingFor: { playerId: "human1", playerName: "Eric" },
      combat: {
        active: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            playerId: "human1",
            name: "Fūsetsu",
            initiative: 18,
            hp: { max: 24, current: 24, temp: 0 },
            conditions: [],
            deathSaves: { successes: 0, failures: 0 },
          },
        ],
      },
    });
    const { system } = buildDMPrompt(gs, [], "test");

    // Combat has its own CURRENT TURN section, so waitingFor is redundant
    expect(system).not.toContain("Orchestrator: Waiting For");
  });
});

describe("buildAskPrompt — /ask does not trigger orchestrator", () => {
  test("does NOT claim orchestrator runs after /ask", () => {
    const prompt = buildAskPrompt("test?", "Fūsetsu");

    expect(prompt).not.toContain("automatically runs the orchestrator");
    expect(prompt).not.toContain("naturally unstick it");
  });

  test("tells DM that /ask does not advance the game", () => {
    const prompt = buildAskPrompt("test?", "Fūsetsu");

    expect(prompt).toContain("does NOT trigger the orchestrator");
  });

  test("includes turn awareness instructions", () => {
    const prompt = buildAskPrompt("whose turn is it?", "Fūsetsu");

    expect(prompt).toContain("TURN AWARENESS");
    expect(prompt).toContain("waitingFor");
  });

  test("forbids advancing the plot in /ask responses", () => {
    const prompt = buildAskPrompt("what happens next?", "Fūsetsu");

    expect(prompt).toContain("NEVER advance the plot");
    expect(prompt).toContain("Do not narrate new scenes");
    expect(prompt).toContain("strictly out-of-character");
  });
});

describe("DM_IDENTITY — ACTIVATE directive", () => {
  test("contains ACTIVATE directive instructions", () => {
    expect(DM_IDENTITY).toContain("[[ACTIVATE:");
    expect(DM_IDENTITY).toContain("dormant agent");
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

  test("includes blueprint generation when needsBlueprint is true", () => {
    const prompt = buildResumePrompt(true);
    expect(prompt).toContain("CAMPAIGN BLUEPRINT REQUIRED");
    expect(prompt).toContain("dm-notes/campaign.md");
    expect(prompt).toContain("Core Premise");
    expect(prompt).toContain("Boss Encounters");
    expect(prompt).toContain("Escalation Triggers");
  });

  test("omits blueprint generation when needsBlueprint is false", () => {
    const prompt = buildResumePrompt(false);
    expect(prompt).not.toContain("CAMPAIGN BLUEPRINT REQUIRED");
  });

  test("omits blueprint generation by default", () => {
    const prompt = buildResumePrompt();
    expect(prompt).not.toContain("CAMPAIGN BLUEPRINT REQUIRED");
  });
});

describe("Campaign Blueprint — prompt injection", () => {
  test("injects blueprint section when provided", () => {
    const gs = makeGameState();
    const blueprint = "# Campaign Blueprint\n\n## Core Premise\nTest premise.";
    const { system } = buildDMPrompt(gs, [], "test", null, null, null, blueprint);
    expect(system).toContain("📜 CAMPAIGN BLUEPRINT");
    expect(system).toContain("Test premise");
  });

  test("omits blueprint section when null", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test", null, null, null, null);
    expect(system).not.toContain("📜 CAMPAIGN BLUEPRINT");
  });

  test("shows World Clock with longRestCount", () => {
    const gs = makeGameState({ longRestCount: 7 });
    const blueprint = "# Campaign Blueprint\n\nTest.";
    const { system } = buildDMPrompt(gs, [], "test", null, null, null, blueprint);
    expect(system).toContain("**World Clock:** 7 long rests");
  });

  test("shows World Clock as 0 when longRestCount undefined", () => {
    const gs = makeGameState();
    const blueprint = "# Campaign Blueprint\n\nTest.";
    const { system } = buildDMPrompt(gs, [], "test", null, null, null, blueprint);
    expect(system).toContain("**World Clock:** 0 long rests");
  });

  test("DM_IDENTITY contains Campaign Blueprint instructions", () => {
    expect(DM_IDENTITY).toContain("Campaign Blueprint");
    expect(DM_IDENTITY).toContain("campaign.md");
    expect(DM_IDENTITY).toContain("NEVER delete uncompleted milestones");
    expect(DM_IDENTITY).toContain("World Clock");
  });

  test("campaign.md appears in file paths", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");
    expect(system).toContain("dm-notes/campaign.md");
  });

  test("BLUEPRINT_FORMAT contains all required sections", () => {
    const { BLUEPRINT_FORMAT } = require("./dm-prompt.js");
    expect(BLUEPRINT_FORMAT).toContain("Core Premise");
    expect(BLUEPRINT_FORMAT).toContain("Act Structure");
    expect(BLUEPRINT_FORMAT).toContain("Boss Encounters");
    expect(BLUEPRINT_FORMAT).toContain("Escalation Triggers");
    expect(BLUEPRINT_FORMAT).toContain("World Consequences");
    expect(BLUEPRINT_FORMAT).toContain("Resolution Conditions");
    expect(BLUEPRINT_FORMAT).toContain("Combat Style");
    expect(BLUEPRINT_FORMAT).toContain("Foreshadowing");
  });
});

describe("parseSceneState", () => {
  test("parses valid structured header", () => {
    const raw = `LOCATION: Root cellar, east Halverton
TIME: Noon
NPCS_PRESENT: Edric (outside entrance), Marsh (captive)
KEY_STATE: Marsh has confessed|Two caches remain in town|Dead drop on Thornwall road
---
The party has been interrogating Marsh in the cellar.`;

    const result = parseSceneState(raw);
    expect(result).not.toBeNull();
    expect(result?.sceneState.location).toBe("Root cellar, east Halverton");
    expect(result?.sceneState.timeOfDay).toBe("Noon");
    expect(result?.sceneState.presentNPCs).toEqual(["Edric (outside entrance)", "Marsh (captive)"]);
    expect(result?.sceneState.keyFacts).toEqual([
      "Marsh has confessed",
      "Two caches remain in town",
      "Dead drop on Thornwall road",
    ]);
    expect(result?.prose).toBe("The party has been interrogating Marsh in the cellar.");
  });

  test("returns null when no delimiter found", () => {
    const raw = "Just a plain summary with no structured header.";
    expect(parseSceneState(raw)).toBeNull();
  });

  test("returns null when LOCATION is missing", () => {
    const raw = `TIME: Noon
NPCS_PRESENT: Edric
---
Some prose.`;
    expect(parseSceneState(raw)).toBeNull();
  });

  test("handles empty NPCS_PRESENT and KEY_STATE", () => {
    const raw = `LOCATION: The town square
TIME: Morning
NPCS_PRESENT:
KEY_STATE:
---
The party is resting in the square.`;

    const result = parseSceneState(raw);
    expect(result).not.toBeNull();
    expect(result?.sceneState.presentNPCs).toEqual([]);
    expect(result?.sceneState.keyFacts).toEqual([]);
  });

  test("returns null when delimiter appears with no LOCATION before it", () => {
    const raw = `---
Just prose with a delimiter at the start.`;
    expect(parseSceneState(raw)).toBeNull();
  });

  test("preserves multiline prose after delimiter", () => {
    const raw = `LOCATION: The mines
TIME: Night
NPCS_PRESENT: Harlan
KEY_STATE: Crystals growing
---
First paragraph of prose.

Second paragraph of prose.`;

    const result = parseSceneState(raw);
    expect(result).not.toBeNull();
    expect(result?.prose).toContain("First paragraph");
    expect(result?.prose).toContain("Second paragraph");
  });
});

describe("formatSceneState", () => {
  test("formats complete scene state", () => {
    const scene = {
      location: "Root cellar, east Halverton",
      timeOfDay: "Noon",
      presentNPCs: ["Edric (outside)", "Marsh (captive)"],
      keyFacts: ["Marsh has confessed", "Two caches remain"],
    };
    const result = formatSceneState(scene);
    expect(result).toContain("## Current Scene");
    expect(result).toContain("**Location:** Root cellar, east Halverton");
    expect(result).toContain("**Time:** Noon");
    expect(result).toContain("**NPCs present:** Edric (outside), Marsh (captive)");
    expect(result).toContain("- Marsh has confessed");
    expect(result).toContain("- Two caches remain");
  });

  test("omits empty fields", () => {
    const scene = { location: "A cave", timeOfDay: "", presentNPCs: [], keyFacts: [] };
    const result = formatSceneState(scene);
    expect(result).toContain("**Location:** A cave");
    expect(result).not.toContain("**Time:**");
    expect(result).not.toContain("**NPCs present:**");
    expect(result).not.toContain("**Key state:**");
  });
});

describe("buildDMPrompt — DM context injection", () => {
  test("includes dm.md context when provided", () => {
    const gs = makeGameState();
    const dmContext =
      "## Active Plot Threads\n- Party investigating shadowstone smuggling\n\n## Key NPCs\n- Edric: chapel keeper, cooperative";
    const { system } = buildDMPrompt(gs, [], "test action", null, null, dmContext);

    expect(system).toContain("## DM Context");
    expect(system).toContain("shadowstone smuggling");
    expect(system).toContain("Edric: chapel keeper");
  });

  test("omits dm.md context when not provided", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test action", null, null, null);

    expect(system).not.toContain("## DM Context");
  });

  test("dm.md context appears after canonical facts and scene state", () => {
    const gs = makeGameState({
      sceneState: {
        location: "Town square",
        timeOfDay: "Noon",
        presentNPCs: [],
        keyFacts: [],
      },
    });
    const facts = "- Tavern: The Sheaf & Stone";
    const dmContext = "## Active Plot Threads\n- Smuggling investigation";
    const { system } = buildDMPrompt(gs, [], "test", null, facts, dmContext);

    const factsIdx = system.indexOf("CANONICAL FACTS");
    const sceneIdx = system.indexOf("## Current Scene");
    const contextIdx = system.indexOf("## DM Context");
    const partyIdx = system.indexOf("## Party");

    expect(factsIdx).toBeLessThan(sceneIdx);
    expect(sceneIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(partyIdx);
  });

  test("DM_IDENTITY mentions dm.md as critical file", () => {
    expect(DM_IDENTITY).toContain("dm-notes/dm.md");
    expect(DM_IDENTITY).toContain("Running Context");
  });

  test("file paths include dm.md reference", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test");
    expect(system).toContain("dm-notes/dm.md");
  });
});

describe("buildDMPrompt — scene state injection", () => {
  test("includes scene state when present in game state", () => {
    const gs = makeGameState({
      sceneState: {
        location: "Root cellar, east Halverton",
        timeOfDay: "Noon",
        presentNPCs: ["Edric (outside entrance)"],
        keyFacts: ["Marsh is cooperating"],
      },
    });
    const { system } = buildDMPrompt(gs, [], "test action");

    expect(system).toContain("## Current Scene");
    expect(system).toContain("**Location:** Root cellar, east Halverton");
    expect(system).toContain("**Time:** Noon");
    expect(system).toContain("Edric (outside entrance)");
    expect(system).toContain("- Marsh is cooperating");
  });

  test("omits scene state when not present", () => {
    const gs = makeGameState();
    const { system } = buildDMPrompt(gs, [], "test action");

    expect(system).not.toContain("## Current Scene");
  });

  test("scene state appears before narrative summary", () => {
    const gs = makeGameState({
      narrativeSummary: "The party explored the mines.",
      sceneState: {
        location: "Mine entrance",
        timeOfDay: "Morning",
        presentNPCs: [],
        keyFacts: [],
      },
    });
    const { system } = buildDMPrompt(gs, [], "test");
    const sceneIdx = system.indexOf("## Current Scene");
    const summaryIdx = system.indexOf("## Story So Far");
    expect(sceneIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(sceneIdx).toBeLessThan(summaryIdx);
  });
});

describe("buildAskPrompt — anti-hallucination", () => {
  test("includes honesty-over-consistency rules", () => {
    const prompt = buildAskPrompt("Who is Drest?", "Fūsetsu");
    expect(prompt).toContain("HONESTY OVER CONSISTENCY");
    expect(prompt).toContain("NEVER fabricate retcons");
    expect(prompt).toContain("say so plainly");
  });

  test("requires reading history.json before answering factual questions", () => {
    const prompt = buildAskPrompt("What happened at the mine?", "Fūsetsu");
    expect(prompt).toContain("YOU MUST USE THE READ TOOL");
    expect(prompt).toContain("read history.json FIRST");
  });

  test("instructs DM to admit uncertainty rather than guess", () => {
    const prompt = buildAskPrompt("Is Aldric dead?", "Fūsetsu");
    expect(prompt).toContain("I don't have a record of that");
    expect(prompt).toContain("I'm not sure");
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
