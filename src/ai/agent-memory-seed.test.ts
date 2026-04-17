import { describe, expect, mock, test } from "bun:test";

mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test", agent: "test", orchestrator: "test" },
  DATA_DIR: "data/games",
  AGENTS_DIR: "agents",
  AGENT_NOTES_DIR: "agent-notes",
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  AGENT_DELAY_MS: 0,
  NARRATIVE_STYLE: "concise",
  STYLE_INSTRUCTIONS: {
    concise: { dm: "", agent: "" },
    standard: { dm: "", agent: "" },
    elaborate: { dm: "", agent: "" },
  },
}));
mock.module("./claude.js", () => ({
  chat: async () => "mocked",
  chatAgentic: async () => "mocked",
}));

const { buildSeedPrompt } = await import("./agent-memory-seed.js");

import type { AgentPersonality, CharacterSheet, TurnEntry } from "../state/types.js";

function personality(overrides: Partial<AgentPersonality> = {}): AgentPersonality {
  return {
    name: "Nyx Namfoodle",
    race: "Gnome",
    class: "Wizard",
    level: 3,
    description: "tinkerer with a mouse familiar",
    voice: "fast, curious",
    traits: ["overthinks"],
    flaws: ["comic relief"],
    goals: ["understand the world"],
    characterSpec: "...",
    rawContent: "Nyx is a tinkerer.",
    ...overrides,
  };
}

function sheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    name: "Nyx Namfoodle",
    race: "Gnome",
    class: "Wizard",
    level: 3,
    background: "Sage",
    alignment: "Neutral Good",
    gender: "female",
    abilityScores: {
      strength: 8,
      dexterity: 14,
      constitution: 13,
      wisdom: 11,
      intelligence: 16,
      charisma: 10,
    },
    proficiencyBonus: 2,
    savingThrows: [],
    skills: [],
    hp: { max: 18, current: 18, temp: 0 },
    armorClass: 12,
    initiative: 2,
    speed: 25,
    equipment: ["dagger", "spellbook"],
    features: ["Arcane Recovery"],
    spells: ["Fire Bolt", "Minor Illusion", "Prestidigitation", "Shield"],
    backstory: "Raised in a clockwork workshop.",
    ...overrides,
  };
}

function historyEntry(overrides: Partial<TurnEntry> = {}): TurnEntry {
  return {
    id: 0,
    timestamp: new Date().toISOString(),
    playerId: "agent:nyx",
    playerName: "Nyx",
    type: "ic",
    content: "I try to cast Light on this copper piece.",
    ...overrides,
  };
}

describe("buildSeedPrompt", () => {
  test("includes the character name as a heading", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt).toContain("## Character: Nyx Namfoodle");
  });

  test("includes race/class/level line", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt).toContain("Gnome Wizard 3");
  });

  test("lists spells when the character is a caster", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt).toContain("Fire Bolt, Minor Illusion, Prestidigitation, Shield");
  });

  test("omits spells line for non-casters", () => {
    const martial = sheet({ class: "Fighter", spells: undefined });
    const prompt = buildSeedPrompt({
      personality: personality({ class: "Fighter" }),
      sheet: martial,
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt).not.toMatch(/Spells & Cantrips:/);
  });

  test("embeds DM character notes when present", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: "- Nyx does NOT know Light cantrip",
      history: [],
    });
    expect(prompt).toContain("DM's Notes About This Character");
    expect(prompt).toContain("does NOT know Light cantrip");
  });

  test("skips DM notes section when null", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt).not.toContain("DM's Notes About This Character");
  });

  test("formats IC entries with > prefix and non-IC entries with tag", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [
        historyEntry({ type: "ic", content: "I cast a spell." }),
        historyEntry({
          playerName: "Dungeon Master",
          type: "dm-narration",
          content: "The door creaks open.",
        }),
        historyEntry({ type: "system", content: "Combat started." }),
      ],
    });
    expect(prompt).toContain("[Nyx] > I cast a spell.");
    expect(prompt).toContain("[Dungeon Master] The door creaks open.");
    expect(prompt).toContain("[system] Combat started.");
  });

  test("emits placeholder when history is empty", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt).toContain("(no history yet)");
  });

  test("closes with a call to produce the memory for the named character", () => {
    const prompt = buildSeedPrompt({
      personality: personality(),
      sheet: sheet(),
      dmCharacterNotes: null,
      history: [],
    });
    expect(prompt.trim().endsWith("Produce the memory file for Nyx Namfoodle now.")).toBe(true);
  });
});
