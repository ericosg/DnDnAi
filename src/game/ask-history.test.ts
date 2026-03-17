import { beforeEach, describe, expect, test } from "bun:test";
import {
  addAskExchange,
  clearAskHistory,
  formatAskHistoryForPrompt,
  getAskHistory,
} from "./ask-history.js";

const GAME_ID = "test-game-ask";

beforeEach(() => {
  clearAskHistory(GAME_ID);
});

describe("ask-history — FIFO store", () => {
  test("starts empty", () => {
    expect(getAskHistory(GAME_ID)).toEqual([]);
  });

  test("adds and retrieves exchanges", () => {
    addAskExchange(GAME_ID, {
      question: "Can I sneak attack?",
      answer: "Yes, if you have advantage.",
      askerName: "Fusetsu",
      timestamp: "2026-03-17T00:00:00Z",
    });
    const history = getAskHistory(GAME_ID);
    expect(history).toHaveLength(1);
    expect(history[0].question).toBe("Can I sneak attack?");
  });

  test("FIFO eviction at max capacity (5)", () => {
    for (let i = 0; i < 7; i++) {
      addAskExchange(GAME_ID, {
        question: `Question ${i}`,
        answer: `Answer ${i}`,
        askerName: "Fusetsu",
        timestamp: new Date().toISOString(),
      });
    }
    const history = getAskHistory(GAME_ID);
    expect(history).toHaveLength(5);
    // Oldest two should have been evicted
    expect(history[0].question).toBe("Question 2");
    expect(history[4].question).toBe("Question 6");
  });

  test("clear removes all entries", () => {
    addAskExchange(GAME_ID, {
      question: "test",
      answer: "test",
      askerName: "test",
      timestamp: new Date().toISOString(),
    });
    clearAskHistory(GAME_ID);
    expect(getAskHistory(GAME_ID)).toEqual([]);
  });

  test("separate games have separate histories", () => {
    addAskExchange("game-a", {
      question: "A?",
      answer: "A!",
      askerName: "A",
      timestamp: new Date().toISOString(),
    });
    addAskExchange("game-b", {
      question: "B?",
      answer: "B!",
      askerName: "B",
      timestamp: new Date().toISOString(),
    });
    expect(getAskHistory("game-a")).toHaveLength(1);
    expect(getAskHistory("game-b")).toHaveLength(1);
    expect(getAskHistory("game-a")[0].question).toBe("A?");
    clearAskHistory("game-a");
    clearAskHistory("game-b");
  });
});

describe("ask-history — formatAskHistoryForPrompt", () => {
  test("returns null when empty", () => {
    expect(formatAskHistoryForPrompt(GAME_ID)).toBeNull();
  });

  test("formats exchanges for prompt", () => {
    addAskExchange(GAME_ID, {
      question: "How many spell slots do I have?",
      answer: "You have 2 first-level slots remaining.",
      askerName: "Hierophantis",
      timestamp: new Date().toISOString(),
    });
    const formatted = formatAskHistoryForPrompt(GAME_ID);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("## Recent /ask Exchanges");
    expect(formatted).toContain("**Hierophantis**");
    expect(formatted).toContain("How many spell slots do I have?");
    expect(formatted).toContain("2 first-level slots remaining");
  });

  test("truncates long answers", () => {
    addAskExchange(GAME_ID, {
      question: "Short?",
      answer: "A".repeat(500),
      askerName: "Test",
      timestamp: new Date().toISOString(),
    });
    const formatted = formatAskHistoryForPrompt(GAME_ID);
    expect(formatted).not.toBeNull();
    // Answer should be truncated to 300 chars
    // biome-ignore lint/style/noNonNullAssertion: test assertion after null check
    expect(formatted!.length).toBeLessThan(500);
  });
});
