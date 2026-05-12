# Bug Fixes & Upgrades — Next Release

> **Audience:** Claude Code working on the DnDnAi bot codebase.
>
> **Source:** Issues observed live in production game `f4d0b958-be57-449f-8354-63674db3b3d1` (Session 7, Mill Street + Threadneedle Lane split scene). Player Fūsetsu (ad3z) flagged the agent breakage; DM Opus repeatedly self-corrected via `/ask`.
>
> **Goal:** Stop the three highest-impact failure modes — (1) agents speaking about scenes they aren't in, (2) agents contradicting their own memory file, (3) the DM hallucinating canonical facts — and harden the guardrail that should have caught all three.
>
> **Treat each section as an independent ticket.** Each one has: symptom (with concrete evidence from the live game), root cause, fix, files to edit, and acceptance criteria. Do them in order; later fixes depend on the data structures introduced earlier.

---

## Ticket 1 — Scene scope leak: agents see narration from scenes they aren't in

### Symptom
The party is currently split across two locations:

- **Mill Street safe house:** Grimbold, Nyx, Sprocket, Fūsetsu, Edric, Maren
- **Vellum & Verge (Threadneedle Lane):** Hierophantis alone with Halba

The DM narrated the Vellum & Verge reliquary-opening scene in detail (bone stylus, master die, V.'s vellum leaf naming Father Eames). On the very next turn, **Grimbold** (at Mill Street) said:

> "The priest's across town opening a locked box. That's what we're waiting on."

And **Nyx** (also at Mill Street) said:

> "The priest has the *stamp.* … If Hierophantis comes back with what I think he found — Sprocket, *the succession breaks*. No new consecrations."

Neither character can possibly know any of that. Hierophantis hasn't sent a runner, hasn't returned, hasn't whispered. The party is split. The agents read the DM's narration of Hierophantis's scene as if they'd witnessed it.

### Root cause
`src/game/engine.ts:390` builds `recentHistory` as the last `HISTORY_WINDOW` turns of the entire channel history with no scene-scope filter:

```ts
const recentHistory = history.slice(-HISTORY_WINDOW);
```

That blob is passed straight into `generateAgentAction` (`src/ai/agent.ts:46`), which inlines it as `## Recent Events` in the agent prompt (`src/ai/agent.ts:178-183`). The agent has no way to know which entries are visible to its character.

The DM correctly produces split-scene narration (it labels each block "**Mill Street — Maren's safe house**" / "**Vellum & Verge — Threadneedle Lane**"), but the markdown headers are just text the agent sees — there is no machine-readable scope tag.

`GameState.sceneState` (`src/state/types.ts:101-106`) is **singular** — one scene per game — so it can't represent a split party at all.

### Fix
Add multi-scene support and route only the agent's own scene to its prompt.

1. **Data model — `src/state/types.ts`**
   - Replace `sceneState?: SceneState` with `scenes?: SceneState[]` (or keep `sceneState` for backward compat and add `scenes` alongside).
   - Add `id: string` and `presentPlayerIds: string[]` to `SceneState`.
   - Add `sceneId?: string` to `Player` so each PC knows which scene they belong to.
   - Add `sceneId?: string` to `TurnEntry` so each narration entry is taggable.

2. **Engine — `src/game/engine.ts:390`**
   - Look up the acting agent's `player.sceneId`.
   - Filter `recentHistory` to entries where `entry.sceneId === player.sceneId` **OR** `entry.sceneId == null` (legacy/global) **OR** `entry.playerId === player.id` (always include the agent's own actions).
   - Always include the most recent compressed `narrativeSummary` (it's already global).
   - Pass the filtered history to `generateAgentAction`.

3. **DM tagging — `src/ai/dm.ts` + `src/game/directives.ts`**
   - Add a directive: `[[SCENE:sceneId TEXT:narration block]]` so the DM can tag a block as belonging to a specific scene. Parser splits the response into per-scene `TurnEntry` objects, each with a `sceneId`.
   - When the DM narrates a split scene, it MUST emit each block inside a `[[SCENE:...]]` wrapper. Add this rule to `dm-prompt.ts`.
   - Add a directive `[[SCENE:CREATE id:foo location:"..." players:Name1,Name2]]` so the DM can split the party and `[[SCENE:MERGE into:foo from:bar]]` to rejoin.

4. **DM prompt — `src/ai/dm-prompt.ts`**
   - In the `## Current Scene` section, render each scene separately when `gameState.scenes.length > 1`, listing which PCs are in each.
   - Add an explicit rule: "When the party is split, you MUST emit a separate `[[SCENE:id]]` wrapper around each location's narration. Agents only see narration tagged for their own scene."

5. **Migration**
   - On first load of an existing game with no `scenes`, synthesize one scene `default` containing all players and tag all existing history entries `default`. Idempotent; gated on absence of `scenes`.

### Files to edit
- `src/state/types.ts`
- `src/game/engine.ts` (`runAgentTurn`, `processTurn`, `compressNarrative` callsites)
- `src/ai/dm.ts`
- `src/ai/dm-prompt.ts`
- `src/game/directives.ts` + `src/game/directives.test.ts` (add SCENE directive)
- `src/ai/agent.ts` (no behavior change, but verify it consumes filtered history)

### Acceptance
- New unit test in `engine.test.ts`: party split into two scenes; agent A acts; assert `recentHistory` passed to `generateAgentAction` contains only scene-A entries plus globals. Assert scene-B narration is excluded.
- New unit test in `directives.test.ts`: `[[SCENE:foo TEXT:...]]` produces a `TurnEntry` with `sceneId: "foo"`; multiple SCENE blocks in one DM response produce multiple entries.
- Manual check on the live game: replay one turn after migration — Grimbold should not be able to reference the Vellum & Verge scene.

---

## Ticket 2 — Agent contradicts its own memory file (the "Harken's dead" bug)

### Symptom
Grimbold's memory file (`data/games/<id>/agent-notes/grimbold-ironforge.md` line 54) explicitly contains:

> "Harken (ALIVE — the whole plan tomorrow at chop-house tea-hour is to take him alive and walk him to Soper's Lane. He has not been touched. **Anyone who tells me Harken is dead is wrong, including me if I ever say it**)."

On the next turn — **with that memory file fully loaded into the prompt** — Grimbold opened with:

> "Harken's dead — that's old news."

The agent saw a guardrail-resistant claim ("anyone who tells me X is wrong, including me") and ignored it.

### Root cause
The agent's memory is **passively included** as text in the user message (`src/ai/agent.ts:232-237`), competing for attention with `recentHistory`, party state, scene state, and personality. Long-context drift means high-salience but old facts get overwritten by recent narration vibes.

Two compounding problems:

1. **No memory consistency check.** Nothing verifies that the agent's response is consistent with its memory file. The agent guardrail (`src/ai/guardrail-check.ts:67-89`) only checks for **world-fact invention**, not for **self-contradiction with established facts**.
2. **No "load-bearing facts" extraction.** The memory file mixes equally-weighted bullets. There's no signal that "Harken is alive" is a hard fact vs. soft flavor.

### Fix
Two-layer defense.

#### Layer A — Prompt-side reinforcement
In `src/ai/agent.ts:buildAgentSystemPrompt`, add a new section **at the END of the system prompt** (highest recency in instruction-following):

```
## CRITICAL — Hard Facts From Your Memory
The following facts in your memory file are LOAD-BEARING. You must not contradict them
under any circumstance. If recent narration appears to contradict a hard fact, treat the
narration as the error and stay consistent with your memory:

<bullets>
```

Hard facts are extracted by scanning the memory file for bullets containing **ALL-CAPS words** like `ALIVE`, `DEAD`, `NOT`, `NEVER`, or wrapped in `**bold**`, or tagged with a new prefix `!! ` (e.g. `- !! Harken is alive`). Pick a syntax and document it in `creating-agents.md`.

Add a parser `extractHardFacts(memory: string): string[]` to `src/game/agent-notes.ts` and unit-test it.

#### Layer B — Memory-consistency guardrail pass
Extend `checkAgentResponse` in `src/ai/guardrail.ts` to take a third argument `hardFacts: string[]` and add a new prompt mode:

```
## The Rule
The agent must not contradict any of these hard facts from its memory:
<list>

If the agent says something incompatible with a hard fact, fail with:
{"pass": false, "violation": "Contradicted hard fact: <which one>"}
```

In `engine.ts:runAgentTurn`, on guardrail failure with this kind of violation, re-generate at `effort: "medium"` with the hard fact echoed in the rejection feedback, exactly like the existing world-fact retry path.

### Files to edit
- `src/game/agent-notes.ts` — add `extractHardFacts`, unit-test in `agent-notes.test.ts`
- `src/ai/agent.ts` — render hard facts at end of system prompt
- `src/ai/guardrail.ts` + `src/ai/guardrail-check.ts` — add hard-fact check mode
- `src/game/engine.ts` — pass hard facts into the guardrail; retry on contradiction
- `docs/creating-agents.md` — document the `!! ` (or chosen) hard-fact syntax

### Acceptance
- Unit test: memory file with `- !! Harken is alive`. Agent response saying "Harken's dead" → guardrail fails with hard-fact violation.
- Unit test: same memory; agent response saying "we plan to grab Harken at the chop-house" → guardrail passes.
- Live replay: re-run Grimbold's turn from history entry where the bug fired; assert the corrected response no longer says Harken is dead.
- Backfill: write a one-time script `scripts/extract-hard-facts.ts` that scans every existing agent-notes file in `data/games/*/agent-notes/` and prints which bullets would be classified as hard facts so we can spot-check before turning the new guardrail on.

---

## Ticket 3 — Agent guardrail too narrow; misses scene-scope and self-contradiction violations

### Symptom
The current agent guardrail (`src/ai/guardrail-check.ts:67-89`) only checks **invention of world facts**. It explicitly does **not** check:

- The agent referencing a scene its character isn't in (Ticket 1 leak).
- The agent contradicting its own memory file (Ticket 2 bug).
- The agent referring to events that never happened (e.g. "we already raided the docks" when no such turn exists in history).
- The agent taking actions while a `pendingRoll` is owed by a different character.

Both Ticket 1 and Ticket 2 should have been blocked by the guardrail and weren't.

### Fix
Reframe `checkAgentResponse` to take a structured `AgentGuardrailContext`:

```ts
interface AgentGuardrailContext {
  agentName: string;
  scopedDmContext: string;       // already filtered to the agent's scene
  hardFacts: string[];           // load-bearing facts from agent memory
  presentCharacters: string[];   // PCs/NPCs in the same scene
  recentHistorySummary: string;  // 1-line per turn, agent-scoped
}
```

The new guardrail prompt checks four classes of violation in order, each with a distinct `violation` type so the engine can target the retry message:

1. **`scene-leak`** — references a character, event, or location outside `presentCharacters`/`scopedDmContext`.
2. **`hard-fact-contradiction`** — directly contradicts a `hardFacts` entry.
3. **`world-invention`** — current behavior; invents a world detail not in `scopedDmContext`.
4. **`fabricated-history`** — claims an event happened that isn't in `recentHistorySummary` and isn't in memory.

Return shape:

```ts
type AgentGuardrailResult =
  | { pass: true }
  | { pass: false; violationType: "scene-leak" | "hard-fact-contradiction" | "world-invention" | "fabricated-history"; violation: string };
```

In `engine.ts:runAgentTurn`, switch on `violationType` to produce a targeted rejection feedback string in the retry prompt. Generic "you invented something" feedback was too soft to fix the Harken bug — explicit "you said Harken is dead but your memory says he is alive" feedback will have far higher fix rate.

### Files to edit
- `src/ai/guardrail.ts`
- `src/ai/guardrail-check.ts` + `src/ai/guardrail.test.ts`
- `src/game/engine.ts:runAgentTurn`

### Acceptance
- Unit tests for each of the 4 violation types — fixture in/fixture out.
- Existing world-invention tests continue to pass.
- Replay: Grimbold "Harken's dead" → rejected with `hard-fact-contradiction`. Grimbold "across town opening a locked box" → rejected with `scene-leak`.

---

## Ticket 4 — DM agent: persistent canonical-fact hallucinations

### Symptom (from the live `dm.md` correction log)
Even with the `⚠️ CANONICAL FACTS` block injected into the system prompt, the DM Opus has produced these errors in the last sessions, all caught by player `/ask`:

| Bug | Caught by | Reality |
|---|---|---|
| Brannock narrated as male (entries #32855 + #32903) | Hierophantis | She/her — established Session 6 entry #27610 |
| Voss "Session 1 only" | Hierophantis | Voss went into the mines with the party Sessions 2–4 |
| Brannock's leather "shipped to Greymarch three weeks back" → revised to "four days" | Fūsetsu | Fūsetsu only traded the leather ~24 hours ago in-world |
| Sera's house "one night already used" | Fūsetsu | Party has only slept at The Salted Beam |
| "Nothing points to a chandler's shop" re Ollen | Hierophantis | Benna had explicitly named the chandler's shop |
| Tavern named "Sinking Flagon" / "Pickaxe & Pint" | (older) | Canonical name is **The Sheaf & Stone** |
| Barkeep named "Hilde" | (older) | Canonical is **Marta** |
| Stale `sceneState` after `/resume` | Fūsetsu | sceneState frozen at "everyone at Maren's table" while party was split |

The DM correctly self-corrects when challenged but the underlying mechanism keeps re-firing the same class of bug.

### Root cause
1. **Canonical facts are flat text.** The `CANONICAL FACTS` block in the prompt is a wall of bullets. Long-context attention degrades on dense reference material when the active narration is more vivid. Whatever the DM is currently writing pulls more weight than a bullet 4000 tokens up.
2. **No per-narration verification pass.** The DM guardrail (`checkDMResponse`) only checks player-agency violations, not factual consistency with `dm-notes/` or character JSONs.
3. **Stale `sceneState`.** `compressNarrative` runs on a schedule (`COMPRESS_EVERY`) and on `/pause`/`/resume` — but **not** when the party splits or merges. After a split, sceneState describes one location while the party is in two.
4. **No retrieval discipline.** The DM's system prompt tells it to read character JSONs and SRD before referencing abilities — but doesn't require it to re-read `dm-notes/dm.md` or the `CANONICAL FACTS` block before naming a recurring NPC. It's all "implicit, please-do-this."

### Fix
Multi-part — these are independent and can land separately.

#### 4a. Structured canonical facts (replace flat block)
Move from prose to a structured JSON `dm-notes/canon.json`:

```json
{
  "names": {
    "town": { "value": "Halverton", "aliases_wrong": ["Ashenmoor"], "since": "session-1-retcon" },
    "tavern": { "value": "The Sheaf & Stone", "aliases_wrong": ["Sinking Flagon", "Pickaxe & Pint"] },
    "barkeep": { "value": "Marta", "aliases_wrong": ["Hilde"] }
  },
  "npcs": {
    "Brannock": { "gender": "female", "pronouns": "she/her", "description": "...", "first_appeared": "session-6" },
    "Voss": { "role": "surveyor", "status": "missing", "last_seen": "mine-expedition" }
  },
  "facts": [
    { "id": "r1-r2-locked", "claim": "R1 and R2 are seated and locked.", "source": "session-1" }
  ]
}
```

Render the structured data into the prompt — the DM is more likely to attend to a labeled record than a paragraph.

#### 4b. DM fact-check guardrail pass
Add `checkDMFactConsistency(dmResponse, canonicalFacts, characterRefs)` in `src/ai/guardrail.ts`. Haiku call. Inputs: the rendered narration text + a structured fact list + the live character JSONs. Asks Haiku one question: "does any sentence in this narration contradict any fact in the list?"

On violation: retry the DM at `effort: "high"` with explicit feedback `[SYSTEM: You contradicted canonical fact <id>: '<claim>'. Rewrite without contradicting it.]`. Same retry path the player-agency guardrail already uses.

This is cheap (Haiku, structured input) and addresses the entire class of bugs in the table above.

#### 4c. Compress on party split / merge
In `engine.ts`, add a hook: whenever `[[SCENE:CREATE]]` or `[[SCENE:MERGE]]` directives fire (Ticket 1), call `compressNarrative` and rebuild per-scene `SceneState` objects. The DM never narrates with stale split-state.

#### 4d. Mandatory pre-narration read
Update `dm-prompt.ts` to add a hard pre-flight rule:

```
Before narrating a scene that includes any NPC by name, you MUST verify the NPC's
gender, description, and last-known status against `dm-notes/canon.json`. If the NPC
is not in canon.json yet but you've established them in `dm.md`, add them to canon.json
on this turn via Edit. Do not narrate an NPC's pronouns, gender, or signature traits
from memory alone.
```

This is the same discipline that already works for spell lookups in the SRD.

#### 4e. Drift snapshot in `/ask`
When a player uses `/ask` to flag an inconsistency, automatically log it to `dm-notes/drift-log.md` with the offending narration, the canonical fact, and the fix. Drift-log is loaded on `/resume`. Closes the feedback loop and gives Claude Code a regression dataset to mine.

### Files to edit
- `dm-notes/` schema — add `canon.json` template
- `src/ai/dm-prompt.ts` — load canon.json structurally, render under CANONICAL FACTS
- `src/ai/dm.ts` — `loadCanonicalFacts` to return structured data, not text
- `src/ai/guardrail.ts` + `guardrail-check.ts` — add `checkDMFactConsistency`
- `src/game/engine.ts` — wire the DM fact-check retry; add scene-change compression hook; auto-write drift-log on `/ask` flagging
- `src/game/ask-history.ts` — emit drift entries when the DM concedes a fact error in its `/ask` answer (heuristic: response contains "you're right" or "I made the same mistake" or similar)
- Migration: parse the existing `## ⚠️ CANONICAL FACTS` block in `dm-notes/world.md` for active games and seed `canon.json`

### Acceptance
- Unit test in `guardrail.test.ts`: DM narration "Brannock raised his hammer" + canon fact "Brannock is female" → guardrail fails.
- Unit test: DM narration about Marta → passes; about "Hilde" → fails (alias_wrong match).
- Live replay of session 7 turn where Brannock was misgendered: with the new guardrail, retry produces correct gender.
- After `[[SCENE:CREATE]]` is fired, sceneState reflects the split within one turn.

---

## Ticket 5 — Bad core memory: agent memory drifts but isn't audited

### Symptom
Grimbold's memory file is well-maintained (the "Harken is alive" bullet is right there). But there's no enforcement loop. If the agent silently writes a wrong bullet — or fails to record a key event — nothing notices.

Specifically:
- The agent can `Edit` its own file with no review.
- There's no diff log; we can't see what an agent added vs. what was there.
- A wrong bullet, once written, becomes self-reinforcing the next turn.

### Fix
1. **Append-only diff log.** When an agent calls `Edit`, write the diff to `data/games/<id>/agent-notes/.audit/<slug>.log` with timestamp + turn id. Use the existing tool-use stream (`src/ai/claude-subprocess.ts`) — it already surfaces tool calls; tee them.
2. **Memory-write guardrail.** When the agent's tool-use stream contains an `Edit` to its memory file, run a small Haiku check: "is the new bullet supported by the recent DM narration in this turn?" Reject hallucinated memory writes the same way we reject hallucinated narration. This is much cheaper than catching the consequences three turns later.
3. **`/audit-memory` slash command.** Admin-only command that runs Sonnet across `agent-notes/<slug>.md` + last `N` turns of history and produces a list of bullets that aren't supported by history. Doesn't auto-edit; surfaces for review.
4. **DM `[[REMEMBER:Name TEXT:...]]` directive already exists** (`docs/directives.md`) — promote it in the DM system prompt as the **canonical** way to lock in mechanical corrections. Agents shouldn't be the sole authors of their own truth on rules-affecting facts.

### Files to edit
- `src/ai/claude-subprocess.ts` — emit tool-use events for tee
- `src/game/agent-memory-effects.ts` — write audit log + run memory-write guardrail
- `src/ai/guardrail.ts` — add `checkAgentMemoryWrite(diff, dmContext)` mode
- `src/discord/client.ts` — register `/audit-memory` admin command
- `src/ai/dm-prompt.ts` — promote `[[REMEMBER:...]]` for mechanical corrections

### Acceptance
- Unit test: agent emits an `Edit` adding "I drank the potion of healing" but no DM narration of the action exists → memory guardrail blocks the write.
- Manual: run `/audit-memory grimbold-ironforge` on the live game; output lists any unsupported bullets.

---

## Ticket 6 — Other DM agent upgrades (smaller, batchable)

These are observed in the live game and should ship together once the bigger tickets land.

### 6a. DM "tool-meta only" still slips through
`isToolMetaOnly` (`engine.ts:27-32`) catches short tool-meta responses. But it allows responses that have any `*` or `>` markdown — so a DM response containing one `*italic*` flourish around tool-meta-only sentences passes the check. Tighten the heuristic: require both narrative markers AND minimum length, not OR.

### 6b. DM should never say "I'll do this next turn"
The DM prompt already says `IMPORTANT — ACT NOW, DON'T PROMISE`, but Opus still occasionally produces "I'll track this going forward" in `/ask` answers (visible in recent /ask exchanges). Add a post-response check: regex for promise patterns (`/I'll (track|fix|handle|note|remember)/i`); on match in `/ask`, retry once with explicit "Do not promise — fix now or tell the player exactly what to do."

### 6c. `/ask` should be able to invoke a fact-check on its own answer
When a player `/ask`s "is X true?" and the DM answers "no, it's Y," that's a canonical-fact correction. Auto-write to `dm-notes/drift-log.md` (Ticket 4e) and ALSO offer a one-click `/canonize` to push the fact into `canon.json`.

### 6d. Stale `pendingRolls` cleanup
Live game had two stale `pendingRolls` from a `ROLL` (auto-resolve) directive that the DM mistakenly emitted as `REQUEST_ROLL` (player-pending). The DM cleared them via `/ask` but only because the player flagged it. Add an automatic check: if a `pendingRoll` is older than 10 minutes AND no player has typed `/roll` AND the player it's for is an AI agent, auto-resolve it.

### 6e. `dm.md` is too long and unstructured
Live `dm.md` is 600+ lines, all unstructured prose. The DM cannot scan it efficiently. Break into sections under top-level headings the DM is instructed to read by name (e.g. `## Live Scene State`, `## Correction Log`, `## NPC Roster`, `## Open Threads`). Update `dm-prompt.ts` so each turn it loads only the sections relevant to the scene type (combat vs. exploration).

### 6f. Compression should preserve hard facts verbatim
`compressNarrative` is summarization — by nature, it loses detail. When it runs, pass it the structured `canon.json` (Ticket 4a) and instruct Sonnet: "any fact in canon.json must appear verbatim in the new summary." Prevents canonical-fact erosion across compressions.

### Files to edit
- `src/game/engine.ts` (6a, 6d)
- `src/ai/dm.ts` (6b, 6c, 6f)
- `src/ai/dm-prompt.ts` (6e)
- `dm-notes/dm.md` template — add section structure (6e)

### Acceptance
- Unit tests for each item where applicable; manual replay for the prose ones.

---

## Migration plan

The tickets compound. Land in this order to keep the live game playable throughout:

1. **Ticket 4a + 4b + 4d** (canonical facts → structured + DM fact-check). Lowest risk, highest immediate value — kills the recurring NPC-gender / NPC-name / barkeep-name class of bug.
2. **Ticket 1** (scene scope). Schema migration; gate behind a feature flag for live games until backfill verified.
3. **Ticket 2** (hard facts in agent memory). Independent of Ticket 1 in terms of code, but tested better with Ticket 1 in place.
4. **Ticket 3** (expanded agent guardrail). Depends on 1 + 2.
5. **Ticket 5** (memory audit). Hardening — ship after the critical path.
6. **Ticket 6** (DM polish). Cleanup pass.

For the live game `f4d0b958-be57-449f-8354-63674db3b3d1`:
- Run the canon.json migration first; spot-check the converted facts against `dm-notes/world.md` `CANONICAL FACTS` block.
- Run the scene migration (everyone gets `sceneId: "default"`); then the DM, on the next turn, calls `[[SCENE:CREATE id:vellum players:Hierophantis location:"Vellum & Verge"]]` and `[[SCENE:CREATE id:mill players:Grimbold,Nyx,Sprocket,Fusetsu location:"Mill Street"]]` to backfill the current split.
- Run the hard-facts extractor over all three agent-notes files in `agent-notes/`.

## Verification

```bash
cd bot
bun test                        # all 897+ tests should pass; new tests added per ticket
bunx tsc --noEmit
bunx biome check src/
```

Then a smoke test on a fresh game:

1. `/start` a new game, add Grimbold and Nyx.
2. DM splits the party with `[[SCENE:CREATE]]`.
3. Send an in-character message to scene-A.
4. Trigger scene-B's agent — assert in logs that its `recentHistory` contains zero scene-A entries.
5. Manually edit Grimbold's memory file to add `- !! The sky is green`. Have him narrate. Assert the response does not contradict.
6. Manually inject a DM narration that misgenders an NPC defined in `canon.json`. Assert the DM fact-check guardrail rejects it and retries.

If all six pass, ship.
