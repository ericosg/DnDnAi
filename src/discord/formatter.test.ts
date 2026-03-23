import { describe, expect, test } from "bun:test";
import type { Player } from "../state/types.js";
import { abilityMod, characterEmbed, formatDMNarration, inventoryEmbed } from "./formatter.js";

function makePlayer(overrides?: Partial<Player>): Player {
  return {
    id: "123",
    name: "TestUser",
    isAgent: false,
    joinedAt: new Date().toISOString(),
    characterSheet: {
      name: "Fūsetsu",
      race: "Variant Human",
      class: "Rogue",
      level: 3,
      background: "Criminal",
      alignment: "Chaotic Neutral",
      abilityScores: {
        strength: 8,
        dexterity: 16,
        constitution: 14,
        wisdom: 14,
        intelligence: 10,
        charisma: 12,
      },
      proficiencyBonus: 2,
      savingThrows: ["Dexterity", "Intelligence"],
      skills: ["Stealth", "Acrobatics", "Sleight of Hand", "Perception", "Deception"],
      hp: { max: 24, current: 24, temp: 0 },
      armorClass: 15,
      initiative: 3,
      speed: 30,
      equipment: ["Shortsword", "Shortbow", "Leather Armor", "Thieves' Tools"],
      features: ["Sneak Attack (2d6)", "Cunning Action", "Expertise"],
      backstory: "A former street urchin who learned to survive by blade and shadow.",
      personality: "Quiet and observant",
      ideals: "Freedom above all",
      bonds: "The Silent Cord",
      flaws: "Trusts no one easily",
    },
    ...overrides,
  };
}

describe("abilityMod", () => {
  test("positive modifier", () => {
    expect(abilityMod(16)).toBe("+3");
  });

  test("zero modifier", () => {
    expect(abilityMod(10)).toBe("+0");
    expect(abilityMod(11)).toBe("+0");
  });

  test("negative modifier", () => {
    expect(abilityMod(8)).toBe("-1");
    expect(abilityMod(7)).toBe("-2");
  });

  test("high score", () => {
    expect(abilityMod(20)).toBe("+5");
  });
});

