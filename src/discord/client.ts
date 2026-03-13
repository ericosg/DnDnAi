import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
  type Attachment,
} from "discord.js";
import { config } from "../config.js";
import { commands } from "./commands.js";
import {
  createGameState,
  saveGameState,
  findGameByChannel,
  loadHistory,
  saveCharacter,
} from "../state/store.js";
import type { GameState, Player, TurnEntry } from "../state/types.js";
import { roll, formatDiceResult } from "../game/dice.js";
import { parseCharacterSheet, buildAgentCharacter } from "../game/characters.js";
import { loadAgentPersonality } from "../ai/agent.js";
import { dmNarrate, dmRecap, dmLook } from "../ai/dm.js";
import { processTurn, clearRound } from "../game/engine.js";
import { startCombat } from "../game/combat.js";
import {
  dmNarrationEmbed,
  systemEmbed,
  partyStatusEmbed,
  inventoryEmbed,
  whisperEmbed,
  diceResultText,
  combatStatusEmbed,
} from "./formatter.js";
import { sendAsIdentity } from "./webhooks.js";

export function createBot(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    await registerCommands(c.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleCommand(interaction);
    } catch (err) {
      console.error("Command error:", err);
      const msg = { content: "Something went wrong.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  });

  // Handle in-character messages (> prefix)
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(">")) return;

    const channel = message.channel as TextChannel;
    const gameState = await findGameByChannel(channel.id);
    if (!gameState || gameState.status !== "active") return;

    const player = gameState.players.find((p) => p.id === message.author.id);
    if (!player) return;

    const content = message.content.slice(1).trim();
    const entry: TurnEntry = {
      id: gameState.turnCount + 1,
      timestamp: new Date().toISOString(),
      playerId: player.id,
      playerName: player.characterSheet.name,
      type: "ic",
      content,
    };

    await processTurn(gameState, entry, channel);
  });

  return client;
}

