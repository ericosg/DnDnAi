import type { CharacterSheet, AgentPersonality } from "../state/types.js";
import { generateBackstory } from "../ai/agent.js";

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
    level: parseInt(extractField(lines, "level") || "1"),
    background: extractField(lines, "background") || "Unknown",
    alignment: extractField(lines, "alignment") || "Neutral",
    abilityScores: {
      strength: parseInt(extractField(lines, "strength", "str") || "10"),
      dexterity: parseInt(extractField(lines, "dexterity", "dex") || "10"),
      constitution: parseInt(extractField(lines, "constitution", "con") || "10"),
      wisdom: parseInt(extractField(lines, "wisdom", "wis") || "10"),
      intelligence: parseInt(extractField(lines, "intelligence", "int") || "10"),
      charisma: parseInt(extractField(lines, "charisma", "cha") || "10"),
    },
    proficiencyBonus: parseInt(extractField(lines, "proficiency bonus", "proficiency") || "2"),
    savingThrows: extractList(lines, "saving throws"),
    skills: extractList(lines, "skills", "proficient skills"),
    hp: {
      max: parseInt(extractField(lines, "hp", "hit points", "max hp") || "10"),
      current: parseInt(extractField(lines, "hp", "hit points", "max hp") || "10"),
      temp: 0,
    },
    armorClass: parseInt(extractField(lines, "armor class", "ac") || "10"),
    initiative: parseInt(extractField(lines, "initiative") || "0"),
    speed: parseInt(extractField(lines, "speed") || "30"),
    equipment: extractList(lines, "equipment", "inventory", "gear"),
    features: extractList(lines, "features", "traits", "abilities", "class features", "racial features"),
    backstory: extractSection(lines, "backstory", "background story") || "",
    personality: extractField(lines, "personality") || undefined,
    ideals: extractField(lines, "ideals") || undefined,
    bonds: extractField(lines, "bonds") || undefined,
    flaws: extractField(lines, "flaws") || undefined,
  };

  // Parse spells if present
  const spells = extractList(lines, "spells", "cantrips", "spell list");
  if (spells.length) sheet.spells = spells;

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
      // Match "**Key:** Value" or "Key: Value" or "- Key: Value"
      const patterns = [
        new RegExp(`^\\*\\*${key}\\*\\*[:\\s]+(.+)`, "i"),
        new RegExp(`^-?\\s*${key}[:\\s]+(.+)`, "i"),
        new RegExp(`^#{1,3}\\s*${key}$`, "i"),
      ];
      for (const pat of patterns) {
        const match = lower.match(pat);
        if (match) {
          // Get the actual line (not lowered) for value
          const actualMatch = line.trim().match(pat);
          if (actualMatch && actualMatch[1]) {
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
    if (sectionNames.some((name) => lower.match(new RegExp(`^#{1,3}\\s*${name}`, "i")) || lower.match(new RegExp(`^\\*\\*${name}\\*\\*`, "i")))) {
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
        const match = lower.match(new RegExp(`^\\*\\*${name}\\*\\*[:\\s]+(.+)`, "i")) ||
                      lower.match(new RegExp(`^-?\\s*${name}[:\\s]+(.+)`, "i"));
        if (match) {
          const actualMatch = line.trim().match(new RegExp(`${name}[:\\s]+(.+)`, "i"));
          if (actualMatch && actualMatch[1]) {
            return actualMatch[1].split(/,\s*/).map((s) => s.trim().replace(/\*\*/g, ""));
          }
        }
      }
    }
  }

  return items;
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
  partyContext: string
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
        strength: 10, dexterity: 10, constitution: 10,
        wisdom: 10, intelligence: 10, charisma: 10,
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
