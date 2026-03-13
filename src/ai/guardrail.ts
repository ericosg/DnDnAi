import { models } from "../config.js";
import { log } from "../logger.js";
import { chat } from "./claude.js";

const GUARDRAIL_SYSTEM = `You are a quality checker for a D&D Dungeon Master AI. Your ONLY job is to check whether the DM's narration violates player agency rules.

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

export async function checkDMResponse(
  dmResponse: string,
  playerCharacterNames: string[],
): Promise<GuardrailResult> {
  const prompt = `## Player Characters (these must NOT be controlled by the DM)\n${playerCharacterNames.map((n) => `- ${n}`).join("\n")}\n\n## DM Narration to Check\n${dmResponse}`;

  try {
    const response = await chat(models.orchestrator, GUARDRAIL_SYSTEM, [
      { role: "user", content: prompt },
    ]);

    const cleaned = response.trim();
    // Extract JSON from response (may have markdown fencing)
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn("Guardrail: could not parse response, allowing through");
      return { pass: true };
    }

    const result = JSON.parse(jsonMatch[0]) as GuardrailResult;
    return result;
  } catch (err) {
    log.warn("Guardrail: check failed, allowing through:", err);
    return { pass: true };
  }
}
