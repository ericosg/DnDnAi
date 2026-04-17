import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Single shared temp DATA_DIR for the whole file — bun's top-level named imports
// capture the module export at import time, so we can't swap DATA_DIR per test.
// Instead each test uses a unique gameId and we nuke the whole dir at the end.
const TEST_DATA_DIR = await mkdtemp(path.join(tmpdir(), "agent-notes-test-"));

mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test", agent: "test", orchestrator: "test" },
  DATA_DIR: TEST_DATA_DIR,
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

const {
  agentNotesDirExists,
  agentNotesExist,
  agentSlug,
  appendAgentMemory,
  buildStarterMemory,
  getAgentNotesDir,
  getAgentNotesPath,
  listAgentNoteFiles,
  readAgentNotes,
  seedAgentNotes,
} = await import("./agent-notes.js");

import type { AgentPersonality, CharacterSheet } from "../state/types.js";

const gid = () => crypto.randomUUID();

afterAll(async () => {
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
});

function personality(overrides: Partial<AgentPersonality> = {}): AgentPersonality {
  return {
    name: "Grimbold Ironforge",
    race: "Mountain Dwarf",
    class: "Fighter",
    level: 3,
    description: "gruff veteran",
    voice: "",
    traits: [],
    flaws: [],
    goals: ["protect the party"],
    characterSpec: "",
    rawContent: "",
    ...overrides,
  };
}

function sheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    name: "Grimbold Ironforge",
    race: "Mountain Dwarf",
    class: "Fighter",
    level: 3,
    background: "Soldier",
    alignment: "Lawful Neutral",
    gender: "male",
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
    equipment: ["longsword", "shield", "chain mail"],
    features: ["Second Wind", "Action Surge"],
    backstory: "A veteran smith.",
    ...overrides,
  };
}

describe("agentSlug", () => {
  test("lowercases and hyphenates", () => {
    expect(agentSlug("Grimbold Ironforge")).toBe("grimbold-ironforge");
  });
  test("single-word names are lowercased", () => {
    expect(agentSlug("Nyx")).toBe("nyx");
  });
  test("trims surrounding whitespace", () => {
    expect(agentSlug("  Sprocket  ")).toBe("sprocket");
  });
});

describe("paths", () => {
  test("getAgentNotesDir returns gamedir/agent-notes", () => {
    expect(getAgentNotesDir("abc")).toBe(path.join(TEST_DATA_DIR, "abc", "agent-notes"));
  });
  test("getAgentNotesPath uses slug", () => {
    expect(getAgentNotesPath("abc", "Grimbold Ironforge")).toBe(
      path.join(TEST_DATA_DIR, "abc", "agent-notes", "grimbold-ironforge.md"),
    );
  });
});

describe("buildStarterMemory", () => {
  test("uses first-person, includes character sheet details", () => {
    const memory = buildStarterMemory(personality(), sheet());
    expect(memory).toContain("# Grimbold Ironforge — Memory");
    expect(memory).toContain("## What I Remember");
    expect(memory).toContain("## What I Carry");
    expect(memory).toContain("## What I Know About Myself");
    expect(memory).toContain("## Bonds & Relationships");
    expect(memory).toContain("## Open Threads");
    expect(memory).toContain("- longsword");
    expect(memory).toContain("- shield");
    expect(memory).toContain("- chain mail");
    expect(memory).toContain("I am Grimbold Ironforge");
    expect(memory).toContain("Mountain Dwarf Fighter");
  });

  test("includes goals under Bonds & Relationships", () => {
    const memory = buildStarterMemory(personality(), sheet());
    expect(memory).toContain("- protect the party");
  });

  test("martial classes do not claim spells they don't have", () => {
    const memory = buildStarterMemory(personality(), sheet()); // Fighter, no spells
    expect(memory).not.toContain("My spells");
    expect(memory).not.toContain("I don't have any spells prepared");
  });

  test("casters with spells list them as the ONLY spells", () => {
    const nyx = personality({
      name: "Nyx Namfoodle",
      race: "Gnome",
      class: "Wizard",
      level: 3,
      goals: ["learn the secrets"],
    });
    const nyxSheet = sheet({
      name: "Nyx Namfoodle",
      race: "Gnome",
      class: "Wizard",
      features: ["Arcane Recovery"],
      spells: ["Fire Bolt", "Minor Illusion", "Prestidigitation", "Shield"],
    });
    const memory = buildStarterMemory(nyx, nyxSheet);
    expect(memory).toContain("Fire Bolt, Minor Illusion, Prestidigitation, Shield");
    expect(memory).toContain("ONLY spells I know");
  });

  test("casters without spells get a placeholder note", () => {
    const sorc = personality({ class: "Sorcerer" });
    const sorcSheet = sheet({ class: "Sorcerer", spells: undefined });
    const memory = buildStarterMemory(sorc, sorcSheet);
    expect(memory).toContain("I don't have any spells prepared");
  });

  test("empty equipment yields a placeholder", () => {
    const memory = buildStarterMemory(personality(), sheet({ equipment: [] }));
    expect(memory).toContain("(nothing of note yet)");
  });

  test("no goals yields placeholder in bonds section", () => {
    const memory = buildStarterMemory(personality({ goals: [] }), sheet());
    expect(memory).toMatch(/## Bonds & Relationships\n- \(none yet/);
  });
});

describe("seedAgentNotes", () => {
  test("creates the file when it does not exist", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    const file = getAgentNotesPath(g, "Grimbold Ironforge");
    expect(existsSync(file)).toBe(true);
    const content = await readFile(file, "utf-8");
    expect(content).toContain("# Grimbold Ironforge — Memory");
  });

  test("does NOT overwrite an existing file", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    const file = getAgentNotesPath(g, "Grimbold Ironforge");
    await writeFile(file, "# User-edited memory\n");
    await seedAgentNotes(g, personality(), sheet());
    const content = await readFile(file, "utf-8");
    expect(content).toBe("# User-edited memory\n");
  });

  test("creates the agent-notes directory as needed", async () => {
    const g = gid();
    expect(agentNotesDirExists(g)).toBe(false);
    await seedAgentNotes(g, personality(), sheet());
    expect(agentNotesDirExists(g)).toBe(true);
  });
});

