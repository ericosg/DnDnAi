const required = (name: string): string => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
};

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  guildId: required("GUILD_ID"),
} as const;

export const models = {
  dm: "claude-opus-4-20250514" as const,
  agent: "claude-sonnet-4-20250514" as const,
  orchestrator: "claude-haiku-4-5-20251001" as const,
} as const;

export const DATA_DIR = "data/games";
export const AGENTS_DIR = "agents";
export const HISTORY_WINDOW = 8;
export const COMPRESS_EVERY = 10;
export const AGENT_DELAY_MS = 2500;
