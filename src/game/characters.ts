import { generateBackstory } from "../ai/agent.js";
import type { AgentPersonality, CharacterSheet } from "../state/types.js";
import { deriveSpellSlots, parseFeatureCharge, parseSpellSlotLine } from "./resources.js";

/** Parse an integer safely, returning the fallback on NaN. */
function safeInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse a markdown character sheet into structured JSON.
 * Expects headings for sections: Ability Scores, Skills, Equipment, Features, etc.
 */
export function parseCharacterSheet(markdown: string): CharacterSheet {
  const lines = markdown.split("\n");

  const sheet: CharacterSheet = {
    name: extractField(lines, "name") || "Unknown",
    race: extractField(lines, "race") || "Unknown",
    class: extractField(lines, "class") || "Unknown",
    level: safeInt(extractField(lines, "level"), 1),
    background: extractField(lines, "background") || "Unknown",
    alignment: extractField(lines, "alignment") || "Neutral",
    gender: extractField(lines, "gender", "sex", "pronouns") || undefined,
    abilityScores: {
      strength: safeInt(extractField(lines, "strength", "str"), 10),
      dexterity: safeInt(extractField(lines, "dexterity", "dex"), 10),
      constitution: safeInt(extractField(lines, "constitution", "con"), 10),
      wisdom: safeInt(extractField(lines, "wisdom", "wis"), 10),
      intelligence: safeInt(extractField(lines, "intelligence", "int"), 10),
      charisma: safeInt(extractField(lines, "charisma", "cha"), 10),
    },
    proficiencyBonus: safeInt(extractField(lines, "proficiency bonus", "proficiency"), 2),
    savingThrows: extractList(lines, "saving throws"),
    skills: extractList(lines, "skills", "proficient skills"),
    hp: {
      max: safeInt(extractField(lines, "hp", "hit points", "max hp"), 10),
      current: safeInt(extractField(lines, "hp", "hit points", "max hp"), 10),
      temp: 0,
    },
    armorClass: safeInt(extractField(lines, "armor class", "ac"), 10),
    initiative: safeInt(extractField(lines, "initiative"), 0),
    speed: safeInt(extractField(lines, "speed"), 30),
    equipment: extractList(lines, "equipment", "inventory", "gear"),
    features: extractList(
      lines,
      "features",
      "traits",
      "abilities",
      "class features",
      "racial features",
    ),
    backstory: extractSection(lines, "backstory", "background story") || "",
    personality: extractField(lines, "personality") || undefined,
    ideals: extractField(lines, "ideals") || undefined,
    bonds: extractField(lines, "bonds") || undefined,
    flaws: extractField(lines, "flaws") || undefined,
  };

  // Parse XP if present
  const xpValue = extractField(lines, "experience points", "xp");
  if (xpValue) {
    const xp = parseInt(xpValue, 10);
    if (!Number.isNaN(xp)) sheet.experiencePoints = xp;
  }

  // Parse feature charges from feature text
  const charges: CharacterSheet["featureCharges"] = [];
  for (const feature of sheet.features) {
    const charge = parseFeatureCharge(feature);
    if (charge) charges.push({ ...charge, current: charge.max });
  }
  if (charges.length) sheet.featureCharges = charges;

  // Parse spell slots from explicit section or derive from class
  const explicitSlots = parseSpellSlotSection(lines);
  if (explicitSlots.length) {
    sheet.spellSlots = explicitSlots.map((s) => ({ ...s, current: s.max }));
  }

  // Parse spells if present
  const spells = extractList(lines, "spells", "cantrips", "spell list");
  if (spells.length) sheet.spells = spells;

  // Derive spell slots from class/level if not explicitly set and character has spells
  if (!sheet.spellSlots && sheet.spells?.length) {
    const derived = deriveSpellSlots(sheet.class, sheet.level);
    if (derived.length) sheet.spellSlots = derived;
  }

  // Calculate initiative from dex if not specified
  if (sheet.initiative === 0) {
    sheet.initiative = Math.floor((sheet.abilityScores.dexterity - 10) / 2);
  }

  return sheet;
}

