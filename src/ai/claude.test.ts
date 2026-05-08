import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSpawnArgs,
  buildSpawnEnv,
  extractFailureDiagnostics,
  isRetryable,
  parseStreamJson,
  spawnAndCommunicate,
  summarizeToolInput,
  withSystemPromptFile,
} from "./claude-subprocess.js";

/**
 * Run `fn()` with PATH pointing at a temp dir whose `claude` binary is the
 * supplied bash script. Restores PATH and removes the dir afterward.
 *
 * Lets us exercise `chat()` / `chatAgentic()` end-to-end (file write,
 * spawn, stdin pipe, cleanup) without hitting the real Claude CLI.
 */
async function withFakeClaude<T>(scriptBody: string, fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "dndnai-fake-claude-"));
  const binPath = join(dir, "claude");
  await writeFile(binPath, `#!/usr/bin/env bash\n${scriptBody}\n`);
  await chmod(binPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}:${originalPath ?? ""}`;
  try {
    return await fn();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Bash prelude for fake-claude scripts: parses `--system-prompt-file <path>`
 * out of args, reads its contents, and reads stdin. Sets `$sysFile`,
 * `$sysContent`, `$userContent` for the script body to use.
 */
const captureSysAndStdin = `
sysFile=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--system-prompt-file" ]]; then
    sysFile="$2"; shift 2
  else
    shift
  fi
