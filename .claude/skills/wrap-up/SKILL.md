---
name: wrap-up
description: Add unit tests for recent changes, run full verification, update docs, commit and push
disable-model-invocation: true
---

# Wrap-Up Workflow

Complete the following steps in order. Stop and report if any step fails.

## 1. Identify what changed

- Run `git diff --stat` and `git diff --cached --stat` to see all modified and staged files
- Run `git log --oneline -1` to see the last commit (to understand what's already been committed vs what's pending)
- Read the changed source files to understand what was added or modified

## 2. Add unit tests

- For each changed source file, check if corresponding tests exist and cover the new/modified code
- Add new unit tests for any uncovered functionality, following existing test patterns in the codebase
- Use the pure-function extraction pattern (e.g., `guardrail-check.ts`, `dm-prompt.ts`) if testing requires mocked modules that would cause cross-file pollution with `mock.module()`
- Do NOT add tests for trivial changes (formatting, imports, comments)

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
