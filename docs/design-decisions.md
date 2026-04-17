# Design Decisions

This document explains the "why" behind key architectural and gameplay choices in DnDnAi.

## Why AI Instead of a Human DM?

The original problem: getting a D&D group together is hard. Finding a DM is harder. This project asks: what if the DM was always available, infinitely patient, and could run a session for any number of players at any time?

The bot isn't trying to replace a skilled human DM. It's trying to make D&D accessible to people who can't find one — or who want to play asynchronously in Discord at their own pace.

## Why Discord?

- Players are already there
- Webhooks let AI characters appear as distinct users
- Slash commands provide a clean game interface
- Channels naturally scope one game per channel
- Asynchronous by nature — no one has to be online at the same time
- Rich embeds for DM narration, combat status, etc.

## Why Three AI Models?

Each AI role has different requirements:

| Role | Model | Effort | Why |
|------|-------|--------|-----|
| Dungeon Master | Opus | default (high on guardrail retry) | Needs the best narrative quality, rule knowledge, and judgment. The DM is the bottleneck for game quality. |
| AI Agents | Sonnet | low (medium on guardrail retry) | Good roleplay and personality consistency, but doesn't need DM-level reasoning. Cost-effective for multiple agents. |
| Orchestrator | Haiku | default | Flow control is largely deterministic. The AI fallback (IC/OOC classification) is a simple binary decision. Fast and cheap. |
| Guardrail | Haiku | default | Fast safety checks — player agency and world-fact enforcement don't need reduced effort. |

Agents can override their model via the `model` field in their personality frontmatter — a complex character might use Opus, a simple one might use Haiku.

Effort levels are passed via `--effort` to the Claude CLI. Agents run at `low` effort for speed/cost savings, but escalate to `medium` when re-generating after a guardrail failure — the extra reasoning helps avoid repeating the same violation. The DM runs at default effort normally, but escalates to `high` on guardrail retry for the same reason. Haiku calls (orchestrator, guardrails, narrative compression) stay at default effort since they're already fast and their tasks are simple enough that reducing effort risks degrading reliability.

## Why Honest Dice?

The DM AI never generates random numbers. Instead:

1. DM writes `[[ROLL:d20+5 FOR:Grimbold REASON:attack roll]]` in its narration
2. The engine parses this, rolls real `Math.random()` dice
3. Results are injected back into the narration before posting

