import { describe, expect, test } from "bun:test";
import { dmNarrationEmbeds } from "./formatter.js";

describe("dmNarrationEmbeds", () => {
  test("short text returns a single embed", () => {
    const embeds = dmNarrationEmbeds("Hello adventurers!");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].data.description).toBe("Hello adventurers!");
  });

  test("single embed has DM author", () => {
    const embeds = dmNarrationEmbeds("Welcome.");
    expect(embeds[0].data.author?.name).toBe("Dungeon Master");
  });

  test("single embed has purple color", () => {
    const embeds = dmNarrationEmbeds("Welcome.");
    expect(embeds[0].data.color).toBe(0x7b2d8b);
  });

  test("text at exactly 4096 chars returns a single embed", () => {
    const text = "a".repeat(4096);
    const embeds = dmNarrationEmbeds(text);
    expect(embeds).toHaveLength(1);
    expect(embeds[0].data.description).toBe(text);
  });

  test("text over 4096 chars splits into multiple embeds", () => {
    const text = "a".repeat(5000);
    const embeds = dmNarrationEmbeds(text);
    expect(embeds.length).toBeGreaterThan(1);
  });

  test("only first embed has DM author when split", () => {
    const text = "a".repeat(5000);
    const embeds = dmNarrationEmbeds(text);
    expect(embeds[0].data.author?.name).toBe("Dungeon Master");
    for (let i = 1; i < embeds.length; i++) {
      expect(embeds[i].data.author).toBeUndefined();
    }
  });

  test("all embeds have purple color", () => {
    const text = "a".repeat(5000);
    const embeds = dmNarrationEmbeds(text);
    for (const embed of embeds) {
      expect(embed.data.color).toBe(0x7b2d8b);
    }
  });

  test("no embed exceeds 4096 chars in description", () => {
    const text = "a".repeat(10000);
    const embeds = dmNarrationEmbeds(text);
    for (const embed of embeds) {
      expect((embed.data.description ?? "").length).toBeLessThanOrEqual(4096);
    }
  });

  test("split preserves all content", () => {
    const text = "a".repeat(5000);
    const embeds = dmNarrationEmbeds(text);
    const reassembled = embeds.map((e) => e.data.description).join("");
    expect(reassembled.length).toBe(text.length);
  });

  test("prefers splitting at paragraph boundaries", () => {
    // Build text with a paragraph break near the limit
    const firstParagraph = "a".repeat(3000);
    const secondParagraph = "b".repeat(3000);
    const text = `${firstParagraph}\n\n${secondParagraph}`;

    const embeds = dmNarrationEmbeds(text);
    expect(embeds).toHaveLength(2);
    expect(embeds[0].data.description).toBe(firstParagraph);
    expect(embeds[1].data.description).toBe(secondParagraph);
  });

  test("falls back to newline split when no paragraph break", () => {
    const firstLine = "a".repeat(3000);
    const secondLine = "b".repeat(3000);
    const text = `${firstLine}\n${secondLine}`;

    const embeds = dmNarrationEmbeds(text);
    expect(embeds).toHaveLength(2);
    expect(embeds[0].data.description).toBe(firstLine);
    expect(embeds[1].data.description).toBe(secondLine);
  });

  test("handles very long text with no newlines", () => {
    const text = "x".repeat(9000);
    const embeds = dmNarrationEmbeds(text);
    expect(embeds.length).toBeGreaterThan(1);
    for (const embed of embeds) {
      expect((embed.data.description ?? "").length).toBeLessThanOrEqual(4096);
    }
    // All content preserved
    const total = embeds.reduce((sum, e) => sum + (e.data.description ?? "").length, 0);
    expect(total).toBe(9000);
  });

  test("single character returns single embed", () => {
    const embeds = dmNarrationEmbeds(".");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].data.description).toBe(".");
  });
});
