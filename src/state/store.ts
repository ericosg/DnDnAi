import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import type { CharacterSheet, GameState, TurnEntry } from "./types.js";

function gamePath(gameId: string): string {
  return path.join(DATA_DIR, gameId);
}

function statePath(gameId: string): string {
  return path.join(gamePath(gameId), "state.json");
}

function historyPath(gameId: string): string {
  return path.join(gamePath(gameId), "history.json");
}

function characterPath(gameId: string, name: string): string {
  return path.join(
    gamePath(gameId),
    "characters",
    `${name.toLowerCase().replace(/\s+/g, "-")}.json`,
  );
}

function dmNotesPath(gameId: string): string {
  return path.join(gamePath(gameId), "dm-notes");
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// --- Game State ---

export async function saveGameState(state: GameState): Promise<void> {
  const dir = gamePath(state.id);
  await ensureDir(dir);
  state.lastActivity = new Date().toISOString();
  await writeFile(statePath(state.id), JSON.stringify(state, null, 2));
}

export async function loadGameState(gameId: string): Promise<GameState | null> {
  const p = statePath(gameId);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw) as GameState;
}

export async function findGameByChannel(channelId: string): Promise<GameState | null> {
  const gamesDir = DATA_DIR;
  if (!existsSync(gamesDir)) return null;
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(gamesDir, { withFileTypes: true });
  let latest: GameState | null = null;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const state = await loadGameState(entry.name);
      if (state && state.channelId === channelId) {
        // Prefer non-ended games; among those, prefer the most recently active
        if (!latest || (latest.status === "ended" && state.status !== "ended")) {
          latest = state;
        } else if (latest.status === state.status && state.lastActivity > latest.lastActivity) {
          latest = state;
        }
      }
    }
  }
  return latest;
}

// --- History ---

export async function loadHistory(gameId: string): Promise<TurnEntry[]> {
  const p = historyPath(gameId);
  if (!existsSync(p)) return [];
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw) as TurnEntry[];
}

export async function appendHistory(gameId: string, entry: TurnEntry): Promise<void> {
  const dir = gamePath(gameId);
  await ensureDir(dir);
  const history = await loadHistory(gameId);
  history.push(entry);
  await writeFile(historyPath(gameId), JSON.stringify(history, null, 2));
}

export async function saveHistory(gameId: string, history: TurnEntry[]): Promise<void> {
  const dir = gamePath(gameId);
  await ensureDir(dir);
  await writeFile(historyPath(gameId), JSON.stringify(history, null, 2));
}

// --- Characters ---

export async function saveCharacter(gameId: string, sheet: CharacterSheet): Promise<void> {
  const dir = path.join(gamePath(gameId), "characters");
  await ensureDir(dir);
  await writeFile(characterPath(gameId, sheet.name), JSON.stringify(sheet, null, 2));
}

export async function loadCharacter(gameId: string, name: string): Promise<CharacterSheet | null> {
  const p = characterPath(gameId, name);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw) as CharacterSheet;
}

export async function findActiveGames(): Promise<GameState[]> {
  if (!existsSync(DATA_DIR)) return [];
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const games: GameState[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const state = await loadGameState(entry.name);
      if (state && state.status === "active") games.push(state);
    }
  }
  return games;
}

// --- DM Notes ---

export async function initDMNotes(gameId: string): Promise<void> {
  const notesDir = dmNotesPath(gameId);
  await ensureDir(notesDir);
  await ensureDir(path.join(notesDir, "characters"));

  // Seed with empty template files so the DM knows the structure
  const worldPath = path.join(notesDir, "world.md");
  if (!existsSync(worldPath)) {
    await writeFile(
      worldPath,
      "# World Notes\n\nNPCs, locations, and lore established during play.\n",
    );
  }

  const plotPath = path.join(notesDir, "plot.md");
  if (!existsSync(plotPath)) {
    await writeFile(
      plotPath,
      "# Plot Threads\n\nActive hooks, mysteries, and planned encounters.\n",
    );
  }

  const rulingsPath = path.join(notesDir, "rulings.md");
  if (!existsSync(rulingsPath)) {
    await writeFile(rulingsPath, "# Rulings\n\nRules interpretations made during this campaign.\n");
  }

  const sessionLogPath = path.join(notesDir, "session-log.md");
  if (!existsSync(sessionLogPath)) {
    await writeFile(sessionLogPath, "# Session Log\n\nKey events by session.\n");
  }

  const dmContextPath = path.join(notesDir, "dm.md");
  if (!existsSync(dmContextPath)) {
    await writeFile(
      dmContextPath,
      `# DM Context

This file is loaded into your system prompt on EVERY call. Keep it concise and current.
Use it as your running memory — anything here, you will always see. Anything elsewhere, you might miss.

## Active Plot Threads
<!-- What's happening RIGHT NOW in the story. Update after major developments. -->

## Key NPCs
<!-- NPCs the party has met or will meet soon. Name, role, disposition, last interaction. -->

## Important Rulings & Precedents
<!-- Rules calls you've made that should stay consistent. -->

## Session Notes
<!-- Brief notes from the current session. What just happened, what's coming next. -->
`,
    );
  }
}

// --- Factory ---

export function createGameState(id: string, channelId: string, guildId: string): GameState {
  return {
    id,
    channelId,
    guildId,
    status: "lobby",
    players: [],
    combat: {
      active: false,
      round: 0,
      turnIndex: 0,
      combatants: [],
    },
    narrativeSummary: "",
    turnCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}
