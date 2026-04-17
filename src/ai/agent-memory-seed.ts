/**
 * Retrofit seeder for agent memory files.
 *
 * For an in-flight game that predates the agent memory module, this module walks
 * the full turn history + the DM's per-character notes + the agent's own character
 * sheet and asks Sonnet to produce a first-person memory file. Called by /resume
 * when the agent-notes directory is missing.
 *
 * Prompt construction is separated from the Claude call so it can be unit-tested
 * without spawning the CLI (see agent-memory-seed.test.ts).
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, models } from "../config.js";
import {
  agentSlug,
  getAgentNotesDir,
  getAgentNotesPath,
  seedAgentNotes,
} from "../game/agent-notes.js";
import { log } from "../logger.js";
import type { AgentPersonality, CharacterSheet, GameState, TurnEntry } from "../state/types.js";
import { loadAgentPersonality } from "./agent.js";
import { chat } from "./claude.js";

const SEED_SYSTEM = `You generate first-person memory files for D&D 5e AI-controlled party members.

You are given: a character's personality file, their character sheet, the DM's private notes about them,
and the full play history so far. Your job is to distill what THIS CHARACTER has witnessed and learned
into a concise memory document written in their voice.

RULES:
- Output ONLY the markdown file body. No preamble, no code fences, no explanation.
- Follow the exact section structure below — no extra or renamed sections.
- First person ("I remember...", "I carry...").
- Only include events the character was actually present for or learned about in-fiction. Do NOT invent.
- Only include mechanical facts supported by the character sheet. If Nyx's cantrips are Fire Bolt, Minor
  Illusion, Prestidigitation, write that; do NOT list Light even if she once tried to cast it.
- Keep bullets short (one sentence). Cap each section to ~8 bullets — the highlights only.
- Where the DM's notes record a correction (e.g. "Nyx does NOT know Light — tried once, embarrassed"),
  capture both the correction AND the memory of trying, so the character does not repeat the mistake.

STRUCTURE:
# <Name> — Memory

Keep this current. After meaningful events, Edit this file to update it. Write in FIRST PERSON.
Append new entries; do NOT delete or rewrite existing ones unless they're factually wrong.
Never record things the DM has not narrated — only what actually happened in the shared story.

## What I Remember
- <event>

## What I Carry
- <item>

## What I Know About Myself
- <class/race/level>
- <cantrips/spells/features — be specific, list what they HAVE, note any corrections>

## Bonds & Relationships
- <Party member>: <one-line feeling>
- <NPC>: <one-line feeling>

## Open Threads
- <thing I'm pursuing or worried about>
`;

export interface SeedContext {
  personality: AgentPersonality;
  sheet: CharacterSheet;
  dmCharacterNotes: string | null;
  history: TurnEntry[];
  narrativeSummary?: string | null;
}

/**
 * Maximum number of recent history entries to include in the seed prompt.
 * At ~500 chars/entry, 150 entries ≈ 75KB — well under the ~1MB OS ARG_MAX
 * for CLI-passed prompts. Older context is provided via `narrativeSummary`
 * (the compressed story summary).
 */
export const SEED_HISTORY_WINDOW = 150;

/**
 * Hard prompt-size safety cap. macOS ARG_MAX is ~1MB and the env is also
 * part of the limit, so we bail well below that and fall back to the starter
 * template rather than crashing with E2BIG.
 */
export const SEED_PROMPT_MAX_BYTES = 500_000;

/**
 * Build the user-message prompt for the seeder. Pure function — no I/O.
 *
 * History is capped at SEED_HISTORY_WINDOW most-recent entries; the
 * `narrativeSummary` (if provided) captures earlier context in compressed form,
 * mirroring how the DM is given long-history context elsewhere in the bot.
 */
export function buildSeedPrompt(ctx: SeedContext): string {
  const recentHistory = ctx.history.slice(-SEED_HISTORY_WINDOW);
  const olderCount = Math.max(0, ctx.history.length - recentHistory.length);

  const historyText = recentHistory
    .map((t) => {
      const prefix = t.type === "ic" ? "> " : t.type === "dm-narration" ? "" : `[${t.type}] `;
      return `[${t.playerName}] ${prefix}${t.content}`;
    })
    .join("\n\n");

  const parts: string[] = [
    `## Character: ${ctx.sheet.name}`,
    "",
    "### Personality File",
    ctx.personality.rawContent.trim() || "(none)",
    "",
    "### Character Sheet",
    `- Race/Class/Level: ${ctx.sheet.race} ${ctx.sheet.class} ${ctx.sheet.level}`,
    ctx.sheet.gender ? `- Gender: ${ctx.sheet.gender}` : "",
    `- HP: ${ctx.sheet.hp.current}/${ctx.sheet.hp.max}`,
    `- Equipment: ${ctx.sheet.equipment.join(", ") || "(none)"}`,
    `- Features: ${ctx.sheet.features.join(", ") || "(none)"}`,
    ctx.sheet.spells?.length ? `- Spells & Cantrips: ${ctx.sheet.spells.join(", ")}` : "",
    ctx.sheet.backstory ? `- Backstory: ${ctx.sheet.backstory.trim()}` : "",
  ].filter(Boolean);

  if (ctx.dmCharacterNotes) {
    parts.push("", "### DM's Notes About This Character", ctx.dmCharacterNotes.trim());
  }

  if (ctx.narrativeSummary?.trim()) {
    parts.push(
      "",
      "### Story So Far (compressed summary of earlier sessions)",
      ctx.narrativeSummary.trim(),
    );
  }

  const historyHeader =
    olderCount > 0
      ? `### Recent Play History (last ${recentHistory.length} of ${ctx.history.length} entries — older events are in the summary above)`
      : "### Play History";

  parts.push(
    "",
    historyHeader,
    historyText || "(no history yet)",
    "",
    `Produce the memory file for ${ctx.sheet.name} now.`,
  );

  return parts.join("\n");
}

