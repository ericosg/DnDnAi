# Creating AI Agents

AI agents are D&D party members controlled by Claude. Each agent is defined by a markdown file in the `agents/` directory.

## File Structure

Agent files use markdown with YAML frontmatter (parsed by [gray-matter](https://github.com/jonschlinkert/gray-matter)):

```
agents/<name>.md
```

The filename (without `.md`) is the name used with `/add-agent <name>`.

## Frontmatter Fields

```yaml
---
name: Character Name          # Display name in Discord
race: Mountain Dwarf           # D&D race
class: Fighter                 # D&D class
level: 3                       # Starting level
description: One-line summary  # Shown when agent joins the party
voice: How they speak          # Style guide for the AI
traits:                        # Personality traits (list)
  - Loyal to companions
  - Tells long stories
flaws:                         # Character flaws (list)
  - Stubborn to a fault
  - Distrusts magic
goals:                         # Character motivations (list)
  - Find the lost forge
  - Protect the party
avatarUrl: https://...         # Optional Discord avatar URL
model: claude-sonnet-4-6        # Optional model override
characterSpec: |               # Full character sheet in markdown
  **Name:** Character Name
  **Strength:** 16
  ...
---
```

### Required Fields
- `name`, `race`, `class`, `level`

### Optional Fields
- `description` — shown in the party join embed
- `voice` — if omitted, defaults to generic in-character instructions
- `traits`, `flaws`, `goals` — if omitted, the AI works from the markdown body alone
- `avatarUrl` — if null or omitted, Discord uses the default webhook avatar
- `model` — override the default agent model (e.g., use Opus for a complex character)
- `characterSpec` — if omitted, the agent gets a bare-bones stat block (10 in all abilities, AC 10, 10 HP)

## The characterSpec Field

This is a full D&D 5e character sheet written in markdown, embedded in the YAML frontmatter as a multiline string (`|`). It uses the same format that human players upload via `/join`:

```yaml
characterSpec: |
  **Name:** Grimbold Ironforge
  **Race:** Mountain Dwarf
  **Class:** Fighter (Champion)
  **Level:** 3
  **Background:** Soldier
  **Alignment:** Lawful Neutral

  **Strength:** 16
  **Dexterity:** 12
  **Constitution:** 16
  **Wisdom:** 13
  **Intelligence:** 10
  **Charisma:** 8

  **Proficiency Bonus:** +2
  **Armor Class:** 18
  **HP:** 31
  **Speed:** 25

  ## Saving Throws
  - Strength
  - Constitution

  ## Skills
  - Athletics
  - Intimidation

  ## Equipment
  - Battleaxe
  - Chain mail
  - Shield

  ## Features
  - Second Wind
  - Action Surge
```

The parser is flexible — it handles `**Key:** Value`, `Key: Value`, `- Key: Value`, heading-based sections, and comma-separated lists.

### Format Rules

The character sheet parser (`game/characters.ts`) extracts list sections by looking for `## Heading` and collecting bullet items until the next heading. Important constraints:

- **Never use `###` subheadings inside a parsed section.** The parser exits a `##` section when it hits any heading (`#`, `##`, or `###`), so items after a `###` inside Features, Spells, Equipment, or Skills will be silently lost.
- **Spells must be in a separate `## Spells` section**, not embedded as bullet items inside `## Features`. Each spell gets its own bullet with the level noted inline: `- Fire Bolt (cantrip)`, `- Shield (1st level)`.
- **Saving throws** should be a `## Saving Throws` section with one bullet per save, not a comma-separated inline field.
- **Scalar fields** use `**Key:** Value` format (Name, Race, Class, Level, ability scores, AC, HP, etc.).
- **Non-casters** simply omit the `## Spells` section.

Example of the canonical spell format:

```markdown
## Spells
- Fire Bolt (cantrip)
- Shield (1st level)
- Magic Missile (1st level)
```

## Markdown Body

Everything below the frontmatter `---` is the agent's personality definition. The AI reads this entire section to stay in character. Structure it however makes sense for the character:

```markdown
## Personality

Detailed description of who this character is, how they behave,
what motivates them, how they interact with others.

## Combat Style

How they fight, when they use special abilities, positioning
preferences, what they prioritize in combat.

## Roleplay Notes

- Specific speech patterns or catchphrases
- How they react to certain situations
- Relationships with party archetypes
- Quirks and habits
```

### Tips for Good Agent Personalities

1. **Be specific about voice** — "speaks in short, gruff sentences" is better than "talks like a dwarf"
2. **Include contradictions** — a tough warrior who gets emotional about craftsmanship is more interesting than a one-note tough guy
3. **Define combat behavior** — the AI needs to know when to use abilities, whether to be aggressive or defensive, who to protect
4. **Add quirks** — recurring references, habits, reactions to specific triggers make agents feel alive
5. **Set boundaries** — "never controls other characters" and "never narrates outcomes" are in the system prompt, but you can add character-specific limits (e.g., "will never willingly enter water")

## How Agents Join a Game

When someone runs `/add-agent grimbold`:

1. The bot loads `agents/grimbold.md` and parses the frontmatter
2. If `characterSpec` exists, it's parsed into a `CharacterSheet` (same parser as human sheets)
3. Claude generates a 2-3 paragraph backstory based on the personality, spec, and existing party composition
4. The agent is added to the game as a `Player` with `isAgent: true` and `id: "agent:grimbold"`
5. The character sheet (with AI backstory) is saved to `data/games/<id>/characters/`

## How Agents Act During Play

Each round, the orchestrator prompts agents in order. For each agent:

1. Engine waits 2.5 seconds (pacing delay)
2. Loads the agent's personality file + memory file (`data/games/<id>/agent-notes/<slug>.md`)
3. Builds a system prompt with the agent's full personality + the absolute path to its memory file
4. Sends recent history + current situation + current memory contents as a user message
5. Claude runs agentically (Read + Edit tools scoped to its own memory file) and generates an in-character response
6. If something noteworthy happened, the agent edits its memory file to append a bullet
7. Response is posted to Discord via the agent's webhook identity
8. Recorded in game history as an IC turn entry

## Agent Capabilities (Player Parity)

AI agents have the same abilities human players do, exposed as directives:

| Human command | Agent equivalent | Notes |
|---------------|------------------|-------|
| `/pass` | `[[PASS]]` | Skip a turn. Optional IC flavor before the directive. |
| `/ask` | `[[ASK:question]]` | OOC question to the DM, answered publicly. |
| `/look` | `[[LOOK:target]]` / `[[LOOK]]` | Ask DM to describe a thing or the environment. |
| `/whisper` | `[[WHISPER:Name TEXT:msg]]` | Private IC message to one party member. |
| `/character` | (not needed) | Full character sheet is always in the agent's prompt. |
| `/inventory` | (not needed) | Equipment + gold are in the agent's prompt. |
| `/status` | (not needed) | Party HP/conditions are in the agent's prompt. |
| `/recap` | (not needed) | Narrative summary is in the agent's prompt. |
| `/roll` | (not needed) | When the DM emits `[[REQUEST_ROLL:]]` for an agent, it auto-rolls. |
| `/rest` | (not available) | Rest is a party-wide decision the DM initiates. |

See `docs/directives.md` for the full syntax reference.

## Agent Memory

Agents have persistent memory across sessions — you don't need to write or maintain it. The engine handles everything automatically:

- **On `/add-agent`**: a starter memory file is created from the character sheet (equipment → "What I Carry", spells/features → "What I Know About Myself", goals → "Bonds & Relationships").
- **On `[[ACTIVATE:]]`** (dormant agents): same starter template, seeded when the DM brings them into the fiction.
- **On `/resume`** of a pre-memory-module game: a one-time retrofit runs a Sonnet call per agent, reading the full turn history + the DM's character notes + the character sheet to produce a rich initial memory file.
- **During play**: the agent edits its own memory file after meaningful events. The DM can also force-commit entries via `[[REMEMBER:AgentName TEXT:first-person bullet]]` — useful for correcting mechanical mistakes or locking in key beats.

Memory files follow a fixed five-section structure: `## What I Remember`, `## What I Carry`, `## What I Know About Myself`, `## Bonds & Relationships`, `## Open Threads`. Written in first person. You can edit them directly in the filesystem if you need to correct something manually — the agent will see the changes on its next turn.

## Example: Grimbold Ironforge

See `agents/grimbold.md` for a complete, production-ready agent definition including full mechanical spec, personality description, combat style, and roleplay notes.
