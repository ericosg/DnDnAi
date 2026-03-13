import { describe, expect, test } from "bun:test";
import { buildSpawnArgs, buildSpawnEnv, isRetryable } from "./claude-subprocess.js";

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

    test("does not retry on invalid key", () => {
      expect(isRetryable("Invalid API key")).toBe(false);
    });

    test("does not retry on unknown model", () => {
      expect(isRetryable("Unknown model specified")).toBe(false);
    });

    test("does not retry on generic error", () => {
      expect(isRetryable("something went wrong")).toBe(false);
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
});
