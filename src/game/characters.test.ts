import { describe, expect, mock, test } from "bun:test";

// Mock config and claude to avoid env var / API requirements
mock.module("../config.js", () => ({
  config: { discordToken: "test", guildId: "test" },
  models: { dm: "test", agent: "test", orchestrator: "test" },
  DATA_DIR: "data/games",
  AGENTS_DIR: "agents",
  HISTORY_WINDOW: 8,
  COMPRESS_EVERY: 10,
  AGENT_DELAY_MS: 0,
  NARRATIVE_STYLE: "concise",
  STYLE_INSTRUCTIONS: {
    concise: { dm: "", agent: "" },
    standard: { dm: "", agent: "" },
    elaborate: { dm: "", agent: "" },
  },
}));
mock.module("../ai/claude.js", () => ({
  chat: async () => "A mocked backstory.",
}));

const { parseCharacterSheet } = await import("./characters.js");

const GRIMBOLD_SHEET = `**Name:** Grimbold Ironforge
**Race:** Mountain Dwarf
**Class:** Fighter (Champion)
**Level:** 3
**Background:** Soldier
**Alignment:** Lawful Neutral

**Strength:** 16
**Dexterity:** 12
**Constitution:** 16
**Wisdom:** 13
**Intelligence:** 10
**Charisma:** 8

**Proficiency Bonus:** +2
**Armor Class:** 18
**HP:** 31
**Speed:** 25
**Initiative:** +1

## Saving Throws
- Strength
- Constitution

## Skills
- Athletics
- Intimidation
- Perception
- Survival

## Equipment
- Battleaxe
- Handaxes (2)
- Chain mail
- Shield
- Explorer's pack
- Dwarven ale flask (never empty, somehow)
- Whetstone (obsessively maintained)

## Features
- Fighting Style: Defense (+1 AC while wearing armor)
- Second Wind (1d10+3 HP, bonus action, 1/short rest)
- Action Surge (1 additional action, 1/short rest)
- Improved Critical (crit on 19-20)
- Darkvision (60 ft)
- Dwarven Resilience (advantage on saves vs. poison)
- Stonecunning (double proficiency on History checks for stonework)`;

