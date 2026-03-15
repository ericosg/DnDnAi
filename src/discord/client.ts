import {
  type Attachment,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type TextChannel,
} from "discord.js";
import { loadAgentPersonality } from "../ai/agent.js";
import { dmAsk, dmLook, dmNarrate, dmRecap } from "../ai/dm.js";
import { config, VERSION } from "../config.js";
import { buildAgentCharacter, parseCharacterSheet } from "../game/characters.js";
import { roll } from "../game/dice.js";
import { processTurn, resumeOrchestrator } from "../game/engine.js";
import { log } from "../logger.js";
import {
  createGameState,
  findActiveGames,
  findGameByChannel,
  initDMNotes,
  loadHistory,
  saveCharacter,
  saveGameState,
} from "../state/store.js";
import type { Player, TurnEntry } from "../state/types.js";
import { commands } from "./commands.js";
import {
  type CharacterSection,
  characterEmbed,
  combatStatusEmbed,
  diceResultText,
  dmNarrationEmbeds,
  inventoryEmbed,
  partyStatusEmbed,
  systemEmbed,
  whisperEmbed,
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
    log.info(`Logged in as ${c.user.tag}`);
    await registerCommands(c.user.id);
    await autoResume(c);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    log.info(`/${interaction.commandName} from ${interaction.user.displayName}`);
    try {
      await handleCommand(interaction);
    } catch (err) {
      log.error("Command error:", err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "Something went wrong.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "Something went wrong.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  // Handle in-character messages (> prefix)
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(">")) return;

    log.info(`IC message from ${message.author.displayName}: ${message.content.slice(0, 80)}`);
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
  log.info(`Registered ${commands.length} slash commands`);
}

async function autoResume(client: Client): Promise<void> {
  const games = await findActiveGames();
  if (games.length === 0) {
    log.info("No active games to resume");
    return;
  }

  log.info(`Found ${games.length} active game(s) to resume`);

  for (const gameState of games) {
    try {
      const channel = await client.channels.fetch(gameState.channelId);
      if (!channel || !channel.isTextBased()) {
        log.warn(`Could not find channel ${gameState.channelId} for game ${gameState.id}`);
        continue;
      }

      const textChannel = channel as TextChannel;
      const playerCount = gameState.players.length;
      const mode = gameState.combat.active
        ? `Combat: Round ${gameState.combat.round}`
        : "Exploration mode";

      await textChannel.send({
        embeds: [
          systemEmbed(
            `DnDnAi v${VERSION} — Back Online`,
            `Game in progress — ${playerCount} players, turn ${gameState.turnCount}.\n${mode}\n\nUse \`/recap\` to catch up. The adventure continues!`,
          ),
        ],
      });

      log.info(
        `Posted startup greeting for game ${gameState.id} in channel ${gameState.channelId}`,
      );

      // Kick off the orchestrator to resume pending AI turns
      resumeOrchestrator(gameState, textChannel);
    } catch (err) {
      log.error(`Failed to resume game ${gameState.id}:`, err);
    }
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel as TextChannel;

  switch (interaction.commandName) {
    case "new-game": {
      const existing = await findGameByChannel(channel.id);
      if (existing && existing.status !== "ended") {
        await interaction.reply({
          content: "A game is already running in this channel. Use `/end` first.",
          flags: MessageFlags.Ephemeral,
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
            "Use `/join` with a character sheet to join, `/add-agent` for AI companions, then `/start` to begin!",
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

      // Check for character name collision
      const nameTaken = gameState.players.some(
        (p) => p.characterSheet.name.toLowerCase() === sheet.name.toLowerCase(),
      );
      if (nameTaken) {
        await interaction.editReply(`A character named "${sheet.name}" is already in the party.`);
        return;
      }

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
            `**${sheet.name}** — ${sheet.race} ${sheet.class} ${sheet.level}\nHP: ${sheet.hp.max} | AC: ${sheet.armorClass}\n\nWelcome, adventurer!`,
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

        // Check for character name collision
        const nameTaken = gameState.players.some(
          (p) => p.characterSheet.name.toLowerCase() === personality.name.toLowerCase(),
        );
        if (nameTaken) {
          await interaction.editReply(
            `A character named "${personality.name}" is already in the party.`,
          );
          return;
        }

        const partyContext = gameState.players
          .map(
            (p) => `${p.characterSheet.name} (${p.characterSheet.race} ${p.characterSheet.class})`,
          )
          .join(", ");

        const sheet = await buildAgentCharacter(
          personality,
          partyContext || "First member of the party",
        );

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
              `**${personality.name}** — ${sheet.race} ${sheet.class} ${sheet.level}\n${personality.description}\n\n*${sheet.backstory.slice(0, 200)}...*`,
            ),
          ],
        });
      } catch (err) {
        log.error(`Failed to add agent "${agentName}":`, err);
        await interaction.editReply(
          `Could not load agent "${agentName}". Make sure \`agents/${agentName}.md\` exists.`,
        );
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
        await interaction.editReply(
          "No players have joined yet. Use `/join` or `/add-agent` first.",
        );
        return;
      }

      gameState.status = "active";
      await saveGameState(gameState);
      await initDMNotes(gameState.id);

      // Check if there's existing history (resume)
      const history = await loadHistory(gameState.id);
      let openingPrompt: string;

      if (history.length > 0) {
        openingPrompt =
          "The party reconvenes. Generate a 'Last time on...' recap of the story so far, then describe the current scene and prompt the players for action.";
      } else {
        const partyDesc = gameState.players
          .map(
            (p) =>
              `${p.characterSheet.name} the ${p.characterSheet.race} ${p.characterSheet.class}`,
          )
          .join(", ");
        openingPrompt = `The campaign begins. The party consists of: ${partyDesc}. Narrate a compelling opening scene that brings these characters together and gives them a reason to adventure. End with a clear hook or prompt for action.`;
      }

      const narration = await dmNarrate(gameState, history, openingPrompt);

      await sendAsIdentity(channel, "Dungeon Master", "", {
        embeds: dmNarrationEmbeds(narration),
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
        await interaction.reply({
          content: "No game in this channel.",
          flags: MessageFlags.Ephemeral,
        });
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
          `**${interaction.user.displayName}** rolls ${diceResultText(result)}`,
        );
      } catch {
        await interaction.reply({
          content: `Invalid dice notation: \`${notation}\``,
          flags: MessageFlags.Ephemeral,
        });
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
        embeds: dmNarrationEmbeds(description),
      });
      await interaction.editReply("The DM surveys the scene...");
      break;
    }

    case "whisper": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status !== "active") {
        await interaction.reply({ content: "No active game.", flags: MessageFlags.Ephemeral });
        return;
      }

      const targetUser = interaction.options.getUser("player", true);
      const message = interaction.options.getString("message", true);

      const sender = gameState.players.find((p) => p.id === interaction.user.id);
      const receiver = gameState.players.find((p) => p.id === targetUser.id);

      if (!sender || !receiver) {
        await interaction.reply({
          content: "Both players must be in the game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Send ephemeral to both parties
      await interaction.reply({
        embeds: [whisperEmbed(sender.characterSheet.name, receiver.characterSheet.name, message)],
        flags: MessageFlags.Ephemeral,
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
        embeds: dmNarrationEmbeds(`**Previously, on our adventure...**\n\n${recap}`),
      });
      await interaction.editReply("The DM recounts the tale...");
      break;
    }

    case "character": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.reply({
          content: "No game in this channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const player = gameState.players.find((p) => p.id === interaction.user.id);
      if (!player) {
        await interaction.reply({
          content: "You're not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const sectionOpt = interaction.options.getString("section") ?? "all";
      const section = sectionOpt === "all" ? undefined : (sectionOpt as CharacterSection);
      await interaction.reply({
        embeds: [characterEmbed(player, section)],
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    case "inventory": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.reply({
          content: "No game in this channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const player = gameState.players.find((p) => p.id === interaction.user.id);
      if (!player) {
        await interaction.reply({
          content: "You're not in this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({ embeds: [inventoryEmbed(player)], flags: MessageFlags.Ephemeral });
      break;
    }

    case "pass": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status !== "active") {
        await interaction.reply({ content: "No active game.", flags: MessageFlags.Ephemeral });
        return;
      }
      const player = gameState.players.find((p) => p.id === interaction.user.id);
      if (!player) {
        await interaction.reply({
          content: "You're not in this game.",
          flags: MessageFlags.Ephemeral,
        });
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

    case "ask": {
      await interaction.deferReply();
      const gameState = await findGameByChannel(channel.id);
      if (!gameState || gameState.status !== "active") {
        await interaction.editReply("No active game in this channel.");
        return;
      }

      const question = interaction.options.getString("question", true);
      const history = await loadHistory(gameState.id);
      const player = gameState.players.find((p) => p.id === interaction.user.id);
      const askerName = player?.characterSheet.name ?? interaction.user.displayName;
      const answer = await dmAsk(gameState, history, question, askerName);

      await sendAsIdentity(channel, "Dungeon Master", "", {
        embeds: dmNarrationEmbeds(
          `**OOC — ${interaction.user.displayName} asks:**\n> ${question}\n\n${answer}`,
        ),
      });
      await interaction.editReply("The DM has answered your question.");
      break;
    }

    case "end": {
      const gameState = await findGameByChannel(channel.id);
      if (!gameState) {
        await interaction.reply({
          content: "No game in this channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      gameState.status = "ended";
      await saveGameState(gameState);

      await interaction.reply({
        embeds: [
          systemEmbed(
            "Campaign Ended",
            `The adventure concludes after ${gameState.turnCount} turns.\nFinal state has been saved. Use \`/new-game\` to start a new campaign.`,
          ),
        ],
      });
      break;
    }
  }
}

async function fetchAttachment(attachment: Attachment): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}
