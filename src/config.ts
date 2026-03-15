export const VERSION = "0.30";

const required = (name: string): string => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
};

export const config = {
  discordToken: required("DISCORD_TOKEN"),
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

export type NarrativeStyle = "concise" | "standard" | "elaborate";

const styleRaw = (process.env.NARRATIVE_STYLE ?? "concise").toLowerCase();
export const NARRATIVE_STYLE: NarrativeStyle = ["concise", "standard", "elaborate"].includes(
  styleRaw,
)
  ? (styleRaw as NarrativeStyle)
  : "concise";

/** Style instructions injected into DM and agent system prompts. */
export const STYLE_INSTRUCTIONS: Record<NarrativeStyle, { dm: string; agent: string }> = {
  concise: {
    dm: `## Style: Concise
- Be brief and punchy — 2-4 sentences for scenes, 1-2 for action resolution
- Cut filler, repetition, and purple prose. Every sentence must advance the scene or prompt action
- Do NOT repeat what players just said back to them. They know what they did
- Favor short, impactful descriptions over long atmospheric passages
- One sensory detail per scene is enough — don't list every sight, sound, and smell
- NPC dialogue should be terse and natural, not monologues`,
    agent: `- Keep responses to 1-3 sentences. Be direct.
- Do not repeat or paraphrase what others just said
- One action or statement per turn — no monologues`,
  },
  standard: {
    dm: `## Style: Standard
- Keep narration concise but atmospheric (3-6 sentences for scenes, 1-3 for action resolution)
- Describe environments with sensory details
- Give NPCs distinct voices and mannerisms`,
    agent: `- Keep responses concise (2-4 sentences)
- React to the current situation naturally based on your personality`,
  },
  elaborate: {
    dm: `## Style: Elaborate
- Rich, atmospheric narration — paint the scene with vivid sensory details
- Give NPCs memorable voices, mannerisms, and emotional depth
- Use dramatic pacing — build tension, let moments breathe
- 4-8 sentences for scenes, 2-4 for action resolution
- Weave in environmental storytelling and subtle foreshadowing`,
    agent: `- Respond with 3-6 sentences of rich, in-character detail
- Include internal thoughts, observations, and personality-driven reactions
- Let your character's voice and mannerisms shine through`,
  },
};
