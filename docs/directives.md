# Directive Reference

Complete reference for all game engine directives. The DM includes these in narration text and the engine processes them instantly before the message is posted to Discord.

## How Directives Work

1. The DM includes a directive in double brackets: `[[DIRECTIVE:params]]`
2. The engine parses and executes it (rolls dice, updates HP, etc.)
3. The directive text is replaced with formatted results in the posted message
4. Players see the result inline — they never see the raw directive syntax

All directives are resolved **before** the message appears in Discord. The DM should narrate as if the result is already known.

## Directive Formats

### ROLL — Ability checks, saving throws, attack rolls

```
[[ROLL:d20+5 FOR:CharacterName REASON:Athletics check to climb the wall]]
```

- Used for: NPC/enemy rolls, AI agent rolls, any roll the engine resolves instantly
- The engine rolls real dice and replaces the directive with formatted results
- **ROLL never changes HP** — it only determines pass/fail or hit/miss
- Result appears as: `**Athletics check to climb the wall**: 🎲 d20+5 → [14]+5 = **19**`

### REQUEST_ROLL — Ask a human player to roll

```
[[REQUEST_ROLL:d20+5 FOR:CharacterName REASON:Athletics check to climb the wall]]
```

- Used for: human player ability checks, saving throws, attack rolls
- Creates a `PendingRoll` — the engine pauses and prompts the player to `/roll`
- For AI agents, auto-resolves like a normal ROLL
- Result appears as: `🎲 **CharacterName**, roll `d20+5` for **Athletics check**! Use `/roll d20+5` to roll.`
- Once all pending rolls are fulfilled, the orchestrator triggers a DM resolution phase

### DAMAGE — Any time a character loses HP

```
[[DAMAGE:2d6+3 TARGET:CharacterName REASON:longsword hit]]
```

- Engine rolls the damage dice and applies to the target's HP
- Temp HP absorbs damage first, then current HP
- Works both in and outside combat
- Result appears as: `🎲 2d6+3 → [4,2]+3 = **9** → **9 damage** to CharacterName (HP: 15/24)`

### HEAL — Any time a character gains HP

```
[[HEAL:1d8+3 TARGET:CharacterName REASON:cure wounds]]
```

- Engine rolls healing dice and applies to the target's HP (capped at max HP)
- Works both in and outside combat
- Result appears as: `🎲 1d8+3 → [6]+3 = **9** → **9 healed** on CharacterName (HP: 24/24)`

### UPDATE_HP — Set HP to an exact value

```
[[UPDATE_HP:15 TARGET:CharacterName]]
```

- Sets HP directly — for desync fixes, environmental damage, or fixed-value changes
- Result appears as: `*[CharacterName HP set to 15/24]*`

### SPELL — Track spell slot usage

```
[[SPELL:1 TARGET:CasterName]]
```

- Deducts a spell slot of the given level from the caster
- If no slot available, posts a warning: `*[CasterName has no level 1 spell slots remaining!]*`
- The directive itself is removed from the text (no visible output unless warning)

### USE — Track limited feature usage

```
[[USE:Second Wind TARGET:CharacterName]]
```

- Deducts a charge of the named feature
- If no charges available, posts a warning: `*[CharacterName has no Second Wind charges remaining!]*`
- The directive itself is removed from the text (no visible output unless warning)

### CONCENTRATE — Track concentration spells

```
[[CONCENTRATE:Bless TARGET:CasterName]]
```

- If already concentrating on another spell, breaks the old concentration and notes it
- Tracks the new concentration spell on the combatant
- The engine auto-rolls CON saves when the concentrating character takes damage (DC = max(10, damage/2))

### CONDITION — Add or remove conditions

```
[[CONDITION:ADD Poisoned TARGET:CharacterName]]
[[CONDITION:REMOVE Poisoned TARGET:CharacterName]]
```

- Adds or removes a single condition from a combatant
- Conditions affect subsequent rolls (advantage/disadvantage noted inline)
- The directive is removed from the text

### UPDATE_CONDITION — Replace all conditions

```
[[UPDATE_CONDITION:SET Poisoned,Frightened TARGET:CharacterName]]
[[UPDATE_CONDITION:SET none TARGET:CharacterName]]
```

- Replaces the full condition list (not additive)
- `SET none` clears all conditions
- The directive is removed from the text

### XP — Award experience points

```
[[XP:300 TARGET:party REASON:defeated the goblins]]
[[XP:50 TARGET:CharacterName REASON:clever use of disguise]]
```

- `TARGET:party` splits XP equally among all players (floor division)
- `TARGET:CharacterName` awards to one character
- If the XP crosses a level threshold, appends "ready to level up!"
- Result appears as: `**+75 XP each** (defeated the goblins)`

### INVENTORY — Track item changes

```
[[INVENTORY:ADD Potion of Healing TARGET:CharacterName]]
[[INVENTORY:REMOVE Potion of Healing TARGET:CharacterName]]
```

- ADD appends the item to the character's equipment list
- REMOVE finds and removes the item (case-insensitive match)
- For transfers between characters: REMOVE from giver + ADD to receiver
- Use the exact item name as it appears in the character's equipment when removing
- The directive is removed from the text

### GOLD — Track gold changes

