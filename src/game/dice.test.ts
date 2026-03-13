import { describe, expect, test } from "bun:test";
import { formatDiceResult, parseDiceDirective, parseDiceNotation, roll } from "./dice.js";

describe("parseDiceNotation", () => {
  test("simple d20", () => {
    const result = parseDiceNotation("d20");
    expect(result).toEqual({ count: 1, sides: 20, modifier: 0, keep: undefined });
  });

  test("2d6+3", () => {
    const result = parseDiceNotation("2d6+3");
    expect(result).toEqual({ count: 2, sides: 6, modifier: 3, keep: undefined });
  });

  test("4d6kh3 (keep highest)", () => {
    const result = parseDiceNotation("4d6kh3");
    expect(result).toEqual({ count: 4, sides: 6, modifier: 0, keep: { type: "h", count: 3 } });
  });

  test("d20-1 (negative modifier)", () => {
    const result = parseDiceNotation("d20-1");
    expect(result).toEqual({ count: 1, sides: 20, modifier: -1, keep: undefined });
  });

  test("ignores spaces", () => {
    const result = parseDiceNotation(" 2d6 + 3 ");
    expect(result).toEqual({ count: 2, sides: 6, modifier: 3, keep: undefined });
  });

  test("throws on invalid notation", () => {
    expect(() => parseDiceNotation("not-dice")).toThrow("Invalid dice notation");
  });
});

describe("roll", () => {
  test("d20 returns value between 1 and 20", () => {
    for (let i = 0; i < 50; i++) {
      const result = roll("d20");
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(20);
    }
  });

  test("2d6 returns value between 2 and 12", () => {
    for (let i = 0; i < 50; i++) {
      const result = roll("2d6");
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeLessThanOrEqual(12);
    }
  });

  test("d6+5 modifier is applied", () => {
    for (let i = 0; i < 50; i++) {
      const result = roll("d6+5");
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(11);
      expect(result.modifier).toBe(5);
    }
  });

  test("4d6kh3 keeps only 3 dice", () => {
    const result = roll("4d6kh3");
    expect(result.rolls).toHaveLength(4);
    expect(result.kept).toHaveLength(3);
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.total).toBeLessThanOrEqual(18);
  });

  test("stores label", () => {
    const result = roll("d20", "attack roll");
    expect(result.label).toBe("attack roll");
  });
});

describe("parseDiceDirective", () => {
  test("parses standard directive", () => {
    const text = "[[ROLL:d20+5 FOR:Grimbold REASON:attack roll]]";
    const results = parseDiceDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      notation: "d20+5",
      forName: "Grimbold",
      reason: "attack roll",
    });
  });

  test("parses multiple directives", () => {
    const text =
      "[[ROLL:d20+5 FOR:Grimbold REASON:attack roll]] then [[ROLL:2d6+3 FOR:Grimbold REASON:damage]]";
    const results = parseDiceDirective(text);
    expect(results).toHaveLength(2);
  });

  test("parses relaxed spacing around colons", () => {
    const text = "[[ROLL : d20+5 FOR : Grimbold REASON : attack roll]]";
    const results = parseDiceDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      notation: "d20+5",
      forName: "Grimbold",
      reason: "attack roll",
    });
  });

  test("parses multi-word FOR names", () => {
    const text = "[[ROLL:d20+5 FOR:Grimbold Ironforge REASON:attack roll]]";
    const results = parseDiceDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0].forName).toBe("Grimbold Ironforge");
  });

  test("returns empty array for no directives", () => {
    const results = parseDiceDirective("Just some normal text");
    expect(results).toHaveLength(0);
  });
});

describe("formatDiceResult", () => {
  test("formats simple roll", () => {
    const result = formatDiceResult({
      notation: "d20",
      rolls: [15],
      modifier: 0,
      total: 15,
    });
    expect(result).toContain("`d20`");
    expect(result).toContain("**15**");
  });

  test("includes modifier", () => {
    const result = formatDiceResult({
      notation: "d20+5",
      rolls: [15],
      modifier: 5,
      total: 20,
    });
    expect(result).toContain("+5");
    expect(result).toContain("**20**");
  });

  test("includes label", () => {
    const result = formatDiceResult({
      notation: "d20",
      rolls: [15],
      modifier: 0,
      total: 15,
      label: "attack",
    });
    expect(result).toContain("(attack)");
  });

  test("shows multiple rolls", () => {
    const result = formatDiceResult({
      notation: "2d6",
      rolls: [3, 4],
      modifier: 0,
      total: 7,
    });
    expect(result).toContain("[3, 4]");
  });

  test("shows kept dice", () => {
    const result = formatDiceResult({
      notation: "4d6kh3",
      rolls: [1, 4, 3, 6],
      modifier: 0,
      total: 13,
      kept: [6, 4, 3],
    });
    expect(result).toContain("kept [6, 4, 3]");
  });
});
