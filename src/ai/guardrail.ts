import { models } from "../config.js";
import { log } from "../logger.js";
import { chat } from "./claude.js";
import {
  AGENT_GUARDRAIL_SYSTEM,
  buildAgentGuardrailPrompt,
  buildGuardrailPrompt,
  GUARDRAIL_SYSTEM,
  type GuardrailResult,
  parseGuardrailResponse,
} from "./guardrail-check.js";

export type { GuardrailResult } from "./guardrail-check.js";

export async function checkDMResponse(
  dmResponse: string,
  playerCharacterNames: string[],
): Promise<GuardrailResult> {
  const prompt = buildGuardrailPrompt(dmResponse, playerCharacterNames);

  try {
    const response = await chat(models.orchestrator, GUARDRAIL_SYSTEM, [
      { role: "user", content: prompt },
    ]);

    const result = parseGuardrailResponse(response);
    if (!result.pass) return result;

    return result;
  } catch (err) {
    log.warn("Guardrail: check failed, allowing through:", err);
    return { pass: true };
  }
}

export async function checkAgentResponse(
  agentResponse: string,
  agentName: string,
  dmContext: string,
): Promise<GuardrailResult> {
  const prompt = buildAgentGuardrailPrompt(agentResponse, agentName, dmContext);

  try {
    const response = await chat(models.orchestrator, AGENT_GUARDRAIL_SYSTEM, [
      { role: "user", content: prompt },
    ]);

    return parseGuardrailResponse(response);
  } catch (err) {
    log.warn("Agent guardrail: check failed, allowing through:", err);
    return { pass: true };
  }
}
