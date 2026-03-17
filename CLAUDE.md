# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run src/index.ts           # Start the bot
bun --watch run src/index.ts   # Start with auto-reload (dev mode)
bun test                       # Run unit tests (656 tests)
bunx tsc --noEmit              # Type-check without emitting
bunx biome check src/          # Lint and format check
bun install                    # Install dependencies
```

### Verification (run all checks)

```bash
cd bot && bun test && bunx tsc --noEmit && bunx biome check src/
```

## What This Is

DnDnAi is an AI-powered D&D 5e Discord bot. Claude AI plays the Dungeon Master while human players and AI-controlled party members interact through Discord. The bot manages the full game loop: narration, combat, dice rolling, character management, and turn-based flow.

This project was born from a set of D&D 5e learning guides in the companion repository [DnD](https://github.com/ericosg/DnD). Those guides informed the rules, character sheet format, and design philosophy baked into the bot. See `docs/design-decisions.md` for the reasoning behind every major architectural choice.

## Architecture

TypeScript + Bun runtime, discord.js for Discord, Claude CLI for AI (uses Pro/Max plan — no API key needed), gray-matter for agent personality files. JSON files for persistence (no database).

### Turn Flow (the core loop)

1. Human sends `>` prefixed message or slash command in Discord
2. `discord/client.ts` receives it, finds the game state, creates a `TurnEntry`
3. `game/engine.ts:processTurn()` records the entry, then runs `orchestratorLoop()`
4. The orchestrator (`ai/orchestrator.ts:getNextAction()`) deterministically decides: prompt an AI agent, call the DM, wait for a human, or advance combat
5. For agents: `ai/agent.ts` generates an in-character response using the personality file, posts via webhook
6. For agents: after generating, `ai/guardrail.ts` (Haiku) checks the response isn't inventing world facts. If it is, the agent re-generates with feedback.
7. For DM: `ai/dm.ts` generates narration with a 5-layer prompt, then `ai/guardrail.ts` (Haiku) checks for player agency violations before posting. If the DM narrated/controlled a PC, it re-generates with feedback. The DM also pushes back on player overreach (humans or agents declaring world facts). `game/directives.ts` processes all directives as a pure function: dice (`[[ROLL:...]]`), damage/heal (`[[DAMAGE:...]]`, `[[HEAL:...]]`), state corrections (`[[UPDATE_HP:...]]`, `[[UPDATE_CONDITION:...]]`), tabletop dice (`[[REQUEST_ROLL:...]]`), resources (`[[SPELL:...]]`, `[[USE:...]]`, `[[CONCENTRATE:...]]`), conditions (`[[CONDITION:...]]`), XP (`[[XP:...]]`), and combat signals (`[[COMBAT:START/END]]`). After combat HP/condition changes, an auto status embed is posted. The DM always narrates roll outcomes and prompts who goes next.
8. After DM resolves, the round clears and the cycle restarts
9. State auto-persists to JSON after every turn; narrative compresses every 10 turns

### AI Model Assignment

| Role | Model | Reason |
|------|-------|--------|
| DM | Opus | Narrative quality, rule adjudication |
| Agents | Sonnet | Good roleplay, cost-effective (per-agent override via frontmatter) |
| Orchestrator | Haiku | Fast flow control, mostly deterministic |
| Guardrail | Haiku | Reviews DM output for player agency violations and agent output for world-fact invention |

All AI calls are stateless — context is rebuilt from game state + sliding history window each call. The DM runs as an agentic Claude Code CLI process with read-only file access (Read, Glob, Grep tools) so it can verify character data, check full history, and consult rules docs before responding.

### Key Protocols

- **Agentic DM**: The DM runs with `--allowedTools Read,Write,Edit,Glob,Grep` so it can read character sheet JSONs, the full history, the SRD rules, and maintain its own persistent notes. The system prompt includes file paths for all game data. The DM's Character Reference section in the prompt provides a quick summary of each character's mechanical details (ability scores, features, spells, equipment, gender), while file access lets it dig deeper when needed. The DM looks up rules in the SRD rather than relying on training data, preventing hallucination of abilities or incorrect rule applications.
- **DM Notes (persistent memory)**: The DM maintains notes in `data/games/<id>/dm-notes/` — character details learned in RP (`characters/{name}.md`), world state (`world.md`), plot threads (`plot.md`), rules rulings (`rulings.md`), and a session log (`session-log.md`). The DM reads these before responding and writes to them when it learns something new. Directory is seeded with templates on `/start`.
- **DM dice directives**: DM AI outputs `[[ROLL:d20+5 FOR:Name REASON:text]]` — engine rolls real dice and injects results. AI never simulates randomness. Directives are resolved instantly before the message is posted — the DM narrates outcomes in the same response.
- **Tabletop dice (REQUEST_ROLL)**: DM outputs `[[REQUEST_ROLL:d20+5 FOR:Name REASON:text]]` for human players — the engine creates a `PendingRoll` in `GameState.pendingRolls`, shows a `/roll` prompt, and pauses until the player rolls. For AI agents, REQUEST_ROLL auto-resolves like a normal ROLL. When all pending rolls are fulfilled, the orchestrator triggers a resolution phase where the DM narrates outcomes.
- **Damage/heal directives**: DM outputs `[[DAMAGE:2d6+3 TARGET:Name REASON:text]]` or `[[HEAL:1d8+3 TARGET:Name REASON:text]]` — engine rolls dice and calls `applyDamage()`/`applyHealing()` in `combat.ts` to update combatant and character sheet HP. Results display inline with updated HP values.
- **State correction directives**: `[[UPDATE_HP:value TARGET:Name]]` sets HP to an exact value (for desync fixes, environmental damage). `[[UPDATE_CONDITION:SET cond1,cond2 TARGET:Name]]` replaces all conditions (or `SET none` to clear).
- **Combat signals**: `[[COMBAT:START]]` and `[[COMBAT:END]]` in DM output trigger the combat state machine.
- **Auto status embed**: After any DM turn in combat that changes HP or conditions, the engine auto-posts a `combatStatusEmbed` showing the updated combat state.
- **Resource reconciliation**: After spell/feature use, the engine appends a system history entry summarizing remaining spell slots and feature charges for all casters.
- **IC vs OOC**: `>` prefix = in-character (advances game state). No prefix = out-of-character (orchestrator skips). Players can use `/ask` for OOC questions to the DM. `/ask` carries in-memory history across multiple questions in the same session (FIFO buffer of 5 exchanges in `ask-history.ts`), and exchanges are recorded as system history entries so the DM sees them in future narration context. The DM is instructed to act immediately on `/ask` requests rather than making promises for later. `/ask` responses are piped through `processDirectives()` so the DM can use ROLL, DAMAGE, HEAL, UPDATE_HP, REQUEST_ROLL, etc. in answers — state is saved if any directives were processed.
- **Webhooks**: Each AI identity (agents + DM) gets a separate Discord webhook with custom name/avatar. DM narration uses rich plain text with visual separators (Discord markdown for formatting); system messages (combat status, dice, game events) use embeds. Agents use plain text.
- **Agent personality files**: `agents/*.md` with gray-matter frontmatter + markdown body. The `characterSpec` field contains a character sheet in the same markdown format human players upload. 11 pre-built agents ship in `agents/` covering all 9 non-Fighter classes plus the original Fighter (Grimbold) and a second Bard (Pumpernickle). All are levels 1-3 with unique race+class combos.
- **Player IDs**: Humans = Discord user ID. Agents = `agent:<name>`.
- **Round tracking**: In-memory `roundResponses` map in `game/engine.ts`. Cleared after DM resolves. Not persisted — on restart, `autoResume()` runs the orchestrator with an empty set, which correctly prompts pending AI agents.
- **Turn mutex**: Per-game promise chain in `game/engine.ts` serializes concurrent `processTurn` calls. Prevents duplicate agent/DM responses when multiple humans act simultaneously.
- **Directive processing**: All directive parsing and application is extracted into `game/directives.ts` as a pure function `processDirectives()`. This takes DM response text and game state, processes all directives (ROLL, DAMAGE, HEAL, UPDATE_HP, UPDATE_CONDITION, REQUEST_ROLL, SPELL, USE, CONCENTRATE, CONDITION, XP, COMBAT signals), mutates game state, and returns a `DirectiveContext` with the processed text and metadata. This enables testing directives independently from the engine's I/O concerns.

### Typing Indicators

While AI agents and the DM are generating responses, the bot shows the native Discord "is typing..." indicator on the channel. `startTyping()` in `discord/webhooks.ts` sends the typing signal immediately and refreshes it every 8 seconds (Discord's typing indicator expires after ~10s). Returns a stop function that clears the refresh interval. Fail-safe: if `sendTyping()` fails, it's silently ignored.

### Logging

Structured logger (`src/logger.ts`) with configurable verbosity via `LOG_LEVEL` env var (`error`, `warn`, `info`, `debug`). Defaults to `info`. At `debug` level, logs include orchestrator iteration details and responded-player sets. At `info`, logs show the full turn lifecycle: turn received → orchestrator decisions → agent/DM Claude calls → responses posted → round cleared.

### Narrative Style

Configurable via `NARRATIVE_STYLE` env var (`concise`, `standard`, `elaborate`). Defaults to `concise`. Style instructions are injected into both DM and agent system prompts via `STYLE_INSTRUCTIONS` in `config.ts`. Concise mode keeps DM narration to 2-4 sentences and agent responses to 1-3 sentences. Elaborate mode allows rich atmospheric detail.

### Resumability

The bot is fully resumable across restarts. All game state persists to JSON; AI calls are stateless. On startup, `autoResume()` in `discord/client.ts` scans for active games, posts a startup greeting embed in each game's channel, and runs the orchestrator loop via `resumeOrchestrator()` in `game/engine.ts` to prompt any pending AI agent turns. This prevents deadlocks where AI agents would never act after a restart mid-combat. No `/start` command is needed to resume — the bot auto-detects and continues.

### Persistence

All runtime data in `data/games/<uuid>/` (gitignored):
- `state.json` — core game state (players, combat, narrative summary)
- `history.json` — append-only turn log
- `characters/*.json` — parsed character sheets
- `dm-notes/` — DM's persistent memory (world state, character notes, plot threads, rulings, session log)

Game lookup scans all game directories for matching channel ID.

### Character Sheet Parser

`game/characters.ts` parses markdown character sheets flexibly — handles `**Key:** Value`, `Key: Value`, `- Key: Value`, heading-based sections, and comma-separated fallback for lists. Missing fields get sensible defaults (10 for ability scores, etc.). The same parser handles human uploads and agent `characterSpec` fields.

**Canonical format rules:**
- `**Key:** Value` for all scalar fields (Name, Race, Class, Level, ability scores, AC, HP, etc.)
- `## Heading` + flat bullet lists for all list sections (Skills, Equipment, Features, Spells, Saving Throws)
- **Never `###` subheadings inside a parsed section** — the parser's `extractList()` exits a `##` section when it hits any heading (including `###`), silently losing items after it
- Spells in a separate `## Spells` section (not inside Features), one spell per bullet, level noted inline: `- Fire Bolt (cantrip)`, `- Shield (1st level)`
- Non-casters omit `## Spells`
- Saving throws as `## Saving Throws` + bullets (not comma-separated inline)
- Backstory with personality traits as `**Key:** Value` at the end

### Testing

656 tests across 21 files. Agent tests (`ai/agent.test.ts`) load every agent file from disk, verify frontmatter fields, and run each `characterSpec` through `parseCharacterSheet()` to validate stats, ability scores, equipment, features, and spells parse correctly. Caster agents are verified to have spells in a separate `## Spells` section (not embedded in Features). Tests also verify all agents have unique names and unique race+class combinations. Formatter tests cover the `/character` embed builder (section filtering, ability modifiers, edge cases) and DM narration formatting. DM prompt tests (`ai/dm.test.ts`) verify prompt construction: party info, character reference (ability scores, features, spells, gender), file paths (SRD, dm-notes), combat state, history formatting, `/ask` verification instructions, and DM allowed tools. Other test files cover dice, combat, character parsing, orchestrator, engine, guardrails, webhooks, and Claude subprocess.

Note on Bun test isolation: `mock.module()` is global and pollutes across files. Tests that need mocked modules use pure-function extraction patterns (e.g., `guardrail-check.ts`, `claude-subprocess.ts`, `dm-prompt.ts`) or direct file I/O to avoid cross-file mock collisions.

## Documentation

- `docs/architecture.md` — system diagram, module responsibilities, data flow, context management
- `docs/design-decisions.md` — why each major choice was made
- `docs/creating-characters.md` — how to create a character sheet for human players (format, AI generation tips, sample)
- `docs/creating-agents.md` — how to write agent personality files
- `docs/game-rules.md` — D&D 5e rules as implemented, deviations, dice system, combat
- `docs/srd/` — D&D 5e SRD 5.1 (CC-BY-4.0) in markdown — the DM reads these files to look up rules, class features, spells, and monster stats instead of guessing from training data. See `docs/srd/README.md` for the index.

## Origin & Context

The companion repository [ericosg/DnD](https://github.com/ericosg/DnD) contains the D&D learning guides that preceded this project:
- Numbered tutorial guides (`00–07`) covering D&D fundamentals through play-ready reference
- Example character build (Fūsetsu, Variant Human Rogue/Assassin) — the character sheet markdown format used there is the format this bot's parser expects from `/join` uploads
- Reference files for backgrounds, equipment, feats, and skills that can serve as AI context for character generation
- A prompt template for AI-assisted character creation
