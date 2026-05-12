/**
 * Admin OOC corrections (Ticket 1 — replaces the original scene-scope work).
 *
 * The bot owner can issue an out-of-character system message to any AI agent,
 * the DM, a specific human player, or everyone. The targeted recipient sees
 * the correction in their NEXT prompt under a high-salience header.
 *
 * Design parallels `src/game/ask-history.ts`:
 * - In-memory FIFO buffer per gameId (corrections are ephemeral; durability
 *   for audit is provided by the system `TurnEntry` written at issuance time).
 * - Buffer size capped, AND entries auto-expire after `MAX_AGE_TURNS` so they
 *   don't haunt the prompt forever.
 * - Pure-function formatters so the prompt-builder can call them without
 *   touching disk.
 *
 * The slash command handler (`src/discord/handlers/correct.ts`) is the only
 * caller of `addAdminCorrection`. The DM prompt builder and agent prompt
 * builder are the only callers of `formatAdminCorrectionsForPrompt`.
 */

export type AdminTarget =
  | { kind: "dm" }
  | { kind: "agent"; name: string }
  | { kind: "human"; playerId: string }
  | { kind: "all" };

export interface AdminCorrection {
  target: AdminTarget;
  message: string;
  remember: boolean;
  issuedAt: string; // ISO timestamp
  issuedAtTurn: number; // gameState.turnCount at issue time
  issuedBy: string; // Discord user ID of the admin
}

const store = new Map<string, AdminCorrection[]>();
const MAX_HISTORY = 10;
/** Corrections older than this many game turns are considered stale and excluded from prompts. */
export const MAX_AGE_TURNS = 5;

export function getAdminCorrections(gameId: string): AdminCorrection[] {
  return store.get(gameId) ?? [];
}

export function addAdminCorrection(gameId: string, entry: AdminCorrection): void {
  const list = store.get(gameId) ?? [];
  list.push(entry);
  // Cap the buffer
  while (list.length > MAX_HISTORY) list.shift();
  store.set(gameId, list);
}

export function clearAdminCorrections(gameId: string): void {
  store.delete(gameId);
}

/** Test helper. Resets all in-memory state. */
export function _resetAdminCorrectionsForTest(): void {
  store.clear();
}

/**
 * Predicate: is this correction visible to the given recipient on this turn?
 *
 * - "all" corrections are visible to everyone.
 * - "agent" corrections only to the matching agent (case-insensitive).
 * - "dm" corrections only to the DM.
 * - "human" corrections only to the matching human (we still surface in prompts
 *   so the DM has context that an admin OOC was issued; humans see it as a
 *   channel message anyway).
 *
 * Stale corrections (older than MAX_AGE_TURNS) are filtered out regardless of target.
 */
export function isCorrectionVisible(
  correction: AdminCorrection,
  recipient: { kind: "dm" } | { kind: "agent"; name: string },
  currentTurn: number,
): boolean {
  if (currentTurn - correction.issuedAtTurn >= MAX_AGE_TURNS) return false;
  const t = correction.target;
  if (t.kind === "all") return true;
  if (recipient.kind === "dm") {
    return t.kind === "dm";
  }
  // recipient is an agent
  if (t.kind !== "agent") return false;
  return t.name.toLowerCase() === recipient.name.toLowerCase();
}

/**
 * Build a `## ⚠️ Admin Correction` block for injection into a prompt.
 *
 * Returns null if no relevant corrections exist. The block lists each
 * correction as a bullet, in chronological order (oldest first so the most
 * recent appears closest to the rest of the prompt content).
 */
export function formatAdminCorrectionsForPrompt(
  gameId: string,
  recipient: { kind: "dm" } | { kind: "agent"; name: string },
  currentTurn: number,
): string | null {
  const all = getAdminCorrections(gameId);
  const visible = all.filter((c) => isCorrectionVisible(c, recipient, currentTurn));
  if (visible.length === 0) return null;
  const bullets = visible.map((c) => `- ${c.message}`).join("\n");
  return `## ⚠️ Admin Correction (READ FIRST — overrides anything below)
The bot owner has issued the following out-of-character correction(s). They override any contradicting content elsewhere in this prompt. Adjust your next response accordingly.

${bullets}`;
}