async function registerCommands(botUserId: string): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  await rest.put(Routes.applicationGuildCommands(botUserId, config.guildId), {
    body: commands,
  });
  console.log(`Registered ${commands.length} slash commands`);
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel as TextChannel;

  switch (interaction.commandName) {
    case "new-game": {
      const existing = await findGameByChannel(channel.id);
      if (existing && existing.status !== "ended") {
        await interaction.reply({
          content: "A game is already running in this channel. Use `/end` first.",
          ephemeral: true,
        });
        return;
      }
      const id = crypto.randomUUID();
      const state = createGameState(id, channel.id, config.guildId);
      await saveGameState(state);
      await interaction.reply({
        embeds: [
          systemEmbed(
            "New Campaign Created",
            "Use `/join` with a character sheet to join, `/add-agent` for AI companions, then `/start` to begin!"
          ),
        ],
      });
      break;
    }

    case "join": {
      await interaction.deferReply();
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status === "ended") {
        await interaction.editReply("No active game in this channel. Use `/new-game` first.");
        return;
      }
      if (gameState.players.some((p) => p.id === interaction.user.id)) {
        await interaction.editReply("You've already joined this game.");
        return;
      }

      const attachment = interaction.options.getAttachment("character", true);
      const markdown = await fetchAttachment(attachment);
      const sheet = parseCharacterSheet(markdown);

      const player: Player = {
        id: interaction.user.id,
        name: interaction.user.displayName,
        isAgent: false,
        characterSheet: sheet,
        joinedAt: new Date().toISOString(),
      };

      gameState.players.push(player);
      await saveCharacter(gameState.id, sheet);
      await saveGameState(gameState);

      await interaction.editReply({
        embeds: [
          systemEmbed(
            `${sheet.name} Joins the Party`,
            `**${sheet.name}** — ${sheet.race} ${sheet.class} ${sheet.level}\nHP: ${sheet.hp.max} | AC: ${sheet.armorClass}\n\nWelcome, adventurer!`
          ),
        ],
      });
      break;
    }

    case "add-agent": {
      await interaction.deferReply();
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.editReply("No game in this channel.");
        return;
      }

      const agentName = interaction.options.getString("name", true);
      try {
        const personality = await loadAgentPersonality(agentName);
        const agentId = `agent:${agentName}`;

        if (gameState.players.some((p) => p.id === agentId)) {
          await interaction.editReply(`${personality.name} is already in the party.`);
          return;
        }

        const partyContext = gameState.players
          .map((p) => `${p.characterSheet.name} (${p.characterSheet.race} ${p.characterSheet.class})`)
          .join(", ");

        const sheet = await buildAgentCharacter(personality, partyContext || "First member of the party");

        const player: Player = {
          id: agentId,
          name: personality.name,
          isAgent: true,
          characterSheet: sheet,
          agentFile: `${agentName}.md`,
          joinedAt: new Date().toISOString(),
        };

        gameState.players.push(player);
        await saveCharacter(gameState.id, sheet);
        await saveGameState(gameState);

        await interaction.editReply({
          embeds: [
            systemEmbed(
              `${personality.name} Joins the Party`,
              `**${personality.name}** — ${sheet.race} ${sheet.class} ${sheet.level}\n${personality.description}\n\n*${sheet.backstory.slice(0, 200)}...*`
            ),
          ],
        });
      } catch (err) {
        await interaction.editReply(`Could not load agent "${agentName}". Make sure \`agents/${agentName}.md\` exists.`);
      }
      break;
    }

    case "start": {
      await interaction.deferReply();
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.editReply("No game in this channel.");
        return;
      }
      if (gameState.players.length === 0) {
        await interaction.editReply("No players have joined yet. Use `/join` or `/add-agent` first.");
        return;
      }

      gameState.status = "active";
      await saveGameState(gameState);

      // Check if there's existing history (resume)
      const history = await loadHistory(gameState.id);
      let openingPrompt: string;

      if (history.length > 0) {
        openingPrompt = "The party reconvenes. Generate a 'Last time on...' recap of the story so far, then describe the current scene and prompt the players for action.";
      } else {
        const partyDesc = gameState.players
          .map((p) => `${p.characterSheet.name} the ${p.characterSheet.race} ${p.characterSheet.class}`)
          .join(", ");
        openingPrompt = `The campaign begins. The party consists of: ${partyDesc}. Narrate a compelling opening scene that brings these characters together and gives them a reason to adventure. End with a clear hook or prompt for action.`;
      }

      const narration = await dmNarrate(gameState, history, openingPrompt);

      await sendAsIdentity(channel, "Dungeon Master", "", {
        embeds: [dmNarrationEmbed(narration)],
      });

      const entry: TurnEntry = {
        id: 1,
        timestamp: new Date().toISOString(),
        playerId: "dm",
        playerName: "Dungeon Master",
        type: "dm-narration",
        content: narration,
      };

      const { appendHistory } = await import("../state/store.js");
      await appendHistory(gameState.id, entry);
      gameState.turnCount++;
      await saveGameState(gameState);

      await interaction.editReply("The adventure begins! Use `> your action` to act in character.");
      break;
    }

    case "status": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.reply({ content: "No game in this channel.", ephemeral: true });
        return;
      }

      const embeds = [partyStatusEmbed(gameState)];
      if (gameState.combat.active) {
        embeds.push(combatStatusEmbed(gameState.combat, gameState.players));
      }
      await interaction.reply({ embeds });
      break;
    }

    case "roll": {
      const notation = interaction.options.getString("notation", true);
      const label = interaction.options.getString("label") ?? undefined;
      try {
        const result = roll(notation, label);
        await interaction.reply(
          `**${interaction.user.displayName}** rolls ${diceResultText(result)}`
        );
      } catch {
        await interaction.reply({ content: `Invalid dice notation: \`${notation}\``, ephemeral: true });
      }
      break;
    }

    case "look": {
      await interaction.deferReply();
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status !== "active") {
        await interaction.editReply("No active game in this channel.");
        return;
      }
      const target = interaction.options.getString("target") ?? undefined;
      const history = await loadHistory(gameState.id);
      const description = await dmLook(gameState, history, target);

      await sendAsIdentity(channel, "Dungeon Master", "", {
        embeds: [dmNarrationEmbed(description)],
      });
      await interaction.editReply("The DM surveys the scene...");
      break;
    }

    case "whisper": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status !== "active") {
        await interaction.reply({ content: "No active game.", ephemeral: true });
        return;
      }

      const targetUser = interaction.options.getUser("player", true);
      const message = interaction.options.getString("message", true);

      const sender = gameState.players.find((p) => p.id === interaction.user.id);
      const receiver = gameState.players.find((p) => p.id === targetUser.id);

      if (!sender || !receiver) {
        await interaction.reply({ content: "Both players must be in the game.", ephemeral: true });
        return;
      }

      // Send ephemeral to both parties
      await interaction.reply({
        embeds: [whisperEmbed(sender.characterSheet.name, receiver.characterSheet.name, message)],
        ephemeral: true,
      });

      // DM the target
      try {
        const dmChannel = await targetUser.createDM();
        await dmChannel.send({
          embeds: [whisperEmbed(sender.characterSheet.name, receiver.characterSheet.name, message)],
        });
      } catch {
        // User may have DMs disabled
      }

      // Record in history (whisper type)
      const entry: TurnEntry = {
        id: gameState.turnCount + 1,
        timestamp: new Date().toISOString(),
        playerId: sender.id,
        playerName: sender.characterSheet.name,
        type: "whisper",
        content: message,
        whisperTo: receiver.id,
      };
      const { appendHistory } = await import("../state/store.js");
      await appendHistory(gameState.id, entry);
      break;
    }

    case "recap": {
      await interaction.deferReply();
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.editReply("No game in this channel.");
        return;
      }
      const history = await loadHistory(gameState.id);
      const recap = await dmRecap(gameState, history);

      await sendAsIdentity(channel, "Dungeon Master", "", {
        embeds: [dmNarrationEmbed(`**Previously, on our adventure...**\n\n${recap}`)],
      });
      await interaction.editReply("The DM recounts the tale...");
      break;
    }

    case "inventory": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.reply({ content: "No game in this channel.", ephemeral: true });
        return;
      }
      const player = gameState.players.find((p) => p.id === interaction.user.id);
      if (!player) {
        await interaction.reply({ content: "You're not in this game.", ephemeral: true });
        return;
      }
      await interaction.reply({ embeds: [inventoryEmbed(player)], ephemeral: true });
      break;
    }

    case "pass": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status !== "active") {
        await interaction.reply({ content: "No active game.", ephemeral: true });
        return;
      }
      const player = gameState.players.find((p) => p.id === interaction.user.id);
      if (!player) {
        await interaction.reply({ content: "You're not in this game.", ephemeral: true });
        return;
      }

      await interaction.reply(`*${player.characterSheet.name} holds their action.*`);

      const entry: TurnEntry = {
        id: gameState.turnCount + 1,
        timestamp: new Date().toISOString(),
        playerId: player.id,
        playerName: player.characterSheet.name,
        type: "ic",
        content: "*holds action and observes*",
      };

      await processTurn(gameState, entry, channel);
      break;
    }

    case "end": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.reply({ content: "No game in this channel.", ephemeral: true });
        return;
      }
      gameState.status = "ended";
      await saveGameState(gameState);

      await interaction.reply({
        embeds: [
          systemEmbed(
            "Campaign Ended",
            `The adventure concludes after ${gameState.turnCount} turns.\nFinal state has been saved. Use \`/new-game\` to start a new campaign.`
          ),
        ],
      });
      break;
    }
  }
}

async function fetchAttachment(attachment: Attachment): Promise<string> {
  const response = await fetch(attachment.url);
  return response.text();
}
