import { OpenAIChatCompletionsModel } from "@openai/agents";
import { env } from "$env/dynamic/private";
import OpenAI from "openai";

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

const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const COST_MODEL_ID = "gpt-oss:20b";
export const INTELLIGENCE_MODEL_ID = "anthropic/claude-opus-4.8";

export function createOllamaCloudModel(): OpenAIChatCompletionsModel {
	const apiKey = env.OLLAMA_CLOUD_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OLLAMA_CLOUD_API_KEY is not set. Add it to .env (see .env.example).",
		);
	}

	const client = new OpenAI({
		baseURL: OLLAMA_CLOUD_BASE_URL,
		apiKey,
	});
	return new OpenAIChatCompletionsModel(client, COST_MODEL_ID);
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
