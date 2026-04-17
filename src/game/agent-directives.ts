/**
 * Agent-action directives.
 *
 * Parallel to DM directives (game/directives.ts) but invoked from agent output.
 * The DM's directives mutate game state (HP, XP, etc.). Agent directives are
 * "utility commands" — the agent's equivalent of the slash commands human
 * players use: PASS, ASK, LOOK, WHISPER.
 *
 * This module only parses & removes the directives from agent text. The side
 * effects (calling the DM, posting messages, recording history, sending DMs)
 * happen in the engine (handleAgentTurn) so this stays a pure function.
 */

import { log } from "../logger.js";
import type { GameState, Player } from "../state/types.js";

export type AgentAction =
  | { kind: "pass" }
  | { kind: "ask"; question: string }
  | { kind: "look"; target: string | null }
  | { kind: "whisper"; target: Player; message: string };

export interface AgentDirectiveContext {
  /** Agent's IC text with directives stripped. May be empty if the agent only emitted directives. */
  processedText: string;
  /** Actions to apply, in the order they appeared in the response. */
  actions: AgentAction[];
  /** Whether [[PASS]] was emitted. */
  passed: boolean;
}

/**
 * Parse agent directives from response text.
 *
 * Recognized:
 *  - `[[PASS]]` — the agent skips their turn
 *  - `[[ASK:question text]]` — OOC question to the DM
 *  - `[[LOOK:target text]]` or `[[LOOK]]` — ask the DM to describe something
 *  - `[[WHISPER:Target Name TEXT:message text]]` — private IC whisper to another PC
 *
 * Unknown-target whispers are dropped with a warning (never silently leak to the wrong target).
 */
export function processAgentDirectives(
  text: string,
  gameState: GameState,
  agentPlayerId: string,
): AgentDirectiveContext {
  let processedText = text;
  const actions: AgentAction[] = [];
  let passed = false;

  // PASS — simplest, no args
  const passMatches = Array.from(processedText.matchAll(/\[\[PASS\]\]/g));
  if (passMatches.length > 0) {
    passed = true;
    actions.push({ kind: "pass" });
    for (const m of passMatches) processedText = processedText.replace(m[0], "");
    log.info(`  Agent directive: PASS`);
  }

  // ASK — [[ASK:question]]
  for (const m of Array.from(processedText.matchAll(/\[\[ASK:([\s\S]+?)\]\]/g))) {
    const question = m[1].trim();
    if (question) {
      actions.push({ kind: "ask", question });
      log.info(`  Agent directive: ASK "${question.slice(0, 80)}"`);
    } else {
      log.warn("  Agent directive: ASK with empty question — dropped");
    }
    processedText = processedText.replace(m[0], "");
  }

  // LOOK — [[LOOK]] or [[LOOK:target]]
  for (const m of Array.from(processedText.matchAll(/\[\[LOOK(?::([\s\S]+?))?\]\]/g))) {
    const target = m[1]?.trim() || null;
    actions.push({ kind: "look", target });
    log.info(`  Agent directive: LOOK ${target ? `"${target}"` : "(general)"}`);
    processedText = processedText.replace(m[0], "");
  }

  // WHISPER — [[WHISPER:Name TEXT:message]]
  for (const m of Array.from(processedText.matchAll(/\[\[WHISPER:(.+?) TEXT:([\s\S]+?)\]\]/g))) {
    const targetName = m[1].trim();
    const message = m[2].trim();
    const target = gameState.players.find(
      (p) =>
        p.id !== agentPlayerId && p.characterSheet.name.toLowerCase() === targetName.toLowerCase(),
    );
    if (target && message) {
      actions.push({ kind: "whisper", target, message });
      log.info(`  Agent directive: WHISPER → ${target.characterSheet.name}`);
    } else if (!target) {
      log.warn(`  Agent directive: WHISPER — unknown target "${targetName}" — dropped`);
    } else {
      log.warn(`  Agent directive: WHISPER with empty message — dropped`);
    }
    processedText = processedText.replace(m[0], "");
  }

  // Clean up: collapse whitespace runs left by directive removal without mangling intentional formatting
  processedText = processedText
    .replace(/[ \t]+$/gm, "") // trailing whitespace per line
    .replace(/ {2,}/g, " ") // collapse internal double-spaces from adjacent-directive gaps
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .trim();

  return { processedText, actions, passed };
}