describe("characterEmbed", () => {
  test("full sheet has title and description with race/class/level", () => {
    const embed = characterEmbed(makePlayer());
    expect(embed.data.title).toBe("Fūsetsu");
    expect(embed.data.description).toContain("Variant Human");
    expect(embed.data.description).toContain("Rogue");
  });

  test("full sheet has blue color", () => {
    const embed = characterEmbed(makePlayer());
    expect(embed.data.color).toBe(0x3388cc);
  });

  test("full sheet includes all sections", () => {
    const embed = characterEmbed(makePlayer());
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Ability Scores");
    expect(fieldNames).toContain("Combat");
    expect(fieldNames).toContain("Saving Throws");
    expect(fieldNames).toContain("Skills");
    expect(fieldNames).toContain("Features");
    expect(fieldNames).toContain("Spells");
    expect(fieldNames).toContain("Backstory");
  });

  test("full sheet shows 'No spellcasting' when no spells", () => {
    const embed = characterEmbed(makePlayer());
    const spellField = embed.data.fields?.find((f) => f.name === "Spells");
    expect(spellField?.value).toBe("No spellcasting");
  });

  test("spellcaster lists spells", () => {
    const player = makePlayer();
    player.characterSheet.spells = ["Fire Bolt", "Shield", "Magic Missile"];
    const embed = characterEmbed(player);
    const spellField = embed.data.fields?.find((f) => f.name === "Spells");
    expect(spellField?.value).toContain("Fire Bolt");
    expect(spellField?.value).toContain("Shield");
    expect(spellField?.value).toContain("Magic Missile");
  });

  test("section filter: abilities shows only ability-related fields", () => {
    const embed = characterEmbed(makePlayer(), "abilities");
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Ability Scores");
    expect(fieldNames).toContain("Combat");
    expect(fieldNames).toContain("Saving Throws");
    expect(fieldNames).not.toContain("Skills");
    expect(fieldNames).not.toContain("Features");
  });

  test("section filter: skills shows only skills", () => {
    const embed = characterEmbed(makePlayer(), "skills");
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Skills");
    expect(fieldNames).not.toContain("Ability Scores");
    expect(fieldNames).not.toContain("Features");
  });

  test("section filter: features shows only features", () => {
    const embed = characterEmbed(makePlayer(), "features");
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Features");
    expect(fieldNames).not.toContain("Skills");
    expect(fieldNames).not.toContain("Spells");
  });

  test("section filter: spells shows only spells", () => {
    const embed = characterEmbed(makePlayer(), "spells");
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Spells");
    expect(fieldNames).not.toContain("Skills");
    expect(fieldNames).not.toContain("Features");
  });

  test("section filter: backstory shows backstory and personality traits", () => {
    const embed = characterEmbed(makePlayer(), "backstory");
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Backstory");
    expect(fieldNames).toContain("Personality");
    expect(fieldNames).toContain("Ideals");
    expect(fieldNames).toContain("Bonds");
    expect(fieldNames).toContain("Flaws");
    expect(fieldNames).not.toContain("Skills");
  });

  test("ability scores field shows formatted modifiers", () => {
    const embed = characterEmbed(makePlayer());
    const abilityField = embed.data.fields?.find((f) => f.name === "Ability Scores");
    expect(abilityField?.value).toContain("**STR** 8 (-1)");
    expect(abilityField?.value).toContain("**DEX** 16 (+3)");
    expect(abilityField?.value).toContain("**INT** 10 (+0)");
  });

  test("combat field shows AC, HP, speed, and initiative", () => {
    const embed = characterEmbed(makePlayer());
    const combatField = embed.data.fields?.find((f) => f.name === "Combat");
    expect(combatField?.value).toContain("AC 15");
    expect(combatField?.value).toContain("HP 24/24");
    expect(combatField?.value).toContain("Speed 30 ft");
    expect(combatField?.value).toContain("Initiative +3");
  });

  test("saving throws field lists proficiencies", () => {
    const embed = characterEmbed(makePlayer());
    const stField = embed.data.fields?.find((f) => f.name === "Saving Throws");
    expect(stField?.value).toContain("Dexterity");
    expect(stField?.value).toContain("Intelligence");
  });

  test("features are bullet-pointed", () => {
    const embed = characterEmbed(makePlayer());
    const featField = embed.data.fields?.find((f) => f.name === "Features");
    expect(featField?.value).toContain("• Sneak Attack (2d6)");
    expect(featField?.value).toContain("• Cunning Action");
  });

  test("description includes background", () => {
    const embed = characterEmbed(makePlayer());
    expect(embed.data.description).toContain("Criminal");
  });

  test("backstory section omits personality fields when not set", () => {
    const player = makePlayer();
    player.characterSheet.personality = undefined;
    player.characterSheet.ideals = undefined;
    player.characterSheet.bonds = undefined;
    player.characterSheet.flaws = undefined;
    const embed = characterEmbed(player, "backstory");
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("Backstory");
    expect(fieldNames).not.toContain("Personality");
    expect(fieldNames).not.toContain("Ideals");
    expect(fieldNames).not.toContain("Bonds");
    expect(fieldNames).not.toContain("Flaws");
  });

  test("full sheet does not include equipment (covered by /inventory)", () => {
    const embed = characterEmbed(makePlayer());
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).not.toContain("Equipment");
    expect(fieldNames).not.toContain("Inventory");
  });

  test("empty spells array shows 'No spellcasting'", () => {
    const player = makePlayer();
    player.characterSheet.spells = [];
    const embed = characterEmbed(player);
    const spellField = embed.data.fields?.find((f) => f.name === "Spells");
    expect(spellField?.value).toBe("No spellcasting");
  });

  test("long backstory is truncated to 1024 chars", () => {
    const player = makePlayer();
    player.characterSheet.backstory = "x".repeat(2000);
    const embed = characterEmbed(player);
    const backstoryField = embed.data.fields?.find((f) => f.name === "Backstory");
    expect((backstoryField?.value ?? "").length).toBeLessThanOrEqual(1024);
  });

  test("skills field shows comma-separated list", () => {
    const embed = characterEmbed(makePlayer());
    const skillsField = embed.data.fields?.find((f) => f.name === "Skills");
    expect(skillsField?.value).toBe("Stealth, Acrobatics, Sleight of Hand, Perception, Deception");
  });

  test("all six ability scores are present", () => {
    const embed = characterEmbed(makePlayer());
    const abilityField = embed.data.fields?.find((f) => f.name === "Ability Scores");
    expect(abilityField?.value).toContain("**STR**");
    expect(abilityField?.value).toContain("**DEX**");
    expect(abilityField?.value).toContain("**CON**");
    expect(abilityField?.value).toContain("**WIS**");
    expect(abilityField?.value).toContain("**INT**");
    expect(abilityField?.value).toContain("**CHA**");
  });

  test("shows XP in combat field when present", () => {
    const player = makePlayer();
    player.characterSheet.experiencePoints = 300;
    const embed = characterEmbed(player);
    const combatField = embed.data.fields?.find((f) => f.name === "Combat");
    expect(combatField?.value).toContain("XP 300/2700 (level 3)");
  });

  test("shows Resources field when spell slots present", () => {
    const player = makePlayer();
    player.characterSheet.spellSlots = [
      { level: 1, max: 4, current: 2 },
      { level: 2, max: 2, current: 1 },
    ];
    const embed = characterEmbed(player);
    const resourceField = embed.data.fields?.find((f) => f.name === "Resources");
    expect(resourceField).toBeDefined();
    expect(resourceField?.value).toContain("Spell Slots");
    expect(resourceField?.value).toContain("1st: 2/4");
    expect(resourceField?.value).toContain("2nd: 1/2");
  });

  test("shows Resources field when feature charges present", () => {
    const player = makePlayer();
    player.characterSheet.featureCharges = [
      { name: "Action Surge", max: 1, current: 0, resetsOn: "short" },
    ];
    const embed = characterEmbed(player);
    const resourceField = embed.data.fields?.find((f) => f.name === "Resources");
    expect(resourceField).toBeDefined();
    expect(resourceField?.value).toContain("Charges");
    expect(resourceField?.value).toContain("Action Surge: 0/1");
  });

  test("no Resources field when no slots or charges", () => {
    const embed = characterEmbed(makePlayer());
    const resourceField = embed.data.fields?.find((f) => f.name === "Resources");
    expect(resourceField).toBeUndefined();
  });

  test("XP not shown in combat field when absent", () => {
    const embed = characterEmbed(makePlayer());
    const combatField = embed.data.fields?.find((f) => f.name === "Combat");
    expect(combatField?.value).not.toContain("XP");
  });

  test("current HP differs from max when damaged", () => {
    const player = makePlayer();
    player.characterSheet.hp.current = 10;
    const embed = characterEmbed(player);
    const combatField = embed.data.fields?.find((f) => f.name === "Combat");
    expect(combatField?.value).toContain("HP 10/24");
  });
});

