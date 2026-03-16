import { describe, expect, test } from "bun:test";
import {
  checkLevelUp,
  fixedHPGain,
  hitDieSize,
  isASILevel,
  proficiencyBonus,
  XP_TABLE,
  xpForNextLevel,
  xpToNextLevel,
} from "./leveling.js";

describe("XP_TABLE", () => {
  test("has 21 entries (index 0-20)", () => {
    expect(XP_TABLE.length).toBe(21);
  });

  test("level 1 requires 0 XP", () => {
    expect(XP_TABLE[1]).toBe(0);
  });

  test("level 2 requires 300 XP", () => {
    expect(XP_TABLE[2]).toBe(300);
  });

  test("level 3 requires 900 XP", () => {
    expect(XP_TABLE[3]).toBe(900);
  });

  test("level 5 requires 6500 XP", () => {
    expect(XP_TABLE[5]).toBe(6_500);
  });

  test("level 20 requires 355000 XP", () => {
    expect(XP_TABLE[20]).toBe(355_000);
  });

  test("values are monotonically increasing", () => {
    for (let i = 2; i <= 20; i++) {
      expect(XP_TABLE[i]).toBeGreaterThan(XP_TABLE[i - 1]);
    }
  });
});

describe("xpForNextLevel", () => {
  test("level 1 → 300 XP needed for level 2", () => {
    expect(xpForNextLevel(1)).toBe(300);
  });

  test("level 2 → 900 XP needed for level 3", () => {
    expect(xpForNextLevel(2)).toBe(900);
  });

  test("level 19 → 355000 XP needed for level 20", () => {
    expect(xpForNextLevel(19)).toBe(355_000);
  });

  test("level 20 → Infinity (can't level further)", () => {
    expect(xpForNextLevel(20)).toBe(Number.POSITIVE_INFINITY);
  });

  test("invalid level 0 → Infinity", () => {
    expect(xpForNextLevel(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("xpToNextLevel", () => {
  test("0 XP at level 1 → 300 remaining", () => {
    expect(xpToNextLevel(0, 1)).toBe(300);
  });

  test("150 XP at level 1 → 150 remaining", () => {
    expect(xpToNextLevel(150, 1)).toBe(150);
  });

  test("300 XP at level 1 → 0 remaining (ready to level)", () => {
    expect(xpToNextLevel(300, 1)).toBe(0);
  });

  test("500 XP at level 1 → 0 remaining (over threshold)", () => {
    expect(xpToNextLevel(500, 1)).toBe(0);
  });

  test("level 20 → Infinity", () => {
    expect(xpToNextLevel(999_999, 20)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("checkLevelUp", () => {
  test("not enough XP → false", () => {
    expect(checkLevelUp(200, 1)).toBe(false);
  });

  test("exactly enough XP → true", () => {
    expect(checkLevelUp(300, 1)).toBe(true);
  });

  test("more than enough XP → true", () => {
    expect(checkLevelUp(500, 1)).toBe(true);
  });

  test("level 20 → false (cap)", () => {
    expect(checkLevelUp(999_999, 20)).toBe(false);
  });

  test("level 2 needs 900 XP", () => {
    expect(checkLevelUp(899, 2)).toBe(false);
    expect(checkLevelUp(900, 2)).toBe(true);
  });
});

describe("proficiencyBonus", () => {
  test("levels 1-4 → +2", () => {
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(4)).toBe(2);
  });

  test("levels 5-8 → +3", () => {
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(8)).toBe(3);
  });

  test("levels 9-12 → +4", () => {
    expect(proficiencyBonus(9)).toBe(4);
  });

  test("levels 17-20 → +6", () => {
    expect(proficiencyBonus(17)).toBe(6);
    expect(proficiencyBonus(20)).toBe(6);
  });
});

describe("hitDieSize", () => {
  test("Barbarian → d12", () => expect(hitDieSize("Barbarian")).toBe(12));
  test("Fighter → d10", () => expect(hitDieSize("Fighter")).toBe(10));
  test("Rogue → d8", () => expect(hitDieSize("Rogue")).toBe(8));
  test("Wizard → d6", () => expect(hitDieSize("Wizard")).toBe(6));
  test("class with subclass in parens", () => expect(hitDieSize("Fighter (Champion)")).toBe(10));
});

describe("fixedHPGain", () => {
  test("Fighter → 6 (d10: avg 5.5 → 6)", () => expect(fixedHPGain("Fighter")).toBe(6));
  test("Rogue → 5 (d8: avg 4.5 → 5)", () => expect(fixedHPGain("Rogue")).toBe(5));
  test("Wizard → 4 (d6: avg 3.5 → 4)", () => expect(fixedHPGain("Wizard")).toBe(4));
  test("Barbarian → 7 (d12: avg 6.5 → 7)", () => expect(fixedHPGain("Barbarian")).toBe(7));
});

describe("isASILevel", () => {
  test("level 4 is ASI", () => expect(isASILevel(4)).toBe(true));
  test("level 8 is ASI", () => expect(isASILevel(8)).toBe(true));
  test("level 3 is not ASI", () => expect(isASILevel(3)).toBe(false));
  test("level 5 is not ASI", () => expect(isASILevel(5)).toBe(false));
  test("level 19 is ASI", () => expect(isASILevel(19)).toBe(true));
});
