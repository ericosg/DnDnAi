# Creating a Character for DnDnAi

This guide walks you through creating a character sheet that the DnDnAi bot can understand. No D&D experience required — if you've never played before, this covers everything you need.

## The Short Version

Create a `.md` (markdown) text file with your character's stats, skills, and backstory. Upload it in Discord with the `/join` command. That's it.

See [`characters/sample-character.md`](../characters/sample-character.md) for a complete, ready-to-use example you can copy and modify.

## Character Sheet Format

The bot's parser is flexible — it handles `**Key:** Value`, `Key: Value`, and `- Key: Value` formats. Sections like Skills, Equipment, and Features go under `## Headings` as bullet lists. Here's the full template:

```markdown
**Name:** Your Character Name
**Race:** Half-Elf
**Class:** Wizard
**Level:** 1
**Background:** Sage
**Alignment:** Neutral Good
**Gender:** Female

**Strength:** 8
**Dexterity:** 14
**Constitution:** 13
**Intelligence:** 16
**Wisdom:** 12
**Charisma:** 8

**Proficiency Bonus:** +2
**Armor Class:** 12
**HP:** 7
**Initiative:** +2
**Speed:** 30

## Saving Throws
- Intelligence
- Wisdom

## Skills
- Arcana
- History
- Investigation
- Perception

## Equipment
- Quarterstaff
- Arcane focus
- Scholar's pack
- Spellbook

## Features
- Darkvision (60 ft)
- Fey Ancestry
- Arcane Recovery
- Spellcasting (INT-based, spell save DC 13, +5 to hit)

## Spells
- Fire Bolt (cantrip)
- Mage Hand (cantrip)
- Shield (1st level)
- Magic Missile (1st level)

## Spell Slots
- 1st level: 2

## Backstory
A paragraph or two about who your character is, where they come from,
and why they're adventuring. The AI DM reads this and weaves it into
the story, so the more you give it, the more personal the narrative gets.

**Personality:** How they act and behave.
**Ideals:** What they believe in.
**Bonds:** What they care about or are loyal to.
**Flaws:** Their weakness or blind spot.
```

### What Each Field Means

| Field | What It Is | Default If Missing |
|-------|-----------|-------------------|
| **Name** | Your character's name (used in Discord messages) | "Unknown" |
| **Race** | Species — Human, Elf, Dwarf, Half-Orc, Tiefling, etc. | "Unknown" |
| **Class** | Role — Fighter, Wizard, Rogue, Cleric, etc. | "Unknown" |
| **Level** | Power level (start at 1 for new campaigns) | 1 |
| **Ability Scores** | STR, DEX, CON, INT, WIS, CHA — your core stats (range 3-20) | 10 each |
| **Armor Class** | How hard you are to hit | 10 |
| **HP** | Hit points — how much damage you can take | 10 |
| **Initiative** | Turn order bonus in combat (usually DEX modifier) | Calculated from DEX |
| **Speed** | How far you move per turn in feet | 30 |
| **Skills** | Things you're trained in (Stealth, Perception, etc.) | None |
| **Equipment** | What you're carrying | None |
| **Features** | Class abilities, racial traits, feats | None |
| **Spell Slots** | Slots per spell level (for casters) | Auto-derived from class/level |
| **Experience Points** | XP earned so far | None (starts tracking when DM awards XP) |
| **Backstory** | Your character's history and personality | None |

### Tips

- **All six ability scores matter.** STR (melee/carrying), DEX (dodging/stealth/ranged), CON (HP/endurance), INT (knowledge/arcana), WIS (perception/insight), CHA (persuasion/deception).
- **Initiative is important.** It determines turn order in combat. If you skip it, the bot calculates it from your DEX modifier, but feats like Alert add bonuses that won't be captured automatically.
- **Backstory drives the narrative.** The AI DM reads your backstory, personality, ideals, bonds, and flaws. A character with a rich backstory gets a much more personalized game.
- **Don't stress about perfection.** Missing fields get sensible defaults. You can always `/end` and `/new-game` with an updated sheet.
- **Never use `###` subheadings inside a section.** The parser exits a `## Section` when it encounters any heading (including `###`), so items after a `###` inside Skills, Equipment, Features, or Spells will be silently lost. Keep all list sections as flat bullet lists under `## Headings`.
- **Spells go in their own section.** Use `## Spells` with one spell per bullet, not inside Features. Non-casters simply omit this section.
- **Spell slots are auto-derived.** If you have spells, the bot figures out your spell slots from your class and level. You can override this with a `## Spell Slots` section listing `- 1st level: 2` etc.
- **Feature charges are auto-parsed.** If your feature says "(1/short rest)" or "(3/long rest)", the bot tracks charges and resets them on rests.
- **XP is optional at creation.** Add `**Experience Points:** 0` if you want to track XP from the start, or leave it out — the bot starts tracking when the DM first awards XP.