describe("readAgentNotes", () => {
  test("returns null when file missing", async () => {
    expect(await readAgentNotes(gid(), "Grimbold Ironforge")).toBeNull();
  });
  test("returns content when file exists", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    const content = await readAgentNotes(g, "Grimbold Ironforge");
    expect(content).toContain("# Grimbold Ironforge — Memory");
  });
});

describe("appendAgentMemory", () => {
  test("appends a bullet under ## What I Remember", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    const ok = await appendAgentMemory(g, "Grimbold Ironforge", "I took a blow for Fusetsu.");
    expect(ok).toBe(true);
    const content = (await readAgentNotes(g, "Grimbold Ironforge")) ?? "";
    expect(content).toContain("- I took a blow for Fusetsu.");
    const idxHeader = content.indexOf("## What I Remember");
    const idxEntry = content.indexOf("- I took a blow for Fusetsu.");
    expect(idxHeader).toBeGreaterThan(-1);
    expect(idxEntry).toBeGreaterThan(idxHeader);
  });

  test("strips leading bullet dash from input", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    await appendAgentMemory(g, "Grimbold Ironforge", "- a bullet");
    const content = (await readAgentNotes(g, "Grimbold Ironforge")) ?? "";
    expect(content).not.toMatch(/- - a bullet/);
    expect(content).toContain("- a bullet");
  });

  test("removes the 'nothing yet' placeholder on first real entry", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    await appendAgentMemory(g, "Grimbold Ironforge", "first real memory");
    const content = (await readAgentNotes(g, "Grimbold Ironforge")) ?? "";
    expect(content).not.toMatch(/nothing yet — my story begins here/);
    expect(content).toContain("- first real memory");
  });

  test("returns false and does not crash when file missing", async () => {
    const ok = await appendAgentMemory(gid(), "Grimbold Ironforge", "entry");
    expect(ok).toBe(false);
  });

  test("adds the section when file exists but section is missing", async () => {
    const g = gid();
    const dir = path.join(TEST_DATA_DIR, g, "agent-notes");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "grimbold-ironforge.md"), "# G\n\n## Other\n- x\n");
    const ok = await appendAgentMemory(g, "Grimbold Ironforge", "entry");
    expect(ok).toBe(true);
    const content = (await readAgentNotes(g, "Grimbold Ironforge")) ?? "";
    expect(content).toContain("## What I Remember");
    expect(content).toContain("- entry");
  });

  test("preserves prior entries when appending", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    await appendAgentMemory(g, "Grimbold Ironforge", "entry one");
    await appendAgentMemory(g, "Grimbold Ironforge", "entry two");
    const content = (await readAgentNotes(g, "Grimbold Ironforge")) ?? "";
    expect(content).toContain("- entry one");
    expect(content).toContain("- entry two");
  });
});

describe("listAgentNoteFiles and agentNotesExist", () => {
  test("empty (non-existent) dir → empty list", async () => {
    expect(await listAgentNoteFiles(gid())).toEqual([]);
  });

  test("after seeding two agents, both are listed", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    await seedAgentNotes(
      g,
      personality({ name: "Nyx Namfoodle" }),
      sheet({ name: "Nyx Namfoodle" }),
    );
    const files = (await listAgentNoteFiles(g)).sort();
    expect(files).toEqual(["grimbold-ironforge.md", "nyx-namfoodle.md"]);
  });

  test("agentNotesExist reports per-agent presence", async () => {
    const g = gid();
    await seedAgentNotes(g, personality(), sheet());
    expect(agentNotesExist(g, "Grimbold Ironforge")).toBe(true);
    expect(agentNotesExist(g, "Nyx Namfoodle")).toBe(false);
  });
});
