# Architecture

## System Overview

DnDnAi is a turn-based game engine that bridges Discord (player interface) with Claude AI (game master + NPC intelligence). The system is designed around stateless AI calls, honest dice, and JSON persistence.

```
Discord Channel
    │
    ├── Human: "> I attack the goblin"
    ├── Human: /roll 2d6+3
    ├── Human: /look chest
    │
    ▼
┌──────────────────┐
│  Discord Client  │  Receives messages + slash commands
│  (client.ts)     │  Detects IC (> prefix) vs OOC
└───────┬──────────┘
        │ Creates TurnEntry
        ▼
┌──────────────────┐
│  Game Engine     │  processTurn() → orchestratorLoop()
│  (engine.ts)     │  Drives the AI response cycle
└───────┬──────────┘
        │ Asks: "What happens next?"
        ▼
┌──────────────────┐
│  Orchestrator    │  Deterministic flow control
│  (orchestrator)  │  prompt_agent / prompt_dm / wait_for_human
└───────┬──────────┘
        │
   ┌────┴────┐
   ▼         ▼
┌────────┐ ┌────────┐
│ Agent  │ │   DM   │  Claude CLI calls (stateless)
│(Sonnet)│ │(Opus)  │  Context rebuilt each call
└───┬────┘ └───┬────┘
    │          │ Contains [[ROLL:...]] directives
    │          ▼
    │   ┌──────────┐
    │   │  Dice    │  Real random rolls
    │   │ Engine   │  Results injected back into narration
    │   └──────────┘
    │          │
    ▼          ▼
┌──────────────────┐
│    Webhooks      │  Each identity gets its own Discord persona
│  (webhooks.ts)   │  DM → purple embeds, Agents → plain text
└──────────────────┘
        │
        ▼
    Discord Channel (responses appear)
```

## Module Responsibilities

### Discord Layer (`src/discord/`)

**client.ts** — The entry point for all user interaction. Listens for slash commands and `>` prefixed messages. Routes to the appropriate handler. Creates `TurnEntry` objects and feeds them into the game engine.

**commands.ts** — Slash command definitions (metadata only, no logic). Registered to a single guild on bot startup.

**webhooks.ts** — Creates and caches Discord webhooks per channel+name pair. Each AI character and the DM get their own webhook so they appear as distinct users in Discord. Handles message splitting for the 2000-character Discord limit.

**formatter.ts** — Builds Discord embeds. Visual identity system:
- DM narration: purple sidebar embeds (auto-split across multiple embeds if >4096 chars)
- System messages: gray embeds
- Combat status: red embeds with initiative markers
- Party status: blue embeds
- Inventory: gold embeds
- Whispers: green embeds

### Game Engine (`src/game/`)

**engine.ts** — The orchestration loop. After a human acts:
1. Record the turn entry
2. Ask the orchestrator who should go next
3. If agent → generate their response, post it, record it, loop back to step 2
4. If DM → generate narration, process dice directives, post it, clear the round
5. If human → stop and wait

The loop is bounded at `players.length + 2` iterations to prevent runaway cycles.

Round tracking is in-memory only (not persisted). It tracks which players have responded this cycle and clears after the DM resolves.

**dice.ts** — Parses dice notation (`2d6+3`, `d20`, `4d6kh3`), rolls real random dice, formats results. Also parses DM dice directives (`[[ROLL:d20+5 FOR:Name REASON:text]]`) from AI output.

**characters.ts** — Flexible markdown-to-JSON parser for character sheets. Handles multiple formatting conventions (bold keys, headings, list items, comma-separated values). Also builds character sheets for AI agents from their personality files + AI-generated backstories.

**combat.ts** — State machine for D&D 5e combat. Handles initiative rolls and ordering, turn advancement (skipping dead/incapacitated), damage/healing with temp HP, death saves (including nat 1/20 special cases), and combat end detection.

### AI Layer (`src/ai/`)

**claude.ts** — AI abstraction layer. All AI calls flow through `chat(model, system, messages)`. Uses the Claude CLI in non-interactive mode (`claude -p`), routing through the user's Pro/Max plan instead of requiring API credits. Retries on failure with exponential backoff (up to 3 attempts). Subprocess safety (env var overrides, permission flags) is handled by helpers in `claude-subprocess.ts`.

**orchestrator.ts** — Decides who acts next. Mostly deterministic (no AI call needed in most cases):
- Exploration: agents first (in order), then wait for humans, then DM resolves
- Combat: follows initiative order strictly
- OOC messages: skip (no game state change)

Has an AI-powered `classifyMessage()` fallback for ambiguous IC/OOC detection, but the primary path uses the `>` prefix convention.

**dm.ts** — Builds the DM's prompt using a 5-layer system:

