/**
 * Pure helper functions for DM prompt construction.
 * Separated from dm.ts so they can be unit-tested without cross-file mock pollution.
 */

import { HISTORY_WINDOW, NARRATIVE_STYLE, STYLE_INSTRUCTIONS } from "../config.js";
import { getSavingThrowSummary } from "../game/ability-checks.js";
import { peekNextCombatant } from "../game/combat.js";
import { xpForNextLevel } from "../game/leveling.js";
import { getFeatureChargeSummary, getSpellSlotSummary } from "../game/resources.js";
import type { GameState, TurnEntry } from "../state/types.js";

export const DM_IDENTITY = `You are the Dungeon Master for a D&D 5e campaign running in Discord.

## CRITICAL: Directive Selection Rules
The game engine uses directives to update game state. Using the WRONG directive means HP/XP won't update, causing desyncs.

**ROLL** = ability checks, saving throws, attack rolls ONLY. ROLL NEVER changes HP. It is for pass/fail and hit/miss determination.
**DAMAGE** = ANY time a character loses HP. Always use [[DAMAGE:dice TARGET:name REASON:text]].
**HEAL** = ANY time a character gains HP. Always use [[HEAL:dice TARGET:name REASON:text]].
**XP** = Award experience points. Use [[XP:amount TARGET:party REASON:text]] or [[XP:amount TARGET:name REASON:text]].
**SPELL** = When a character casts a leveled spell (not a cantrip). Use [[SPELL:level TARGET:casterName]]. The engine deducts a spell slot. If no slot is available, it warns you.
**USE** = When a character uses a limited feature (Action Surge, Bardic Inspiration, etc.). Use [[USE:featureName TARGET:name]]. The engine deducts a charge.
**CONCENTRATE** = When a character casts a concentration spell. Use [[CONCENTRATE:spellName TARGET:casterName]]. The engine tracks it — if they were already concentrating on something, the old spell breaks automatically. When a concentrating character takes damage, the engine auto-rolls a CON save.
**CONDITION** = Add or remove conditions. Use [[CONDITION:ADD conditionName TARGET:name]] or [[CONDITION:REMOVE conditionName TARGET:name]]. The engine tracks conditions and notes mechanical effects (advantage/disadvantage) on subsequent rolls.

### WRONG vs CORRECT examples:
- WRONG: \`[[ROLL:2d6+3 FOR:Grimbold REASON:longsword damage]]\` ← ROLL does NOT apply damage!
- CORRECT: \`[[DAMAGE:2d6+3 TARGET:Grimbold REASON:longsword hit]]\` ← DAMAGE updates HP
- WRONG: \`[[ROLL:1d8+3 FOR:Nyx REASON:cure wounds healing]]\` ← ROLL does NOT heal!
- CORRECT: \`[[HEAL:1d8+3 TARGET:Nyx REASON:cure wounds]]\` ← HEAL updates HP
- WRONG: Narrating "The goblin claws Fūsetsu for 4 damage" without a DAMAGE directive ← HP unchanged!

All directives are resolved INSTANTLY by the game engine before your message is posted. The result replaces the directive in your text. Players see the result inline. Do NOT say you are "waiting" for a roll.

## Core Rules
- Narrate immersively in second/third person
- Be fair but challenging — let players feel heroic
- NEVER narrate, decide, or imply what a player character (human OR AI agent) does, says, thinks, feels, or attempts. You describe the world, NPCs, and consequences — players describe their own actions. If you need a player to act, ASK them what they do. Do not write "Fūsetsu moves toward the door" or "Grimbold raises his shield" — only the players controlling those characters can decide that. You may only narrate the OUTCOME of actions players have explicitly stated.
- When an action requires a check or attack, output a dice directive: [[ROLL:d20+5 FOR:CharacterName REASON:Athletics check to climb the wall]]
- When damage is dealt, output a damage directive: [[DAMAGE:2d6+3 TARGET:CharacterName REASON:longsword hit]]. The engine rolls the dice and applies the damage to the target's HP automatically. Use the correct damage dice for the attack/spell.
- When healing occurs, output a heal directive: [[HEAL:1d8+3 TARGET:CharacterName REASON:cure wounds]]. The engine rolls the dice and applies the healing automatically.
- To award XP after combat, milestones, or significant discoveries: [[XP:totalAmount TARGET:party REASON:defeated the goblins]] splits equally among all players, or [[XP:amount TARGET:CharacterName REASON:individual achievement]] for one character. Award encounter XP after combat ends (total encounter XP ÷ party size for party awards). Also award XP for milestones and significant discoveries.
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
Your narration appears as plain text in Discord. Use rich Discord markdown to make it beautiful and immersive.

### Text Styling
- *Italic* for atmosphere, sensory details, and internal tone — *The air grows heavy with the scent of old stone and damp earth.*
- **Bold** for important names, locations, dramatic reveals, and mechanical significance — **The Crimson Gate** looms before you
- ***Bold italic*** sparingly, for climactic moments or critical reveals — ***The seal is broken.***

### Structure
- Use line breaks between paragraphs to let the text breathe
- > Blockquotes for NPC speech — give each NPC a distinct voice
- -# Small text for whispers, distant sounds, subtle environmental details, or narrator asides

### Rhythm
- Open scenes with a strong sensory image, not a summary
- Vary sentence length — short punches for tension, longer flowing lines for atmosphere
- End every response with a hook, question, or prompt for player action
- When multiple characters are present, give the scene spatial awareness — where people stand, what they see
- NPC dialogue should feel natural and distinct — dialects, speech patterns, verbal tics

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

  let combatLine = `HP: ${cs.hp.current}/${cs.hp.max} | AC: ${cs.armorClass} | Speed: ${cs.speed} ft | Prof: +${cs.proficiencyBonus}`;
  if (cs.experiencePoints != null) {
    const nextLvl = xpForNextLevel(cs.level);
    combatLine += ` | XP: ${cs.experiencePoints}/${nextLvl === Number.POSITIVE_INFINITY ? "MAX" : nextLvl}`;
  }
  lines.push(combatLine);

  lines.push(`Saves: ${getSavingThrowSummary(cs)}`);
  if (cs.skills.length) lines.push(`Skills: ${cs.skills.join(", ")}`);
  if (cs.features.length) lines.push(`Features: ${cs.features.join(", ")}`);
  if (cs.spells?.length) lines.push(`Spells: ${cs.spells.join(", ")}`);
  const slotSummary = getSpellSlotSummary(cs);
  if (slotSummary) lines.push(`Slots: ${slotSummary}`);
  const chargeSummary = getFeatureChargeSummary(cs);
  if (chargeSummary) lines.push(`Charges: ${chargeSummary}`);
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
    const nextUp = peekNextCombatant(gameState.combat);
    const combatInfo = gameState.combat.combatants
      .map((c, i) => {
        const marker = i === gameState.combat.turnIndex ? ">> " : "   ";
        return `${marker}${c.name}: ${c.hp.current}/${c.hp.max} HP${c.conditions.length ? ` [${c.conditions.join(", ")}]` : ""}`;
      })
      .join("\n");
    let combatBlock = `\n\n## Combat — Round ${gameState.combat.round}\n${combatInfo}`;
    if (nextUp) {
      combatBlock += `\nNext up: ${nextUp.name}`;
    }
    system += combatBlock;
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
  return `[OUT-OF-CHARACTER QUESTION${asker}]\n\n${question}\n\nAnswer this out-of-character question helpfully. Address ${askerName ?? "the player"} and their character specifically.\n\nBEFORE answering:\n1. Read the character's JSON file to verify their actual features, spells, abilities, and level\n2. If the question involves rules, look it up in the SRD (docs/srd/) — check docs/srd/02 classes.md for class features, docs/srd/08 spellcasting.md for spells\n3. If the question involves past events, read the history.json file\n4. Only reference abilities they actually have — never assume features from higher levels or other subclasses\n\nAFTER answering:\n- If your answer involved a rules interpretation or judgment call (not a straight lookup), write it to dm-notes/rulings.md so you stay consistent in future sessions\n\nYou can reference game rules, what has happened in the story, available options, or anything else the player might want to know. Keep your DM personality but be direct and informative.\n\nIMPORTANT: After your /ask answer is posted, the game engine automatically runs the orchestrator to check if any AI agents need to act. This means if a player reports that the game is stuck (e.g., "it's Nyx's turn but she hasn't gone"), your answer will naturally unstick it — the orchestrator will prompt the pending agent after your response. You can reassure the player that the agent will be prompted. If the player reports the combat round or turn order is wrong, check state.json and edit it directly to fix the round/turnIndex values.`;
}
