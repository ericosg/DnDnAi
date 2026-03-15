# DnDnAi

An AI-powered Dungeon Master for D&D 5e, running entirely in Discord.

DnDnAi replaces the human DM with Claude AI while keeping human players at the table (in a Discord channel) alongside AI-controlled party members. The bot manages narration, combat, dice, characters, and turn flow — you just play.

## How It Works

1. Create a game in a Discord channel with `/new-game`
2. Human players join with `/join` and upload a markdown character sheet
3. Add AI companions with `/add-agent grimbold`
4. Start the campaign with `/start` — the AI DM narrates an opening scene
5. Type `> I search the room for traps` to act in character
6. AI agents respond in character, then the DM resolves everything and narrates what happens
7. Dice are real — the DM requests rolls, the engine rolls actual random dice

## Features

- **AI Dungeon Master** — Claude Opus narrates, adjudicates rules, and drives the story
- **AI Party Members** — Claude Sonnet-powered NPCs with distinct personalities and voices
- **Honest Dice** — real random rolls, never AI-simulated
- **Combat System** — initiative, turn order, damage, healing, death saves
- **Webhook Identities** — each AI character appears as a separate Discord user with their own name and avatar
- **Auto-Persistence** — game state saves after every turn; crash-safe, always resumable
- **Narrative Compression** — AI summarizes the story every 10 turns to manage context length
- **Private Messages** — `/whisper` for secret in-character communication (only recipient + DM see it)

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) runtime
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (uses your Pro/Max plan — no API key needed)

### Setup

```bash
# Clone and install
git clone git@github.com:ericosg/DnDnAi.git
cd DnDnAi
bun install

# Configure
cp .env.example .env
# Edit .env with your tokens:
#   DISCORD_TOKEN=your_bot_token
#   GUILD_ID=your_server_id
#   NARRATIVE_STYLE=concise  # concise | standard | elaborate (default: concise)

# Run
bun run src/index.ts
```

### Discord Bot Permissions

When creating your bot in the Discord Developer Portal, enable these:
- **Bot permissions**: Send Messages, Manage Webhooks, Use Slash Commands, Embed Links, Attach Files, Read Message History, Add Reactions, View Channels
- **Privileged intents**: Message Content Intent

### Invite URL
Use the OAuth2 URL Generator in the Developer Portal with the `bot` and `applications.commands` scopes plus the permissions above.

## Commands

| Command | Description |
|---------|-------------|
| `/new-game` | Create a new campaign in this channel |
| `/join` | Join with a character sheet (markdown file attachment) |
| `/add-agent <name>` | Add an AI party member from `agents/<name>.md` |
| `/start` | Begin the adventure — AI generates backstories and opening scene |
| `/status` | Show party HP, conditions, combat turn order |
| `/roll <notation>` | Roll dice — `2d6+3`, `d20`, `4d6kh3` |
| `/look [target]` | Ask the DM to describe the environment or something specific |
| `/whisper @player <msg>` | Private in-character message |
| `/recap` | DM summarizes the story so far |
| `/ask <question>` | Ask the DM an out-of-character question about rules or the game |
| `/character [section]` | Show your character sheet (all, abilities, skills, features, spells, backstory) |
| `/inventory` | Show your character's equipment |
| `/pass` | Skip your turn |
| `/end` | End the campaign and save final state |

## Playing the Game

### In-Character Actions
Prefix your message with `>` to act in character:
```
> I draw my sword and cautiously approach the door
> "Who goes there?" I call out into the darkness
> I check the chest for traps before opening it
```

Plain messages (no `>` prefix) are treated as out-of-character and don't affect the game.

### How Turns Work
1. The DM narrates a scene
2. Human players act (using `>` messages or `/pass`)
3. AI agents respond in character automatically
4. Once everyone has acted, the DM resolves all actions and narrates the outcome
5. If dice are needed, the DM requests them and the engine rolls real dice
6. Repeat

In combat, turns follow initiative order. The game never auto-advances without human input — if it's your turn, the bot waits for you.

