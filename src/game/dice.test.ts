import { describe, expect, test } from "bun:test";
import {
  formatDiceResult,
  parseConcentrateDirective,
  parseConditionDirective,
  parseDamageDirective,
  parseDiceDirective,
  parseDiceNotation,
  parseHealDirective,
  parseSpellDirective,
  parseUseDirective,
  parseXPDirective,
  roll,
} from "./dice.js";

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

  test("compound: 1d6+3+1d6 (weapon + mod + sneak attack)", () => {
    for (let i = 0; i < 50; i++) {
      const result = roll("1d6+3+1d6");
      expect(result.rolls).toHaveLength(2); // two d6 rolls
      expect(result.modifier).toBe(3);
      expect(result.total).toBeGreaterThanOrEqual(5); // 1+3+1
      expect(result.total).toBeLessThanOrEqual(15); // 6+3+6
    }
  });

  test("compound: 2d6+1d8+5 (multiple dice groups + modifier)", () => {
    for (let i = 0; i < 50; i++) {
      const result = roll("2d6+1d8+5");
      expect(result.rolls).toHaveLength(3); // two d6 + one d8
      expect(result.modifier).toBe(5);
      expect(result.total).toBeGreaterThanOrEqual(8); // 1+1+1+5
      expect(result.total).toBeLessThanOrEqual(25); // 6+6+8+5
    }
  });

  test("compound: preserves original notation", () => {
    const result = roll("1d6+3+1d6", "sneak attack damage");
    expect(result.notation).toBe("1d6+3+1d6");
    expect(result.label).toBe("sneak attack damage");
  });

  test("simple expression with modifier still works", () => {
    for (let i = 0; i < 50; i++) {
      const result = roll("1d6+3");
      expect(result.rolls).toHaveLength(1);
      expect(result.modifier).toBe(3);
      expect(result.total).toBeGreaterThanOrEqual(4);
      expect(result.total).toBeLessThanOrEqual(9);
    }
  });

  test("flat number: positive integer", () => {
    const result = roll("1", "necrotic resonance");
    expect(result.rolls).toEqual([]);
    expect(result.modifier).toBe(1);
    expect(result.total).toBe(1);
    expect(result.notation).toBe("1");
    expect(result.label).toBe("necrotic resonance");
  });

  test("flat number: larger value", () => {
    const result = roll("5");
    expect(result.rolls).toEqual([]);
    expect(result.modifier).toBe(5);
    expect(result.total).toBe(5);
  });

  test("flat number: negative value", () => {
    const result = roll("-2");
    expect(result.rolls).toEqual([]);
    expect(result.modifier).toBe(-2);
    expect(result.total).toBe(-2);
  });

  test("flat number: zero", () => {
    const result = roll("0");
    expect(result.rolls).toEqual([]);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(0);
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

describe("parseDamageDirective", () => {
  test("parses standard damage directive", () => {
    const text = "[[DAMAGE:2d6+3 TARGET:Grimbold REASON:longsword hit]]";
    const results = parseDamageDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      notation: "2d6+3",
      targetName: "Grimbold",
      reason: "longsword hit",
    });
  });

  test("parses multiple damage directives", () => {
    const text =
      "[[DAMAGE:1d8+2 TARGET:Grimbold REASON:bite]] and [[DAMAGE:1d6 TARGET:Nyx REASON:claw]]";
    const results = parseDamageDirective(text);
    expect(results).toHaveLength(2);
  });

  test("parses multi-word target names", () => {
    const text = "[[DAMAGE:2d6+3 TARGET:Grimbold Ironforge REASON:longsword hit]]";
    const results = parseDamageDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0].targetName).toBe("Grimbold Ironforge");
  });

  test("returns empty array for no directives", () => {
    const results = parseDamageDirective("Just some normal text");
    expect(results).toHaveLength(0);
  });
});