/**
 * Load the DM's private notes for a character, if they exist.
 * DM stores these in two common conventions (first-name-only or full-slug) —
 * try both.
 */
async function loadDMCharacterNotes(gameId: string, characterName: string): Promise<string | null> {
  const base = path.join(DATA_DIR, gameId, "dm-notes", "characters");
  const candidates = [
    `${agentSlug(characterName)}.md`,
    `${characterName.toLowerCase().split(/\s+/)[0]}.md`,
  ];
  for (const candidate of candidates) {
    const p = path.join(base, candidate);
    if (existsSync(p)) {
      return readFile(p, "utf-8");
    }
  }
  return null;
}

/**
 * Seed a single agent's memory by asking Sonnet to distill it from history + DM notes.
 * Does not overwrite an existing memory file.
 */
export async function seedAgentMemoryFromHistory(
  gameState: GameState,
  agentPlayerCharacterName: string,
  agentFile: string,
  history: TurnEntry[],
): Promise<void> {
  const file = getAgentNotesPath(gameState.id, agentPlayerCharacterName);
  if (existsSync(file)) {
    log.debug(`Agent notes already exist for ${agentPlayerCharacterName} — skipping retrofit seed`);
    return;
  }

  const player = gameState.players.find((p) => p.characterSheet.name === agentPlayerCharacterName);
  if (!player) {
    log.warn(`Retrofit seed: player ${agentPlayerCharacterName} not found`);
    return;
  }

  try {
    const personality = await loadAgentPersonality(agentFile.replace(/\.md$/, ""));
    const dmCharacterNotes = await loadDMCharacterNotes(gameState.id, agentPlayerCharacterName);
    const prompt = buildSeedPrompt({
      personality,
      sheet: player.characterSheet,
      dmCharacterNotes,
      history,
      narrativeSummary: gameState.narrativeSummary,
    });

    // Safety cap: the claude CLI takes the prompt via posix_spawn args, which
    // are capped at ~1MB on macOS (ARG_MAX). If the prompt is still too large
    // after history-window trimming, fall back to the starter template instead
    // of crashing with E2BIG.
    if (prompt.length > SEED_PROMPT_MAX_BYTES) {
      log.warn(
        `Agent notes: seed prompt for ${agentPlayerCharacterName} is ${prompt.length} bytes (over ${SEED_PROMPT_MAX_BYTES} cap) — falling back to starter template`,
      );
      await seedAgentNotes(gameState.id, personality, player.characterSheet);
      return;
    }

    const effectiveHistoryCount = Math.min(history.length, SEED_HISTORY_WINDOW);
    log.info(
      `Agent notes: seeding ${agentPlayerCharacterName} from ${effectiveHistoryCount}/${history.length} history entries${dmCharacterNotes ? " + DM notes" : ""}${gameState.narrativeSummary ? " + story summary" : ""}...`,
    );
    const response = await chat(
      models.agent,
      SEED_SYSTEM,
      [{ role: "user", content: prompt }],
      undefined,
      "low",
    );

    // Strip any stray code-fencing or preamble a model may emit
    let content = response.trim();
    content = content.replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n?```\s*$/i, "");
    if (!content.startsWith("# ")) {
      log.warn(
        `Agent notes: seeder response for ${agentPlayerCharacterName} doesn't start with a heading — falling back to starter template`,
      );
      await seedAgentNotes(gameState.id, personality, player.characterSheet);
      return;
    }

    await writeFile(file, `${content}\n`);
    log.info(`Agent notes: retrofit seeded for ${agentPlayerCharacterName}`);
  } catch (err) {
    log.error(`Agent notes: retrofit seed failed for ${agentPlayerCharacterName}:`, err);
    // Best-effort fallback to starter template so the file exists
    const fallback = gameState.players.find(
      (p) => p.characterSheet.name === agentPlayerCharacterName,
    );
    if (fallback?.agentFile) {
      try {
        const personality = await loadAgentPersonality(fallback.agentFile.replace(/\.md$/, ""));
        await seedAgentNotes(gameState.id, personality, fallback.characterSheet);
      } catch {
        /* give up silently — next /resume will try again */
      }
    }
  }
}

/**
 * Seed memories for all active (non-dormant) AI agents in a game.
 * Runs per-agent calls in parallel.
 */
export async function seedAllAgentMemories(
  gameState: GameState,
  history: TurnEntry[],
): Promise<void> {
  const targets = gameState.players.filter((p) => p.isAgent && !p.dormant && p.agentFile);
  if (targets.length === 0) {
    log.info("Agent notes: no active AI agents to seed");
    return;
  }
  log.info(
    `Agent notes: retrofitting memory for ${targets.length} agent(s): ${targets.map((t) => t.characterSheet.name).join(", ")}`,
  );
  await Promise.all(
    targets.map((p) =>
      seedAgentMemoryFromHistory(
        gameState,
        p.characterSheet.name,
        // biome-ignore lint/style/noNonNullAssertion: filter above ensures agentFile exists
        p.agentFile!,
        history,
      ),
    ),
  );
}

export { getAgentNotesDir };
