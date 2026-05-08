import { log } from "../logger.js";
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

export async function chat(
  model: string,
  system: string,
  messages: ChatMessage[],
  allowedTools?: string[],
  effort?: "low" | "medium" | "high" | "max",
): Promise<string> {
  const prompt = messages.map((m) => m.content).join("\n\n");

  log.debug(`Claude call: model=${model} promptLen=${prompt.length}`);

  return withSystemPromptFile(system, async (systemPromptFile) => {
    const args = buildSpawnArgs(model, systemPromptFile, allowedTools, "text", effort);
    const env = buildSpawnEnv();

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { exitCode, stdout, stderr } = await spawnAndCommunicate(args, env, prompt);

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
  });
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

  log.debug(`Claude agentic call: model=${model} promptLen=${prompt.length}`);

  return withSystemPromptFile(system, async (systemPromptFile) => {
    const args = buildSpawnArgs(model, systemPromptFile, allowedTools, "stream-json", effort);
    const env = buildSpawnEnv();

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { exitCode, stdout, stderr } = await spawnAndCommunicate(args, env, prompt);

        if (exitCode !== 0) {
          const msg = extractFailureDiagnostics(stdout, stderr, exitCode, true);
          log.error(`Claude CLI failed (exit ${exitCode}): ${msg.slice(0, 300)}`);
          if (isRetryable(msg, exitCode)) {
            throw new RetryableError(msg);
          }
          throw new Error(`Claude CLI error: ${msg}`);
        }

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
  });
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}
