import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { AGENTS_DIR, models, NARRATIVE_STYLE, STYLE_INSTRUCTIONS } from "../config.js";
import { getAgentNotesPath, readAgentNotes } from "../game/agent-notes.js";
import { log } from "../logger.js";
import type { AgentPersonality, GameState, TurnEntry } from "../state/types.js";
import { chat, chatAgentic } from "./claude.js";
import { buildCharacterReference } from "./dm-prompt.js";

/**
 * Tools the agent can use. Scoped by prompt discipline to its own memory file
 * (absolute path provided in the system prompt). Read lets the agent refresh
 * its memory; Edit lets it append entries. No Write (which could create
 * arbitrary files), no Glob/Grep (no codebase snooping needed).
 */
export const AGENT_ALLOWED_TOOLS = ["Read", "Edit"];

export async function loadAgentPersonality(name: string): Promise<AgentPersonality> {
  const filePath = path.join(AGENTS_DIR, `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Agent file not found: ${filePath}`);
  }

  const raw = await readFile(filePath, "utf-8");
  const { data, content } = matter(raw);

  return {
    name: data.name ?? name,
    race: data.race ?? "Unknown",
    class: data.class ?? "Unknown",
    level: data.level ?? 1,
    description: data.description ?? "",
    voice: data.voice ?? "",
    traits: data.traits ?? [],
    flaws: data.flaws ?? [],
    goals: data.goals ?? [],
    characterSpec: data.characterSpec ?? "",
    rawContent: content,
    model: data.model,
    avatarUrl: data.avatarUrl,
  };
}

export async function generateAgentAction(
  personality: AgentPersonality,
  gameState: GameState,
  recentHistory: TurnEntry[],
  currentSituation: string,
  effort: "low" | "medium" | "high" | "max" = "low",
): Promise<string> {
  const memoryPath = path.resolve(getAgentNotesPath(gameState.id, personality.name));
  const memoryContent = await readAgentNotes(gameState.id, personality.name);
  if (memoryContent == null) {
    log.warn(
      `Agent ${personality.name}: no memory file at ${memoryPath} — acting without persistent memory`,
    );
  }

  const system = buildAgentSystemPrompt(personality, memoryPath, memoryContent != null);
  const messages = buildAgentMessages(
    personality,
    gameState,
    recentHistory,
    currentSituation,
    memoryContent,
  );
  const model = personality.model ?? models.agent;
  return chatAgentic(model, system, messages, AGENT_ALLOWED_TOOLS, personality.name, effort);
}

