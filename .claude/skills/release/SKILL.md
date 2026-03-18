---
name: release
description: Increment version, create git tag, and publish a GitHub release with auto-generated notes
disable-model-invocation: true
---

# Release Workflow

All commands below assume the working directory is the bot repo root.

Complete the following steps in order. Stop and report if any step fails.

## 1. Pre-flight checks

- Run `cd bot && bun test && bunx tsc --noEmit && bunx biome check src/` — all must pass
- Run `git status` — working tree must be clean (no uncommitted changes). If dirty, stop and tell the user to commit or stash first.
- Run `git log --oneline origin/main..HEAD` — if there are unpushed commits, stop and tell the user to push first.

## 2. Determine version

- Read the current version from `src/config.ts` (the `VERSION` constant) and `package.json`
- The version format is `X.Y` in config.ts and `X.Y.0` in package.json where Y is the release number
- Increment Y by 1 (e.g., `0.29` becomes `0.30`)
- Show the user the current and new version and confirm before proceeding

## 3. Generate release notes

- Run `git log --oneline` from the last tag (or all commits if no tags exist) to see what changed since the last release
- Write concise release notes summarizing the changes, grouped by category:
  - **Features** — new functionality
  - **Fixes** — bug fixes
  - **Improvements** — enhancements to existing features
- Skip categories with no changes. Keep it brief — one line per change.

## 4. Bump version

- Update `VERSION` in `src/config.ts`
- Update `version` in `package.json`
- Stage both files and commit: `chore: bump version to vX.Y`
- Push to remote

## 5. Create GitHub release

```bash
cd bot && gh release create vX.Y --title "vX.Y" --notes "RELEASE_NOTES_HERE" --repo ericosg/DnDnAi
```

- Use the release notes from step 3
- Pass the notes via a HEREDOC to preserve formatting
- If `gh` auth fails, tell the user to run `gh auth login` with the `ericosg` account

## 6. Report

- Print the release URL
- Print the new version number
- Print the number of commits included
