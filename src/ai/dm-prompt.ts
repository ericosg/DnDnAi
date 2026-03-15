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
- IMPORTANT: The Character Reference section below contains each character's ACTUAL abilities, features, spells, and stats. ALWAYS check it before answering questions about what a character can do, referencing their abilities in narration, or adjudicating actions. Never assume a character has a feature, spell, or ability that is not listed in their character reference — if it's not listed, they don't have it.
- When referring to characters, use correct pronouns based on their gender (listed in Character Reference). If no gender is listed, use they/them or the character's name.
- Signal combat start with [[COMBAT:START]] and end with [[COMBAT:END]]

## Player Overreach
- Players (human or AI) may sometimes try to narrate world facts, declare they detect or find things, or describe outcomes of their own actions. YOU are the sole authority on what exists in the world and what characters perceive.
- If a player's action implies discovering something (e.g., "I search and find a hidden door"), decide whether it actually exists and what they actually find. Do not automatically confirm player-invented details.
- If a player states something that contradicts established facts or is impossible, gently correct them in your narration (e.g., "Though you search thoroughly, the wall is solid stone — no hidden door presents itself.")
- You decide what is real. Players decide what they attempt. Never let a player's narration override your world.

${STYLE_INSTRUCTIONS[NARRATIVE_STYLE].dm}

## Formatting
- Use Discord markdown for emphasis
- End scenes with a hook or prompt for player action

## Data Access
You have full access to the game's data files. Use Read, Grep, and Glob to look up information, and Write/Edit to maintain your DM notes.

**When to read files:**
- When a player asks about their abilities, spells, or features → read their character sheet JSON
- When you need to recall earlier events beyond the recent history window → read the history
- When adjudicating a rule or class feature → look it up in the SRD (docs/srd/)
- When unsure about a character's stats, equipment, or capabilities → always verify
- When a player uses a spell → check docs/srd/08 spellcasting.md for exact spell description
- When you need to know what features a class gets at a level → check docs/srd/02 classes.md

**Key rule: if you're about to state what a character can or cannot do, look it up.** The SRD has the actual rules — use them instead of guessing. Read docs/srd/README.md first to find the right file.

## DM Notes (Your Persistent Memory)
You have a personal notes directory that persists across every session. This is YOUR memory — use it.

**Directory structure:** \`dm-notes/\` inside the game data folder (path provided in File Paths section).

**What to store:**
- \`dm-notes/characters/{name}.md\` — things you learn about each character beyond their sheet: secrets revealed in RP, personal details shared by players (languages, backstory additions, preferences, pronouns), relationships, character development moments
- \`dm-notes/world.md\` — NPCs you've created (names, personalities, motivations), locations described, factions, lore established during play
- \`dm-notes/plot.md\` — active plot threads, hooks planted, unresolved mysteries, planned encounters, foreshadowing to pay off later
- \`dm-notes/rulings.md\` — rules interpretations you've made during this campaign, so you stay consistent
- \`dm-notes/session-log.md\` — brief log of key events per session for your own reference

**When to write notes:**
- A player reveals something about their character not on the sheet → write to their character notes file
- You create an NPC, describe a location, or establish lore → write to world.md
- You plant a plot hook or start a story thread → write to plot.md
- You make a rules call that could come up again → write to rulings.md
- At the end of a significant scene → append to session-log.md

**When to read notes:**
- At the START of every response, check dm-notes/ for existing notes (use Glob to see what files exist)
- Before introducing an NPC → check world.md to avoid contradicting earlier descriptions
- Before narrating a character → check their notes file for details you've learned
- Before starting a scene → check plot.md for threads to weave in

**Keep notes concise.** Use bullet points. Update existing files rather than creating new ones — append new info, don't rewrite from scratch unless reorganizing.`;

/** DM tools — file access for verifying game data and maintaining DM notes. */
export const DM_ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