done
sysContent=$(cat "$sysFile")
userContent=$(cat)`;

describe("claude CLI subprocess", () => {
  describe("buildSpawnArgs", () => {
    const args = buildSpawnArgs("claude-opus-4-7", "/tmp/sysprompt-abc.txt");

    test("starts with claude binary", () => {
      expect(args[0]).toBe("claude");
    });

    test("uses -p (print) mode without a positional prompt", () => {
      const idx = args.indexOf("-p");
      expect(idx).toBeGreaterThan(-1);
      // The token after -p must be another flag, never a prompt string —
      // the user prompt is piped via stdin.
      expect(args[idx + 1]?.startsWith("--")).toBe(true);
    });

    test("never includes the legacy --system-prompt inline arg", () => {
      expect(args).not.toContain("--system-prompt");
    });

    test("passes model via --model", () => {
      const idx = args.indexOf("--model");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("claude-opus-4-7");
    });

    test("passes system prompt via --system-prompt-file", () => {
      const idx = args.indexOf("--system-prompt-file");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("/tmp/sysprompt-abc.txt");
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
      const args = buildSpawnArgs("m", "/tmp/s.txt");
      const idx = args.indexOf("--output-format");
      expect(args[idx + 1]).toBe("text");
    });

    test("accepts stream-json output format", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "stream-json");
      const idx = args.indexOf("--output-format");
      expect(args[idx + 1]).toBe("stream-json");
    });

    test("adds --verbose when using stream-json", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "stream-json");
      expect(args).toContain("--verbose");
    });

    test("does not add --verbose for text output", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt");
      expect(args).not.toContain("--verbose");
    });
  });

  describe("allowedTools parameter", () => {
    test("omits --allowedTools when no tools specified", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt");
      expect(args).not.toContain("--allowedTools");
    });

    test("omits --allowedTools when empty array", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", []);
      expect(args).not.toContain("--allowedTools");
    });

    test("includes --allowedTools with comma-separated tool names", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", ["Read", "Write", "Grep"]);
      const idx = args.indexOf("--allowedTools");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("Read,Write,Grep");
    });

    test("single tool is passed without commas", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", ["Read"]);
      const idx = args.indexOf("--allowedTools");
      expect(args[idx + 1]).toBe("Read");
    });
  });

  test("never includes --max-turns (relies on CLI timeout instead)", () => {
    const args = buildSpawnArgs("m", "/tmp/s.txt", ["Read"], "stream-json", "high");
    expect(args).not.toContain("--max-turns");
  });

  describe("effort parameter", () => {
    test("omits --effort when not provided", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt");
      expect(args).not.toContain("--effort");
    });

    test("omits --effort when undefined", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "text", undefined);
      expect(args).not.toContain("--effort");
    });

    test("includes --effort low", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "text", "low");
      const idx = args.indexOf("--effort");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("low");
    });

    test("includes --effort medium", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "text", "medium");
      const idx = args.indexOf("--effort");
      expect(args[idx + 1]).toBe("medium");
    });

    test("includes --effort high", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "text", "high");
      const idx = args.indexOf("--effort");
      expect(args[idx + 1]).toBe("high");
    });

    test("includes --effort max", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", [], "text", "max");
      const idx = args.indexOf("--effort");
      expect(args[idx + 1]).toBe("max");
    });

    test("effort works with stream-json and allowedTools", () => {
      const args = buildSpawnArgs("m", "/tmp/s.txt", ["Read"], "stream-json", "high");
      expect(args).toContain("--effort");
      expect(args).toContain("--verbose");
      const idx = args.indexOf("--effort");
      expect(args[idx + 1]).toBe("high");
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

    test("prefers text blocks over result when narration precedes tool use", () => {
      // Bug case: DM narrates in turn 1, then uses tools to update dm-notes,
      // and the final result only contains brief post-tool text — narration is lost
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"*The merchant slides a leather pouch across the counter.* \\"Fifty gold, as promised.\\"\\n\\n[[GOLD:+50 TARGET:Fūsetsu REASON:merchant payment]]\\n[[INVENTORY:ADD Enchanted Compass TARGET:Fūsetsu]]"}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"dm-notes/dm.md","old_string":"pending payment","new_string":"payment complete"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Updated dm-notes with merchant transaction."}]}}',
        '{"type":"result","result":"Updated dm-notes with merchant transaction.","num_turns":3}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      // Should include the full narration with directives, not just the brief final text
      expect(parsed.resultText).toContain("merchant slides a leather pouch");
      expect(parsed.resultText).toContain("[[GOLD:+50");
      expect(parsed.resultText).toContain("[[INVENTORY:ADD");
    });

    test("uses result text when no tool uses occurred", () => {
      // Non-agentic call — result text should be preferred as before
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"The cave is dark."}]}}',
        '{"type":"result","result":"The cave is dark.","num_turns":1}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe("The cave is dark.");
    });

    test("uses result when tools precede narration (no lost text)", () => {
      // DM reads files first, then narrates — result captures everything
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"dm-notes/world.md"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"The dragon roars! [[DAMAGE:3d6 TARGET:Grimbold REASON:fire breath]]"}]}}',
        '{"type":"result","result":"The dragon roars! [[DAMAGE:3d6 TARGET:Grimbold REASON:fire breath]]","num_turns":2}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe(
        "The dragon roars! [[DAMAGE:3d6 TARGET:Grimbold REASON:fire breath]]",
      );
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

    test("returns brief result when DM only uses tools with no narration", () => {
      // Edge case: DM does tool calls but never produces narration text blocks —
      // parseStreamJson returns the brief result; the engine guardrail catches it downstream
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"dm-notes/dm.md"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"dm-notes/dm.md","old_string":"pending","new_string":"done"}}]}}',
        '{"type":"result","result":"Updated dm-notes.","num_turns":2}',
      ].join("\n");
      const parsed = parseStreamJson(stdout);
      expect(parsed.resultText).toBe("Updated dm-notes.");
      expect(parsed.toolUses).toHaveLength(2);
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

describe("withSystemPromptFile (temp-file lifecycle)", () => {
  test("writes content to the path passed to fn", async () => {
    let observedPath = "";
    let observedContent = "";
    await withSystemPromptFile("body-here", async (path) => {
      observedPath = path;
      observedContent = await readFile(path, "utf-8");
    });
    expect(observedPath).toMatch(/dndnai-sysprompt-[^/]+\.txt$/);
    expect(observedContent).toBe("body-here");
  });

  test("path lives under os.tmpdir()", async () => {
    let observedPath = "";
    await withSystemPromptFile("x", async (path) => {
      observedPath = path;
    });
    expect(observedPath.startsWith(tmpdir())).toBe(true);
  });

  test("returns fn's result", async () => {
    const out = await withSystemPromptFile("ignored", async () => "value");
    expect(out).toBe("value");
  });

  test("unlinks the file after fn resolves", async () => {
    let observedPath = "";
    await withSystemPromptFile("x", async (path) => {
      observedPath = path;
      expect(existsSync(path)).toBe(true); // sanity: file exists during fn
    });
    expect(existsSync(observedPath)).toBe(false);
  });

  test("unlinks the file even when fn throws", async () => {
    let observedPath = "";
    await expect(
      withSystemPromptFile("x", async (path) => {
        observedPath = path;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(observedPath)).toBe(false);
  });

  test("path is stable across multiple awaits inside the same fn (retry-safe)", async () => {
    let firstPath = "";
    let secondPath = "";
    await withSystemPromptFile("x", async (path) => {
      firstPath = path;
      await new Promise((r) => setTimeout(r, 10));
      secondPath = path;
    });
    expect(firstPath).toBe(secondPath);
  });

  test("generates a unique path per call (concurrent-safe)", async () => {
    const paths: string[] = [];
    await Promise.all([
      withSystemPromptFile("a", async (p) => {
        paths.push(p);
      }),
      withSystemPromptFile("b", async (p) => {
        paths.push(p);
      }),
      withSystemPromptFile("c", async (p) => {
        paths.push(p);
      }),
    ]);
    expect(new Set(paths).size).toBe(3);
  });

  test("handles a 256KB body without truncation (regression)", async () => {
    // The point of the file path: bypass kernel argv limits. 256KB is well
    // over Linux's 128KB MAX_ARG_STRLEN — would have crashed posix_spawn
    // under the old --system-prompt <inline> path.
    const big = "x".repeat(256 * 1024);
    let observedLength = 0;
    await withSystemPromptFile(big, async (path) => {
      observedLength = (await readFile(path, "utf-8")).length;
    });
    expect(observedLength).toBe(256 * 1024);
  });
});

describe("spawnAndCommunicate (against fake claude binary)", () => {
  test("captures stdout, stderr, and exit code from the subprocess", async () => {
    const result = await withFakeClaude(
      `cat > /dev/null
