import { EmbedBuilder } from "discord.js";
import { formatDiceResult } from "../game/dice.js";
import type { CombatState, DiceResult, GameState, Player } from "../state/types.js";

const DM_SEPARATOR = "───────────────────────────────";

/** Wrap DM narration in visual separators for plain-text Discord display. */
export function formatDMNarration(text: string): string {
  return `${DM_SEPARATOR}\n${text}\n${DM_SEPARATOR}`;
}

export function systemEmbed(title: string, text: string): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(text).setColor(0x555555);
}

export function diceResultText(result: DiceResult): string {
  return formatDiceResult(result);
}

export function multiDiceText(results: DiceResult[]): string {
  return results.map(formatDiceResult).join("\n");
}

export function combatStatusEmbed(combat: CombatState, _players: Player[]): EmbedBuilder {
  const lines = combat.combatants.map((c, i) => {
    const marker = i === combat.turnIndex ? "**>>** " : "    ";
    const conditions = c.conditions.length ? ` [${c.conditions.join(", ")}]` : "";
    const hp = `${c.hp.current}/${c.hp.max} HP`;
    return `${marker}**${c.name}** — ${hp}${conditions}`;
  });

  return new EmbedBuilder()
    .setTitle(`Combat — Round ${combat.round}`)
    .setDescription(lines.join("\n"))
    .setColor(0xcc3333);
}

export function partyStatusEmbed(state: GameState): EmbedBuilder {
  const lines = state.players.map((p) => {
    const cs = p.characterSheet;
    const tag = p.isAgent ? " (AI)" : "";
    const hp = `${cs.hp.current}/${cs.hp.max} HP`;
    return `**${cs.name}**${tag} — ${cs.race} ${cs.class} ${cs.level} — ${hp} — AC ${cs.armorClass}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Party Status")
    .setDescription(lines.join("\n"))
    .setColor(0x3388cc);

  if (state.combat.active) {
    embed.addFields({
      name: "Combat",
      value: `Round ${state.combat.round}`,
    });
  }

  return embed;
}

export function inventoryEmbed(player: Player): EmbedBuilder {
  const cs = player.characterSheet;
  const items = cs.equipment.length ? cs.equipment.map((e) => `• ${e}`).join("\n") : "No equipment";

  return new EmbedBuilder()
    .setTitle(`${cs.name}'s Inventory`)
    .setDescription(items)
    .setColor(0xccaa33);
}

const CHARACTER_COLOR = 0x3388cc; // blue sidebar

export type CharacterSection = "abilities" | "skills" | "features" | "spells" | "backstory";

export function abilityMod(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function characterEmbed(player: Player, section?: CharacterSection): EmbedBuilder {
  const cs = player.characterSheet;
  const embed = new EmbedBuilder()
    .setTitle(cs.name)
    .setDescription(`${cs.race} ${cs.class} ${cs.level} — ${cs.background}`)
    .setColor(CHARACTER_COLOR);

  if (!section || section === "abilities") {
    const abilities = Object.entries(cs.abilityScores)
      .map(([key, val]) => `**${key.slice(0, 3).toUpperCase()}** ${val} (${abilityMod(val)})`)
      .join("  ");
    embed.addFields({ name: "Ability Scores", value: abilities });

    if (!section) {
      embed.addFields({
        name: "Combat",
        value: `AC ${cs.armorClass} | HP ${cs.hp.current}/${cs.hp.max} | Speed ${cs.speed} ft | Initiative ${abilityMod(cs.abilityScores.dexterity)}`,
      });
      embed.addFields({
        name: "Saving Throws",
        value: cs.savingThrows.length ? cs.savingThrows.join(", ") : "None",
      });
    }
  }

  if (section === "abilities") {
    embed.addFields({
      name: "Combat",
      value: `AC ${cs.armorClass} | HP ${cs.hp.current}/${cs.hp.max} | Speed ${cs.speed} ft | Initiative ${abilityMod(cs.abilityScores.dexterity)}`,
    });
    embed.addFields({
      name: "Saving Throws",
      value: cs.savingThrows.length ? cs.savingThrows.join(", ") : "None",
    });
  }

  if (!section || section === "skills") {
    embed.addFields({
      name: "Skills",
      value: cs.skills.length ? cs.skills.join(", ") : "None",
    });
  }

  if (!section || section === "features") {
    embed.addFields({
      name: "Features",
      value: cs.features.length ? cs.features.map((f) => `• ${f}`).join("\n") : "None",
    });
  }

  if (!section || section === "spells") {
    const spells = cs.spells;
    embed.addFields({
      name: "Spells",
      value: spells?.length ? spells.map((s) => `• ${s}`).join("\n") : "No spellcasting",
    });
  }

  if (!section || section === "backstory") {
    embed.addFields({ name: "Backstory", value: cs.backstory.slice(0, 1024) || "None" });
    if (cs.personality) embed.addFields({ name: "Personality", value: cs.personality });
    if (cs.ideals) embed.addFields({ name: "Ideals", value: cs.ideals });
    if (cs.bonds) embed.addFields({ name: "Bonds", value: cs.bonds });
    if (cs.flaws) embed.addFields({ name: "Flaws", value: cs.flaws });
  }

  return embed;
}

export function whisperEmbed(fromName: string, toName: string, message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Whisper from ${fromName}`)
    .setDescription(`*${message}*`)
    .setFooter({ text: `Only ${toName} and the DM can see this` })
    .setColor(0x336633);
}
