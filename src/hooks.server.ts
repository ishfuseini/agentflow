import { configureTracing } from "$lib/pipeline/tracing";

// Configure OpenAI Agents SDK tracing → Langfuse OTLP at server boot.
// Replaces the SDK's default OpenAI exporter (source of the
// "No API key provided for OpenAI tracing exporter" noise) with a Langfuse
// exporter. Idempotent and guarded by a globalThis flag.
configureTracing();

// Per-run manual traces (agentflow.pipeline / agentflow.agent.*) are still
// handled inside traceAgentRun/tracePipelineRun in src/lib/pipeline/langfuse.ts.