describe("parseCharacterSheet", () => {
  test("parses Grimbold fixture correctly", () => {
    const sheet = parseCharacterSheet(GRIMBOLD_SHEET);

    expect(sheet.name).toBe("Grimbold Ironforge");
    expect(sheet.race).toBe("Mountain Dwarf");
    expect(sheet.class).toBe("Fighter (Champion)");
    expect(sheet.level).toBe(3);
    expect(sheet.background).toBe("Soldier");
    expect(sheet.alignment).toBe("Lawful Neutral");
  });

  test("parses ability scores", () => {
    const sheet = parseCharacterSheet(GRIMBOLD_SHEET);

    expect(sheet.abilityScores.strength).toBe(16);
    expect(sheet.abilityScores.dexterity).toBe(12);
    expect(sheet.abilityScores.constitution).toBe(16);
    expect(sheet.abilityScores.wisdom).toBe(13);
    expect(sheet.abilityScores.intelligence).toBe(10);
    expect(sheet.abilityScores.charisma).toBe(8);
  });

  test("parses combat stats", () => {
    const sheet = parseCharacterSheet(GRIMBOLD_SHEET);

    expect(sheet.armorClass).toBe(18);
    expect(sheet.hp.max).toBe(31);
    expect(sheet.hp.current).toBe(31);
    expect(sheet.speed).toBe(25);
    expect(sheet.initiative).toBe(1);
  });

  test("parses list sections", () => {
    const sheet = parseCharacterSheet(GRIMBOLD_SHEET);

    expect(sheet.savingThrows).toContain("Strength");
    expect(sheet.savingThrows).toContain("Constitution");
    expect(sheet.skills).toContain("Athletics");
    expect(sheet.skills).toContain("Perception");
    expect(sheet.equipment).toContain("Battleaxe");
    expect(sheet.equipment.length).toBe(7);
    expect(sheet.features.length).toBe(7);
  });

  test("defaults for missing fields", () => {
    const sheet = parseCharacterSheet("**Name:** Minimal Character");

    expect(sheet.name).toBe("Minimal Character");
    expect(sheet.race).toBe("Unknown");
    expect(sheet.class).toBe("Unknown");
    expect(sheet.level).toBe(1);
    expect(sheet.abilityScores.strength).toBe(10);
    expect(sheet.hp.max).toBe(10);
    expect(sheet.armorClass).toBe(10);
    expect(sheet.speed).toBe(30);
  });

  test("safeInt handles garbage input", () => {
    const sheet = parseCharacterSheet(`**Name:** Bad Data
**Strength:** abc
**Level:** not-a-number
**HP:** ???`);

    expect(sheet.abilityScores.strength).toBe(10);
    expect(sheet.level).toBe(1);
    expect(sheet.hp.max).toBe(10);
  });

  test("calculates initiative from DEX when not specified", () => {
    const sheet = parseCharacterSheet(`**Name:** Dex Test
**Dexterity:** 16`);

    // DEX 16 → modifier = (16-10)/2 = 3
    expect(sheet.initiative).toBe(3);
  });

  test("uses explicit initiative over DEX calculation", () => {
    const sheet = parseCharacterSheet(`**Name:** Init Test
**Dexterity:** 16
**Initiative:** +5`);

    expect(sheet.initiative).toBe(5);
  });

  test("parses gender field", () => {
    const sheet = parseCharacterSheet(`**Name:** Gendered Character
**Gender:** Male`);

    expect(sheet.gender).toBe("Male");
  });

  test("parses pronouns as gender alias", () => {
    const sheet = parseCharacterSheet(`**Name:** Pronoun Character
**Pronouns:** she/her`);

    expect(sheet.gender).toBe("she/her");
  });

  test("gender is undefined when not specified", () => {
    const sheet = parseCharacterSheet("**Name:** No Gender");

    expect(sheet.gender).toBeUndefined();
  });

  test("parses spells from separate ## Spells section", () => {
    const sheet = parseCharacterSheet(`**Name:** Caster Test

## Features
- Spellcasting (INT-based, DC 13, +5 to hit)
- Arcane Recovery

## Spells
- Fire Bolt (cantrip)
- Mage Hand (cantrip)
- Shield (1st level)
- Magic Missile (1st level)`);

    expect(sheet.spells).toBeDefined();
    expect(sheet.spells?.length).toBe(4);
    expect(sheet.spells).toContain("Fire Bolt (cantrip)");
    expect(sheet.spells).toContain("Shield (1st level)");
    // Spells should NOT leak into features
    expect(sheet.features.length).toBe(2);
  });

  test("non-caster has no spells", () => {
    const sheet = parseCharacterSheet(GRIMBOLD_SHEET);
    expect(sheet.spells).toBeUndefined();
  });

  test("### subheading inside a section stops list collection", () => {
    // This documents the known parser behavior: ### exits the ## section
    const sheet = parseCharacterSheet(`**Name:** Bug Demo

## Features
- Feature One
- Feature Two
### Subheading
- Feature Three`);

    // Feature Three is lost because ### exits the section
    expect(sheet.features.length).toBe(2);
  });

  test("parses experience points field", () => {
    const sheet = parseCharacterSheet(`**Name:** XP Test
**Experience Points:** 450`);
    expect(sheet.experiencePoints).toBe(450);
  });

  test("parses XP shorthand field", () => {
    const sheet = parseCharacterSheet(`**Name:** XP Test
**XP:** 900`);
    expect(sheet.experiencePoints).toBe(900);
  });

  test("XP is undefined when not specified", () => {
    const sheet = parseCharacterSheet("**Name:** No XP");
    expect(sheet.experiencePoints).toBeUndefined();
  });

  test("parses feature charges from feature text", () => {
    const sheet = parseCharacterSheet(`**Name:** Charge Test

## Features
- Second Wind (1d10+3 HP, bonus action, 1/short rest)
- Action Surge (1 additional action, 1/short rest)
- Darkvision (60 ft)`);

    expect(sheet.featureCharges).toBeDefined();
    expect(sheet.featureCharges?.length).toBe(2);
    expect(sheet.featureCharges?.[0].name).toBe("Second Wind");
    expect(sheet.featureCharges?.[0].max).toBe(1);
    expect(sheet.featureCharges?.[0].resetsOn).toBe("short");
    expect(sheet.featureCharges?.[1].name).toBe("Action Surge");
  });

  test("derives spell slots for caster with spells", () => {
    const sheet = parseCharacterSheet(`**Name:** Caster Test
**Class:** Cleric
**Level:** 3

## Spells
- Sacred Flame (cantrip)
- Cure Wounds (1st level)`);

    expect(sheet.spellSlots).toBeDefined();
    expect(sheet.spellSlots?.length).toBeGreaterThan(0);
    // Level 3 Cleric: 4 first-level, 2 second-level
    expect(sheet.spellSlots?.[0]).toEqual({ level: 1, max: 4, current: 4 });
    expect(sheet.spellSlots?.[1]).toEqual({ level: 2, max: 2, current: 2 });
  });

  test("no spell slots for non-casters", () => {
    const sheet = parseCharacterSheet(GRIMBOLD_SHEET);
    expect(sheet.spellSlots).toBeUndefined();
  });

  test("parses explicit ## Spell Slots section", () => {
    const sheet = parseCharacterSheet(`**Name:** Slot Test
**Class:** Wizard
**Level:** 1

## Spell Slots
- 1st level: 3

## Spells
- Fire Bolt (cantrip)`);

    expect(sheet.spellSlots).toBeDefined();
    expect(sheet.spellSlots?.[0]).toEqual({ level: 1, max: 3, current: 3 });
  });

  test("parses saving throws from ## section with full names", () => {
    const sheet = parseCharacterSheet(`**Name:** Save Test

## Saving Throws
- Dexterity
- Intelligence

## Skills
- Stealth`);

    expect(sheet.savingThrows).toEqual(["Dexterity", "Intelligence"]);
    expect(sheet.skills).toEqual(["Stealth"]);
  });

  test("parses inline comma-separated saving throws without leading spaces", () => {
    const sheet = parseCharacterSheet(`**Name:** Inline Save Test
**Saving Throws:** WIS, CHA`);

    expect(sheet.savingThrows).toEqual(["WIS", "CHA"]);
  });
});
