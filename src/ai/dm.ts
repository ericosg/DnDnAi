import { readFile } from "node:fs/promises";
import { COMPRESS_EVERY, models } from "../config.js";
import type { GameState, TurnEntry } from "../state/types.js";
import { chat, chatAgentic } from "./claude.js";
import {
  buildAskPrompt,
  buildDMPrompt,
  buildPausePrompt,
  buildResumePrompt,
  type CompressionResult,
  DM_ALLOWED_TOOLS,
  parseSceneState,
} from "./dm-prompt.js";

export type { CompressionResult } from "./dm-prompt.js";
export { buildDMPrompt } from "./dm-prompt.js";

/**
 * Load the DM's persistent context file (dm-notes/dm.md).
 * This file is always injected into the DM system prompt — the DM's "running memory."
 */
export async function loadDMContext(gameId: string): Promise<string | null> {
  try {
    const content = await readFile(`data/games/${gameId}/dm-notes/dm.md`, "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

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

/**
 * Load the campaign blueprint (dm-notes/campaign.md).
 * Always injected into the DM prompt to keep the plot on track.
 */
export async function loadCampaignBlueprint(gameId: string): Promise<string | null> {
  try {
    const content = await readFile(`data/games/${gameId}/dm-notes/campaign.md`, "utf-8");
    const trimmed = content.trim();
    // Skip placeholder content
    if (trimmed.length === 0 || trimmed.includes("will be generated")) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Load canonical facts, DM context, and campaign blueprint for a game. */
async function loadDMPromptContext(gameId: string): Promise<{
  canonicalFacts: string | null;
  dmContext: string | null;
  campaignBlueprint: string | null;
}> {
  const [canonicalFacts, dmContext, campaignBlueprint] = await Promise.all([
    loadCanonicalFacts(gameId),
    loadDMContext(gameId),
    loadCampaignBlueprint(gameId),
  ]);
  return { canonicalFacts, dmContext, campaignBlueprint };
}

export async function dmNarrate(
  gameState: GameState,
  history: TurnEntry[],
  currentActions: string,
  askHistory?: string | null,
  effort?: "low" | "medium" | "high" | "max",
): Promise<string> {
  const { canonicalFacts, dmContext, campaignBlueprint } = await loadDMPromptContext(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    currentActions,
    askHistory,
    canonicalFacts,
    dmContext,
    campaignBlueprint,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM", effort);
}

export async function dmRecap(gameState: GameState, history: TurnEntry[]): Promise<string> {
  const { canonicalFacts, dmContext, campaignBlueprint } = await loadDMPromptContext(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    "Please provide a dramatic recap of the adventure so far, summarizing key events, discoveries, and character moments. Write it as a 'Previously on...' narration. Read the full history.json file to ensure accuracy.",
    null,
    canonicalFacts,
    dmContext,
    campaignBlueprint,
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

  const { canonicalFacts, dmContext, campaignBlueprint } = await loadDMPromptContext(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    prompt,
    null,
    canonicalFacts,
    dmContext,
    campaignBlueprint,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM look");
}

export async function dmAsk(
  gameState: GameState,
  history: TurnEntry[],
  question: string,
  askerName?: string,
  askHistory?: string | null,
): Promise<string> {
  const { canonicalFacts, dmContext, campaignBlueprint } = await loadDMPromptContext(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    buildAskPrompt(question, askerName, askHistory),
    askHistory,
    canonicalFacts,
    dmContext,
    campaignBlueprint,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM ask");
}

export async function dmPause(gameState: GameState, history: TurnEntry[]): Promise<string> {
  const { canonicalFacts, dmContext, campaignBlueprint } = await loadDMPromptContext(gameState.id);
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    buildPausePrompt(),
    null,
    canonicalFacts,
    dmContext,
    campaignBlueprint,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM pause");
}

export async function dmResume(gameState: GameState, history: TurnEntry[]): Promise<string> {
  const { canonicalFacts, dmContext, campaignBlueprint } = await loadDMPromptContext(gameState.id);
  const needsBlueprint = !campaignBlueprint;
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    buildResumePrompt(needsBlueprint),
    null,
    canonicalFacts,
    dmContext,
    campaignBlueprint,
  );
  return chatAgentic(models.dm, system, messages, DM_ALLOWED_TOOLS, "DM resume");
}

export async function compressNarrative(
  gameState: GameState,
  history: TurnEntry[],
  canonicalFacts?: string | null,
): Promise<CompressionResult> {
  const existing = gameState.narrativeSummary
    ? `Previous summary:\n${gameState.narrativeSummary}\n\n`
    : "";

  // Use a wider window (2x COMPRESS_EVERY) for better context
  const recentText = history
    .slice(-COMPRESS_EVERY * 2)
    .map((t) => `[${t.playerName}] ${t.content}`)
    .join("\n");

  const system = `You are a concise narrative summarizer for a D&D campaign. Combine the existing summary with recent events into a structured scene snapshot followed by a 2-4 paragraph narrative summary.

CRITICAL — Your output MUST follow this exact format:

LOCATION: <the party's exact current physical location — be specific>
TIME: <time of day (dawn, morning, noon, afternoon, dusk, evening, night, midnight)>
NPCS_PRESENT: <comma-separated list of NPCs currently present with or near the party — omit NPCs who have left>
KEY_STATE: <pipe-separated list of 3-5 important current-state facts>
---
<2-4 paragraph prose narrative summary>

CRITICAL — Always preserve in the summary:
- The party's CURRENT physical location (where they are RIGHT NOW, not where they were)
- Whether a rest occurred (short or long) and its consequences
- Key plot developments and NPC interactions
- Time of day if established

If recent events contradict the existing summary (e.g., the party moved, rested, or retreated), UPDATE the summary to reflect the current state. The summary should always describe where things stand NOW, not where they stood before.

The LOCATION, TIME, and NPCS_PRESENT fields must reflect the CURRENT state, not past states. Be precise — "Edric is outside the cellar entrance" not "Edric is arriving."

Omit mechanical details (dice rolls, HP numbers) unless plot-relevant.`;

  let userContent = `${existing}Recent events:\n${recentText}\n\n`;
  if (canonicalFacts) {
    userContent += `Canonical facts (use these exact names/details, never contradict them):\n${canonicalFacts}\n\n`;
  }
  userContent += "Create the structured scene snapshot and updated narrative summary.";

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userContent },
  ];

  const raw = await chat(models.agent, system, messages);

  // Parse structured header; fall back to treating entire response as prose
  const parsed = parseSceneState(raw);
  if (parsed) {
    return { narrativeSummary: parsed.prose, sceneState: parsed.sceneState };
  }

  // Fallback: keep existing scene state, use full response as summary
  return {
    narrativeSummary: raw,
    sceneState: gameState.sceneState ?? {
      location: "",
      timeOfDay: "",
      presentNPCs: [],
      keyFacts: [],
    },
  };
}
