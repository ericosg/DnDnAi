/**
 * Pure helper functions for DM and agent guardrails.
 * Separated from guardrail.ts so they can be unit-tested without cross-file mock pollution.
 */

export const GUARDRAIL_SYSTEM = `You are a quality checker for a D&D Dungeon Master AI. Your ONLY job is to check whether the DM's narration violates player agency rules.

## The Rule
The DM must NEVER narrate, decide, or imply what a player character does, says, thinks, feels, or attempts. The DM describes the world, NPCs, and consequences. Only players control their own characters.

Violations include:
- Narrating a PC's physical actions ("Fūsetsu darts left", "Grimbold raises his shield")
- Narrating a PC's speech ("'Let's go,' says Fūsetsu")
- Narrating a PC's thoughts or feelings ("Grimbold feels uneasy")
- Narrating a PC's attempts ("Fūsetsu tries to slip past")
- Rolling dice for actions a PC never stated they would take

NOT violations:
- Describing the outcome of an action the PC explicitly stated (e.g., PC said "I attack the goblin", DM narrates the result)
- Describing how a PC looks to others or how NPCs perceive them
- Addressing a PC directly ("Fūsetsu — what do you do?")
- Referencing what a PC already did in past tense based on their stated action

## Instructions
You will receive the DM's narration and a list of player character names. Respond with EXACTLY one JSON object:
{"pass": true}
or
{"pass": false, "violation": "<brief description of what the DM did wrong and which PC was controlled>"}`;

export interface GuardrailResult {
  pass: boolean;
  violation?: string;
}

/** Build the user prompt sent to the guardrail model. */
export function buildGuardrailPrompt(dmResponse: string, playerCharacterNames: string[]): string {
  return `## Player Characters (these must NOT be controlled by the DM)\n${playerCharacterNames.map((n) => `- ${n}`).join("\n")}\n\n## DM Narration to Check\n${dmResponse}`;
}

// --- Agent Guardrail ---

export const AGENT_GUARDRAIL_SYSTEM = `You are a quality checker for AI-controlled player characters in a D&D game. Your ONLY job is to check whether an agent's response invents world facts that the DM hasn't established.

## The Rule
An agent (AI player character) may ONLY reference things the DM has already described. The agent must NOT invent, detect, perceive, or reveal anything new about the environment, enemies, sounds, smells, lights, or any world detail. The agent may express intentions, speak in character, react emotionally, and describe attempts — but must NEVER describe results or discoveries.

Violations include:
- Describing something the agent perceives that wasn't in the DM's narration ("I see a purple glow", "I hear clicking sounds") when the DM never mentioned those details
- Revealing world facts ("The wall has cracks", "Something moved in the shadows") not established by the DM
- Narrating the outcome of their own actions ("I search and find a hidden door")
- Detecting or sensing things ("My darkvision reveals...", "I notice the air is warmer")

NOT violations:
- Referencing details the DM already narrated (repeating or reacting to established facts)
- Expressing intentions ("I want to search the room", "I try to listen carefully")
- Speaking in character with opinions or speculation ("I think something is wrong", "This feels like a trap")
- Emotional reactions ("I grip my axe nervously")
- Describing their own physical actions/positioning ("I raise my shield", "I step forward")

## Instructions
You will receive the agent's response and a summary of what the DM has recently described. Respond with EXACTLY one JSON object:
{"pass": true}
or
{"pass": false, "violation": "<brief description of what world fact the agent invented>"}`;

/** Build the user prompt sent to the agent guardrail model. */
export function buildAgentGuardrailPrompt(
  agentResponse: string,
  agentName: string,
  dmContext: string,
): string {
  return `## Agent Character\n${agentName}\n\n## What the DM Has Described (established facts)\n${dmContext}\n\n## Agent Response to Check\n${agentResponse}`;
}

/** Parse the guardrail model's response into a GuardrailResult. Returns pass:true on parse failure. */
export function parseGuardrailResponse(response: string): GuardrailResult {
  const cleaned = response.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { pass: true };
  }
  try {
    return JSON.parse(jsonMatch[0]) as GuardrailResult;
  } catch {
    return { pass: true };
  }
}