function extractField(lines: string[], ...keys: string[]): string | null {
  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    for (const key of keys) {
      // Match "**Key:** Value", "**Key**: Value", "Key: Value", or "- Key: Value"
      const patterns = [
        new RegExp(`^\\*\\*${key}\\s*:?\\s*\\*\\*\\s*:?\\s*(.+)`, "i"),
        new RegExp(`^-?\\s*${key}[:\\s]+(.+)`, "i"),
        new RegExp(`^#{1,3}\\s*${key}$`, "i"),
      ];
      for (const pat of patterns) {
        const match = lower.match(pat);
        if (match) {
          // Get the actual line (not lowered) for value
          const actualMatch = line.trim().match(pat);
          if (actualMatch?.[1]) {
            return actualMatch[1].trim().replace(/\*\*/g, "");
          }
        }
      }
    }
  }
  return null;
}

function extractList(lines: string[], ...sectionNames: string[]): string[] {
  const items: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Check if we're entering a target section
    if (
      sectionNames.some(
        (name) =>
          lower.match(new RegExp(`^#{1,3}\\s*${name}`, "i")) ||
          lower.match(new RegExp(`^\\*\\*${name}\\s*:?\\s*\\*\\*`, "i")),
      )
    ) {
      inSection = true;
      continue;
    }

    // Check if we've left the section (hit a new heading)
    if (inSection && /^#{1,3}\s/.test(trimmed) && !sectionNames.some((n) => lower.includes(n))) {
      break;
    }

    // Collect list items
    if (inSection && /^[-*]\s/.test(trimmed)) {
      items.push(trimmed.replace(/^[-*]\s+/, "").replace(/\*\*/g, ""));
    }
  }

  // Fallback: try comma-separated on a key line
  if (items.length === 0) {
    for (const line of lines) {
      const lower = line.toLowerCase().trim();
      for (const name of sectionNames) {
        const match =
          lower.match(new RegExp(`^\\*\\*${name}\\s*:?\\s*\\*\\*\\s*:?\\s*(.+)`, "i")) ||
          lower.match(new RegExp(`^-?\\s*${name}[:\\s]+(.+)`, "i"));
        if (match) {
          const actualMatch = line.trim().match(new RegExp(`${name}[:\\s]+(.+)`, "i"));
          if (actualMatch?.[1]) {
            return actualMatch[1].split(/,\s*/).map((s) => s.replace(/\*\*/g, "").trim());
          }
        }
      }
    }
  }

  return items;
}

function parseSpellSlotSection(lines: string[]): { level: number; max: number }[] {
  const slots: { level: number; max: number }[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower.match(/^#{1,3}\s*spell\s+slots/i)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,3}\s/.test(trimmed)) break;
    if (inSection) {
      const parsed = parseSpellSlotLine(trimmed);
      if (parsed) slots.push(parsed);
    }
  }
  return slots;
}

function extractSection(lines: string[], ...sectionNames: string[]): string | null {
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (sectionNames.some((name) => lower.match(new RegExp(`^#{1,3}\\s*${name}`, "i")))) {
      inSection = true;
      continue;
    }

    if (inSection && /^#{1,3}\s/.test(trimmed)) {
      break;
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  const text = sectionLines.join("\n").trim();
  return text || null;
}

/**
 * Build a character sheet from an agent personality file,
 * generating a backstory via AI.
 */
export async function buildAgentCharacter(
  personality: AgentPersonality,
  partyContext: string,
): Promise<CharacterSheet> {
  const backstory = await generateBackstory(personality, partyContext);

  // If agent has a characterSpec, parse it; otherwise use frontmatter values
  let sheet: CharacterSheet;
  if (personality.characterSpec) {
    sheet = parseCharacterSheet(personality.characterSpec);
  } else {
    sheet = {
      name: personality.name,
      race: personality.race,
      class: personality.class,
      level: personality.level,
      background: "Adventurer",
      alignment: "Neutral",
      abilityScores: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        wisdom: 10,
        intelligence: 10,
        charisma: 10,
      },
      proficiencyBonus: 2,
      savingThrows: [],
      skills: [],
      hp: { max: 10, current: 10, temp: 0 },
      armorClass: 10,
      initiative: 0,
      speed: 30,
      equipment: [],
      features: [],
      backstory: "",
    };
  }

  // Override with personality file values
  sheet.name = personality.name;
  sheet.race = personality.race;
  sheet.class = personality.class;
  sheet.level = personality.level;
  sheet.backstory = backstory;

  return sheet;
}
