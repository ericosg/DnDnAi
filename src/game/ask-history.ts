/**
 * In-memory /ask exchange store.
 * Keeps a FIFO buffer of recent /ask Q&A pairs per game so the DM
 * has context about prior OOC questions within the same session.
 * Clears on bot restart (intentional — these are ephemeral).
 */

export interface AskExchange {
  question: string;
  answer: string;
  askerName: string;
  timestamp: string;
}

const store = new Map<string, AskExchange[]>();
const MAX_HISTORY = 5;

export function getAskHistory(gameId: string): AskExchange[] {
  return store.get(gameId) ?? [];
}

export function addAskExchange(gameId: string, exchange: AskExchange): void {
  const history = store.get(gameId) ?? [];
  history.push(exchange);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  store.set(gameId, history);
}

export function clearAskHistory(gameId: string): void {
  store.delete(gameId);
}

/**
 * Format ask history for inclusion in DM prompt.
 * Returns null if no exchanges exist.
 */
export function formatAskHistoryForPrompt(gameId: string): string | null {
  const history = getAskHistory(gameId);
  if (history.length === 0) return null;

  const lines = history.map(
    (h) => `- **${h.askerName}** asked: ${h.question}\n  DM answered: ${h.answer.slice(0, 300)}`,
  );
  return `## Recent /ask Exchanges\n${lines.join("\n\n")}`;
}
