import { log } from "../logger.js";
import {
  buildSpawnArgs,
  buildSpawnEnv,
  isRetryable,
  summarizeToolInput,
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
): Promise<string> {
  const prompt = messages.map((m) => m.content).join("\n\n");
  const args = buildSpawnArgs(model, system, prompt, allowedTools);
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

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        const msg = stderr.trim() || `claude exited with code ${exitCode}`;
        log.error(`Claude CLI failed (exit ${exitCode}): ${msg.slice(0, 200)}`);
        if (isRetryable(msg)) {
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
): Promise<string> {
  const prompt = messages.map((m) => m.content).join("\n\n");
  const args = buildSpawnArgs(model, system, prompt, allowedTools, "stream-json");
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

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        const msg = stderr.trim() || `claude exited with code ${exitCode}`;
        log.error(`Claude CLI failed (exit ${exitCode}): ${msg.slice(0, 200)}`);
        if (isRetryable(msg)) {
          throw new RetryableError(msg);
        }
        throw new Error(`Claude CLI error: ${msg}`);
      }

      // Parse stream-json output: one JSON object per line
      let resultText = "";
      let toolUseCount = 0;

      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Log tool use events
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "tool_use") {
                toolUseCount++;
                const summary = summarizeToolInput(block.name, block.input ?? {});
                log.info(`  ${label} tool: ${block.name} → ${summary}`);
              }
            }
          }

          // Extract final result
          if (event.type === "result") {
            resultText = event.result ?? "";
            if (event.num_turns && event.num_turns > 1) {
              log.info(
                `  ${label} agentic: ${toolUseCount} tool calls across ${event.num_turns} turns`,
              );
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      log.debug(`Claude agentic response: ${resultText.length} chars`);
      return resultText.trim();
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
