import { configureAgentsTracing } from "./agents-tracing";

/**
 * Configures OpenAI Agents SDK tracing once at server boot.
 *
 * Replaces the SDK's default OpenAI tracing exporter (which logs
 * "No API key provided for OpenAI tracing exporter" when OPENAI_API_KEY is a
 * dummy) with a Langfuse OTLP exporter, so the Agents SDK's native
 * agent/generation/tool/MCP spans ship to Langfuse without noisy errors.
 *
 * The per-run manual traces (`tracePipelineRun`/`traceAgentRun` in langfuse.ts)
 * are configured separately and are unaffected.
 */
export function configureTracing(): void {
	configureAgentsTracing();
}
