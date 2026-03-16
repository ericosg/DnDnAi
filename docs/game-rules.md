# Game Rules & Mechanics

How DnDnAi implements D&D 5e rules and where it deviates for a Discord-based AI-driven experience.

## Dice System

### Supported Notation
| Notation | Meaning |
|----------|---------|
| `d20` | Roll one 20-sided die |
| `2d6+3` | Roll two 6-sided dice, add 3 |
| `d20-1` | Roll a d20, subtract 1 |
| `4d6kh3` | Roll 4d6, keep highest 3 (stat generation) |
| `2d20kl1` | Roll 2d20, keep lowest 1 (disadvantage) |

### How Dice Work in Play
The DM AI **never generates random numbers**. The flow is:

1. DM determines a check is needed and outputs a directive:
   ```
   [[ROLL:d20+5 FOR:Grimbold REASON:Athletics check to climb the wall]]
   ```
2. The engine parses this directive
3. Real dice are rolled using `Math.random()`
4. The directive text is replaced with formatted results
5. The modified narration is posted to Discord

Players can also roll manually with `/roll 2d6+3`.

### Advantage & Disadvantage
Available programmatically (`rollAdvantage()`, `rollDisadvantage()`) but typically handled through the DM requesting appropriate notation (e.g., `2d20kh1+5` for advantage).

## Combat

### Starting Combat
The DM signals combat by including `[[COMBAT:START]]` in its narration. The engine then:
1. Rolls initiative for all players (d20 + initiative modifier)
2. Sorts combatants by initiative (DEX breaks ties)
3. Enters combat mode — turns follow initiative order strictly

### Turn Order
- The orchestrator follows initiative order, prompting one combatant at a time
- AI agents act when it's their turn (with a 2.5s pacing delay)
- Human players are waited on indefinitely — the game never skips a human
- After each combatant acts, the DM resolves their action before the next combatant goes

### Damage & Healing
- Temp HP absorbs damage first
- HP can't exceed maximum
- Both the combatant record and the player's character sheet stay in sync

### Death Saves (Simplified)
When a combatant drops to 0 HP:
- Roll d20 each turn at start
- 10+ = success, <10 = failure
- Natural 20 = revive with 1 HP
- Natural 1 = two failures
- 3 successes = stable
- 3 failures = dead
- Any healing from 0 HP clears death save counters

### Ending Combat
The DM includes `[[COMBAT:END]]` when combat concludes. The engine clears the combat state.

## Turn Flow

### Exploration Mode
1. DM narrates a scene
2. Open floor — any player can act (using `>` prefix)
3. AI agents respond after human(s) act
4. Once all players have acted, DM resolves everything and narrates the outcome
5. Round clears, cycle repeats

### Combat Mode
1. Initiative is rolled, turn order established
2. Current combatant is prompted (AI automatically, human waited on)
3. DM resolves their action (dice rolled as needed)
4. Turn advances to next combatant
5. After all combatants go, round increments

### What Counts as Acting
- `> message` — in-character action (advances game state)
- `/pass` — explicitly skips turn (counts as having acted)
- Plain messages — OOC, does not advance game state
- `/roll`, `/look`, `/whisper` — utility commands, handled independently

## Character Sheets

### Parser Behavior
The markdown character sheet parser is deliberately flexible. It recognizes:
- `**Key:** Value` (bold key)
- `Key: Value` (plain key)
- `- Key: Value` (list item key)
- `## Section` headings followed by `- item` lists
- Comma-separated values as a fallback for list fields

### Auto-Calculated Fields
- **Initiative**: Derived from DEX modifier if not explicitly specified
- **Current HP**: Set to max HP on creation

### Required Fields (with defaults)
If any field is missing, it gets a sensible default (e.g., 10 for ability scores, "Unknown" for race/class, 30 for speed). The parser won't reject an incomplete sheet.

## OOC Questions (`/ask`)

Players can ask the DM out-of-character questions without affecting game state:
- `/ask How does sneak attack work?`
- `/ask What options do I have here?`
- `/ask What happened to the merchant we met earlier?`

The DM answers with full game context (party, history, narrative summary) but the question and answer are clearly marked as OOC. The response appears as a DM embed visible to everyone. No turn is consumed and the orchestrator is not triggered.

Plain messages (without `>`) are ignored by the game engine entirely — use `/ask` when you actually want the DM to answer.

## Whispers

