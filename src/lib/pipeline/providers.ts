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

/**
 * Local-test override. When `LLM_TEST_ENDPOINT` is set, the cost-tier model
 * resolves to that OpenAI-compatible endpoint (e.g. LM Studio / mlx-lm) using
 * `LLM_TEST_MODEL` and `LLM_TEST_KEY`, instead of Ollama Cloud. Lets the
 * pipeline run end-to-end without a paid Ollama Cloud / OpenRouter key.
 * Intelligence mode is unaffected — it still requires `OPENROUTER_API_KEY`.
 */
function createTestModel(): OpenAIChatCompletionsModel | undefined {
	const baseURL = env.LLM_TEST_ENDPOINT;
	if (!baseURL) {
		return undefined;
	}
	const apiKey = env.LLM_TEST_KEY ?? "test";
	const modelId = env.LLM_TEST_MODEL;
	if (!modelId) {
		throw new Error(
			"LLM_TEST_ENDPOINT is set but LLM_TEST_MODEL is not. Add both to .env.",
		);
	}
	const client = new OpenAI({ baseURL, apiKey });
	return new OpenAIChatCompletionsModel(client, modelId);
}

export function createOllamaCloudModel(): OpenAIChatCompletionsModel {
	const testModel = createTestModel();
	if (testModel) {
		return testModel;
	}

	const apiKey = env.OLLAMA_CLOUD_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OLLAMA_CLOUD_API_KEY is not set. Add it to .env (see .env.example), or set LLM_TEST_ENDPOINT/LLM_TEST_MODEL to route to a local OpenAI-compatible model.",
		);
	}

	const client = new OpenAI({
		baseURL: env.OLLAMA_ENDPOINT || DEFAULT_OLLAMA_BASE_URL,
		apiKey,
	});
	return new OpenAIChatCompletionsModel(
		client,
		env.OLLAMA_MODEL || DEFAULT_COST_MODEL_ID,
	);
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
