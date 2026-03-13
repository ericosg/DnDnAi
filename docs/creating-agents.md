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
model: claude-sonnet-4-20250514 # Optional model override
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
2. Loads the agent's personality file
3. Builds a system prompt with the agent's full personality
4. Sends recent history + current situation as a user message
5. Claude generates an in-character response
6. Response is posted to Discord via the agent's webhook identity
7. Recorded in game history as an IC turn entry

## Example: Grimbold Ironforge

See `agents/grimbold.md` for a complete, production-ready agent definition including full mechanical spec, personality description, combat style, and roleplay notes.