For tabletop feel, the DM can also write `[[REQUEST_ROLL:d20+5 FOR:Grimbold REASON:attack roll]]` to ask a human player to roll. The engine creates a pending roll, shows a `/roll` prompt, and waits for the player. This separates the roll request from execution — the player drives when their dice are rolled, like at a physical table. AI agents auto-resolve REQUEST_ROLL (they don't need the tabletop experience).

This matters because:
- AI language models are bad at randomness
- Players trust real dice — perceived fairness is critical
- Dice results drive mechanical outcomes (HP, damage, saves) that must be consistent
- The DM can request any valid dice notation without needing to understand the roller
- REQUEST_ROLL makes dice feel shared and interactive, not something the engine does behind the scenes

## Why Stateless AI Calls?

Every AI call (DM, agent, orchestrator) is a fresh API call with no conversation history. Context is rebuilt from game state + sliding history window.

**Pros:**
- No accumulated token cost from growing conversations
- Crash-safe — restart the bot and nothing is lost
- Easy to debug — you can see exactly what context the AI received
- Multiple games can run simultaneously without interference
- No conversation ID management

**Cons:**
- AI can "forget" details from early in the campaign
- Narrative compression is lossy

The narrative compression system (every 6 turns, Sonnet summarizes recent events) mitigates the memory loss. The full history is always saved to disk for potential future retrieval-augmented approaches.

## Why Persistent Per-Agent Memory?

Stateless calls apply to the DM and orchestrator cleanly — the DM has the full `dm-notes/` directory to compensate. Agents originally had nothing equivalent, so after a dozen turns they genuinely forgot who they are, what they carry, and what they've done. Over a multi-session campaign the drift was severe: Nyx kept trying to cast a cantrip she doesn't have; Grimbold lost track of gifts he had been given.

The fix is `data/games/<id>/agent-notes/<slug>.md` — a first-person memory file per AI agent, auto-seeded when they join (or retrofit-seeded from full history + DM's character notes on `/resume` of an in-flight game). Each agent runs agentically with Read+Edit tools scoped to its own memory file and updates it after meaningful events. The DM can also force-commit entries mid-turn via `[[REMEMBER:Name TEXT:...]]` for corrections or key beats.

This preserves the stateless call model — the memory is rebuilt from disk each turn, not retained in a conversation — while giving agents durable continuity across sessions.

## Why Agent Player-Parity?

Human players have `/pass`, `/ask`, `/look`, `/whisper`, `/character`, `/inventory`, `/status`, `/recap`. Agents originally had none of these — they could only produce IC narration. This was functionally sub-par: an AI agent couldn't pass cleanly, couldn't ask the DM a rules question, couldn't whisper a tactical idea to a party member, and never knew their own inventory beyond what the prompt happened to include.

The resolution uses two mechanisms:
- **Directives for active commands**: `[[PASS]]`, `[[ASK:q]]`, `[[LOOK:target]]`, `[[WHISPER:Name TEXT:msg]]`. The agent emits these inline; the engine strips them and executes the side effects (call `dmAsk`, post answer, DM whisper targets, etc.).
- **Prompt enrichment for passive queries**: `/character`, `/inventory`, `/status`, `/recap` don't need directives — the agent's turn prompt includes its own full character sheet, party HP/conditions, narrative summary, and scene state on every call.

Agents stay restricted from DM-only directives (HP, XP, rest, combat signals, REMEMBER, ACTIVATE). The same trust model as the DM applies to agents, but with an explicit "Information Boundaries" block forbidding reads of `src/`, `docs/`, `dm-notes/`, and other characters' files.

## Why JSON Files Instead of a Database?

- Human-readable — you can open `state.json` and see exactly what the game state is
- No setup — no database server, no migrations, no connection strings
- Debuggable — copy a game directory, modify state, test
- Git-friendly structure (even though game data is gitignored)
- Sufficient for the scale (one bot, handful of concurrent games)

The store module abstracts I/O, so swapping to SQLite or a database later is straightforward.

## Why the `>` Prefix for In-Character?

Discord doesn't have a native IC/OOC distinction. Options considered:

1. **Separate channels** — too much friction, splits conversation
2. **AI classification** — slow (API call per message), error-prone, expensive
3. **Prefix convention** — simple, zero latency, player-controlled

The `>` prefix was chosen because Discord already renders it as a quote block, giving visual distinction. Players quickly learn the convention: `>` for actions/speech, plain text for table talk.

The AI classifier exists as a fallback (`orchestrator.ts:classifyMessage()`) but isn't used in the primary path.

## Why Webhooks for AI Identities?

Discord webhooks let you post messages with any username and avatar. This means:
- The DM appears as "Dungeon Master" with a distinct identity
- Each AI agent appears with their character name and avatar
- Players see a conversation between distinct characters, not a bot talking to itself

Without webhooks, all bot messages would come from the same bot user, making conversations confusing.

## Why the Orchestrator Pattern?

Without an orchestrator, you'd need complex conditional logic scattered across handlers: "if agent hasn't responded, prompt them; if all responded, call DM; if combat, follow initiative; if human AFK, wait..."

The orchestrator centralizes this into a single decision function (`getNextAction()`) that returns one of five actions. The engine loop just executes whatever the orchestrator says.

In practice, the orchestrator is almost entirely deterministic (no AI call needed). The AI-powered classification is a fallback for edge cases.

## Why Auto-Save After Every Turn?

- **Crash recovery** — the bot can restart and resume any game
- **Debugging** — inspect state at any point
- **Session flexibility** — players can `/end` and `/start` later, or just walk away and come back

The cost is minimal (small JSON writes) and the benefit is never losing game progress.

## Why Narrative Compression?

AI context windows are finite. Without compression:
- After 50 turns, the history would be tens of thousands of tokens
- Token cost per call would grow linearly
- Eventually you'd hit the context limit

Every 6 turns, Sonnet summarizes recent events into 2-4 paragraphs. This compressed narrative replaces the full history in the DM's context. The sliding window (last 8 turns) provides recent detail, and the summary provides long-term continuity.

## Why Agent Personality Files as Markdown?

Markdown with YAML frontmatter (parsed by gray-matter) was chosen because:
- **Human-writable** — anyone can create an agent with a text editor
- **Expressive** — the markdown body supports rich personality descriptions, combat notes, roleplay guidelines
- **Structured** — frontmatter provides typed fields (name, race, class, stats) for the parser
- **Versionable** — personality files live in git, are diffable, reviewable
- **Self-documenting** — reading `grimbold.md` tells you exactly who Grimbold is

The `characterSpec` field embeds a full character sheet in the same markdown format that human players upload, so the same parser handles both.

## Why Single-Channel, Single-Guild?

Simplicity. The bot registers commands to one guild (via `GUILD_ID`) and each game is scoped to one channel. This avoids:
- Multi-guild command registration complexity
- Cross-channel game state confusion
- Permission management across servers

Supporting multiple guilds is a future enhancement — the architecture doesn't prevent it, it's just not wired up.

## Why Claude CLI Instead of the Anthropic SDK?

The bot uses the Claude CLI (`claude -p`) in non-interactive mode rather than the Anthropic SDK directly. This means AI calls route through the user's Claude Pro/Max subscription instead of requiring separate API credits.

**Pros:**
- No API key or prepaid credits needed — uses existing Pro/Max plan
- Same model access (Opus, Sonnet, Haiku)
- Simpler credential management (just `claude` being logged in)

**Cons:**
- Slightly higher latency (subprocess spawn per call vs direct HTTP)
- Consumes Pro/Max plan usage faster
- Requires Claude CLI installed and authenticated on the host

Since the bot's AI calls are all single-turn and the game's pace is naturally slow (human turn-based), the subprocess overhead is negligible. The cost savings make this ideal for development and small-group play.

### Subprocess Safety

Running `claude -p` as a subprocess requires several safeguards to avoid hangs and silent failures:

- **`--dangerously-skip-permissions`** — In a subprocess there is no terminal to approve tool calls. Without this flag, the process hangs indefinitely. It sounds scary but is safe here — the bot doesn't use MCP tools, so there's nothing to approve.
- **`--no-session-persistence`** — Prevents the subprocess from reading/writing Claude Code session state. Without this, concurrent game AI calls could interfere with each other or with an interactive session.
- **`CLAUDECODE=""`** — When the bot is started from inside Claude Code (common during development), child processes inherit the `CLAUDECODE` env var. Claude CLI detects this and rejects the call as a nested session. Blanking it prevents this.
- **`GIT_PAGER="cat"` / `PAGER="cat"`** — Prevents any pager (`less`, `more`) from launching in the headless subprocess. A pager would hang the process indefinitely.
- **`--output-format text`** — Ensures plain text output without ANSI formatting or structured wrappers.

These lessons were learned from the [d2r-screenshot-ai-reviewer](https://github.com/ericosg/d2r-screenshot-ai-reviewer) project, which also drives Claude as a subprocess.

## Why "AFK = Pause"?

The game never auto-advances without human input. If it's a human's turn and they walk away, the bot waits indefinitely. This prevents:
- AI agents and DM playing the game without anyone watching
- Story advancing past what a player has read
- Feeling pressured to respond immediately

This is a deliberate choice for asynchronous play in Discord — players can respond hours or days later.
