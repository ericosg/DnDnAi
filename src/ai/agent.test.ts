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

const { parseCharacterSheet } = await import("../game/characters.js");
const { buildAgentSystemPrompt, buildAgentMessages, AGENT_ALLOWED_TOOLS } = await import(
  "./agent.js"
);

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

      test("caster agents have spells in separate ## Spells section", async () => {
        const nonCasters = ["grimbold", "vola", "damakos"];
        if (nonCasters.includes(agentName)) return; // skip non-casters

        const p = await loadAgent(agentName);
        const sheet = parseCharacterSheet(p.characterSpec);
        expect(sheet.spells).toBeDefined();
        expect(sheet.spells?.length).toBeGreaterThanOrEqual(2);
        // Spells should NOT be embedded in features as "Cantrips: ..." or "Spells Known: ..."
        for (const f of sheet.features) {
          expect(f).not.toMatch(
            /^(Cantrips|Spells Known|Spellbook|Prepared \(|Spell Slots|Domain Spells|Oath Spells):/,
          );
        }
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

describe("agent prompt — memory injection", () => {
  const baseP = {
    name: "Nyx Namfoodle",
    race: "Gnome",
    class: "Wizard",
    level: 3,
    description: "tinkerer",
    voice: "",
    traits: ["curious"],
    flaws: ["overthinker"],
    goals: ["learn"],
    characterSpec: "",
    rawContent: "Nyx is thoughtful.",
  };

  test("AGENT_ALLOWED_TOOLS is Read + Edit only (no Write, Glob, Grep)", () => {
    expect(AGENT_ALLOWED_TOOLS).toEqual(["Read", "Edit"]);
  });

  test("system prompt includes memory file path when memory exists", () => {
    const system = buildAgentSystemPrompt(baseP, "/abs/path/nyx.md", true);
    expect(system).toContain("Your Memory (PERSISTENT)");
    expect(system).toContain("/abs/path/nyx.md");
    expect(system).toContain("Edit the file to append");
    expect(system).toContain("NEVER delete existing bullets");
  });

  test("system prompt falls back gracefully when memory file is missing", () => {
    const system = buildAgentSystemPrompt(baseP, "/abs/path/nyx.md", false);
    expect(system).toContain("No memory file found");
    expect(system).not.toContain("Your Memory (PERSISTENT)");
  });

  test("user message embeds current memory content when provided", () => {
    const gs = {
      id: "g",
      channelId: "c",
      guildId: "gu",
      status: "active" as const,
      players: [
        {
          id: "agent:nyx",
          name: "Nyx",
          isAgent: true,
          characterSheet: {
            name: "Nyx Namfoodle",
            race: "Gnome",
            class: "Wizard",
            level: 3,
            background: "Sage",
            alignment: "N",
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
            equipment: [],
            features: [],
            backstory: "",
          },
          joinedAt: new Date().toISOString(),
        },
      ],
      combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
      narrativeSummary: "",
      turnCount: 0,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    const messages = buildAgentMessages(
      baseP,
      gs,
      [],
      "current situation text",
      "# Nyx — Memory\n\n## What I Remember\n- I tried to cast Light once and embarrassed myself.",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("Your Memory");
    expect(messages[0].content).toContain("I tried to cast Light once");
    expect(messages[0].content).toContain("## Party Status");
    expect(messages[0].content).toContain("Nyx Namfoodle");
    expect(messages[0].content).toContain("current situation text");
  });

  test("user message omits memory block when memory is null", () => {
    const gs = {
      id: "g",
      channelId: "c",
      guildId: "gu",
      status: "active" as const,
      players: [],
      combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
      narrativeSummary: "",
      turnCount: 0,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    const messages = buildAgentMessages(baseP, gs, [], "situation", null);
    expect(messages[0].content).not.toContain("Your Memory");
    expect(messages[0].content).toContain("## Party Status");
  });
});

describe("agent prompt — action directives + security", () => {
  const baseP = {
    name: "Nyx Namfoodle",
    race: "Gnome",
    class: "Wizard",
    level: 3,
    description: "tinkerer",
    voice: "",
    traits: [],
    flaws: [],
    goals: [],
    characterSpec: "",
    rawContent: "",
  };

  test("system prompt documents all four action directives", () => {
    const system = buildAgentSystemPrompt(baseP, "/abs/nyx.md", true);
    expect(system).toContain("[[PASS]]");
    expect(system).toContain("[[ASK:");
    expect(system).toContain("[[LOOK:");
    expect(system).toContain("[[WHISPER:");
    expect(system).toContain("Your Available Actions");
  });

  test("system prompt lists forbidden file locations", () => {
    const system = buildAgentSystemPrompt(baseP, "/abs/nyx.md", true);
    expect(system).toContain("src/");
    expect(system).toContain("dm-notes/");
    expect(system).toContain("history.json");
    expect(system).toContain("CRITICAL");
    expect(system).toContain("Information Boundaries");
  });

  test("system prompt names the one allowed file path when memory exists", () => {
    const system = buildAgentSystemPrompt(baseP, "/my/path/nyx.md", true);
    // The allowed-file anchor appears inside the Information Boundaries block
    expect(system).toMatch(/The only file you should ever Read or Edit[\s\S]+\/my\/path\/nyx\.md/);
  });

  test("system prompt says no file is readable when memory file is missing", () => {
    const system = buildAgentSystemPrompt(baseP, "/my/path/nyx.md", false);
    expect(system).toContain("no memory file yet — do not use Read or Edit this turn");
  });
});

describe("agent prompt — character / party / narrative enrichment", () => {
  const nyxP = {
    name: "Nyx Namfoodle",
    race: "Gnome",
    class: "Wizard",
    level: 3,
    description: "tinkerer",
    voice: "",
    traits: [],
    flaws: [],
    goals: [],
    characterSpec: "",
    rawContent: "",
  };

  function makeGS(): import("../state/types.js").GameState {
    return {
      id: "g",
      channelId: "c",
      guildId: "gu",
      status: "active" as const,
      players: [
        {
          id: "human1",
          name: "Fusetsu",
          isAgent: false,
          characterSheet: {
            name: "Fusetsu",
            race: "Human",
            class: "Rogue",
            level: 3,
            background: "Hermit",
            alignment: "N",
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
            hp: { max: 24, current: 18, temp: 0 },
            armorClass: 14,
            initiative: 3,
            speed: 30,
            equipment: ["dagger"],
            features: [],
            backstory: "",
          },
          joinedAt: new Date().toISOString(),
        },
        {
          id: "agent:nyx",
          name: "Nyx Namfoodle",
          isAgent: true,
          characterSheet: {
            name: "Nyx Namfoodle",
            race: "Gnome",
            class: "Wizard",
            level: 3,
            background: "Sage",
            alignment: "NG",
            abilityScores: {
              strength: 8,
              dexterity: 14,
              constitution: 13,
              wisdom: 11,
              intelligence: 16,
              charisma: 10,
            },
            proficiencyBonus: 2,
            savingThrows: ["Intelligence", "Wisdom"],
            skills: ["Arcana", "Investigation"],
            hp: { max: 18, current: 18, temp: 0 },
            armorClass: 12,
            initiative: 2,
            speed: 25,
            equipment: ["dagger", "spellbook"],
            features: ["Arcane Recovery"],
            spells: ["Fire Bolt", "Minor Illusion", "Prestidigitation", "Shield"],
            backstory: "",
          },
          joinedAt: new Date().toISOString(),
        },
      ],
      combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
      narrativeSummary: "The party is deep in the mines hunting for crystals.",
      turnCount: 5,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      sceneState: {
        location: "Shadowstone cavern",
        timeOfDay: "Night",
        presentNPCs: ["Aldric"],
        keyFacts: ["R1 not yet seated"],
      },
    };
  }

  test("includes 'Your Character Sheet' with full mechanical detail for the agent only", () => {
    const messages = buildAgentMessages(nyxP, makeGS(), [], "", null);
    const content = messages[0].content;
    expect(content).toContain("## Your Character Sheet");
    expect(content).toContain("### Nyx Namfoodle");
    expect(content).toContain("Fire Bolt, Minor Illusion, Prestidigitation, Shield");
    // Other PCs' full reference should NOT be in Your Character Sheet
    expect(content).not.toContain("### Fusetsu");
  });

  test("includes Party Status with HP for each player and marks the agent as YOU", () => {
    const messages = buildAgentMessages(nyxP, makeGS(), [], "", null);
    const content = messages[0].content;
    expect(content).toContain("## Party Status");
    expect(content).toContain("Fusetsu");
    expect(content).toContain("HP 18/24");
    expect(content).toContain("Nyx Namfoodle");
    expect(content).toContain("— YOU");
  });

  test("includes narrative summary when present", () => {
    const messages = buildAgentMessages(nyxP, makeGS(), [], "", null);
    expect(messages[0].content).toContain("## Story So Far");
    expect(messages[0].content).toContain("deep in the mines");
  });

  test("includes scene state when present", () => {
    const messages = buildAgentMessages(nyxP, makeGS(), [], "", null);
    const content = messages[0].content;
    expect(content).toContain("## Current Scene");
    expect(content).toContain("Shadowstone cavern");
    expect(content).toContain("Night");
    expect(content).toContain("Aldric");
  });

  test("suggests directives to the agent in the prompt's final line", () => {
    const messages = buildAgentMessages(nyxP, makeGS(), [], "", null);
    const content = messages[0].content;
    expect(content).toContain("[[PASS]]");
    expect(content).toContain("[[ASK:");
    expect(content).toContain("[[LOOK:");
    expect(content).toContain("[[WHISPER:");
  });

  test("omits narrative summary and scene when empty", () => {
    const gs = makeGS();
    gs.narrativeSummary = "";
    gs.sceneState = undefined;
    const messages = buildAgentMessages(nyxP, gs, [], "", null);
    const content = messages[0].content;
    expect(content).not.toContain("## Story So Far");
    expect(content).not.toContain("## Current Scene");
  });

  test("combat HP overrides character sheet HP in Party Status", () => {
    const gs = makeGS();
    gs.combat = {
      active: true,
      round: 2,
      turnIndex: 0,
      combatants: [
        {
          playerId: "agent:nyx",
          name: "Nyx Namfoodle",
          initiative: 15,
          hp: { max: 18, current: 5, temp: 0 },
          conditions: ["concentrating"],
          deathSaves: { successes: 0, failures: 0 },
        },
      ],
    };
    const messages = buildAgentMessages(nyxP, gs, [], "", null);
    const content = messages[0].content;
    expect(content).toContain("HP 5/18");
    expect(content).toContain("[concentrating]");
  });
});