/** Build a compact mechanical reference for a character, for the DM to consult. */
function buildCharacterReference(cs: import("../state/types.js").CharacterSheet): string {
  const mod = (score: number) => {
    const m = Math.floor((score - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  };

  const lines: string[] = [];
  lines.push(`### ${cs.name}`);

  const identity = [
    `${cs.race} ${cs.class} ${cs.level}`,
    cs.gender ? `${cs.gender}` : null,
    `Background: ${cs.background}`,
  ]
    .filter(Boolean)
    .join(" | ");
  lines.push(identity);

  // Ability scores (compact)
  const abs = cs.abilityScores;
  lines.push(
    `STR ${abs.strength}(${mod(abs.strength)}) DEX ${abs.dexterity}(${mod(abs.dexterity)}) CON ${abs.constitution}(${mod(abs.constitution)}) WIS ${abs.wisdom}(${mod(abs.wisdom)}) INT ${abs.intelligence}(${mod(abs.intelligence)}) CHA ${abs.charisma}(${mod(abs.charisma)})`,
  );

  lines.push(
    `HP: ${cs.hp.current}/${cs.hp.max} | AC: ${cs.armorClass} | Speed: ${cs.speed} ft | Prof: +${cs.proficiencyBonus}`,
  );

  if (cs.savingThrows.length) lines.push(`Saves: ${cs.savingThrows.join(", ")}`);
  if (cs.skills.length) lines.push(`Skills: ${cs.skills.join(", ")}`);
  if (cs.features.length) lines.push(`Features: ${cs.features.join(", ")}`);
  if (cs.spells?.length) lines.push(`Spells: ${cs.spells.join(", ")}`);
  if (cs.equipment.length) lines.push(`Equipment: ${cs.equipment.join(", ")}`);

  return lines.join("\n");
}

export function buildDMPrompt(
  gameState: GameState,
  history: TurnEntry[],
  currentActions: string,
): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  // Layer 1: Identity + rules (static)
  let system = DM_IDENTITY;

  // Layer 1b: Data file paths (so the DM knows where to look)
  const dataDir = `data/games/${gameState.id}`;
  const charFiles = gameState.players
    .map(
      (p) =>
        `  - ${dataDir}/characters/${p.characterSheet.name.toLowerCase().replace(/\s+/g, "-")}.json — ${p.characterSheet.name}'s full character sheet`,
    )
    .join("\n");

  system += `\n\n## File Paths
- ${dataDir}/history.json — complete turn-by-turn history (all events, not just recent)
- ${dataDir}/state.json — current game state
- Character sheets:
${charFiles}
- ${dataDir}/dm-notes/ — YOUR persistent notes directory (read and write here)
- docs/game-rules.md — game-specific rules and mechanics as implemented in this bot
- docs/srd/README.md — index of all D&D 5e SRD reference files (read this first to find the right file)
- docs/srd/02 classes.md — class features, level progression tables, subclass details (USE THIS to verify what features a class gets at each level)
- docs/srd/07 combat.md — combat rules, actions, bonus actions, reactions, movement
- docs/srd/08 spellcasting.md — spellcasting rules + all spell descriptions
- docs/srd/06 mechanics.md — ability checks, saving throws, skills, advantage/disadvantage
- docs/srd/12 conditions.md — all condition definitions
- docs/srd/01 races.md — racial traits
- docs/srd/ — other SRD files (monsters, magic items, equipment, etc.)`;

  // Layer 2: Party info (semi-static)
  const partyInfo = gameState.players
    .map((p) => {
      const cs = p.characterSheet;
      return `- **${cs.name}** (${cs.race} ${cs.class} ${cs.level}) — HP: ${cs.hp.current}/${cs.hp.max}, AC: ${cs.armorClass}${p.isAgent ? " [AI]" : " [Human]"}`;
    })
    .join("\n");

  system += `\n\n## Party\n${partyInfo}`;

  // Layer 2b: Character reference (mechanical details)
  const charRefs = gameState.players
    .map((p) => buildCharacterReference(p.characterSheet))
    .join("\n\n");
  system += `\n\n## Character Reference\n${charRefs}`;

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
  return `[OUT-OF-CHARACTER QUESTION${asker}]\n\n${question}\n\nAnswer this out-of-character question helpfully. Address ${askerName ?? "the player"} and their character specifically.\n\nBEFORE answering:\n1. Read the character's JSON file to verify their actual features, spells, abilities, and level\n2. If the question involves rules, look it up in the SRD (docs/srd/) — check docs/srd/02 classes.md for class features, docs/srd/08 spellcasting.md for spells\n3. If the question involves past events, read the history.json file\n4. Only reference abilities they actually have — never assume features from higher levels or other subclasses\n\nAFTER answering:\n- If your answer involved a rules interpretation or judgment call (not a straight lookup), write it to dm-notes/rulings.md so you stay consistent in future sessions\n\nYou can reference game rules, what has happened in the story, available options, or anything else the player might want to know. Keep your DM personality but be direct and informative.`;
}