```
[[GOLD:+50 TARGET:CharacterName REASON:sold the gems]]
[[GOLD:-10 TARGET:CharacterName REASON:bought rations]]
[[GOLD:+100 TARGET:party REASON:quest reward]]
```

- `TARGET:party` splits evenly among all players
- Gold cannot go below 0 (warns if insufficient)
- Result appears as: `**+50 gp** to CharacterName (sold the gems)`

### REST — Trigger rest mechanics

```
[[REST:long TARGET:party]]
[[REST:short TARGET:party]]
```

- **Long rest**: restores HP to max, resets ALL spell slots and feature charges
- **Short rest**: resets features with "short rest" recharge (Action Surge, Second Wind, Warlock Pact Magic slots)
- Narration alone does NOT reset resources — this directive is required
- Result appears as: `*[Long Rest: Grimbold HP restored; Nyx spell slots restored; ...]*`

### ACTIVATE — Introduce a dormant agent

```
[[ACTIVATE:AgentName]]
```

- Activates a dormant agent (loaded via `/add-agent name dormant:true`)
- The agent begins receiving turn prompts starting next round
- Result appears as: `*AgentName joins the party!*`
- Use when the story naturally calls for the character's introduction
- **Side effect:** creates the agent's starter memory file at `agent-notes/<slug>.md` if it doesn't already exist

## Agent Action Directives

AI agents (not humans) can emit a small set of directives in their own responses. These mirror the slash commands human players use and are parsed/executed after the agent's response is generated but before it's posted to Discord.

### PASS — Skip a turn

```
[[PASS]]
```

- Agent skips its turn (equivalent to human `/pass`)
- If the agent's IC text is empty after the directive is stripped, the engine posts `*CharacterName holds their action and observes.*` on their behalf
- Can be combined with brief IC flavor, e.g., `*Grimbold watches the door.* [[PASS]]`

### ASK — OOC question to the DM (agent equivalent of `/ask`)

```
[[ASK:what does a clockwork puzzle look like in 5e?]]
```

- Calls `dmAsk()`, posts the DM's answer publicly as OOC, records both in history
- Can appear alongside an IC action in the same response — the engine posts the IC text first, then the Q&A
- Multi-line questions are supported

### LOOK — Ask the DM for environmental detail (agent equivalent of `/look`)

```
[[LOOK:the stone altar]]
[[LOOK]]
```

- With a target: DM describes that specific thing. Without: general environment
- Calls `dmLook()`, posts description as DM narration, records in history

### WHISPER — Private IC message to one party member (agent equivalent of `/whisper`)

```
[[WHISPER:Fusetsu TEXT:I think the lock is trapped — don't touch it yet.]]
```

- Target must be another PC (human or agent) — by character-sheet name, case-insensitive
- If the target is a human, the bot DMs them the whisper
- If the target is an agent, the whisper lands in history and the target sees it on their next turn
- Sending to yourself, an unknown name, or with an empty message → dropped silently with a warning

Agents cannot use DM-only directives (ROLL, DAMAGE, HEAL, XP, INVENTORY, REST, COMBAT, ACTIVATE, REMEMBER, etc.). Only the DM authors those.

### REMEMBER — Append to an AI agent's persistent memory

```
[[REMEMBER:AgentName TEXT:first-person bullet describing what the agent should remember]]
```

- Appends a bullet under `## What I Remember` in `data/games/<id>/agent-notes/<slug>.md`
- Only targets AI agents (humans don't have memory files) — the directive is silently dropped for unknown or human targets
- Write the TEXT in FIRST PERSON, from the agent's voice (e.g. `TEXT:I took a blow for Fusetsu and he nodded at me.`)
- Use this for:
  - **Correcting mechanics** the agent keeps getting wrong (`[[REMEMBER:Nyx Namfoodle TEXT:I do NOT have the Light cantrip. I tried once and embarrassed myself.]]`)
  - **Pushing key beats** the agent should not forget across sessions (`[[REMEMBER:Grimbold Ironforge TEXT:Fusetsu entrusted me with his twin shortswords for the forging. I treated them with reverence.]]`)
  - **Relationships** cemented in play
- The directive is invisible in the posted narration (replaced with empty string)
- Agents see their memory file on every turn — use this directive when the compressor-style self-updates from the agent itself aren't enough

### COMBAT — Start or end combat

```
[[COMBAT:START]]
[[COMBAT:END]]
```

- **START**: Engine rolls initiative for all active (non-dormant) players, sorts by initiative (DEX breaks ties), enters combat mode
- **END**: Clears combat state, exits combat mode
- START result appends the initiative order to the message

## How Results Appear in History

After directive processing, `history.json` entries contain the **processed text** (directives replaced with results). When searching history for past rolls or events:

- Roll results look like: `**Athletics check**: 🎲 d20+5 → [14]+5 = **19**`
- Damage results look like: `🎲 2d6+3 → [4,2]+3 = **9** → **9 damage** to Name (HP: 15/24)`
- Healing results look like: `🎲 1d8+3 → [6]+3 = **9** → **9 healed** on Name (HP: 24/24)`
- XP results look like: `**+75 XP each** (reason)`
- Gold results look like: `**+50 gp** to Name (reason)`
- Combat start appends: `**Initiative Order:**` followed by each combatant's roll

To find a specific character's past rolls, search history for their name near `🎲` or `→`.