export function buildAgentSystemPrompt(
  personality: AgentPersonality,
  memoryPath: string,
  memoryExists: boolean,
): string {
  const sections: string[] = [
    `You are ${personality.name}, a ${personality.race} ${personality.class} (Level ${personality.level}) in a D&D 5e campaign.`,
  ];

  // rawContent includes personality prose, combat style, and roleplay notes
  if (personality.rawContent.trim()) {
    sections.push(personality.rawContent.trim());
  }

  // Only add structured sections if rawContent doesn't already cover them
  if (personality.voice) {
    sections.push(`## Voice & Style\n${personality.voice}`);
  }

  // Structured traits/flaws/goals supplement the prose (not duplicated in rawContent)
  if (personality.traits.length) {
    sections.push(`## Key Traits\n${personality.traits.map((t) => `- ${t}`).join("\n")}`);
  }
  if (personality.flaws.length) {
    sections.push(`## Flaws\n${personality.flaws.map((f) => `- ${f}`).join("\n")}`);
  }
  if (personality.goals.length) {
    sections.push(`## Goals\n${personality.goals.map((g) => `- ${g}`).join("\n")}`);
  }

  // Memory module — tells the agent about its persistent memory file and how to maintain it.
  if (memoryExists) {
    sections.push(`## Your Memory (PERSISTENT)
Your memory file is at:
\`${memoryPath}\`

The current contents are included in the message below under "Your Memory". Read from there by default.
If you need to refresh it mid-turn (e.g. you think the file may have been updated externally), use the Read tool on that exact path.

After the DM narrates something meaningful that happens to YOU — an event worth remembering, a promise made or broken, a new relationship formed, a new item carried, a correction about your own abilities — Edit the file to append a short first-person bullet under the relevant section:
- \`## What I Remember\` — events and decisions. One bullet per event, short.
- \`## What I Carry\` — new inventory items. Remove an item only if you used/lost/gave it away in-fiction.
- \`## What I Know About Myself\` — mechanical corrections (e.g. learning you can't cast a spell you thought you had).
- \`## Bonds & Relationships\` — feelings about party members or NPCs.
- \`## Open Threads\` — things you're pursuing or worried about.

Rules for editing memory:
- NEVER delete existing bullets. Append only (unless a bullet is factually wrong and you're correcting it).
- NEVER invent events the DM did not narrate. Memory tracks the shared story, not imagination.
- Keep bullets SHORT — one sentence each. If the section exceeds ~10 bullets, condense the oldest.
- Only edit ONCE per turn at most. If nothing noteworthy happened, do not edit.`);
  } else {
    sections.push(`## Your Memory
(No memory file found — act from personality and recent history only.)`);
  }

  // Action directives — the agent's equivalent of the slash commands human players have
  sections.push(`## Your Available Actions (Directives)
You have the same out-of-character abilities a human player has, available as inline directives in \`[[double brackets]]\`. The engine parses them out before your response reaches Discord, so players never see the raw directive syntax.

- \`[[PASS]]\` — skip your turn if you have nothing meaningful to do. Combine with brief IC flavor if you want ("*${personality.name} watches quietly.*") or emit it alone.
- \`[[ASK:your question]]\` — ask the DM an out-of-character clarifying question (rules, what a thing means, what your character would remember, etc.). The DM's answer is posted publicly and recorded in history. You can also take an in-character action in the same response — put the \`[[ASK:...]]\` at the end.
- \`[[LOOK:target]]\` or \`[[LOOK]]\` — ask the DM to describe something (an object, an NPC, the current environment) in more detail. The DM's description is posted as DM narration.
- \`[[WHISPER:Target Name TEXT:your private message]]\` — send a private in-character whisper to ONE specific party member (by their character name). Only they see it. Use this for tactical coordination, secrets, or side conversations.

Use these sparingly. Prefer in-character action over directives. If you can describe what your character does instead of asking about it, do that first.

## Your Mechanical Knowledge
Your own character sheet is embedded in every turn prompt under "Your Character Sheet". It contains your ability scores, HP, AC, saving throws, skills, features, spells, spell slots, feature charges, equipment, and gold. Trust this document over anything else — if a feature or spell isn't listed there, you don't have it. Party members' brief stats are under "Party Status".`);

  // Security rules — explicit file-access scoping. Same trust model as the DM, but much narrower.
  sections.push(`## CRITICAL — Information Boundaries
You have Read access ONLY to refresh your own memory file. You must NEVER read:
- Any file under \`src/\` (bot source code)
- Any file under \`docs/\` or \`reference/\` (design docs, rule references)
- Any file under \`data/games/<id>/dm-notes/\` (the DM's private notes — reading these breaks the fiction)
- Any file under \`data/games/<id>/history.json\` or \`state.json\` (raw game state — you see what you need in the prompt)
- Any other character's \`agent-notes/\` file or \`characters/*.json\` sheet (other PCs are their own players)
- Any file outside your own memory file path

The only file you should ever Read or Edit is:
${memoryExists ? `\`${memoryPath}\`` : "(no memory file yet — do not use Read or Edit this turn)"}

If you want to know something about another character, the world, or the game, ask in fiction or via \`[[ASK:...]]\`. Never snoop.`);

  const styleRules = STYLE_INSTRUCTIONS[NARRATIVE_STYLE].agent;
  sections.push(`## Rules
- Always stay in character
- Respond with what ${personality.name} SAYS and DOES — express intentions, speak, react emotionally
${styleRules}
- When you want to make an attack or skill check, describe the ATTEMPT — the DM will call for rolls and narrate the outcome
- Never control other characters or narrate outcomes of actions
- CRITICAL: You can ONLY reference things the DM has already described. Do NOT invent, detect, perceive, or reveal anything new about the environment, enemies, sounds, smells, lights, or any world detail that the DM has not explicitly narrated. If you want to look/listen/search for something, say you ARE TRYING TO — do not describe what you find. Only the DM decides what exists in the world and what you perceive.
- Your in-character reply (the prose the players read) MUST be your final message after any tool calls. Tool use is invisible to players — only text you emit after your tool calls goes to the channel.`);

  return sections.join("\n\n");
}

