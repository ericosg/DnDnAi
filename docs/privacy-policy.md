# DnDnAi Privacy Policy

**Last updated:** 2026-03-13

## What DnDnAi Collects

DnDnAi is a D&D game bot for Discord. It processes:

- **Discord User IDs** — to track which player is which during a game session
- **Display Names** — shown in game output
- **Message Content** — only messages prefixed with `>` (in-character actions) and slash commands in channels where a game is active
- **Uploaded Character Sheets** — markdown files attached via the `/join` command

## How Data Is Used

All data is used solely to run the D&D game. Messages are sent to the Anthropic API (Claude) to generate AI responses. No data is sold, shared with third parties, or used for advertising.

## Data Storage

- Game state is stored as local JSON files on the bot host for the duration of a campaign
- No data is stored after a game ends with `/end` beyond what Discord itself retains
- No database or external storage is used

## Data Retention

Game data persists until the game is ended or the bot host is cleared. There is no long-term data retention.

## Third-Party Services

- **Anthropic API** — message content is sent to Claude for AI narration and agent responses, subject to [Anthropic's usage policy](https://www.anthropic.com/legal/usage-policy)
- **Discord API** — the bot operates within Discord's platform, subject to [Discord's privacy policy](https://discord.com/privacy)

## Contact

This is an open-source hobby project. For questions or concerns, open an issue at [github.com/ericosg/DnDnAi](https://github.com/ericosg/DnDnAi).
