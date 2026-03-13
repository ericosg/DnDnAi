import { EmbedBuilder } from "discord.js";
import { formatDiceResult } from "../game/dice.js";
import type { CombatState, DiceResult, GameState, Player } from "../state/types.js";

const DM_COLOR = 0x7b2d8b; // purple sidebar

export function dmNarrationEmbed(text: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(text)
    .setColor(DM_COLOR)
    .setAuthor({ name: "Dungeon Master" });
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

export function whisperEmbed(fromName: string, toName: string, message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Whisper from ${fromName}`)
    .setDescription(`*${message}*`)
    .setFooter({ text: `Only ${toName} and the DM can see this` })
    .setColor(0x336633);
}
