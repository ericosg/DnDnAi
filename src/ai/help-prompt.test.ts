/**
 * Tests for help prompt construction.
 */

import { describe, expect, test } from "bun:test";
import { buildHelpPrompt, HELP_ALLOWED_TOOLS, HELP_SYSTEM } from "./help-prompt.js";

describe("HELP_SYSTEM", () => {
  test("identifies as rules assistant, not DM", () => {
    expect(HELP_SYSTEM).toContain("rules assistant");
    expect(HELP_SYSTEM).toContain("NOT the Dungeon Master");
  });

  test("lists all bot commands", () => {
    expect(HELP_SYSTEM).toContain("/ask");
    expect(HELP_SYSTEM).toContain("/help");
    expect(HELP_SYSTEM).toContain("/how-to-play");
    expect(HELP_SYSTEM).toContain("/rest");
    expect(HELP_SYSTEM).toContain("/level-up");
    expect(HELP_SYSTEM).toContain("/character");
    expect(HELP_SYSTEM).toContain("/roll");
  });

  test("explains help vs ask difference", () => {
    expect(HELP_SYSTEM).toContain("/help vs /ask");
  });

  test("includes file paths for docs and SRD", () => {
    expect(HELP_SYSTEM).toContain("docs/how-to-play.md");
    expect(HELP_SYSTEM).toContain("docs/game-rules.md");
    expect(HELP_SYSTEM).toContain("docs/creating-characters.md");
    expect(HELP_SYSTEM).toContain("docs/srd/README.md");
    expect(HELP_SYSTEM).toContain("docs/srd/08 spellcasting.md");
  });

  test("instructs to look up rules instead of guessing", () => {
    expect(HELP_SYSTEM).toContain("look up");
    expect(HELP_SYSTEM).toContain("don't guess");
  });

  test("redirects game-specific questions to /ask", () => {
    expect(HELP_SYSTEM).toContain("/ask");
    expect(HELP_SYSTEM).toContain("game-specific");
  });
});

describe("HELP_ALLOWED_TOOLS", () => {
  test("includes read-only tools", () => {
    expect(HELP_ALLOWED_TOOLS).toContain("Read");
    expect(HELP_ALLOWED_TOOLS).toContain("Glob");
    expect(HELP_ALLOWED_TOOLS).toContain("Grep");
  });

  test("does not include write tools", () => {
    expect(HELP_ALLOWED_TOOLS).not.toContain("Write");
    expect(HELP_ALLOWED_TOOLS).not.toContain("Edit");
  });
});

describe("buildHelpPrompt", () => {
  test("returns system prompt and user message", () => {
    const { system, messages } = buildHelpPrompt("How does sneak attack work?");
    expect(system).toBe(HELP_SYSTEM);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("How does sneak attack work?");
  });
});
