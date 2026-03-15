import { afterEach, describe, expect, test } from "bun:test";
import { splitMessage, startTyping } from "./webhooks.js";

describe("startTyping", () => {
  const activeIntervals: ReturnType<typeof startTyping>[] = [];

  afterEach(() => {
    for (const stop of activeIntervals) stop();
    activeIntervals.length = 0;
  });

  test("calls sendTyping immediately", () => {
    let called = 0;
    const channel = { sendTyping: () => ({ catch: () => ++called }) } as never;
    const stop = startTyping(channel);
    activeIntervals.push(stop);
    expect(called).toBe(1);
  });

  test("returns a stop function", () => {
    const channel = { sendTyping: () => ({ catch: () => {} }) } as never;
    const stop = startTyping(channel);
    expect(typeof stop).toBe("function");
    stop(); // should not throw
  });

  test("handles sendTyping errors silently", () => {
    const channel = {
      sendTyping: () => ({
        catch: (fn: (e: Error) => void) => fn(new Error("fail")),
      }),
    } as never;
    // Should not throw
    const stop = startTyping(channel);
    activeIntervals.push(stop);
    stop();
  });
});

describe("splitMessage", () => {
  test("returns single chunk when under limit", () => {
    const chunks = splitMessage("Hello world", 100);
    expect(chunks).toEqual(["Hello world"]);
  });

  test("splits at newline boundary", () => {
    const text = "Line one\nLine two\nLine three\nLine four";
    const chunks = splitMessage(text, 20);

    // Each chunk should be under the limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }

    // All content should be preserved
    expect(chunks.join("\n")).toBe(text);
  });

  test("handles text with no newlines (fallback to maxLen split)", () => {
    const text = "a".repeat(100);
    const chunks = splitMessage(text, 30);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
    // All characters preserved
    expect(chunks.join("").length).toBe(100);
  });

  test("handles empty string", () => {
    const chunks = splitMessage("", 100);
    expect(chunks).toEqual([]);
  });

  test("splits long Discord messages (1900 char limit)", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${"x".repeat(80)}`);
    const text = paragraphs.join("\n\n");
    const chunks = splitMessage(text, 1900);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });
});
