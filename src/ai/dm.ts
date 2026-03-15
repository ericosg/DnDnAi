import { COMPRESS_EVERY, models } from "../config.js";
import type { GameState, TurnEntry } from "../state/types.js";
import { chat } from "./claude.js";
import { buildAskPrompt, buildDMPrompt, DM_ALLOWED_TOOLS } from "./dm-prompt.js";

export { buildDMPrompt } from "./dm-prompt.js";

export async function dmNarrate(
  gameState: GameState,
  history: TurnEntry[],
  currentActions: string,
): Promise<string> {
  const { system, messages } = buildDMPrompt(gameState, history, currentActions);
  return chat(models.dm, system, messages, DM_ALLOWED_TOOLS);
}

export async function dmRecap(gameState: GameState, history: TurnEntry[]): Promise<string> {
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    "Please provide a dramatic recap of the adventure so far, summarizing key events, discoveries, and character moments. Write it as a 'Previously on...' narration. Read the full history.json file to ensure accuracy.",
  );
  return chat(models.dm, system, messages, DM_ALLOWED_TOOLS);
}

export async function dmLook(
  gameState: GameState,
  history: TurnEntry[],
  target?: string,
): Promise<string> {
  const prompt = target
    ? `A player wants to examine: "${target}". Describe what they see, hear, and sense. Include any details that might be relevant for gameplay.`
    : `A player looks around. Describe the current environment in detail — sights, sounds, smells, and anything notable they might interact with.`;

  const { system, messages } = buildDMPrompt(gameState, history, prompt);
  return chat(models.dm, system, messages, DM_ALLOWED_TOOLS);
}

export async function dmAsk(
  gameState: GameState,
  history: TurnEntry[],
  question: string,
  askerName?: string,
): Promise<string> {
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    buildAskPrompt(question, askerName),
  );
  return chat(models.dm, system, messages, DM_ALLOWED_TOOLS);
}

export async function compressNarrative(
  gameState: GameState,
  history: TurnEntry[],
): Promise<string> {
  const existing = gameState.narrativeSummary
    ? `Previous summary:\n${gameState.narrativeSummary}\n\n`
    : "";

  const recentText = history
    .slice(-COMPRESS_EVERY)
    .map((t) => `[${t.playerName}] ${t.content}`)
    .join("\n");

  const system =
    "You are a concise narrative summarizer for a D&D campaign. Combine the existing summary with recent events into a coherent 2-4 paragraph narrative summary. Focus on key plot points, character developments, and important discoveries. Omit mechanical details (dice rolls, HP changes) unless plot-relevant.";

  const messages: { role: "user" | "assistant"; content: string }[] = [
    {
      role: "user",
      content: `${existing}Recent events:\n${recentText}\n\nCreate an updated narrative summary.`,
    },
  ];

  return chat(models.orchestrator, system, messages);
}
