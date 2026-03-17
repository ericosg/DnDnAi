import { describe, expect, test } from "bun:test";
import {
  buildSpawnArgs,
  buildSpawnEnv,
  extractFailureDiagnostics,
  isRetryable,
  parseStreamJson,
  summarizeToolInput,
} from "./claude-subprocess.js";

describe("claude CLI subprocess", () => {
  describe("buildSpawnArgs", () => {
    const args = buildSpawnArgs("claude-opus-4-20250514", "You are a DM.", "Describe the room.");

    test("starts with claude binary", () => {
      expect(args[0]).toBe("claude");
    });

    test("uses -p flag with prompt", () => {
      const idx = args.indexOf("-p");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("Describe the room.");
    });

    test("passes model via --model", () => {
      const idx = args.indexOf("--model");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("claude-opus-4-20250514");
    });

    test("passes system prompt via --system-prompt", () => {
      const idx = args.indexOf("--system-prompt");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("You are a DM.");
    });

    test("does not include --max-tokens (not supported by CLI)", () => {
      expect(args).not.toContain("--max-tokens");
    });

    test("uses text output format", () => {
      const idx = args.indexOf("--output-format");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("text");
    });

    test("includes --no-session-persistence", () => {
      expect(args).toContain("--no-session-persistence");
    });

    test("includes --dangerously-skip-permissions for headless operation", () => {
      expect(args).toContain("--dangerously-skip-permissions");
    });
  });

  describe("buildSpawnEnv", () => {
    const env = buildSpawnEnv();

    test("blanks CLAUDECODE to prevent nested session rejection", () => {
      expect(env.CLAUDECODE).toBe("");
    });

    test("sets GIT_PAGER=cat to prevent pager hangs", () => {
      expect(env.GIT_PAGER).toBe("cat");
    });

    test("sets PAGER=cat to prevent pager hangs", () => {
      expect(env.PAGER).toBe("cat");
    });

    test("inherits PATH from process.env", () => {
      expect(env.PATH).toBe(process.env.PATH);
    });

    test("inherits HOME from process.env", () => {
      expect(env.HOME).toBe(process.env.HOME);
    });

    test("overrides inherited CLAUDECODE even if set", () => {
      const original = process.env.CLAUDECODE;
      process.env.CLAUDECODE = "some-session-id";
      try {
        const freshEnv = buildSpawnEnv();
        expect(freshEnv.CLAUDECODE).toBe("");
      } finally {
        if (original === undefined) {
          delete process.env.CLAUDECODE;
        } else {
          process.env.CLAUDECODE = original;
        }
      }
    });
  });

  describe("isRetryable", () => {
    test("retries on overloaded", () => {
      expect(isRetryable("API is overloaded")).toBe(true);
    });

    test("retries on rate limit", () => {
      expect(isRetryable("rate limit exceeded")).toBe(true);
    });

    test("retries on 529 status", () => {
      expect(isRetryable("HTTP 529")).toBe(true);
    });

    test("retries on 500 status", () => {
      expect(isRetryable("HTTP 500 internal error")).toBe(true);
    });

    test("retries on timeout", () => {
      expect(isRetryable("connection timeout")).toBe(true);
    });

    test("retries on exit code 1 with fallback message", () => {
      expect(isRetryable("claude exited with code 1 (no output)", 1)).toBe(true);
    });

    test("does not retry exit code 1 with real stderr", () => {
      expect(isRetryable("Invalid API key", 1)).toBe(false);
    });

    test("does not retry exit code 2 with fallback message", () => {
      expect(isRetryable("claude exited with code 2", 2)).toBe(false);
    });

    test("does not retry on invalid key", () => {
      expect(isRetryable("Invalid API key")).toBe(false);
    });

    test("does not retry on unknown model", () => {
      expect(isRetryable("Unknown model specified")).toBe(false);
    });

    test("does not retry on generic error", () => {
      expect(isRetryable("something went wrong")).toBe(false);
    });

    test("existing patterns still work with exitCode param", () => {
      expect(isRetryable("API is overloaded", 1)).toBe(true);
      expect(isRetryable("rate limit exceeded", 0)).toBe(true);
    });
  });

  describe("outputFormat parameter", () => {
    test("defaults to text output format", () => {
      const args = buildSpawnArgs("m", "s", "p");
      const idx = args.indexOf("--output-format");
      expect(args[idx + 1]).toBe("text");
    });

    test("accepts stream-json output format", () => {
      const args = buildSpawnArgs("m", "s", "p", [], "stream-json");
      const idx = args.indexOf("--output-format");
      expect(args[idx + 1]).toBe("stream-json");
    });

    test("adds --verbose when using stream-json", () => {
      const args = buildSpawnArgs("m", "s", "p", [], "stream-json");
      expect(args).toContain("--verbose");
    });

    test("does not add --verbose for text output", () => {
      const args = buildSpawnArgs("m", "s", "p");
      expect(args).not.toContain("--verbose");
    });
  });

  describe("allowedTools parameter", () => {
    test("omits --allowedTools when no tools specified", () => {
      const args = buildSpawnArgs("m", "s", "p");
      expect(args).not.toContain("--allowedTools");
    });

    test("omits --allowedTools when empty array", () => {
      const args = buildSpawnArgs("m", "s", "p", []);
      expect(args).not.toContain("--allowedTools");
    });

    test("includes --allowedTools with comma-separated tool names", () => {
      const args = buildSpawnArgs("m", "s", "p", ["Read", "Write", "Grep"]);
      const idx = args.indexOf("--allowedTools");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("Read,Write,Grep");
    });

    test("single tool is passed without commas", () => {
      const args = buildSpawnArgs("m", "s", "p", ["Read"]);
      const idx = args.indexOf("--allowedTools");
      expect(args[idx + 1]).toBe("Read");
    });
  });

  describe("maxTurns parameter", () => {
    test("appends --max-turns when provided", () => {
      const args = buildSpawnArgs("m", "s", "p", [], "text", 10);
      const idx = args.indexOf("--max-turns");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("10");
    });

    test("omits --max-turns when not provided", () => {
      const args = buildSpawnArgs("m", "s", "p");
      expect(args).not.toContain("--max-turns");
    });

    test("omits --max-turns when zero", () => {
      const args = buildSpawnArgs("m", "s", "p", [], "text", 0);
      expect(args).not.toContain("--max-turns");
    });
  });

  describe("prompt construction (via buildSpawnArgs)", () => {
    test("single message becomes the prompt", () => {
      const args = buildSpawnArgs("m", "s", "Solo message.");
      const idx = args.indexOf("-p");
      expect(args[idx + 1]).toBe("Solo message.");
    });

    test("empty prompt is passed through", () => {
      const args = buildSpawnArgs("m", "s", "");
      const idx = args.indexOf("-p");
      expect(args[idx + 1]).toBe("");
    });

    test("long prompt with newlines is preserved", () => {
      const prompt = "First paragraph.\n\nSecond paragraph.\n\nThird.";
      const args = buildSpawnArgs("m", "s", prompt);
      const idx = args.indexOf("-p");
      expect(args[idx + 1]).toBe(prompt);
    });
  });

  describe("summarizeToolInput", () => {
    test("Read shows file path", () => {
      expect(summarizeToolInput("Read", { file_path: "docs/srd/07 combat.md" })).toBe(
        "docs/srd/07 combat.md",
      );
    });

    test("Write shows file path and content length", () => {
      expect(
        summarizeToolInput("Write", { file_path: "dm-notes/world.md", content: "hello world" }),
      ).toBe("dm-notes/world.md (11 chars)");
    });

    test("Glob shows pattern", () => {
      expect(summarizeToolInput("Glob", { pattern: "dm-notes/**/*.md" })).toBe("dm-notes/**/*.md");
    });

    test("Glob shows pattern with path", () => {
      expect(summarizeToolInput("Glob", { pattern: "*.md", path: "dm-notes/" })).toBe(
        "*.md in dm-notes/",
      );
    });

    test("Grep shows pattern and path", () => {
      expect(summarizeToolInput("Grep", { pattern: "Channel Divinity", path: "docs/srd/" })).toBe(
        '"Channel Divinity" in docs/srd/',
      );
    });

    test("unknown tool shows truncated JSON", () => {
      const result = summarizeToolInput("Unknown", { foo: "bar" });
      expect(result).toContain("foo");
    });
  });

  describe("parseStreamJson", () => {
    test("extracts result text from result event", () => {
      const stdout = '{"type":"result","result":"The cave is dark.","num_turns":1}\n';
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe("The cave is dark.");
      expect(parsed.toolUses).toHaveLength(0);
    });

    test("extracts tool uses from assistant events", () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"docs/srd/07 combat.md"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"The answer is..."}]}}',
        '{"type":"result","result":"The answer is...","num_turns":2}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.toolUses).toHaveLength(1);
      expect(parsed.toolUses[0].name).toBe("Read");
      expect(parsed.toolUses[0].input.file_path).toBe("docs/srd/07 combat.md");
      expect(parsed.numTurns).toBe(2);
    });

    test("falls back to text blocks when result is empty", () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"The DM narrates..."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"notes.md","content":"x"}}]}}',
        '{"type":"result","result":"","num_turns":3}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe("The DM narrates...");
    });

    test("joins multiple text blocks with double newline", () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Paragraph one."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Paragraph two."}]}}',
        '{"type":"result","result":"","num_turns":2}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe("Paragraph one.\n\nParagraph two.");
    });

    test("skips malformed JSON lines", () => {
      const stdout = [
        "not valid json",
        '{"type":"result","result":"Valid result.","num_turns":1}',
        "another bad line",
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe("Valid result.");
    });

    test("handles empty stdout", () => {
      const parsed = parseStreamJson("");
      expect(parsed.resultText).toBe("");
      expect(parsed.toolUses).toHaveLength(0);
      expect(parsed.numTurns).toBe(0);
    });

    test("handles multiple tool uses across turns", () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Glob","input":{"pattern":"dm-notes/*"}},{"type":"tool_use","name":"Read","input":{"file_path":"dm-notes/world.md"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Response."},{"type":"tool_use","name":"Write","input":{"file_path":"dm-notes/plot.md","content":"updated"}}]}}',
        '{"type":"result","result":"Response.","num_turns":3}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.toolUses).toHaveLength(3);
      expect(parsed.toolUses[0].name).toBe("Glob");
      expect(parsed.toolUses[1].name).toBe("Read");
      expect(parsed.toolUses[2].name).toBe("Write");
    });
  });

  describe("extractFailureDiagnostics", () => {
    test("uses stderr as primary message", () => {
      const result = extractFailureDiagnostics("", "API key invalid", 1, false);
      expect(result).toBe("API key invalid");
    });

    test("extracts tool call summary from stream-json stdout", () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"world.md"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Glob","input":{"pattern":"dm-notes/*"}}]}}',
      ].join("\n");
      const result = extractFailureDiagnostics(stdout, "", 1, true);
      expect(result).toContain("Tool calls before failure:");
      expect(result).toContain("Read(world.md)");
      expect(result).toContain("Glob(dm-notes/*)");
    });

    test("includes truncated text stdout excerpt", () => {
      const stdout = "Some partial output from claude";
      const result = extractFailureDiagnostics(stdout, "", 1, false);
      expect(result).toContain("stdout excerpt:");
      expect(result).toContain("Some partial output");
    });

    test("combines stderr and tool calls", () => {
      const stdout =
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"test.md"}}]}}\n';
      const result = extractFailureDiagnostics(stdout, "something broke", 1, true);
      expect(result).toContain("something broke");
      expect(result).toContain("Read(test.md)");
    });

    test("returns fallback when all output is empty", () => {
      const result = extractFailureDiagnostics("", "", 1, false);
      expect(result).toBe("claude exited with code 1 (no output)");
    });

    test("returns fallback for whitespace-only output", () => {
      const result = extractFailureDiagnostics("  \n  ", "  \n  ", 137, true);
      expect(result).toBe("claude exited with code 137 (no output)");
    });

    test("stream-json with text blocks but no tool calls returns fallback", () => {
      const stdout =
        '{"type":"assistant","message":{"content":[{"type":"text","text":"partial response"}]}}\n';
      const result = extractFailureDiagnostics(stdout, "", 1, true);
      expect(result).toBe("claude exited with code 1 (no output)");
    });
  });
});
