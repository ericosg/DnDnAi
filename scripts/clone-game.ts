/**
 * Clone an existing game directory to a new game id + target channel.
 *
 * Use case: bug-fixes-next-release smoke test. Copy the live game into a fresh
 * id pointed at a test Discord channel so we can exercise the new features
 * (admin /correct, hard facts, canon pre-read, etc.) without touching the
 * live channel's game state.
 *
 * Usage:
 *   bun run scripts/clone-game.ts <source-id> <target-channel-id> [--paused]
 *
 * The clone:
 * - copies every file in data/games/<source-id>/ recursively
 * - generates a fresh UUID for the clone's directory + state.json `id`
 * - rewrites state.json `channelId` to the target
 * - optionally flips status to "paused" (--paused)
 * - prints the new id so it can be cleaned up later with `rm -rf data/games/<id>`
 *
 * The source is read-only — original game is untouched.
 */

import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const sourceId = args[0];
const targetChannelId = args[1];
const paused = args.includes("--paused");

if (!sourceId || !targetChannelId) {
  console.error("Usage: bun run scripts/clone-game.ts <source-id> <target-channel-id> [--paused]");
  process.exit(2);
}

const dataDir = path.resolve("data/games");
const srcDir = path.join(dataDir, sourceId);
if (!existsSync(srcDir)) {
  console.error(`Source game directory not found: ${srcDir}`);
  process.exit(1);
}

const newId = crypto.randomUUID();
const destDir = path.join(dataDir, newId);

if (existsSync(destDir)) {
  console.error(`Destination already exists (UUID collision?!): ${destDir}`);
  process.exit(1);
}

console.log(`Cloning ${sourceId} → ${newId}`);
console.log(`  src: ${srcDir}`);
console.log(`  dst: ${destDir}`);

await cp(srcDir, destDir, { recursive: true });

// Rewrite state.json with new id + channelId
const statePath = path.join(destDir, "state.json");
const raw = await readFile(statePath, "utf-8");
const state = JSON.parse(raw);

const originalId = state.id;
const originalChannelId = state.channelId;
const originalStatus = state.status;

state.id = newId;
state.channelId = targetChannelId;
if (paused) state.status = "paused";

await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");

console.log("\nClone complete.");
console.log(`  id        : ${originalId} → ${newId}`);
console.log(`  channelId : ${originalChannelId} → ${targetChannelId}`);
console.log(`  status    : ${originalStatus}${paused ? " → paused" : " (unchanged)"}`);
console.log(`\nCleanup later with:  rm -rf ${destDir}`);
