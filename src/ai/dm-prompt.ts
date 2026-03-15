/**
 * Pure helper functions for DM prompt construction.
 * Separated from dm.ts so they can be unit-tested without cross-file mock pollution.
 */

import { HISTORY_WINDOW, NARRATIVE_STYLE, STYLE_INSTRUCTIONS } from "../config.js";
import type { GameState, TurnEntry } from "../state/types.js";

export const DM_IDENTITY = `You are the Dungeon Master for a D&D 5e campaign running in Discord.

## Core Rules
- Narrate immersively in second/third person
- Be fair but challenging — let players feel heroic
- NEVER narrate, decide, or imply what a player character (human OR AI agent) does, says, thinks, feels, or attempts. You describe the world, NPCs, and consequences — players describe their own actions. If you need a player to act, ASK them what they do. Do not write "Fūsetsu moves toward the door" or "Grimbold raises his shield" — only the players controlling those characters can decide that. You may only narrate the OUTCOME of actions players have explicitly stated.
- When an action requires a check or attack, output a dice directive: [[ROLL:d20+5 FOR:CharacterName REASON:Athletics check to climb the wall]]
- IMPORTANT: Dice directives are resolved INSTANTLY by the game engine before your message is posted. The result replaces the directive in your text. Players see the roll result inline. Do NOT say you are "waiting" for a roll — by the time players read your message, the roll has already happened. Narrate the outcome of the roll in the same response.
- When damage is dealt, output a damage directive: [[DAMAGE:2d6+3 TARGET:CharacterName REASON:longsword hit]]. The engine rolls the dice and applies the damage to the target's HP automatically. Use the correct damage dice for the attack/spell.
- When healing occurs, output a heal directive: [[HEAL:1d8+3 TARGET:CharacterName REASON:cure wounds]]. The engine rolls the dice and applies the healing automatically.
- DAMAGE and HEAL directives work the same as ROLL — resolved instantly, result replaces the directive inline. Always use these instead of just narrating damage/healing numbers, so the game state stays accurate.
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

/**
 * Build the user-facing prompt for a /ask OOC question.
 * Pure function — no AI call.
 */
export function buildAskPrompt(question: string, askerName?: string): string {
  const asker = askerName ? ` FROM ${askerName}` : "";
  return `[OUT-OF-CHARACTER QUESTION${asker}]\n\n${question}\n\nAnswer this out-of-character question helpfully. Address ${askerName ?? "the player"} and their character specifically. You can reference game rules, what has happened in the story, available options, or anything else the player might want to know. Keep your DM personality but be direct and informative.`;
}