## New to D&D? Use AI to Help

If you've never built a D&D character before, you don't have to figure out ability scores, proficiencies, and equipment on your own. Use any AI assistant (Claude, ChatGPT, etc.) with a prompt like:

> I want to play a D&D 5e character who is [describe your concept — e.g., "a charming rogue who talks their way out of trouble" or "a nature-loving healer" or "a big angry barbarian"]. Create a Level 1 character sheet for me in this exact markdown format:
>
> - `**Key:** Value` for all scalar fields (Name, Race, Class, Level, Background, Alignment, Gender, all six ability scores, Proficiency Bonus, AC, HP, Initiative, Speed)
> - `## Saving Throws` with one bullet per save
> - `## Skills`, `## Equipment`, `## Features` with flat bullet lists (never `###` subheadings)
> - `## Spells` with one spell per bullet, level noted inline like `- Fire Bolt (cantrip)` — omit this section for non-casters
> - `## Spell Slots` with one bullet per level like `- 1st level: 2` — or omit to let the bot derive from class/level
> - `## Backstory` with narrative text, then `**Personality:**`, `**Ideals:**`, `**Bonds:**`, `**Flaws:**` as bold-key-value pairs
>
> Make sure the stats follow D&D 5e rules (standard array or point buy).

The AI will generate a complete, rules-legal character sheet you can save as a `.md` file and upload directly.

### Want to Learn the Rules First?

The companion repository [**ericosg/DnD**](https://github.com/ericosg/DnD) has a structured set of D&D 5e learning guides:

- Numbered tutorials (`00` through `07`) that walk through D&D fundamentals step by step
- A reference library covering backgrounds, equipment, feats, and skills
- A complete example character build showing every decision and why it was made
- An AI-assisted character creation prompt template for guided builds

You don't need any of that to play DnDnAi — but if you want to understand *why* your Rogue has 16 DEX, those guides explain it.

## Sample Character

A ready-to-use sample character is included at [`characters/sample-character.md`](../characters/sample-character.md). You can:

1. Use it as-is to jump straight into a game
2. Copy it and change the name, stats, and backstory to make it your own
3. Use it as a reference for the format while building from scratch

## Playing

Once your `.md` file is ready:

1. Open the Discord channel where a game is running (or create one with `/new-game`)
2. Type `/join` and attach your character sheet file
3. The bot parses your sheet and adds you to the party
4. When the game starts, type `> ` followed by your action to play in character (e.g., `> I search the room for traps`)
5. Use `/ask` to ask the DM out-of-character questions about rules or the game
6. Plain messages without the `>` prefix are out-of-character chat and don't affect the game

### Useful Commands During Play

| Command | When to Use |
|---------|-------------|
| `> action` | Act in character — this is how you play |
| `/ask question` | Ask the DM anything without using your turn |
| `/character` | Check your stats, HP, XP, spell slots, and feature charges |
| `/character spells` | See just your spells and remaining slots |
| `/roll 2d6+3` | Roll dice manually |
| `/rest short` | Recover short-rest features between fights |
| `/rest long` | Full recovery — HP, spell slots, all features |
| `/level-up` | Level up when you have enough XP |
| `/status` | See the whole party's HP and combat status |
| `/pass` | Skip your turn in combat |

### Things You Don't Need to Track

The bot handles these automatically:
- **Spell slots** — deducted when you cast, restored on rest
- **Feature charges** — Action Surge, Bardic Inspiration, etc. tracked and reset
- **Death saves** — auto-rolled when you're at 0 HP
- **Concentration** — tracked; auto-broken if you take damage and fail the CON save
- **Conditions** — prone, frightened, etc. tracked with mechanical effects
