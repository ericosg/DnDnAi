import { buildSpawnArgs, buildSpawnEnv, isRetryable } from "./claude-subprocess.js";

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
  maxTokens = 2048,
): Promise<string> {
  const prompt = messages.map((m) => m.content).join("\n\n");
  const args = buildSpawnArgs(model, system, prompt, maxTokens);
  const env = buildSpawnEnv();

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
        if (isRetryable(msg)) {
          throw new RetryableError(msg);
        }
        throw new Error(`Claude CLI error: ${msg}`);
      }

      return stdout.trim();
    } catch (err: unknown) {
      lastError = err;
      if (err instanceof RetryableError) {
        const delay = BASE_DELAY * 2 ** attempt;
        console.warn(`Claude CLI retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
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
