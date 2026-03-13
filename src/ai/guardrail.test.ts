import { describe, expect, test } from "bun:test";
import {
  AGENT_GUARDRAIL_SYSTEM,
  buildAgentGuardrailPrompt,
  buildGuardrailPrompt,
  GUARDRAIL_SYSTEM,
  parseGuardrailResponse,
} from "./guardrail-check.js";

describe("guardrail", () => {
  describe("GUARDRAIL_SYSTEM prompt", () => {
    test("contains player agency rules", () => {
      expect(GUARDRAIL_SYSTEM).toContain("NEVER narrate");
      expect(GUARDRAIL_SYSTEM).toContain("player character");
    });

    test("lists violation examples", () => {
      expect(GUARDRAIL_SYSTEM).toContain("Violations include");
      expect(GUARDRAIL_SYSTEM).toContain("physical actions");
      expect(GUARDRAIL_SYSTEM).toContain("speech");
      expect(GUARDRAIL_SYSTEM).toContain("thoughts or feelings");
      expect(GUARDRAIL_SYSTEM).toContain("attempts");
    });

    test("lists non-violation examples", () => {
      expect(GUARDRAIL_SYSTEM).toContain("NOT violations");
      expect(GUARDRAIL_SYSTEM).toContain("outcome of an action the PC explicitly stated");
      expect(GUARDRAIL_SYSTEM).toContain("Addressing a PC directly");
    });

    test("specifies JSON output format", () => {
      expect(GUARDRAIL_SYSTEM).toContain('"pass": true');
      expect(GUARDRAIL_SYSTEM).toContain('"pass": false');
      expect(GUARDRAIL_SYSTEM).toContain('"violation"');
    });
  });

  describe("buildGuardrailPrompt", () => {
    const pcNames = ["Fūsetsu", "Grimbold Ironforge"];

    test("includes all PC names", () => {
      const prompt = buildGuardrailPrompt("Some narration.", pcNames);
      expect(prompt).toContain("- Fūsetsu");
      expect(prompt).toContain("- Grimbold Ironforge");
    });

    test("includes the DM response text", () => {
      const prompt = buildGuardrailPrompt("The dragon roars and fire fills the cavern.", pcNames);
      expect(prompt).toContain("The dragon roars and fire fills the cavern.");
    });

    test("has a header for PC names section", () => {
      const prompt = buildGuardrailPrompt("Test.", pcNames);
      expect(prompt).toContain("## Player Characters");
      expect(prompt).toContain("must NOT be controlled");
    });

    test("has a header for DM narration section", () => {
      const prompt = buildGuardrailPrompt("Test.", pcNames);
      expect(prompt).toContain("## DM Narration to Check");
    });

    test("works with a single PC", () => {
      const prompt = buildGuardrailPrompt("Test.", ["Solo"]);
      expect(prompt).toContain("- Solo");
    });

    test("works with many PCs", () => {
      const names = ["Alice", "Bob", "Charlie", "Diana", "Eve"];
      const prompt = buildGuardrailPrompt("Test.", names);
      for (const name of names) {
        expect(prompt).toContain(`- ${name}`);
      }
    });
  });

  describe("parseGuardrailResponse", () => {
    test("parses clean pass response", () => {
      const result = parseGuardrailResponse('{"pass": true}');
      expect(result.pass).toBe(true);
      expect(result.violation).toBeUndefined();
    });

    test("parses clean fail response", () => {
      const result = parseGuardrailResponse(
        '{"pass": false, "violation": "DM narrated PC action"}',
      );
      expect(result.pass).toBe(false);
      expect(result.violation).toBe("DM narrated PC action");
    });

    test("handles JSON wrapped in markdown code fences", () => {
      const result = parseGuardrailResponse('```json\n{"pass": true}\n```');
      expect(result.pass).toBe(true);
    });

    test("handles JSON with surrounding text", () => {
      const result = parseGuardrailResponse(
        'Here is my analysis:\n{"pass": false, "violation": "controlled PC"}\nThat is my verdict.',
      );
      expect(result.pass).toBe(false);
      expect(result.violation).toBe("controlled PC");
    });

    test("handles extra whitespace around JSON", () => {
      const result = parseGuardrailResponse('  \n  {"pass": false, "violation": "test"}  \n  ');
      expect(result.pass).toBe(false);
      expect(result.violation).toBe("test");
    });

    test("returns pass:true when no JSON found", () => {
      const result = parseGuardrailResponse("I cannot determine if this is a violation.");
      expect(result.pass).toBe(true);
    });

    test("returns pass:true on malformed JSON", () => {
      const result = parseGuardrailResponse("{not valid json at all");
      expect(result.pass).toBe(true);
    });

    test("returns pass:true on empty string", () => {
      const result = parseGuardrailResponse("");
      expect(result.pass).toBe(true);
    });

    test("extracts violation message with special characters", () => {
      const result = parseGuardrailResponse(
        '{"pass": false, "violation": "DM narrated Fūsetsu\'s thoughts — he felt uneasy"}',
      );
      expect(result.pass).toBe(false);
      expect(result.violation).toContain("Fūsetsu");
    });

    test("handles pass:true with extra fields", () => {
      const result = parseGuardrailResponse('{"pass": true, "confidence": 0.95}');
      expect(result.pass).toBe(true);
    });
  });

  describe("AGENT_GUARDRAIL_SYSTEM prompt", () => {
    test("contains world fact invention rules", () => {
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("invent");
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("detect");
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("perceive");
    });

    test("lists violation examples", () => {
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("Violations include");
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("NOT violations");
    });

    test("allows emotional reactions and intentions", () => {
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("intentions");
      expect(AGENT_GUARDRAIL_SYSTEM).toContain("Emotional reactions");
    });

    test("specifies JSON output format", () => {
      expect(AGENT_GUARDRAIL_SYSTEM).toContain('"pass"');
      expect(AGENT_GUARDRAIL_SYSTEM).toContain('"violation"');
    });
  });

  describe("buildAgentGuardrailPrompt", () => {
    test("includes agent name", () => {
      const prompt = buildAgentGuardrailPrompt(
        "I raise my shield.",
        "Grimbold",
        "The cave is dark.",
      );
      expect(prompt).toContain("Grimbold");
    });

    test("includes agent response", () => {
      const prompt = buildAgentGuardrailPrompt(
        "I raise my shield.",
        "Grimbold",
        "The cave is dark.",
      );
      expect(prompt).toContain("I raise my shield.");
    });

    test("includes DM context", () => {
      const prompt = buildAgentGuardrailPrompt(
        "I raise my shield.",
        "Grimbold",
        "The cave is dark and cold.",
      );
      expect(prompt).toContain("The cave is dark and cold.");
    });

    test("has section headers", () => {
      const prompt = buildAgentGuardrailPrompt("Test.", "Agent", "Context.");
      expect(prompt).toContain("## Agent Character");
      expect(prompt).toContain("## What the DM Has Described");
      expect(prompt).toContain("## Agent Response to Check");
    });
  });
});