## Character Sheets

Upload a markdown (`.md`) file with your character's stats, skills, equipment, and backstory. The bot's parser is flexible — `**Key:** Value`, `Key: Value`, and `- Key: Value` all work.

See the full guide: **[docs/creating-characters.md](docs/creating-characters.md)** — covers the format, what every field means, how to use AI to generate a character if you're new to D&D, and links to learning resources.

A ready-to-use sample is included at [`characters/sample-character.md`](characters/sample-character.md) — copy it and make it your own, or use it as-is.

## Available AI Agents

Add any of these to your game with `/add-agent <name>`:

| Agent File | Name | Race | Class | Level | Personality |
|-----------|------|------|-------|-------|-------------|
| `grimbold` | Grimbold Ironforge | Mountain Dwarf | Fighter | 3 | Gruff veteran who protects the party while complaining about everything |
| `criella` | Criella Arkalis | Tiefling | Warlock | 2 | Treats her fiendish pact like a tedious business contract |
| `merric` | Merric Tosscobble | Lightfoot Halfling | Bard | 1 | Cheerful traveling cook whose secret ingredient is magic |
| `torinn` | Torinn Stormfang | Dragonborn | Paladin | 3 | Earnest honor-bound knight who cannot detect sarcasm |
| `nyx` | Nyx Namfoodle | Forest Gnome | Wizard | 2 | Compulsive tinkerer whose contraptions "probably won't explode" |
| `vola` | Vola Keth | Half-Orc | Barbarian | 1 | Gentle former shepherd who rages only to protect the helpless |
| `caelynn` | Caelynn Galanodel | Wood Elf | Ranger | 2 | 237-year-old elf who adventures because she's bored |
| `damakos` | Damakos "Sorrow" | Tiefling | Monk | 1 | Awkward monk stuck with an embarrassing teenage virtue name |
| `seraphina` | Seraphina Goodbarrel | Lightfoot Halfling | Cleric | 3 | Militant soup-healer who mothers the entire party |
| `soveliss` | Soveliss Ilphelkiir | High Elf | Sorcerer | 2 | Aristocrat whose wild magic got him politely exiled |
| `pumpernickle` | Pumpernickle | Slate (Homebrew) | Bard | 3 | Theatrical slate humanoid whose every threat becomes a performance |

## Creating AI Agents

Agent personality files live in `agents/` as markdown with YAML frontmatter. See `agents/grimbold.md` for a complete example.

```markdown
---
name: Agent Name
race: Dwarf
class: Fighter
level: 3
description: One-line description
voice: How they speak
traits:
  - Trait one
  - Trait two
flaws:
  - Flaw one
goals:
  - Goal one
avatarUrl: https://example.com/avatar.png  # optional
model: claude-sonnet-4-20250514             # optional override
characterSpec: |
  **Name:** Agent Name
  **Strength:** 16
  ... (full character sheet in markdown)
---

Detailed personality description, combat style, and roleplay notes go here.
The AI reads this entire file to stay in character.
```

The `characterSpec` field contains the mechanical character sheet that gets parsed into game stats. The markdown body below the frontmatter defines personality, voice, combat behavior, and roleplay guidelines.

## Architecture

See [docs/architecture.md](docs/architecture.md) for full technical details.

**TL;DR:** Discord events → game engine → AI orchestrator decides who acts → agents/DM generate responses via Claude CLI → webhooks post as character identities → state persists to JSON.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript (strict mode)
- **Discord**: [discord.js](https://discord.js.org) v14
- **AI**: Claude CLI (non-interactive mode) — Opus (DM), Sonnet (agents), Haiku (orchestrator)
- **Config Parsing**: [gray-matter](https://github.com/jonschlinkert/gray-matter) for agent frontmatter
- **Persistence**: Flat JSON files (no database)

## Development

```bash
bun test                       # unit + integration tests
bunx tsc --noEmit              # type-check
bunx biome check src/          # lint + format check
```

## License

MIT