| Layer | Content | Update Frequency |
|-------|---------|-----------------|
| 1. Identity | DM role, rules, formatting instructions, dice directive format | Static |
| 2. Party | Character names, races, classes, HP, AC, human/AI tags | Per-call |
| 3. Narrative | Compressed story summary | Every 10 turns |
| 4. Combat | Round, initiative order, HP, conditions | Per-call (combat only) |
| 5. History | Sliding window of last 8 turns | Per-call |

The current player actions go in the user message, not the system prompt.

Separate functions for different DM tasks: `dmNarrate()` (main resolution), `dmRecap()` (story summary), `dmLook()` (environment description), `dmAsk()` (OOC player questions), `compressNarrative()` (periodic summarization).

**guardrail.ts** / **guardrail-check.ts** — Player agency enforcement. After every DM response, Haiku reviews the narration against a list of player character names, checking if the DM narrated/controlled any PC's actions, speech, thoughts, or attempts. If a violation is detected, the DM re-generates with explicit feedback. Pure helper functions (prompt building, response parsing) are in `guardrail-check.ts` for testability. The guardrail is fail-safe — if it errors or returns unparseable output, the response is allowed through.

**agent.ts** — Loads personality from `agents/*.md` via gray-matter. Builds a system prompt from the personality data (name, race, class, voice, traits, flaws, goals, full markdown body). Generates in-character actions given game state and recent history. Also generates AI backstories for new agents joining the party.

### State Layer (`src/state/`)

**types.ts** — All TypeScript interfaces. The key ones:
- `GameState` — top-level game snapshot (players, combat, narrative summary, status)
- `Player` — links a Discord user ID or `agent:<name>` to a `CharacterSheet`
- `CharacterSheet` — full D&D 5e character data
- `TurnEntry` — single history log entry with type discrimination (ic, ooc, dm-narration, roll, whisper)
- `CombatState` / `Combatant` — combat tracking with initiative, conditions, death saves
- `AgentPersonality` — parsed agent personality file
- `OrchestratorDecision` — what the orchestrator decided (action + target + reason)

### Logging (`src/logger.ts`)

Structured logger with configurable verbosity via `LOG_LEVEL` env var. Levels: `error` (0), `warn` (1), `info` (2), `debug` (3). Defaults to `info`.

At `info` level, logs show the full turn lifecycle: turn received → orchestrator decisions → agent/DM Claude calls (with char counts) → dice directives processed → responses posted → round cleared. At `debug` level, additionally shows orchestrator iteration details and responded-player sets per iteration.

### State Layer (`src/state/`)

**store.ts** — JSON file I/O. All data lives under `data/games/<uuid>/`:
- `state.json` — core game state
- `history.json` — append-only turn log
- `characters/<name>.json` — parsed character sheets

Game lookup is by scanning all game directories for a matching channel ID.

## AI Communication Protocol

### Dice Directives
The DM AI never rolls dice itself. Instead, it outputs structured directives in its narration:

```
[[ROLL:d20+5 FOR:Grimbold REASON:Athletics check to climb the wall]]
```

The engine:
1. Parses these directives from the DM's response
2. Rolls real random dice
3. Replaces the directive text with formatted results
4. Posts the modified narration to Discord

### Combat Signals
The DM signals combat transitions with:
- `[[COMBAT:START]]` — engine rolls initiative for all players, creates combat state
- `[[COMBAT:END]]` — engine clears combat state

### Agent Pacing
AI agents wait 2.5 seconds before posting to feel more natural in Discord. This delay is configurable via `AGENT_DELAY_MS` in config.

## Persistence Model

```
data/games/
└── <uuid>/
    ├── state.json         # GameState — players, combat, narrative summary
    ├── history.json       # TurnEntry[] — append-only, complete game log
    └── characters/
        ├── grimbold.json  # Parsed CharacterSheet
        └── fusetsu.json
```

- State saves after every turn (crash-safe)
- History is append-only (never trimmed, only the sliding window is sent to AI)
- Narrative summary compresses every 10 turns to manage context growth
- All game data is gitignored
- On restart, the bot resumes any game automatically — the next player action loads state from disk
- The only thing lost on restart is the in-memory round tracker; the next action starts a fresh round with full history context

## Context Management Strategy

AI calls are stateless — no conversation memory. Context is rebuilt each call from:

1. **System prompt** — static identity + dynamic game state
2. **Sliding window** — last 8 turns of history (configurable via `HISTORY_WINDOW`)
3. **Narrative summary** — compressed story updated every 10 turns
4. **Current actions** — what the AI needs to resolve right now

This means the AI "forgets" old details but maintains narrative continuity through the compressed summary. The full history is always available in `history.json` for debugging or future features.
