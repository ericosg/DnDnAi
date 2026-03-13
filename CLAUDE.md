# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run src/index.ts           # Start the bot
bun --watch run src/index.ts   # Start with auto-reload (dev mode)
bun test                       # Run unit tests
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
6. For DM: `ai/dm.ts` generates narration with a 5-layer prompt, engine processes dice directives (`[[ROLL:...]]`) and combat signals (`[[COMBAT:START/END]]`)
7. After DM resolves, the round clears and the cycle restarts
8. State auto-persists to JSON after every turn; narrative compresses every 10 turns

### AI Model Assignment

| Role | Model | Reason |
|------|-------|--------|
| DM | Opus | Narrative quality, rule adjudication |
| Agents | Sonnet | Good roleplay, cost-effective (per-agent override via frontmatter) |
| Orchestrator | Haiku | Fast flow control, mostly deterministic |

All AI calls are stateless — context is rebuilt from game state + sliding history window each call.

### Key Protocols

- **DM dice directives**: DM AI outputs `[[ROLL:d20+5 FOR:Name REASON:text]]` — engine rolls real dice and injects results. AI never simulates randomness. Directives are resolved instantly before the message is posted — the DM narrates outcomes in the same response.
- **Combat signals**: `[[COMBAT:START]]` and `[[COMBAT:END]]` in DM output trigger the combat state machine.
- **IC vs OOC**: `>` prefix = in-character (advances game state). No prefix = out-of-character (orchestrator skips). Players can use `/ask` for OOC questions to the DM.
- **Webhooks**: Each AI identity (agents + DM) gets a separate Discord webhook with custom name/avatar. DM uses purple embeds (auto-split if >4096 chars); agents use plain text.
- **Agent personality files**: `agents/*.md` with gray-matter frontmatter + markdown body. The `characterSpec` field contains a character sheet in the same markdown format human players upload.
- **Player IDs**: Humans = Discord user ID. Agents = `agent:<name>`.
- **Round tracking**: In-memory `roundResponses` map in `game/engine.ts`. Cleared after DM resolves. Not persisted.

### Logging

Structured logger (`src/logger.ts`) with configurable verbosity via `LOG_LEVEL` env var (`error`, `warn`, `info`, `debug`). Defaults to `info`. At `debug` level, logs include orchestrator iteration details and responded-player sets. At `info`, logs show the full turn lifecycle: turn received → orchestrator decisions → agent/DM Claude calls → responses posted → round cleared.

### Resumability

The bot is fully resumable across restarts. All game state persists to JSON; AI calls are stateless. On restart, the bot reconnects to Discord and responds to the next player action by loading state from disk. The only thing lost is the in-memory round tracker — the next player action starts a fresh round, but the DM still has full history context. No special resume command is needed; just keep playing.

### Persistence

All runtime data in `data/games/<uuid>/` (gitignored):
- `state.json` — core game state (players, combat, narrative summary)
- `history.json` — append-only turn log
- `characters/*.json` — parsed character sheets

Game lookup scans all game directories for matching channel ID.

### Character Sheet Parser

`game/characters.ts` parses markdown character sheets flexibly — handles `**Key:** Value`, `Key: Value`, `- Key: Value`, heading-based sections, and comma-separated fallback for lists. Missing fields get sensible defaults (10 for ability scores, etc.). The same parser handles human uploads and agent `characterSpec` fields.

## Documentation

- `docs/architecture.md` — system diagram, module responsibilities, data flow, context management
- `docs/design-decisions.md` — why each major choice was made
- `docs/creating-characters.md` — how to create a character sheet for human players (format, AI generation tips, sample)
- `docs/creating-agents.md` — how to write agent personality files
- `docs/game-rules.md` — D&D 5e rules as implemented, deviations, dice system, combat

## Origin & Context

The companion repository [ericosg/DnD](https://github.com/ericosg/DnD) contains the D&D learning guides that preceded this project:
- Numbered tutorial guides (`00–07`) covering D&D fundamentals through play-ready reference
- Example character build (Fūsetsu, Variant Human Rogue/Assassin) — the character sheet markdown format used there is the format this bot's parser expects from `/join` uploads
- Reference files for backgrounds, equipment, feats, and skills that can serve as AI context for character generation
- A prompt template for AI-assisted character creation