describe("parseHealDirective", () => {
  test("parses standard heal directive", () => {
    const text = "[[HEAL:1d8+3 TARGET:Fūsetsu REASON:cure wounds]]";
    const results = parseHealDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      notation: "1d8+3",
      targetName: "Fūsetsu",
      reason: "cure wounds",
    });
  });

  test("returns empty array for no directives", () => {
    const results = parseHealDirective("Just some normal text");
    expect(results).toHaveLength(0);
  });
});

describe("parseXPDirective", () => {
  test("parses party XP directive", () => {
    const text = "[[XP:300 TARGET:party REASON:defeated the goblins]]";
    const results = parseXPDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      amount: 300,
      target: "party",
      reason: "defeated the goblins",
    });
  });

  test("parses individual XP directive", () => {
    const text = "[[XP:50 TARGET:Fūsetsu REASON:clever trap disarm]]";
    const results = parseXPDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      amount: 50,
      target: "Fūsetsu",
      reason: "clever trap disarm",
    });
  });

  test("parses multiple XP directives", () => {
    const text =
      "[[XP:300 TARGET:party REASON:combat victory]] and [[XP:50 TARGET:Grimbold REASON:heroic last stand]]";
    const results = parseXPDirective(text);
    expect(results).toHaveLength(2);
  });

  test("returns empty array for no directives", () => {
    const results = parseXPDirective("Just some normal text with XP mentioned");
    expect(results).toHaveLength(0);
  });

  test("parses relaxed spacing around colons", () => {
    const text = "[[XP : 100 TARGET : party REASON : milestone]]";
    const results = parseXPDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(100);
  });
});

describe("parseSpellDirective", () => {
  test("parses spell slot directive", () => {
    const text = "[[SPELL:1 TARGET:Hierophantis]]";
    const results = parseSpellDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ level: 1, target: "Hierophantis" });
  });

  test("parses higher level spell", () => {
    const text = "[[SPELL:3 TARGET:Nyx]]";
    const results = parseSpellDirective(text);
    expect(results[0]).toEqual({ level: 3, target: "Nyx" });
  });

  test("returns empty for no directives", () => {
    expect(parseSpellDirective("normal text")).toHaveLength(0);
  });
});

describe("parseUseDirective", () => {
  test("parses feature use", () => {
    const text = "[[USE:Second Wind TARGET:Grimbold]]";
    const results = parseUseDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ featureName: "Second Wind", target: "Grimbold" });
  });

  test("parses multi-word feature", () => {
    const text = "[[USE:Bardic Inspiration TARGET:Merric]]";
    const results = parseUseDirective(text);
    expect(results[0].featureName).toBe("Bardic Inspiration");
  });

  test("returns empty for no directives", () => {
    expect(parseUseDirective("normal text")).toHaveLength(0);
  });
});

describe("parseConcentrateDirective", () => {
  test("parses concentration directive", () => {
    const text = "[[CONCENTRATE:Bless TARGET:Hierophantis]]";
    const results = parseConcentrateDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ spell: "Bless", target: "Hierophantis" });
  });

  test("parses multi-word spell", () => {
    const text = "[[CONCENTRATE:Hold Person TARGET:Nyx]]";
    const results = parseConcentrateDirective(text);
    expect(results[0].spell).toBe("Hold Person");
  });

  test("returns empty for no directives", () => {
    expect(parseConcentrateDirective("normal text")).toHaveLength(0);
  });
});

describe("parseConditionDirective", () => {
  test("parses ADD condition", () => {
    const text = "[[CONDITION:ADD prone TARGET:Grimbold]]";
    const results = parseConditionDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ action: "add", condition: "prone", target: "Grimbold" });
  });

  test("parses REMOVE condition", () => {
    const text = "[[CONDITION:REMOVE prone TARGET:Grimbold]]";
    const results = parseConditionDirective(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ action: "remove", condition: "prone", target: "Grimbold" });
  });

  test("case insensitive action", () => {
    const text = "[[CONDITION:add frightened TARGET:Fūsetsu]]";
    const results = parseConditionDirective(text);
    expect(results[0].action).toBe("add");
    expect(results[0].condition).toBe("frightened");
  });

  test("returns empty for no directives", () => {
    expect(parseConditionDirective("normal text")).toHaveLength(0);
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
