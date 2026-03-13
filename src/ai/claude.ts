import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

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
  maxTokens = 2048
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      });

      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text ?? "";
    } catch (err: unknown) {
      lastError = err;
      if (
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError
      ) {
        const delay = BASE_DELAY * Math.pow(2, attempt);
        console.warn(`Claude API retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
