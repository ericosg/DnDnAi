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

const { buildDMPrompt, buildAskPrompt, DM_IDENTITY, DM_ALLOWED_TOOLS } = await import(
  "./dm-prompt.js"
);

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
});
