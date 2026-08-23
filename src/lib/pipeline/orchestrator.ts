import { run } from "@openai/agents";
import { createArchitectAgent } from "$lib/agents/architect";
import { createQualifierAgent } from "$lib/agents/qualifier";
import { createRiskCheckerAgent } from "$lib/agents/risk-checker";
import type {
	ArchitectOutput,
	QualifierOutput,
	RiskCheckerOutput,
} from "$lib/agents/types";
import { resolveAgentModels, type RoutingMode } from "./routing";

export interface PipelineResult {
	prompt: string;
	routingMode: RoutingMode;
	qualifier: QualifierOutput;
	architect: ArchitectOutput;
	riskChecker: RiskCheckerOutput;
}

/**
 * Runs the 3-agent sequential pipeline: Qualifier → Architect → Risk Checker.
 *
 * Each agent receives the previous agent's structured JSON output as its input;
 * the Qualifier receives the free-text user prompt. Zod-validated outputs are
 * passed between agents, so an invalid handoff fails fast instead of poisoning
 * the next agent.
 */
export async function runPipeline(
	prompt: string,
	routingMode: RoutingMode,
): Promise<PipelineResult> {
	const models = resolveAgentModels(routingMode);

	const qualifierResult = await run(
		createQualifierAgent(models.qualifier),
		prompt,
	);
	const qualifierOutput: QualifierOutput = qualifierResult.finalOutput;

	const architectResult = await run(
		createArchitectAgent(models.architect),
		JSON.stringify(qualifierOutput),
	);
	const architectOutput: ArchitectOutput = architectResult.finalOutput;

	const riskCheckerResult = await run(
		createRiskCheckerAgent(models.riskChecker),
		JSON.stringify(architectOutput),
	);
	const riskCheckerOutput: RiskCheckerOutput = riskCheckerResult.finalOutput;

	return {
		prompt,
		routingMode,
		qualifier: qualifierOutput,
		architect: architectOutput,
		riskChecker: riskCheckerOutput,
	};
}
