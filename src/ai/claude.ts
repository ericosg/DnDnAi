import { log } from "../logger.js";
import {
  buildSpawnArgs,
  buildSpawnEnv,
  extractFailureDiagnostics,
  isRetryable,
  parseStreamJson,
  summarizeToolInput,
} from "./claude-subprocess.js";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;
const TIMEOUT_SIMPLE_MS = 2 * 60 * 1000; // 2 min
const TIMEOUT_AGENTIC_MS = 5 * 60 * 1000; // 5 min

interface WaitResult {
  exitCode: number;
  timedOut: boolean;
}

/** Race proc.exited against a timeout. On timeout, kills the process. */
async function waitWithTimeout(
  proc: { exited: Promise<number>; kill: (signal?: number) => void },
  timeoutMs: number,
): Promise<WaitResult> {
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<WaitResult>((resolve) => {
    timer = setTimeout(() => {
      killed = true;
      proc.kill();
      resolve({ exitCode: -1, timedOut: true });
    }, timeoutMs);
  });

  const exitPromise = proc.exited.then((code) => {
    clearTimeout(timer);
    return { exitCode: code, timedOut: killed } as WaitResult;
  });

  return Promise.race([exitPromise, timeoutPromise]);
}

export async function chat(
  model: string,
  system: string,
  messages: ChatMessage[],
  allowedTools?: string[],
  effort?: "low" | "medium" | "high" | "max",
): Promise<string> {
  const prompt = messages.map((m) => m.content).join("\n\n");
  const args = buildSpawnArgs(model, system, prompt, allowedTools, "text", effort);
  const env = buildSpawnEnv();

  log.debug(`Claude call: model=${model} promptLen=${prompt.length}`);

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const { exitCode, timedOut } = await waitWithTimeout(proc, TIMEOUT_SIMPLE_MS);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (timedOut) {
        const msg = `Claude CLI timeout after ${TIMEOUT_SIMPLE_MS / 1000}s`;
        log.error(msg);
        throw new RetryableError(msg);
      }

      if (exitCode !== 0) {
        const msg = extractFailureDiagnostics(stdout, stderr, exitCode, false);
        log.error(`Claude CLI failed (exit ${exitCode}): ${msg.slice(0, 300)}`);
        if (isRetryable(msg, exitCode)) {
          throw new RetryableError(msg);
        }
        throw new Error(`Claude CLI error: ${msg}`);
      }

      log.debug(`Claude response: ${stdout.trim().length} chars`);
      return stdout.trim();
    } catch (err: unknown) {
      lastError = err;
      if (err instanceof RetryableError) {
        const delay = BASE_DELAY * 2 ** attempt;
        log.warn(`Claude CLI retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Agentic chat — uses stream-json output to log tool use in real time.
 * The DM uses this so we can see when it reads files, writes notes, etc.
 */
export async function chatAgentic(
  model: string,
  system: string,
  messages: ChatMessage[],
  allowedTools: string[],
  label: string,
  effort?: "low" | "medium" | "high" | "max",
): Promise<string> {
  const prompt = messages.map((m) => m.content).join("\n\n");
  const args = buildSpawnArgs(model, system, prompt, allowedTools, "stream-json", effort);
  const env = buildSpawnEnv();

  log.debug(`Claude agentic call: model=${model} promptLen=${prompt.length}`);

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const { exitCode, timedOut } = await waitWithTimeout(proc, TIMEOUT_AGENTIC_MS);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (timedOut) {
        const diag = extractFailureDiagnostics(stdout, stderr, exitCode, true);
        const msg = `Claude CLI timeout after ${TIMEOUT_AGENTIC_MS / 1000}s | ${diag}`;
        log.error(msg);
        throw new RetryableError(msg);
      }

      if (exitCode !== 0) {
        const msg = extractFailureDiagnostics(stdout, stderr, exitCode, true);
        log.error(`Claude CLI failed (exit ${exitCode}): ${msg.slice(0, 300)}`);
        if (isRetryable(msg, exitCode)) {
          throw new RetryableError(msg);
        }
        throw new Error(`Claude CLI error: ${msg}`);
      }

      // Parse stream-json output and log tool uses
      const parsed = parseStreamJson(stdout);

      for (const tool of parsed.toolUses) {
        const summary = summarizeToolInput(tool.name, tool.input);
        log.info(`  ${label} tool: ${tool.name} → ${summary}`);
      }

      if (parsed.toolUses.length > 0 && parsed.numTurns > 1) {
        log.info(
          `  ${label} agentic: ${parsed.toolUses.length} tool calls across ${parsed.numTurns} turns`,
        );
      }

      log.debug(`Claude agentic response: ${parsed.resultText.length} chars`);
      return parsed.resultText;
    } catch (err: unknown) {
      lastError = err;
      if (err instanceof RetryableError) {
        const delay = BASE_DELAY * 2 ** attempt;
        log.warn(`Claude CLI retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}
