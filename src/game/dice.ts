import type { DiceResult } from "../state/types.js";

/**
 * Parse and roll dice notation like "2d6+3", "d20", "4d6kh3", "d20-1"
 * Supports: NdS, NdSkh/klN, +/- modifiers
 */
export function parseDiceNotation(notation: string): {
  count: number;
  sides: number;
  modifier: number;
  keep?: { type: "h" | "l"; count: number };
} {
  const cleaned = notation.toLowerCase().replace(/\s/g, "");
  const match = cleaned.match(/^(\d*)d(\d+)(?:k([hl])(\d+))?([+-]\d+)?$/);
  if (!match) throw new Error(`Invalid dice notation: ${notation}`);

  const [, countStr, sidesStr, keepType, keepCountStr, modStr] = match;
  return {
    count: countStr ? parseInt(countStr, 10) : 1,
    sides: parseInt(sidesStr, 10),
    modifier: modStr ? parseInt(modStr, 10) : 0,
    keep:
      keepType && keepCountStr
        ? {
            type: keepType as "h" | "l",
            count: parseInt(keepCountStr, 10),
          }
        : undefined,
  };
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function roll(notation: string, label?: string): DiceResult {
  // Check for compound expressions like "1d6+3+1d6" or "2d6+1d8+5"
  // Split into terms, preserving +/- signs
  const cleaned = notation.replace(/\s/g, "");
  const terms = cleaned.match(/[+-]?[^+-]+/g) ?? [cleaned];

  // If it's a simple expression, use the fast path
  if (terms.length <= 1 || !cleaned.match(/d.*d/i)) {
    return rollSimple(notation, label);
  }

  // Compound expression: roll each dice term, sum flat modifiers
  const allRolls: number[] = [];
  let totalModifier = 0;
  let sum = 0;

  for (const term of terms) {
    const trimmed = term.replace(/^\+/, "");
    if (/d/i.test(trimmed)) {
      // It's a dice term like "1d6" or "-2d4"
      const result = rollSimple(trimmed);
      allRolls.push(...result.rolls);
      sum += result.total;
    } else {
      // It's a flat modifier like "+3" or "-1"
      const mod = parseInt(trimmed, 10);
      if (!Number.isNaN(mod)) {
        totalModifier += mod;
        sum += mod;
      }
    }
  }

  return {
    notation,
    rolls: allRolls,
    modifier: totalModifier,
    total: sum,
    kept: undefined,
    label,
  };
}

function rollSimple(notation: string, label?: string): DiceResult {
  const parsed = parseDiceNotation(notation);
  const rolls: number[] = [];

  for (let i = 0; i < parsed.count; i++) {
    rolls.push(rollDie(parsed.sides));
  }

  let kept: number[] | undefined;
  let sum: number;

  if (parsed.keep) {
    const sorted = [...rolls].sort((a, b) => (parsed.keep?.type === "h" ? b - a : a - b));
    kept = sorted.slice(0, parsed.keep.count);
    sum = kept.reduce((a, b) => a + b, 0);
  } else {
    sum = rolls.reduce((a, b) => a + b, 0);
  }

  return {
    notation,
    rolls,
    modifier: parsed.modifier,
    total: sum + parsed.modifier,
    kept,
    label,
  };
}

export function rollAdvantage(modifier = 0, label?: string): DiceResult {
  const r1 = rollDie(20);
  const r2 = rollDie(20);
  const best = Math.max(r1, r2);
  return {
    notation: `2d20kh1${modifier >= 0 ? "+" : ""}${modifier}`,
    rolls: [r1, r2],
    modifier,
    total: best + modifier,
    kept: [best],
    label,
  };
}

export function rollDisadvantage(modifier = 0, label?: string): DiceResult {
  const r1 = rollDie(20);
  const r2 = rollDie(20);
  const worst = Math.min(r1, r2);
  return {
    notation: `2d20kl1${modifier >= 0 ? "+" : ""}${modifier}`,
    rolls: [r1, r2],
    modifier,
    total: worst + modifier,
    kept: [worst],
    label,
  };
}

export function formatDiceResult(result: DiceResult): string {
  const parts: string[] = [];
  parts.push(`\`${result.notation}\``);

  if (result.rolls.length > 1 || result.kept) {
    parts.push(`[${result.rolls.join(", ")}]`);
  }
  if (result.kept && result.kept.length !== result.rolls.length) {
    parts.push(`kept [${result.kept.join(", ")}]`);
  }
  if (result.modifier !== 0) {
    parts.push(`${result.modifier >= 0 ? "+" : ""}${result.modifier}`);
  }
  parts.push(`= **${result.total}**`);

  if (result.label) {
    parts.push(`(${result.label})`);
  }

  return parts.join(" ");
}

/**
 * Parse DM spell slot directives like [[SPELL:1 TARGET:Hierophantis]]
 * Level is an integer (spell level being cast).
 */
export function parseSpellDirective(text: string): { level: number; target: string }[] {
  const regex = /\[\[SPELL\s*:\s*(\d+)\s+TARGET\s*:\s*(.+?)\s*\]\]/g;
  const results: { level: number; target: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      level: parseInt(match[1].trim(), 10),
      target: match[2].trim(),
    });
  }
  return results;
}

