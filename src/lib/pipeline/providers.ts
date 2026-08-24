import { OpenAIChatCompletionsModel } from "@openai/agents";
import OpenAI from "openai";
import { env } from "$env/dynamic/private";

/**
 * Model providers for the pipeline's two routing tiers.
 *
 * - Cost tier: gpt-oss:20b on Ollama Cloud (OpenAI-compatible endpoint at ollama.com/v1).
 * - Intelligence tier: claude-opus-4-8 on OpenRouter (spec name; OpenRouter slug
 *   is "anthropic/claude-opus-4.8").
 *
 * Both are exposed as concrete chat-completions Model instances so agents can mix
 * providers within a single pipeline run.
 */

const DEFAULT_OLLAMA_BASE_URL = "https://ollama.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const DEFAULT_COST_MODEL_ID = "gpt-oss:20b";
export const INTELLIGENCE_MODEL_ID = "anthropic/claude-opus-4.8";
export const OLLAMA_CLOUD_PROVIDER = "ollama-cloud";
export const OPENROUTER_PROVIDER = "openrouter";

export function getCostProviderName(): string {
	return OLLAMA_CLOUD_PROVIDER;
}

export function getCostModelId(): string {
	return env.OLLAMA_MODEL || DEFAULT_COST_MODEL_ID;
}

export function createOllamaCloudModel(): OpenAIChatCompletionsModel {
	const apiKey = env.OLLAMA_CLOUD_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OLLAMA_CLOUD_API_KEY is not set. Add it to .env (see .env.example).",
		);
	}

	const client = new OpenAI({
		baseURL: env.OLLAMA_ENDPOINT || DEFAULT_OLLAMA_BASE_URL,
		apiKey,
	});
	return new OpenAIChatCompletionsModel(client, getCostModelId());
}

export function createOpenRouterModel(): OpenAIChatCompletionsModel {
	const apiKey = env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OPENROUTER_API_KEY is not set. Add it to .env (see .env.example).",
		);
	}

	const client = new OpenAI({
		baseURL: OPENROUTER_BASE_URL,
		apiKey,
	});
	return new OpenAIChatCompletionsModel(client, INTELLIGENCE_MODEL_ID);
}
