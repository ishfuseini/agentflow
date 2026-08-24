import type { Model } from "@openai/agents";
import { createOllamaCloudModel, createOpenRouterModel } from "./providers";

export const ROUTING_MODES = ["cost", "intelligence"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

/** The three pipeline agents that get a routed model per run. */
export type AgentKey = "qualifier" | "architect" | "riskChecker";

export type AgentModels = Record<AgentKey, Model>;

export function isRoutingMode(value: unknown): value is RoutingMode {
	return value === "cost" || value === "intelligence";
}

/**
 * Resolves the model each agent uses for a run:
 * - cost mode — all three agents on gpt-oss:20b via Ollama Cloud
 * - intelligence mode — Architect on claude-opus-4-8 via OpenRouter,
 *   Qualifier and Risk Checker stay on gpt-oss:20b via Ollama Cloud
 */
export function resolveAgentModels(mode: RoutingMode): AgentModels {
	const costModel = createOllamaCloudModel();

	switch (mode) {
		case "cost":
			return {
				qualifier: costModel,
				architect: costModel,
				riskChecker: costModel,
			};
		case "intelligence":
			return {
				qualifier: costModel,
				architect: createOpenRouterModel(),
				riskChecker: costModel,
			};
		default:
			throw new Error(`Unknown routing mode: ${mode}`);
	}
}