/**
 * Parse DM feature use directives like [[USE:Second Wind TARGET:Grimbold]]
 */
export function parseUseDirective(text: string): { featureName: string; target: string }[] {
  const regex = /\[\[USE\s*:\s*(.+?)\s+TARGET\s*:\s*(.+?)\s*\]\]/g;
  const results: { featureName: string; target: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      featureName: match[1].trim(),
      target: match[2].trim(),
    });
  }
  return results;
}

/**
 * Parse DM concentration directives like [[CONCENTRATE:Bless TARGET:Hierophantis]]
 */
export function parseConcentrateDirective(text: string): { spell: string; target: string }[] {
  const regex = /\[\[CONCENTRATE\s*:\s*(.+?)\s+TARGET\s*:\s*(.+?)\s*\]\]/g;
  const results: { spell: string; target: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      spell: match[1].trim(),
      target: match[2].trim(),
    });
  }
  return results;
}

/**
 * Parse DM condition directives like [[CONDITION:ADD prone TARGET:Grimbold]]
 * or [[CONDITION:REMOVE prone TARGET:Grimbold]]
 */
export function parseConditionDirective(
  text: string,
): { action: "add" | "remove"; condition: string; target: string }[] {
  const regex = /\[\[CONDITION\s*:\s*(ADD|REMOVE)\s+(.+?)\s+TARGET\s*:\s*(.+?)\s*\]\]/gi;
  const results: { action: "add" | "remove"; condition: string; target: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      action: match[1].trim().toLowerCase() as "add" | "remove",
      condition: match[2].trim().toLowerCase(),
      target: match[3].trim(),
    });
  }
  return results;
}

/**
 * Parse DM XP directives like [[XP:300 TARGET:party REASON:defeated the goblins]]
 * Amount is a flat integer (not dice). TARGET can be "party" or a character name.
 */
export function parseXPDirective(
  text: string,
): { amount: number; target: string; reason: string }[] {
  const regex = /\[\[XP\s*:\s*(\d+)\s+TARGET\s*:\s*(.+?)\s+REASON\s*:\s*([^\]]+)\]\]/g;
  const results: { amount: number; target: string; reason: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      amount: parseInt(match[1].trim(), 10),
      target: match[2].trim(),
      reason: match[3].trim(),
    });
  }
  return results;
}

/**
 * Parse DM dice directives like [[ROLL:d20+5 FOR:Grimbold REASON:attack roll]]
 */
export function parseDiceDirective(
  text: string,
): { notation: string; forName: string; reason: string }[] {
  const regex = /\[\[ROLL\s*:\s*([^\s]+)\s+FOR\s*:\s*(.+?)\s+REASON\s*:\s*([^\]]+)\]\]/g;
  const results: { notation: string; forName: string; reason: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      notation: match[1].trim(),
      forName: match[2].trim(),
      reason: match[3].trim(),
    });
  }
  return results;
}

/**
 * Parse DM damage directives like [[DAMAGE:2d6+3 TARGET:Grimbold REASON:longsword hit]]
 */
export function parseDamageDirective(
  text: string,
): { notation: string; targetName: string; reason: string }[] {
  const regex = /\[\[DAMAGE\s*:\s*([^\s]+)\s+TARGET\s*:\s*(.+?)\s+REASON\s*:\s*([^\]]+)\]\]/g;
  const results: { notation: string; targetName: string; reason: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      notation: match[1].trim(),
      targetName: match[2].trim(),
      reason: match[3].trim(),
    });
  }
  return results;
}

/**
 * Parse DM heal directives like [[HEAL:1d8+3 TARGET:Fūsetsu REASON:cure wounds]]
 */
export function parseHealDirective(
  text: string,
): { notation: string; targetName: string; reason: string }[] {
  const regex = /\[\[HEAL\s*:\s*([^\s]+)\s+TARGET\s*:\s*(.+?)\s+REASON\s*:\s*([^\]]+)\]\]/g;
  const results: { notation: string; targetName: string; reason: string }[] = [];
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = regex.exec(text)) !== null) {
    results.push({
      notation: match[1].trim(),
      targetName: match[2].trim(),
      reason: match[3].trim(),
    });
  }
  return results;
}
