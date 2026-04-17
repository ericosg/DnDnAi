import { describe, expect, test } from "bun:test";
import type { GameState, Player } from "../state/types.js";
import { processAgentDirectives } from "./agent-directives.js";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "human1",
    name: "Fusetsu",
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

function makeAgent(name = "Grimbold Ironforge", id = "agent:grimbold"): Player {
  return {
    id,
    name,
    isAgent: true,
    characterSheet: { ...makePlayer().characterSheet, name },
    agentFile: "grimbold.md",
    joinedAt: new Date().toISOString(),
  };
}

function makeGS(): GameState {
  return {
    id: "g",
    channelId: "c",
    guildId: "gu",
    status: "active",
    players: [makePlayer(), makeAgent(), makeAgent("Nyx Namfoodle", "agent:nyx")],
    combat: { active: false, round: 0, turnIndex: 0, combatants: [] },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

describe("agent directives — PASS", () => {
  test("standalone [[PASS]] strips directive and flags passed", () => {
    const ctx = processAgentDirectives("[[PASS]]", makeGS(), "agent:grimbold");
    expect(ctx.passed).toBe(true);
    expect(ctx.processedText).toBe("");
    expect(ctx.actions).toEqual([{ kind: "pass" }]);
  });

  test("[[PASS]] with surrounding IC text keeps the IC text", () => {
    const ctx = processAgentDirectives(
      "*Grimbold watches quietly.* [[PASS]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.passed).toBe(true);
    expect(ctx.processedText).toBe("*Grimbold watches quietly.*");
  });

  test("no PASS directive → passed:false", () => {
    const ctx = processAgentDirectives("I swing my axe.", makeGS(), "agent:grimbold");
    expect(ctx.passed).toBe(false);
    expect(ctx.actions).toEqual([]);
  });
});

describe("agent directives — ASK", () => {
  test("single ASK records action and strips text", () => {
    const ctx = processAgentDirectives(
      "I need clarity. [[ASK:what rules cover climbing with an injured arm?]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toEqual([
      { kind: "ask", question: "what rules cover climbing with an injured arm?" },
    ]);
    expect(ctx.processedText).toBe("I need clarity.");
  });

  test("multiple ASKs in one response are all captured", () => {
    const ctx = processAgentDirectives(
      "[[ASK:first question]] [[ASK:second question]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toHaveLength(2);
    expect(ctx.actions[0]).toEqual({ kind: "ask", question: "first question" });
    expect(ctx.actions[1]).toEqual({ kind: "ask", question: "second question" });
  });

  test("empty ASK payload is dropped silently", () => {
    const ctx = processAgentDirectives("[[ASK: ]]", makeGS(), "agent:grimbold");
    expect(ctx.actions).toEqual([]);
  });

  test("multi-line ASK payload is captured verbatim", () => {
    const ctx = processAgentDirectives("[[ASK:line one\nline two]]", makeGS(), "agent:grimbold");
    expect(ctx.actions[0]).toEqual({
      kind: "ask",
      question: "line one\nline two",
    });
  });
});

describe("agent directives — LOOK", () => {
  test("[[LOOK]] without target captures general look", () => {
    const ctx = processAgentDirectives("[[LOOK]]", makeGS(), "agent:grimbold");
    expect(ctx.actions).toEqual([{ kind: "look", target: null }]);
  });

  test("[[LOOK:target]] captures target", () => {
    const ctx = processAgentDirectives(
      "I study the altar. [[LOOK:the stone altar]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toEqual([{ kind: "look", target: "the stone altar" }]);
    expect(ctx.processedText).toBe("I study the altar.");
  });
});

describe("agent directives — WHISPER", () => {
  test("whisper to another party member is captured", () => {
    const ctx = processAgentDirectives(
      "[[WHISPER:Fusetsu TEXT:I think the door is trapped]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toHaveLength(1);
    const whisper = ctx.actions[0];
    expect(whisper.kind).toBe("whisper");
    if (whisper.kind === "whisper") {
      expect(whisper.target.characterSheet.name).toBe("Fusetsu");
      expect(whisper.message).toBe("I think the door is trapped");
    }
  });

  test("whisper to self is dropped", () => {
    const ctx = processAgentDirectives(
      "[[WHISPER:Grimbold Ironforge TEXT:talking to myself]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toEqual([]);
  });

  test("whisper to unknown target is dropped", () => {
    const ctx = processAgentDirectives(
      "[[WHISPER:Nobody TEXT:ghost message]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toEqual([]);
  });

  test("empty whisper message is dropped", () => {
    const ctx = processAgentDirectives("[[WHISPER:Fusetsu TEXT: ]]", makeGS(), "agent:grimbold");
    expect(ctx.actions).toEqual([]);
  });

  test("whisper target matching is case-insensitive", () => {
    const ctx = processAgentDirectives("[[WHISPER:fusetsu TEXT:hey]]", makeGS(), "agent:grimbold");
    expect(ctx.actions).toHaveLength(1);
  });

  test("agent-to-agent whisper is allowed", () => {
    const ctx = processAgentDirectives(
      "[[WHISPER:Nyx Namfoodle TEXT:cover me]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.actions).toHaveLength(1);
    const whisper = ctx.actions[0];
    if (whisper.kind === "whisper") {
      expect(whisper.target.isAgent).toBe(true);
      expect(whisper.target.characterSheet.name).toBe("Nyx Namfoodle");
    }
  });
});

describe("agent directives — combined", () => {
  test("PASS + ASK combine correctly", () => {
    const ctx = processAgentDirectives(
      "[[ASK:what's nearby?]] [[PASS]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.passed).toBe(true);
    expect(ctx.actions.map((a) => a.kind)).toEqual(["pass", "ask"]);
  });

  test("directive stripping preserves IC text between directives", () => {
    const ctx = processAgentDirectives(
      "Grimbold steps forward. [[LOOK:the door]] He waits. [[PASS]]",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.processedText).toBe("Grimbold steps forward. He waits.");
    expect(ctx.passed).toBe(true);
    expect(ctx.actions.map((a) => a.kind).sort()).toEqual(["look", "pass"]);
  });

  test("no directives at all → passthrough text", () => {
    const ctx = processAgentDirectives(
      "I swing my warhammer at the goblin.",
      makeGS(),
      "agent:grimbold",
    );
    expect(ctx.processedText).toBe("I swing my warhammer at the goblin.");
    expect(ctx.actions).toEqual([]);
    expect(ctx.passed).toBe(false);
  });
});
