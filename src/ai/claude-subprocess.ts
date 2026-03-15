/**
 * Pure helper functions for building Claude CLI subprocess arguments.
 * Separated from claude.ts so they can be unit-tested without cross-file mock pollution.
 */

/** Build the CLI argument array for a `claude -p` subprocess call. */
export function buildSpawnArgs(
  model: string,
  system: string,
  prompt: string,
  allowedTools?: string[],
  outputFormat: "text" | "stream-json" = "text",
): string[] {
  const args = [
    "claude",
    "-p",
    prompt,
    "--model",
    model,
    "--system-prompt",
    system,
    "--output-format",
    outputFormat,
    "--no-session-persistence",
    "--dangerously-skip-permissions",
  ];

  if (outputFormat === "stream-json") {
    args.push("--verbose");
  }

  if (allowedTools?.length) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  return args;
}

/** Summarize a tool_use input for logging (keep it short). */
export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
      return `${input.file_path ?? ""}`;
    case "Write":
      return `${input.file_path ?? ""} (${typeof input.content === "string" ? input.content.length : 0} chars)`;
    case "Edit":
      return `${input.file_path ?? ""}`;
    case "Glob":
      return `${input.pattern ?? ""}${input.path ? ` in ${input.path}` : ""}`;
    case "Grep":
      return `"${input.pattern ?? ""}"${input.path ? ` in ${input.path}` : ""}`;
    default:
      return JSON.stringify(input).slice(0, 100);
  }
}

/**
 * Build the environment for a claude subprocess, with safety overrides.
 *
 * - `CLAUDECODE=""` — prevents nested-session rejection when the bot is
 *   launched from inside Claude Code (e.g. during development).
 * - `GIT_PAGER="cat"` / `PAGER="cat"` — prevents interactive pagers from
 *   hanging the headless subprocess.
 */
export function buildSpawnEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    CLAUDECODE: "",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

/** Parse stream-json output, extracting tool uses and the final text response. */
export function parseStreamJson(stdout: string): {
  resultText: string;
  toolUses: { name: string; input: Record<string, unknown> }[];
  numTurns: number;
} {
  let resultText = "";
  const toolUses: { name: string; input: Record<string, unknown> }[] = [];
  const textBlocks: string[] = [];
  let numTurns = 0;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            toolUses.push({ name: block.name, input: block.input ?? {} });
          } else if (block.type === "text" && block.text) {
            textBlocks.push(block.text);
          }
        }
      }

      if (event.type === "result") {
        resultText = event.result ?? "";
        numTurns = event.num_turns ?? 0;
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Use result text if available, otherwise fall back to collected text blocks
  const finalText = (resultText || textBlocks.join("\n\n")).trim();
  return { resultText: finalText, toolUses, numTurns };
}

/** Returns true if a CLI error message indicates a retryable condition. */
export function isRetryable(errorMsg: string): boolean {
  return (
    errorMsg.includes("overloaded") ||
    errorMsg.includes("rate") ||
    errorMsg.includes("529") ||
    errorMsg.includes("500")
  );
}
