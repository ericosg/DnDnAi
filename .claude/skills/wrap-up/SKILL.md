---
name: wrap-up
description: Verify and fix tests for recent changes, run full verification, update docs, commit and push
disable-model-invocation: true
---

# Wrap-Up Workflow

Complete the following steps in order. Stop and report if any step fails.

## 1. Identify what changed

- Run `git diff --stat` and `git diff --cached --stat` to see all modified and staged files
- Run `git log --oneline -1` to see the last commit (to understand what's already been committed vs what's pending)
- If there are no uncommitted changes, look at recent commits since the last session using `git log --oneline -10` and `git diff HEAD~5..HEAD --stat` to identify all source files changed in recent commits
- Read the changed source files to understand what was added or modified

## 2. Verify and fix tests

This is the most important step. Do not rush it.

### 2a. Audit existing tests for correctness

For each changed source file, read the corresponding test file and check:

- **Do test helpers match reality?** If tests use factory functions (e.g., `makeCombatState()`, `makeGameState()`), verify they create scenarios that reflect all real-world states. A helper that always creates combat-active state will miss every non-combat bug. If the code being tested can run in multiple states (combat vs exploration, logged-in vs anonymous, empty vs populated), there MUST be test helpers and tests for each state.
- **Do tests verify behavior or just code paths?** A test that checks "function returns non-null" when it should check "function updates HP to 15 on the character sheet" is testing the wrong thing. Tests should verify the observable outcome the user cares about.
- **Do tests cover the unhappy paths?** For every "target found" test, there should be a "target not found" test. For every "in combat" test, ask: what happens outside combat? For every "player exists" test, what about unknown players?
- **Are existing tests still valid after the change?** If a function's return type changed, if a parameter was added, if behavior was altered — existing tests may pass but test stale expectations. Read them and fix them.

### 2b. Write new tests for uncovered functionality

- Review every new function, new parameter, new code path, and new behavior — each should have at least one test
- **Test in every relevant state.** If a directive can be used in combat AND exploration, test both. If a function works with and without optional parameters, test both. Don't just test the state your implementation was designed for — test the state a user will actually trigger.
- **Test at the boundaries.** Zero values, max values, negative values, empty arrays, missing optional fields, case mismatches in names.
- **Test the integration, not just the unit.** If `processDirectives()` calls `setHP()`, and `setHP()` has unit tests, you still need a `processDirectives()` test that passes a non-combat game state with an UPDATE_HP directive — because the integration path may not match what the unit test covers.
- Follow existing test patterns in the codebase
- Use the pure-function extraction pattern (e.g., `guardrail-check.ts`, `dm-prompt.ts`) if testing requires mocked modules that would cause cross-file pollution with `mock.module()`

### 2c. What NOT to test

- Trivial changes (formatting, imports, comments)
- But do NOT skip this step just because changes are already committed — always verify coverage

## 3. Run tests

```bash
cd bot && bun test
```

Fix any failures before proceeding.

## 4. Type-check and lint

```bash
cd bot && bunx tsc --noEmit && bunx biome check src/
```

Fix any errors (use `bunx biome format --write` for formatting issues).

## 5. Re-run all tests

```bash
cd bot && bun test
```

Confirm all tests still pass after any fixes.

## 6. Update documentation

- **CLAUDE.md**: Update if test file count changed, new architectural patterns were added, new commands were introduced, or key protocols changed. Keep descriptions concise.
- **README.md**: Update if user-facing features changed (new commands, new agents, changed behavior). Do NOT update for internal refactors.
- **docs/**: Update architecture.md or design-decisions.md only if there are significant structural changes.

Skip docs that don't need changes. Do not add documentation for its own sake.

## 7. Final verification

```bash
cd bot && bun test && bunx tsc --noEmit && bunx biome check src/
```

All three must pass.

## 8. Commit and push

- Stage only the relevant files (no `git add -A`)
- Write a commit message that explains **why**, not just what
- Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
- Push to remote

Report the final test count, commit hash, and what was shipped.
