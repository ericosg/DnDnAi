/**
 * Append-only audit log for agent memory writes (Ticket 5.1).
 *
 * Whenever an AI agent emits an `Edit` tool-use against its own memory file,
 * we tee a short record into `data/games/<id>/agent-notes/.audit/<slug>.log`.
 *
 * The log is purely observational — there is no enforcement, no guardrail, no
 * blocking. Its purpose is to answer the question "where did THIS bullet
 * come from?" three turns after the fact, when something seems off.
 *
 * Format (one line per Edit):
 *   <ISO timestamp> · turn=<N> · <toolName> · <oneline input summary>
 *
 * The `.audit/` subdirectory is inside `data/games/<id>/`, which is already
 * gitignored, so audit logs never enter git.
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { AGENT_NOTES_DIR, DATA_DIR } from "../config.js";
import { log } from "../logger.js";
import { agentSlug } from "./agent-notes.js";

/** Subdirectory name under `agent-notes/` for audit logs. Hidden so users don't trip on it. */
export const AUDIT_DIR_NAME = ".audit";

export function getAuditDir(gameId: string): string {
  return path.join(DATA_DIR, gameId, AGENT_NOTES_DIR, AUDIT_DIR_NAME);
}

export function getAuditLogPath(gameId: string, agentName: string): string {
  return path.join(getAuditDir(gameId), `${agentSlug(agentName)}.log`);
}

/**
 * Build a single audit-log line from a tool-use event.
 * Pure function — easy to unit-test without filesystem I/O.
 */
export function formatAuditLine(
  timestamp: string,
  turnCount: number,
  toolName: string,
  inputSummary: string,
): string {
  // Strip embedded newlines so each event is exactly one line.
  const safeSummary = inputSummary.replace(/\s+/g, " ").trim();
  return `${timestamp} · turn=${turnCount} · ${toolName} · ${safeSummary}`;
}

/**
 * Append one line to the agent's audit log. Creates `.audit/` lazily.
 * Best-effort: errors are logged but not thrown — observability must never
 * block an agent turn.
 */
export async function appendAuditEntry(
  gameId: string,
  agentName: string,
  turnCount: number,
  toolName: string,
  inputSummary: string,
): Promise<void> {
  const dir = getAuditDir(gameId);
  try {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const line = `${formatAuditLine(new Date().toISOString(), turnCount, toolName, inputSummary)}\n`;
    await appendFile(getAuditLogPath(gameId, agentName), line, "utf-8");
  } catch (err) {
    log.warn(`Agent audit log: failed to write for ${agentName}: ${(err as Error).message}`);
  }
}
