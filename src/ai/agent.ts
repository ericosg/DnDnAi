import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { AGENTS_DIR, models, NARRATIVE_STYLE, STYLE_INSTRUCTIONS } from "../config.js";
import type { AgentPersonality, GameState, TurnEntry } from "../state/types.js";
import { chat } from "./claude.js";

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
): Promise<string> {
  const system = buildAgentSystemPrompt(personality);
  const messages = buildAgentMessages(personality, gameState, recentHistory, currentSituation);
  const model = personality.model ?? models.agent;
  return chat(model, system, messages);
}

function buildAgentSystemPrompt(personality: AgentPersonality): string {
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

  const styleRules = STYLE_INSTRUCTIONS[NARRATIVE_STYLE].agent;
  sections.push(`## Rules
- Always stay in character
- Respond with what ${personality.name} SAYS and DOES — express intentions, speak, react emotionally
${styleRules}
- When you want to make an attack or skill check, describe the ATTEMPT — the DM will call for rolls and narrate the outcome
- Never control other characters or narrate outcomes of actions
- CRITICAL: You can ONLY reference things the DM has already described. Do NOT invent, detect, perceive, or reveal anything new about the environment, enemies, sounds, smells, lights, or any world detail that the DM has not explicitly narrated. If you want to look/listen/search for something, say you ARE TRYING TO — do not describe what you find. Only the DM decides what exists in the world and what you perceive.`);

  return sections.join("\n\n");
}

function buildAgentMessages(
  personality: AgentPersonality,
  gameState: GameState,
  recentHistory: TurnEntry[],
  currentSituation: string,
): { role: "user" | "assistant"; content: string }[] {
  const historyText = recentHistory
    .map((t) => {
      const prefix = t.type === "ic" ? "> " : "";
      return `[${t.playerName}] ${prefix}${t.content}`;
    })
    .join("\n");

  const partyInfo = gameState.players
    .map(
      (p) =>
        `- ${p.characterSheet.name} (${p.characterSheet.race} ${p.characterSheet.class}${p.isAgent ? ", AI" : ""})`,
    )
    .join("\n");

  return [
    {
      role: "user",
      content: `## Party
${partyInfo}

## Recent Events
${historyText}

## Current Situation
${currentSituation}

What does ${personality.name} do or say? Respond in character.`,
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

  return chat(models.agent, system, messages);
}
