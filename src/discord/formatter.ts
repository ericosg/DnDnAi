import { EmbedBuilder } from "discord.js";
import { formatDiceResult } from "../game/dice.js";
import type { CombatState, DiceResult, GameState, Player } from "../state/types.js";

const DM_COLOR = 0x7b2d8b; // purple sidebar

const EMBED_DESC_LIMIT = 4096;

export function dmNarrationEmbeds(text: string): EmbedBuilder[] {
  if (text.length <= EMBED_DESC_LIMIT) {
    return [
      new EmbedBuilder()
        .setDescription(text)
        .setColor(DM_COLOR)
        .setAuthor({ name: "Dungeon Master" }),
    ];
  }

  // Split into chunks at paragraph boundaries
  const embeds: EmbedBuilder[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk: string;
    if (remaining.length <= EMBED_DESC_LIMIT) {
      chunk = remaining;
      remaining = "";
    } else {
      // Try to split at a double newline (paragraph), then single newline
      let splitAt = remaining.lastIndexOf("\n\n", EMBED_DESC_LIMIT);
      if (splitAt < EMBED_DESC_LIMIT / 2) {
        splitAt = remaining.lastIndexOf("\n", EMBED_DESC_LIMIT);
      }
      if (splitAt < EMBED_DESC_LIMIT / 2) {
        splitAt = EMBED_DESC_LIMIT;
      }
      chunk = remaining.slice(0, splitAt);
      remaining = remaining.slice(splitAt).trimStart();
    }

    const embed = new EmbedBuilder().setDescription(chunk).setColor(DM_COLOR);
    if (embeds.length === 0) {
      embed.setAuthor({ name: "Dungeon Master" });
    }
    embeds.push(embed);
  }
  return embeds;
}

/** @deprecated Use dmNarrationEmbeds() instead — this throws on text > 4096 chars */
export function dmNarrationEmbed(text: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(text.slice(0, EMBED_DESC_LIMIT))
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