`/whisper @player message` sends a private in-character message:
- The sender sees it as an ephemeral embed
- The recipient gets a DM with the message
- The DM AI is aware of whispers (they're recorded in history with type "whisper")
- Other players don't see the content in the channel

## Session Management

### Starting a Session
- `/new-game` creates a game in lobby status
- `/join` and `/add-agent` add players
- `/start` transitions to active and generates the opening scene

### Resuming
- If `/start` is called on a game with existing history, the DM generates a "last time on..." recap instead of a new opening
- On bot restart, games resume automatically — no special command needed. State is loaded from JSON when any player action arrives in the game's channel
- The only thing lost on restart is the in-memory round tracker (who has acted this cycle). The next player action starts a fresh round, but the DM has full history context so narration remains coherent
- Use `/recap` after a restart to get a DM summary of the story so far, or just `> action` to keep playing

### Ending
- `/end` sets status to "ended" and saves final state
- A new game can be created in the same channel after ending

## DM Notes

The DM maintains persistent notes in `data/games/<id>/dm-notes/` that survive across sessions:

- `characters/{name}.md` — things learned about characters beyond their sheet (secrets, details revealed in RP, player-specified info like pronouns or languages)
- `world.md` — NPCs created, locations described, factions, lore established during play
- `plot.md` — active plot threads, hooks planted, mysteries, planned encounters
- `rulings.md` — rules interpretations made during this campaign (for consistency)
- `session-log.md` — brief log of key events

The DM reads these notes before responding and updates them when new information is established. This ensures narrative consistency across sessions.

## Experience Points & Leveling

### How XP Works
The DM awards XP using a directive:
```
[[XP:300 TARGET:party REASON:defeated the goblins]]
```

- `TARGET:party` splits XP equally among all players (`Math.floor` per player)
- `TARGET:CharacterName` awards XP to a single character
- The engine replaces the directive with formatted text: **+75 XP each** (defeated the goblins)

### When XP Is Awarded
- After combat (total encounter XP ÷ party size)
- Milestones and significant discoveries
- Individual achievements

### Level-Up Thresholds (SRD)
| Level | XP Required |
|-------|-------------|
| 2 | 300 |
| 3 | 900 |
| 4 | 2,700 |
| 5 | 6,500 |
| 10 | 64,000 |
| 20 | 355,000 |

When a character crosses a threshold, the engine appends "**Ready to level up!**" — but leveling is **not automatic**. Leveling involves player choices (HP roll, ability scores, new features) and must be done manually.

### XP in the UI
- `/character` embed shows XP progress: `XP 300/2700 (level 3)`
- The DM's Character Reference includes XP when tracked
- Character sheet parser recognizes `**Experience Points:** N` or `**XP:** N`

## Spell Slots & Resources

### Spell Slot Tracking
Characters with spellcasting have their spell slots tracked automatically:
- **Full casters** (Bard, Cleric, Druid, Sorcerer, Wizard): slots derived from SRD tables
- **Half casters** (Paladin, Ranger): slots start at level 2, half progression
- **Warlock**: Pact Magic slots (all at same level, recharge on short rest)
- Slots can also be explicitly specified in a `## Spell Slots` section on the character sheet

The DM signals spell usage with `[[SPELL:level TARGET:casterName]]`. The engine deducts a slot and warns if none are available.

### Feature Charges
Limited-use features are auto-parsed from feature text:
- `"Second Wind (1d10+3 HP, bonus action, 1/short rest)"` → 1 charge, short rest reset
- `"Bardic Inspiration (d6, 3/long rest)"` → 3 charges, long rest reset

The DM signals feature usage with `[[USE:featureName TARGET:name]]`.

### Concentration
When a character casts a concentration spell, the DM outputs `[[CONCENTRATE:spellName TARGET:casterName]]`. The engine:
- Breaks any existing concentration automatically
- Tracks the active concentration spell
- Auto-rolls CON saves when the concentrating character takes damage (DC = max(10, damage/2))
- Breaks concentration on a failed save

### Conditions
The DM can add/remove conditions with `[[CONDITION:ADD conditionName TARGET:name]]` and `[[CONDITION:REMOVE conditionName TARGET:name]]`. Conditions are tracked on combatants.

### Saving Throw Modifiers
The DM's Character Reference now includes pre-calculated saving throw modifiers for all six abilities, with proficient saves marked with `*`. This prevents manual math errors.

### What's Shown in `/character`
- **Combat field**: AC, HP, Speed, Initiative, XP progress
- **Resources field**: Spell slots remaining, feature charges remaining

## Rest System

### Short Rest (`/rest short`)
- Resets features with "short rest" recharge (Action Surge, Second Wind, Warlock Pact Magic slots)
- Does NOT restore HP (Hit Dice healing not yet tracked)
- Cannot be used during combat

### Long Rest (`/rest long`)
- Restores HP to maximum
- Resets ALL spell slots to max
- Resets ALL feature charges (both short and long rest features)
- Cannot be used during combat

## Level-Up (`/level-up`)

When a character has enough XP to level up:
1. `/level-up` — uses fixed average HP gain (default)
2. `/level-up hp:Roll` — rolls the hit die for HP

The command:
- Increments level
- Adds HP (hit die roll or fixed average + CON modifier)
- Updates proficiency bonus if the new level changes it
- Updates spell slots for casters
- Flags Ability Score Improvement levels (4, 8, 12, 16, 19)
- Does NOT auto-add class features (check SRD or ask the DM with `/ask`)

## Death Saves

When a combatant drops to 0 HP and their combat turn arrives:
- The engine auto-rolls a d20 death save
- Natural 20: revive with 1 HP
- Natural 1: two failures
- 10+: success, <10: failure
- 3 successes: stabilized (skipped in turn order)
- 3 failures: dead (removed from combat)
- Any healing from 0 HP clears death save counters

Death saves are fully automated — the DM doesn't need to narrate them.

## What's Not Implemented (Yet)
- Hit Dice healing during short rests
- Inventory management (adding/removing items during play)
- Multi-guild support
- NPC stat blocks (enemies are narrated by the DM, not mechanically tracked)
- Map or visual positioning