describe("formatDMNarration", () => {
  test("wraps text with separators", () => {
    const result = formatDMNarration("Hello adventurers!");
    expect(result).toStartWith("─");
    expect(result).toEndWith("─");
    expect(result).toContain("Hello adventurers!");
  });

  test("separator appears at start and end", () => {
    const result = formatDMNarration("Some narration.");
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^─+$/);
    expect(lines[lines.length - 1]).toMatch(/^─+$/);
  });

  test("preserves original text between separators", () => {
    const narration = "The dragon **roars** and the cave *trembles*.";
    const result = formatDMNarration(narration);
    expect(result).toContain(narration);
  });

  test("handles multiline text", () => {
    const narration = "First paragraph.\n\nSecond paragraph.";
    const result = formatDMNarration(narration);
    expect(result).toContain("First paragraph.\n\nSecond paragraph.");
  });

  test("returns string, not embed objects", () => {
    const result = formatDMNarration("Test");
    expect(result).toBeString();
  });
});

describe("inventoryEmbed", () => {
  test("shows equipment items", () => {
    const player = makePlayer();
    player.characterSheet.equipment = ["Shortsword", "Leather Armor"];
    const embed = inventoryEmbed(player);
    const json = embed.toJSON();
    expect(json.description).toContain("Shortsword");
    expect(json.description).toContain("Leather Armor");
  });

  test("shows gold when present", () => {
    const player = makePlayer();
    player.characterSheet.gold = 50;
    const embed = inventoryEmbed(player);
    const json = embed.toJSON();
    const goldField = json.fields?.find((f) => f.name === "Gold");
    expect(goldField).toBeDefined();
    expect(goldField?.value).toBe("50 gp");
  });

  test("omits gold field when gold is undefined", () => {
    const player = makePlayer();
    player.characterSheet.gold = undefined;
    const embed = inventoryEmbed(player);
    const json = embed.toJSON();
    const goldField = json.fields?.find((f) => f.name === "Gold");
    expect(goldField).toBeUndefined();
  });
});
