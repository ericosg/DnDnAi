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
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const state = await loadGameState(entry.name);
      if (state && state.channelId === channelId) return state;
    }
  }
  return null;
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
