import { readFile } from "node:fs/promises";
import { COMPRESS_EVERY, models } from "../config.js";
import type { GameState, TurnEntry } from "../state/types.js";
import { chat, chatAgentic } from "./claude.js";
import { buildAskPrompt, buildDMPrompt, DM_ALLOWED_TOOLS } from "./dm-prompt.js";

export { buildDMPrompt } from "./dm-prompt.js";

/**
 * Load the CANONICAL FACTS section from dm-notes/world.md.
 * Returns the text between `## ⚠️ CANONICAL FACTS` and the next `##` heading, or null.
 */
export async function loadCanonicalFacts(gameId: string): Promise<string | null> {
  try {
    const content = await readFile(`data/games/${gameId}/dm-notes/world.md`, "utf-8");
    const startMarker = "## ⚠️ CANONICAL FACTS";
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) return null;
    const afterHeader = startIdx + startMarker.length;
    // Find the next ## heading (or end of file)
    const nextHeading = content.indexOf("\n## ", afterHeader);
    const section =
      nextHeading === -1 ? content.slice(afterHeader) : content.slice(afterHeader, nextHeading);
    const trimmed = section.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function dmNarrate(
  gameState: GameState,
  history: TurnEntry[],
  currentActions: string,
  askHistory?: string | null,
  effort?: "low" | "medium" | "high" | "max",
): Promise<string> {
  const canonicalFacts = await loadCanonicalFacts(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    currentActions,
    askHistory,
    canonicalFacts,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM", effort);
}

export async function dmRecap(gameState: GameState, history: TurnEntry[]): Promise<string> {
  const canonicalFacts = await loadCanonicalFacts(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    "Please provide a dramatic recap of the adventure so far, summarizing key events, discoveries, and character moments. Write it as a 'Previously on...' narration. Read the full history.json file to ensure accuracy.",
    null,
    canonicalFacts,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM recap");
}

export async function dmLook(
  gameState: GameState,
  history: TurnEntry[],
  target?: string,
): Promise<string> {
  const prompt = target
    ? `A player wants to examine: "${target}". Describe what they see, hear, and sense. Include any details that might be relevant for gameplay.`
    : `A player looks around. Describe the current environment in detail — sights, sounds, smells, and anything notable they might interact with.`;

  const canonicalFacts = await loadCanonicalFacts(gameState.id);
  const { system, messages } = buildDMPrompt(gameState, history, prompt, null, canonicalFacts);
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM look");
}

export async function dmAsk(
  gameState: GameState,
  history: TurnEntry[],
  question: string,
  askerName?: string,
  askHistory?: string | null,
): Promise<string> {
  const canonicalFacts = await loadCanonicalFacts(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    buildAskPrompt(question, askerName, askHistory),
    askHistory,
    canonicalFacts,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM ask");
}

export async function compressNarrative(
  gameState: GameState,
  history: TurnEntry[],
  canonicalFacts?: string | null,
): Promise<string> {
  const existing = gameState.narrativeSummary
    ? `Previous summary:\n${gameState.narrativeSummary}\n\n`
    : "";

  const recentText = history
    .slice(-COMPRESS_EVERY)
    .map((t) => `[${t.playerName}] ${t.content}`)
    .join("\n");

  const system = `You are a concise narrative summarizer for a D&D campaign. Combine the existing summary with recent events into a coherent 2-4 paragraph narrative summary.

CRITICAL — Always preserve in the summary:
- The party's CURRENT physical location (where they are RIGHT NOW, not where they were)
- Whether a rest occurred (short or long) and its consequences
- Key plot developments and NPC interactions
- Time of day if established

If recent events contradict the existing summary (e.g., the party moved, rested, or retreated), UPDATE the summary to reflect the current state. The summary should always describe where things stand NOW, not where they stood before.

Omit mechanical details (dice rolls, HP numbers) unless plot-relevant.`;

  let userContent = `${existing}Recent events:\n${recentText}\n\n`;
  if (canonicalFacts) {
    userContent += `Canonical facts (use these exact names/details, never contradict them):\n${canonicalFacts}\n\n`;
  }
  userContent += "Create an updated narrative summary.";

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userContent },
  ];

  return chat(models.agent, system, messages);
}