export function buildAgentMessages(
  personality: AgentPersonality,
  gameState: GameState,
  recentHistory: TurnEntry[],
  currentSituation: string,
  memoryContent: string | null,
): { role: "user" | "assistant"; content: string }[] {
  const historyText = recentHistory
    .map((t) => {
      const prefix = t.type === "ic" ? "> " : "";
      return `[${t.playerName}] ${prefix}${t.content}`;
    })
    .join("\n");

  // Find the agent's own character sheet so we can expose full mechanical detail (/character + /inventory parity)
  const selfPlayer = gameState.players.find((p) => p.characterSheet.name === personality.name);
  const selfSheetSection = selfPlayer
    ? `## Your Character Sheet
${buildCharacterReference(selfPlayer.characterSheet)}

`
    : "";

  // Party status — HP / conditions for everyone (what /status shows)
  const partyStatusLines = gameState.players.map((p) => {
    const cs = p.characterSheet;
    const combatant = gameState.combat.combatants.find(
      (c) => c.name.toLowerCase() === cs.name.toLowerCase(),
    );
    const hp = combatant
      ? `HP ${combatant.hp.current}/${combatant.hp.max}`
      : `HP ${cs.hp.current}/${cs.hp.max}`;
    const conditions = combatant?.conditions.length ? ` [${combatant.conditions.join(", ")}]` : "";
    const dormant = p.dormant ? " (dormant)" : "";
    const you = p.characterSheet.name === personality.name ? " — YOU" : "";
    return `- ${cs.name} (${cs.race} ${cs.class}${p.isAgent ? ", AI" : ""}): ${hp}${conditions}${dormant}${you}`;
  });
  const partySection = `## Party Status
${partyStatusLines.join("\n")}

`;

  // Narrative summary — /recap equivalent, only if there's one
  const narrativeSection = gameState.narrativeSummary
    ? `## Story So Far
${gameState.narrativeSummary.trim()}

`
    : "";

  // Scene snapshot from compression
  const sceneSection = gameState.sceneState
    ? `## Current Scene
- Location: ${gameState.sceneState.location}
- Time: ${gameState.sceneState.timeOfDay}
- NPCs present: ${gameState.sceneState.presentNPCs.join(", ") || "(none)"}
- Key facts: ${gameState.sceneState.keyFacts.join(" | ") || "(none)"}

`
    : "";

  const memorySection = memoryContent
    ? `## Your Memory
${memoryContent.trim()}

`
    : "";

  return [
    {
      role: "user",
      content: `${memorySection}${selfSheetSection}${partySection}${narrativeSection}${sceneSection}## Recent Events
${historyText}

## Current Situation
${currentSituation}

What does ${personality.name} do or say? Respond in character. You may emit \`[[PASS]]\`, \`[[ASK:...]]\`, \`[[LOOK:...]]\`, or \`[[WHISPER:Name TEXT:...]]\` directives if appropriate — see your system prompt for details.`,
    },
  ];
}

export async function generateBackstory(
  personality: AgentPersonality,
  partyContext: string,
): Promise<string> {
  const system = `You are a creative writer for D&D 5e. Generate a compelling backstory for a character based on their personality file and mechanical spec. The backstory should be 2-3 paragraphs, vivid, and hint at motivations. Write in third person.`;

  const messages: { role: "user" | "assistant"; content: string }[] = [
    {
      role: "user",
      content: `Create a backstory for this character:

Name: ${personality.name}
Race: ${personality.race}
Class: ${personality.class}
Level: ${personality.level}
Description: ${personality.description}

Personality Details:
${personality.rawContent}

${personality.characterSpec ? `Mechanical Spec:\n${personality.characterSpec}` : ""}

Party context: ${partyContext}`,
    },
  ];

  return chat(models.agent, system, messages, undefined, "low");
}