echo "OUT-LINE"
echo "ERR-LINE" >&2
exit 0`,
      () => spawnAndCommunicate(["claude"], { ...process.env }, "ignored"),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("OUT-LINE");
    expect(result.stderr.trim()).toBe("ERR-LINE");
  });

  test("pipes the prompt to the subprocess's stdin", async () => {
    const result = await withFakeClaude(
      `cat`, // echo stdin to stdout verbatim
      () => spawnAndCommunicate(["claude"], { ...process.env }, "hello-stdin"),
    );
    expect(result.stdout).toBe("hello-stdin");
  });

  test("propagates non-zero exit codes", async () => {
    const result = await withFakeClaude(
      `cat > /dev/null
echo "boom" >&2
exit 7`,
      () => spawnAndCommunicate(["claude"], { ...process.env }, ""),
    );
    expect(result.exitCode).toBe(7);
    expect(result.stderr.trim()).toBe("boom");
  });

  test("handles a 256KB stdin payload without truncation (regression)", async () => {
    // Confirms stdin can carry the full user prompt — the other half of
    // bypassing the kernel's per-arg limit.
    const big = "x".repeat(256 * 1024);
    const result = await withFakeClaude(
      `wc -c`, // count bytes of stdin
      () => spawnAndCommunicate(["claude"], { ...process.env }, big),
    );
    expect(result.stdout.trim()).toBe(`${256 * 1024}`);
  });

  test("preserves embedded newlines in stdin", async () => {
    const result = await withFakeClaude(`cat`, () =>
      spawnAndCommunicate(["claude"], { ...process.env }, "first\n\nsecond\n\nthird"),
    );
    expect(result.stdout).toBe("first\n\nsecond\n\nthird");
  });
});

describe("withSystemPromptFile + spawnAndCommunicate end-to-end", () => {
  test("subprocess can read --system-prompt-file content", async () => {
    // Verifies the integration contract: chat()-style code writes a file,
    // passes its path via --system-prompt-file, and the subprocess reads
    // that file. This exercises both helpers in their real composition.
    const result = await withFakeClaude(
      `${captureSysAndStdin}
echo "SYS=$sysContent|USER=$userContent"`,
      () =>
        withSystemPromptFile("you-sys", async (sysPath) => {
          const args = buildSpawnArgs("m", sysPath);
          // Capture env *inside* the fakeClaude scope so PATH points at the fake.
          return spawnAndCommunicate(args, { ...process.env }, "you-user");
        }),
    );
    expect(result.stdout.trim()).toBe("SYS=you-sys|USER=you-user");
    expect(result.exitCode).toBe(0);
  });

  test("a retry inside fn reuses the same tmp file path", async () => {
    // Simulates chat()'s retry loop: the same fn runs the subprocess twice,
    // reusing the path the first time it was bound.
    const observedPaths: string[] = [];
    const stdouts: string[] = [];
    await withFakeClaude(
      `${captureSysAndStdin}
echo "$sysFile"`,
      () =>
        withSystemPromptFile("retry-content", async (sysPath) => {
          const args = buildSpawnArgs("m", sysPath);
          for (let i = 0; i < 2; i++) {
            const r = await spawnAndCommunicate(args, { ...process.env }, "p");
            observedPaths.push(sysPath);
            stdouts.push(r.stdout.trim());
          }
        }),
    );
    expect(observedPaths.length).toBe(2);
    expect(observedPaths[0]).toBe(observedPaths[1]);
    expect(stdouts[0]).toBe(observedPaths[0]); // subprocess saw the same path
    expect(stdouts[1]).toBe(observedPaths[1]);
    expect(existsSync(observedPaths[0])).toBe(false); // cleaned up after fn
  });
});
