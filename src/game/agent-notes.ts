import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_NOTES_DIR, DATA_DIR } from "../config.js";
import { log } from "../logger.js";
import type { AgentPersonality, CharacterSheet } from "../state/types.js";

/**
 * Agent memory module.
 *
 * Each AI agent maintains a first-person memory file in
 * `data/games/<id>/agent-notes/<slug>.md`. The file is:
 * - seeded with a template when the agent joins (or when a dormant agent activates)
 * - read by the agent at the start of every turn (injected into its prompt + available via Read tool)
 * - edited by the agent after meaningful events (via Edit tool)
 * - appendable by the DM mid-turn via the `[[REMEMBER:name TEXT:...]]` directive
 * - backfilled for in-flight games by `seedAgentMemoryFromHistory` (see ai/agent-memory-seed.ts)
 *
 * This module handles pure file I/O only. The AI-driven seeder lives in ai/agent-memory-seed.ts.
 */

export function agentSlug(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-");
}

export function getAgentNotesDir(gameId: string): string {
  return path.join(DATA_DIR, gameId, AGENT_NOTES_DIR);
}

export function getAgentNotesPath(gameId: string, agentName: string): string {
  return path.join(getAgentNotesDir(gameId), `${agentSlug(agentName)}.md`);
}

export function agentNotesDirExists(gameId: string): boolean {
  return existsSync(getAgentNotesDir(gameId));
}

export function agentNotesExist(gameId: string, agentName: string): boolean {
  return existsSync(getAgentNotesPath(gameId, agentName));
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Build a starter memory file from the character sheet + personality.
 * Used on /add-agent join and on [[ACTIVATE:]] for dormant agents.
 * For existing games with prior sessions, use seedAgentMemoryFromHistory instead.
 */
export function buildStarterMemory(personality: AgentPersonality, sheet: CharacterSheet): string {
  const equipmentLines = sheet.equipment.length
    ? sheet.equipment.map((e) => `- ${e}`).join("\n")
    : "- (nothing of note yet)";

  const selfKnowledge: string[] = [
    `- I am ${sheet.name}, a ${sheet.race} ${sheet.class} (Level ${sheet.level}).`,
  ];
  if (sheet.gender) selfKnowledge.push(`- Gender: ${sheet.gender}.`);
  if (sheet.spells?.length) {
    selfKnowledge.push(
      `- My spells & cantrips: ${sheet.spells.join(", ")}. These are the ONLY spells I know — I cannot cast anything not on this list.`,
    );
  } else if (
    sheet.class.toLowerCase().match(/wizard|sorcerer|cleric|druid|bard|warlock|paladin|ranger/)
  ) {
    selfKnowledge.push("- I don't have any spells prepared right now.");
  }
  if (sheet.features.length) {
    selfKnowledge.push(
      `- My features: ${sheet.features.join(", ")}. I cannot use features not on this list.`,
    );
  }

  const bonds = personality.goals.length
    ? personality.goals.map((g) => `- ${g}`).join("\n")
    : "- (none yet — I've just met the party)";

  return `# ${sheet.name} — Memory

Keep this current. After meaningful events, Edit this file to update it. Write in FIRST PERSON.
Append new entries; do NOT delete or rewrite existing ones unless they're factually wrong.
Never record things the DM has not narrated — only what actually happened in the shared story.

## What I Remember
<!-- Events I witnessed, decisions I made, promises I kept or broke. One bullet per event. Keep it short. -->
- (nothing yet — my story begins here)

## What I Carry
${equipmentLines}

## What I Know About Myself
${selfKnowledge.join("\n")}

## Bonds & Relationships
${bonds}

## Open Threads
- (none yet — things I'm pursuing or worried about will go here as the story unfolds)
`;
}

/**
 * Seed a new memory file for an agent. Safe to call if the file already exists
 * (no-op in that case — won't overwrite accumulated memory).
 */
export async function seedAgentNotes(
  gameId: string,
  personality: AgentPersonality,
  sheet: CharacterSheet,
): Promise<void> {
  const dir = getAgentNotesDir(gameId);
  await ensureDir(dir);
  const file = getAgentNotesPath(gameId, sheet.name);
  if (existsSync(file)) {
    log.debug(`Agent notes already exist for ${sheet.name} — skipping seed`);
    return;
  }
  await writeFile(file, buildStarterMemory(personality, sheet));
  log.info(`Agent notes: seeded starter memory for ${sheet.name}`);
}

/**
 * Read an agent's memory file. Returns null if the file doesn't exist.
 */
export async function readAgentNotes(gameId: string, agentName: string): Promise<string | null> {
  const file = getAgentNotesPath(gameId, agentName);
  if (!existsSync(file)) return null;
  return readFile(file, "utf-8");
}

/**
 * Append a bullet under `## What I Remember` in an agent's memory file.
 * Used by the DM's `[[REMEMBER:name TEXT:...]]` directive.
 *
 * If the file doesn't exist, logs a warning and skips (the agent may not be in this game).
 * If the `## What I Remember` section is missing (defensive — file edited externally),
 * the section is added at the end.
 */
export async function appendAgentMemory(
  gameId: string,
  agentName: string,
  entry: string,
): Promise<boolean> {
  const file = getAgentNotesPath(gameId, agentName);
  if (!existsSync(file)) {
    log.warn(`Agent notes: cannot append — no file for "${agentName}" (${file})`);
    return false;
  }
  const existing = await readFile(file, "utf-8");
  const bullet = `- ${entry.trim().replace(/^\s*-\s*/, "")}`;
  const header = "## What I Remember";
  let updated: string;
  if (existing.includes(header)) {
    updated = existing.replace(header, `${header}\n${bullet}`);
    // Remove "nothing yet" placeholder if present so real entries don't sit next to it
    updated = updated.replace(/^- \(nothing yet[^)]*\)\s*$/m, "");
    // Collapse runs of blank lines that may result from placeholder removal
    updated = updated.replace(/\n{3,}/g, "\n\n");
  } else {
    updated = `${existing.trimEnd()}\n\n${header}\n${bullet}\n`;
  }
  await writeFile(file, updated);
  log.info(`Agent notes: appended to ${agentName}'s memory: ${entry.slice(0, 80)}`);
  return true;
}

/**
 * List all agent memory files present in a game directory.
 * Used by /resume retrofit to detect whether any agents are missing memory.
 */
export async function listAgentNoteFiles(gameId: string): Promise<string[]> {
  const dir = getAgentNotesDir(gameId);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
}
