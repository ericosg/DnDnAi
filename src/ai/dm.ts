import {
  COMPRESS_EVERY,
  HISTORY_WINDOW,
  models,
  NARRATIVE_STYLE,
  STYLE_INSTRUCTIONS,
} from "../config.js";
import type { GameState, TurnEntry } from "../state/types.js";
import { chat } from "./claude.js";

const DM_IDENTITY = `You are the Dungeon Master for a D&D 5e campaign running in Discord.

## Core Rules
- Narrate immersively in second/third person
- Be fair but challenging — let players feel heroic
- NEVER narrate, decide, or imply what a player character (human OR AI agent) does, says, thinks, feels, or attempts. You describe the world, NPCs, and consequences — players describe their own actions. If you need a player to act, ASK them what they do. Do not write "Fūsetsu moves toward the door" or "Grimbold raises his shield" — only the players controlling those characters can decide that. You may only narrate the OUTCOME of actions players have explicitly stated.
- When an action requires a check or attack, output a dice directive: [[ROLL:d20+5 FOR:CharacterName REASON:Athletics check to climb the wall]]
- IMPORTANT: Dice directives are resolved INSTANTLY by the game engine before your message is posted. The result replaces the directive in your text. Players see the roll result inline. Do NOT say you are "waiting" for a roll — by the time players read your message, the roll has already happened. Narrate the outcome of the roll in the same response.
- Track narrative consistency — remember what you've established
- Use D&D 5e rules but favor fun over strict RAW when it improves the story
- Signal combat start with [[COMBAT:START]] and end with [[COMBAT:END]]

## Player Overreach
- Players (human or AI) may sometimes try to narrate world facts, declare they detect or find things, or describe outcomes of their own actions. YOU are the sole authority on what exists in the world and what characters perceive.
- If a player's action implies discovering something (e.g., "I search and find a hidden door"), decide whether it actually exists and what they actually find. Do not automatically confirm player-invented details.
- If a player states something that contradicts established facts or is impossible, gently correct them in your narration (e.g., "Though you search thoroughly, the wall is solid stone — no hidden door presents itself.")
- You decide what is real. Players decide what they attempt. Never let a player's narration override your world.

${STYLE_INSTRUCTIONS[NARRATIVE_STYLE].dm}

## Formatting
- Use Discord markdown for emphasis
- End scenes with a hook or prompt for player action`;

export function buildDMPrompt(
  gameState: GameState,
  history: TurnEntry[],
  currentActions: string,
): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  // Layer 1: Identity + rules (static)
  let system = DM_IDENTITY;

  // Layer 2: Party info (semi-static)
  const partyInfo = gameState.players
    .map((p) => {
      const cs = p.characterSheet;
      return `- **${cs.name}** (${cs.race} ${cs.class} ${cs.level}) — HP: ${cs.hp.current}/${cs.hp.max}, AC: ${cs.armorClass}${p.isAgent ? " [AI]" : " [Human]"}`;
    })
    .join("\n");

  system += `\n\n## Party\n${partyInfo}`;

  // Layer 3: Narrative summary (compressed)
  if (gameState.narrativeSummary) {
    system += `\n\n## Story So Far\n${gameState.narrativeSummary}`;
  }

  // Layer 4: Combat state if active
  if (gameState.combat.active) {
    const combatInfo = gameState.combat.combatants
      .map((c, i) => {
        const marker = i === gameState.combat.turnIndex ? ">> " : "   ";
        return `${marker}${c.name}: ${c.hp.current}/${c.hp.max} HP${c.conditions.length ? ` [${c.conditions.join(", ")}]` : ""}`;
      })
      .join("\n");
    system += `\n\n## Combat — Round ${gameState.combat.round}\n${combatInfo}`;
  }

  // Layer 5: Recent history (sliding window)
  const recentHistory = history.slice(-HISTORY_WINDOW);
  const historyText = recentHistory
    .map((t) => {
      if (t.type === "dm-narration") return `[DM] ${t.content}`;
      if (t.type === "roll" && t.diceResults) {
        const rolls = t.diceResults
          .map((r) => `${r.notation} = ${r.total}${r.label ? ` (${r.label})` : ""}`)
          .join(", ");
        return `[ROLL] ${t.playerName}: ${rolls}`;
      }
      const prefix = t.type === "ic" ? "> " : "";
      return `[${t.playerName}] ${prefix}${t.content}`;
    })
    .join("\n");

  const messages: { role: "user" | "assistant"; content: string }[] = [];

  if (historyText) {
    messages.push({
      role: "user",
      content: `## Recent History\n${historyText}\n\n## Current Actions to Resolve\n${currentActions}`,
    });
  } else {
    messages.push({
      role: "user",
      content: currentActions,
    });
  }

  return { system, messages };
}

export async function dmNarrate(
  gameState: GameState,
  history: TurnEntry[],
  currentActions: string,
): Promise<string> {
  const { system, messages } = buildDMPrompt(gameState, history, currentActions);
  return chat(models.dm, system, messages);
}

export async function dmRecap(gameState: GameState, history: TurnEntry[]): Promise<string> {
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    "Please provide a dramatic recap of the adventure so far, summarizing key events, discoveries, and character moments. Write it as a 'Previously on...' narration.",
  );
  return chat(models.dm, system, messages);
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
  return chat(models.dm, system, messages);
}

export async function dmAsk(
  gameState: GameState,
  history: TurnEntry[],
  question: string,
): Promise<string> {
  const { system, messages } = buildDMPrompt(
    gameState,
    history,
    `[OUT-OF-CHARACTER QUESTION FROM A PLAYER]\n\n${question}\n\nAnswer this out-of-character question helpfully. You can reference game rules, what has happened in the story, available options, or anything else the player might want to know. Keep your DM personality but be direct and informative.`,
  );
  return chat(models.dm, system, messages);
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
