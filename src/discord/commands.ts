import {
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
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
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("add-agent")
    .setDescription("Add an AI agent to the game")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("Agent name (matches agents/<name>.md)").setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("dormant")
        .setDescription(
          "Load agent dormant — not active until the DM introduces them via [[ACTIVATE:Name]]",
        ),
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
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("label").setDescription("What this roll is for").setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("look")
    .setDescription("Ask the DM to describe the environment or a target")
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("What to look at (leave blank for general)")
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("whisper")
    .setDescription("Send a private in-character message")
    .addUserOption((opt) =>
      opt.setName("player").setDescription("Who to whisper to").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("message").setDescription("Your whisper").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("recap")
    .setDescription("DM summarizes the story so far")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("character")
    .setDescription("Show your character sheet")
    .addStringOption((opt) =>
      opt
        .setName("section")
        .setDescription("Show a specific section")
        .setRequired(false)
        .addChoices(
          { name: "All", value: "all" },
          { name: "Ability Scores", value: "abilities" },
          { name: "Skills", value: "skills" },
          { name: "Features", value: "features" },
          { name: "Spells", value: "spells" },
          { name: "Backstory", value: "backstory" },
        ),
    )
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
    .setName("pause")
    .setDescription("Pause the game — DM saves full context for seamless resume")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume a paused game — DM reloads context and continues")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("End the campaign and save final state")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the DM an out-of-character question about the game")
    .addStringOption((opt) =>
      opt
        .setName("question")
        .setDescription("Your question (rules, options, what happened, etc.)")
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("how-to-play")
    .setDescription("Quick reference for how to play DnDnAi")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Ask a question about D&D rules, DnDnAi commands, or how things work")
    .addStringOption((opt) =>
      opt
        .setName("question")
        .setDescription("Your question (D&D rules, bot commands, how-to, etc.)")
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("rest")
    .setDescription("Take a short or long rest to recover resources")
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("Rest type")
        .setRequired(true)
        .addChoices({ name: "Short Rest", value: "short" }, { name: "Long Rest", value: "long" }),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("level-up")
    .setDescription("Level up your character (requires enough XP)")
    .addStringOption((opt) =>
      opt
        .setName("hp")
        .setDescription("HP method: roll the hit die or take the fixed average")
        .setRequired(false)
        .addChoices({ name: "Roll", value: "roll" }, { name: "Fixed (average)", value: "fixed" }),
    )
    .toJSON(),
];
