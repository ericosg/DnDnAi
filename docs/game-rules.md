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
- On bot restart, games resume automatically — state is loaded from JSON when a message arrives in the game's channel

### Ending
- `/end` sets status to "ended" and saves final state
- A new game can be created in the same channel after ending

## What's Not Implemented (Yet)
- Spell slots and spell management
- Inventory management (adding/removing items during play)
- Experience points and leveling
- Multi-guild support
- NPC stat blocks (enemies are narrated by the DM, not mechanically tracked)
- Map or visual positioning
