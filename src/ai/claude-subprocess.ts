/**
 * Pure helper functions for building Claude CLI subprocess arguments.
 * Separated from claude.ts so they can be unit-tested without cross-file mock pollution.
 */

/** Build the CLI argument array for a `claude -p` subprocess call. */
export function buildSpawnArgs(
  model: string,
  system: string,
  prompt: string,
  maxTokens: number,
): string[] {
  return [
    "claude",
    "-p",
    prompt,
    "--model",
    model,
    "--system-prompt",
    system,
    "--max-tokens",
    String(maxTokens),
    "--output-format",
    "text",
    "--no-session-persistence",
    "--dangerously-skip-permissions",
  ];
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

/** Returns true if a CLI error message indicates a retryable condition. */
export function isRetryable(errorMsg: string): boolean {
  return (
    errorMsg.includes("overloaded") ||
    errorMsg.includes("rate") ||
    errorMsg.includes("529") ||
    errorMsg.includes("500")
  );
}
