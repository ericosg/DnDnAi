import { describe, expect, test } from "bun:test";
import type { Player } from "../state/types.js";
import { abilityMod, characterEmbed, dmNarrationEmbeds } from "./formatter.js";

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

  test("current HP differs from max when damaged", () => {
    const player = makePlayer();
    player.characterSheet.hp.current = 10;
    const embed = characterEmbed(player);
    const combatField = embed.data.fields?.find((f) => f.name === "Combat");
    expect(combatField?.value).toContain("HP 10/24");
  });
});

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
