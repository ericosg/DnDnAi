import { describe, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

// Mock config and claude to avoid env var / API requirements
mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test", agent: "test", orchestrator: "test" },
  DATA_DIR: "data/games",
  AGENTS_DIR: "agents",
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
}));

const { parseCharacterSheet } = await import("../game/characters.js");

const AGENTS_DIR = path.resolve("agents");

const ALL_AGENTS = [
  "grimbold",
  "criella",
  "merric",
  "torinn",
  "nyx",
  "vola",
  "caelynn",
  "damakos",
  "seraphina",
  "soveliss",
  "pumpernickle",
];

/** Load agent personality directly from disk (avoids AGENTS_DIR mock issues). */
async function loadAgent(name: string) {
  const raw = await readFile(path.join(AGENTS_DIR, `${name}.md`), "utf-8");
  const { data, content } = matter(raw);
  return {
    name: data.name ?? name,
    race: data.race ?? "Unknown",
    class: data.class ?? "Unknown",
    level: data.level ?? 1,
    description: data.description ?? "",
    voice: data.voice ?? "",
    traits: data.traits ?? [],
    flaws: data.flaws ?? [],
    goals: data.goals ?? [],
    characterSpec: data.characterSpec ?? "",
    rawContent: content,
    model: data.model,
    avatarUrl: data.avatarUrl,
  };
}

describe("agent personality files", () => {
  for (const agentName of ALL_AGENTS) {
    describe(agentName, () => {
      test("loads without error", async () => {
        const personality = await loadAgent(agentName);
        expect(personality).toBeDefined();
      });

      test("has required personality fields", async () => {
        const p = await loadAgent(agentName);
        expect(p.name).toBeString();
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.race).toBeString();
        expect(p.race).not.toBe("Unknown");
        expect(p.class).toBeString();
        expect(p.class).not.toBe("Unknown");
        expect(p.level).toBeNumber();
        expect(p.level).toBeGreaterThanOrEqual(1);
        expect(p.level).toBeLessThanOrEqual(3);
        expect(p.description).toBeString();
        expect(p.description.length).toBeGreaterThan(0);
        expect(p.voice).toBeString();
        expect(p.voice.length).toBeGreaterThan(0);
      });

      test("has traits, flaws, and goals arrays", async () => {
        const p = await loadAgent(agentName);
        expect(p.traits).toBeArray();
        expect(p.traits.length).toBeGreaterThanOrEqual(1);
        expect(p.flaws).toBeArray();
        expect(p.flaws.length).toBeGreaterThanOrEqual(1);
        expect(p.goals).toBeArray();
        expect(p.goals.length).toBeGreaterThanOrEqual(1);
      });

      test("has rawContent with personality prose", async () => {
        const p = await loadAgent(agentName);
        expect(p.rawContent.trim().length).toBeGreaterThan(100);
      });

      test("has a characterSpec that parses into a valid character sheet", async () => {
        const p = await loadAgent(agentName);
        expect(p.characterSpec).toBeString();
        expect(p.characterSpec.length).toBeGreaterThan(50);

        const sheet = parseCharacterSheet(p.characterSpec);
        expect(sheet.name).toBe(p.name);
        expect(sheet.race).not.toBe("Unknown");
        expect(sheet.class).not.toBe("Unknown");
        expect(sheet.level).toBe(p.level);
        expect(sheet.hp.max).toBeGreaterThan(0);
        expect(sheet.armorClass).toBeGreaterThan(0);
        expect(sheet.equipment.length).toBeGreaterThan(0);
        expect(sheet.features.length).toBeGreaterThan(0);
      });

      test("characterSpec ability scores are all set (not defaults)", async () => {
        const p = await loadAgent(agentName);
        const sheet = parseCharacterSheet(p.characterSpec);
        const scores = sheet.abilityScores;
        // At least some scores should differ from the default of 10
        const nonDefault = Object.values(scores).filter((v) => v !== 10);
        expect(nonDefault.length).toBeGreaterThanOrEqual(3);
        // All scores should be in valid D&D range
        for (const val of Object.values(scores)) {
          expect(val).toBeGreaterThanOrEqual(3);
          expect(val).toBeLessThanOrEqual(20);
        }
      });

      test("characterSpec saving throws and skills parse", async () => {
        const p = await loadAgent(agentName);
        const sheet = parseCharacterSheet(p.characterSpec);
        expect(sheet.savingThrows.length).toBeGreaterThanOrEqual(2);
        expect(sheet.skills.length).toBeGreaterThanOrEqual(2);
      });
    });
  }
});

describe("agent uniqueness", () => {
  test("all agents have unique names", async () => {
    const names = new Set<string>();
    for (const agentName of ALL_AGENTS) {
      const p = await loadAgent(agentName);
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
    }
  });

  test("all agents have unique race+class combinations", async () => {
    const combos = new Set<string>();
    for (const agentName of ALL_AGENTS) {
      const p = await loadAgent(agentName);
      const combo = `${p.race} ${p.class}`;
      expect(combos.has(combo)).toBe(false);
      combos.add(combo);
    }
  });
});
