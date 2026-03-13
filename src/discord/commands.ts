import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("new-game")
    .setDescription("Create a new D&D game in this channel")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join the game with a character sheet")
    .addAttachmentOption((opt) =>
      opt
        .setName("character")
        .setDescription("Your character sheet (markdown file)")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("add-agent")
    .setDescription("Add an AI agent to the game")
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("Agent name (matches agents/<name>.md)")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Start the campaign — AI generates backstories and opening scene")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show party HP, conditions, and turn order")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll dice")
    .addStringOption((opt) =>
      opt
        .setName("notation")
        .setDescription("Dice notation (e.g., 2d6+3, d20, 4d6kh3)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("label")
        .setDescription("What this roll is for")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("look")
    .setDescription("Ask the DM to describe the environment or a target")
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("What to look at (leave blank for general)")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("whisper")
    .setDescription("Send a private in-character message")
    .addUserOption((opt) =>
      opt
        .setName("player")
        .setDescription("Who to whisper to")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Your whisper")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("recap")
    .setDescription("DM summarizes the story so far")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Show your character's equipment")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("pass")
    .setDescription("Skip your turn or signal nothing to do")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("End the campaign and save final state")
    .toJSON(),
];
