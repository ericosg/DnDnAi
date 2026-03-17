export interface CharacterSheet {
  name: string;
  race: string;
  class: string;
  level: number;
  experiencePoints?: number;
  spellSlots?: { level: number; max: number; current: number }[];
  featureCharges?: { name: string; max: number; current: number; resetsOn: "short" | "long" }[];
  background: string;
  alignment: string;
  gender?: string;
  abilityScores: {
    strength: number;
    dexterity: number;
    constitution: number;
    wisdom: number;
    intelligence: number;
    charisma: number;
  };
  proficiencyBonus: number;
  savingThrows: string[];
  skills: string[];
  hp: { max: number; current: number; temp: number };
  armorClass: number;
  initiative: number;
  speed: number;
  equipment: string[];
  features: string[];
  spells?: string[];
  backstory: string;
  personality?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
}

export interface Player {
  id: string; // discord user ID or "agent:<name>"
  name: string; // display name
  isAgent: boolean;
  characterSheet: CharacterSheet;
  agentFile?: string; // path to agent .md for AI agents
  joinedAt: string; // ISO timestamp
}

export interface DiceResult {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
  kept?: number[]; // for kh/kl mechanics
  label?: string;
}

export interface Combatant {
  playerId: string;
  name: string;
  initiative: number;
  hp: { max: number; current: number; temp: number };
  conditions: string[];
  deathSaves: { successes: number; failures: number };
  concentration?: { spell: string };
}

export interface CombatState {
  active: boolean;
  round: number;
  turnIndex: number;
  combatants: Combatant[];
}

export interface TurnEntry {
  id: number;
  timestamp: string;
  playerId: string;
  playerName: string;
  type: "ic" | "ooc" | "dm-narration" | "roll" | "system" | "whisper";
  content: string;
  diceResults?: DiceResult[];
  whisperTo?: string; // player ID for whispers
}

export interface AgentPersonality {
  name: string;
  race: string;
  class: string;
  level: number;
  description: string;
  voice: string;
  traits: string[];
  flaws: string[];
  goals: string[];
  characterSpec: string; // full mechanical spec for chargen
  rawContent: string; // full .md content
  model?: string; // override model for this agent
  avatarUrl?: string;
}

export interface PendingRoll {
  id: string;
  playerId: string;
  playerName: string;
  notation: string;
  reason: string;
  result?: DiceResult;
}

export interface GameState {
  id: string;
  channelId: string;
  guildId: string;
  status: "lobby" | "active" | "paused" | "ended";
  players: Player[];
  combat: CombatState;
  narrativeSummary: string; // compressed story so far
  turnCount: number;
  createdAt: string;
  lastActivity: string;
  pendingRolls?: PendingRoll[];
}

export interface OrchestratorDecision {
  action: "prompt_agent" | "prompt_dm" | "wait_for_human" | "advance_combat" | "skip";
  targetPlayerId?: string;
  reason: string;
  isIC: boolean;
}
