import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
	type LangfuseAgent,
	type LangfuseSpan,
	propagateAttributes,
	startActiveObservation,
} from "@langfuse/tracing";
import type { Usage as AgentsUsage } from "@openai/agents";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { env } from "$env/dynamic/private";
import type { PocPlan } from "$lib/agents/types";
import type { HitlDecisionType, JsonDiffEntry } from "./hitl";
import type { AgentModelConfig, RoutingMode } from "./routing";

export interface HitlDecisionLogInput {
	runId: string;
	decision: HitlDecisionType;
	humanLatencyMs: number;
	originalPlan: PocPlan;
	finalPlan: PocPlan;
	diff: JsonDiffEntry[];
}

export type TracedAgentKey = "qualifier" | "architect" | "riskChecker";

export interface AgentRunTraceInput<TResult extends AgentRunTelemetryResult> {
	runId: string;
	agentKey: TracedAgentKey;
	agentName: string;
	routingMode: RoutingMode;
	model: AgentModelConfig;
	input: unknown;
	execute: () => Promise<TResult>;
	getEvalScore?: (result: TResult) => number | undefined;
}

export interface AgentTraceRecord {
	agent: TracedAgentKey;
	traceId: string | null;
	latencyMs: number;
	usage: AgentsUsageSnapshot | null;
	tokenCount: number;
	costUsd: number;
	evalScore?: number;
	telemetryLogged: boolean;
}

interface AgentRunTelemetryResult {
	finalOutput?: unknown;
	state: {
		usage: AgentsUsage;
	};
}

interface AgentsUsageSnapshot {
	requests: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	inputTokensDetails: Record<string, number>[];
	outputTokensDetails: Record<string, number>[];
	requestUsageEntries?: Array<{
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		inputTokensDetails: Record<string, number>;
		outputTokensDetails: Record<string, number>;
		endpoint?: string;
	}>;
}

interface LangfuseRuntime {
	client: LangfuseClient;
	spanProcessor: LangfuseSpanProcessor;
	sdk: NodeSDK;
}

type AgentflowGlobal = typeof globalThis & {
	__agentflowLangfuseRuntime?: LangfuseRuntime;
};

export function isLangfuseConfigured(): boolean {
	return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

function getLangfuseRuntime(): LangfuseRuntime | null {
	if (!isLangfuseConfigured()) {
		return null;
	}

	const agentflowGlobal = globalThis as AgentflowGlobal;
	if (agentflowGlobal.__agentflowLangfuseRuntime) {
		return agentflowGlobal.__agentflowLangfuseRuntime;
	}

	const spanProcessor = new LangfuseSpanProcessor({
		publicKey: env.LANGFUSE_PUBLIC_KEY,
		secretKey: env.LANGFUSE_SECRET_KEY,
		baseUrl: env.LANGFUSE_BASE_URL,
		exportMode: "immediate",
		release: env.LANGFUSE_RELEASE,
	});
	const sdk = new NodeSDK({
		serviceName: "agentflow",
		spanProcessors: [spanProcessor],
	});
	sdk.start();

	agentflowGlobal.__agentflowLangfuseRuntime = {
		client: new LangfuseClient({
			publicKey: env.LANGFUSE_PUBLIC_KEY,
			secretKey: env.LANGFUSE_SECRET_KEY,
			baseUrl: env.LANGFUSE_BASE_URL,
		}),
		spanProcessor,
		sdk,
	};
	return agentflowGlobal.__agentflowLangfuseRuntime;
}

async function flushLangfuse(runtime: LangfuseRuntime): Promise<boolean> {
	try {
		await Promise.all([
			runtime.spanProcessor.forceFlush(),
			runtime.client.flush(),
		]);
		return true;
	} catch {
		return false;
	}
}

function snapshotUsage(usage: AgentsUsage): AgentsUsageSnapshot {
	return {
		requests: usage.requests,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		totalTokens: usage.totalTokens,
		inputTokensDetails: usage.inputTokensDetails,
		outputTokensDetails: usage.outputTokensDetails,
		...(usage.requestUsageEntries
			? {
					requestUsageEntries: usage.requestUsageEntries.map((entry) => ({
						inputTokens: entry.inputTokens,
						outputTokens: entry.outputTokens,
						totalTokens: entry.totalTokens,
						inputTokensDetails: entry.inputTokensDetails,
						outputTokensDetails: entry.outputTokensDetails,
						...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
					})),
				}
			: {}),
	};
}

function buildUsageDetails(usage: AgentsUsage): Record<string, number> {
	return {
		input: usage.inputTokens,
		output: usage.outputTokens,
		total: usage.totalTokens,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Agent run failed";
}

function buildAgentMetadata(
	runId: string,
	agentKey: TracedAgentKey,
	agentName: string,
	routingMode: RoutingMode,
	model: AgentModelConfig,
	extras: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		app: "agentflow",
		runId,
		agent: agentKey,
		agentName,
		routingMode,
		provider: model.provider,
		modelId: model.modelId,
		langfuseProjectScope: "dedicated-agentflow-project-keys",
		...extras,
	};
}

function scoreTrace(
	client: LangfuseClient,
	observation: LangfuseAgent | LangfuseSpan,
	name: string,
	value: number,
): void {
	client.score.create({
		traceId: observation.traceId,
		name,
		value,
	});
}

/**
 * Nominal per-1M-token pricing for the cost column in the trace summary.
 * Demo estimates — tune to actual provider invoices.
 */
const MODEL_COST_USD_PER_1M: Record<string, { input: number; output: number }> = {
	// Ollama Cloud (gpt-oss:20b) is subscription-based; a nominal stand-in.
	"gpt-oss:20b": { input: 0.15, output: 0.15 },
	// claude-opus-4-8 via OpenRouter — Opus-class frontier pricing.
	"claude-opus-4-8": { input: 15, output: 75 },
};

function estimateCostUsd(modelId: string, usage: AgentsUsageSnapshot): number {
	const pricing = MODEL_COST_USD_PER_1M[modelId] ?? { input: 0, output: 0 };
	return (
		(usage.inputTokens / 1_000_000) * pricing.input +
		(usage.outputTokens / 1_000_000) * pricing.output
	);
}

export interface PipelineTraceInput<TResult> {
	runId: string;
	prompt: string;
	routingMode: RoutingMode;
	execute: () => Promise<TResult>;
}

export interface PipelineTraceRecord {
	traceId: string | null;
	telemetryLogged: boolean;
}

/**
 * Wraps a full pipeline run in a single Langfuse trace (`agentflow.pipeline`),
 * scoped by sessionId = runId. Agent runs executed inside `execute` nest as
 * child observations of this trace via the active observation context.
 */
export async function tracePipelineRun<TResult>({
	runId,
	prompt,
	routingMode,
	execute,
}: PipelineTraceInput<TResult>): Promise<{ result: TResult; trace: PipelineTraceRecord }> {
	const runtime = getLangfuseRuntime();
	if (!runtime) {
		return { result: await execute(), trace: { traceId: null, telemetryLogged: false } };
	}

	const traceName = "agentflow.pipeline";
	return await startActiveObservation(
		traceName,
		async (pipelineObservation) =>
			await propagateAttributes(
				{
					sessionId: runId,
					traceName,
					tags: ["agentflow", "pipeline-run", routingMode],
					metadata: { app: "agentflow", runId, routingMode },
				},
				async () => {
					pipelineObservation.update({
						input: prompt,
						metadata: { app: "agentflow", runId, routingMode },
					});
					try {
						const result = await execute();
						pipelineObservation.update({
							output: {
								status: "completed",
								runId,
								agents: ["qualifier", "architect", "riskChecker"],
							},
							metadata: { app: "agentflow", runId, routingMode },
						});
						return {
							result,
							trace: {
								traceId: pipelineObservation.traceId,
								telemetryLogged: await flushLangfuse(runtime),
							},
						};
					} catch (error) {
						pipelineObservation.update({
							output: { error: errorMessage(error) },
							level: "ERROR",
							statusMessage: errorMessage(error),
							metadata: { app: "agentflow", runId, routingMode },
						});
						await flushLangfuse(runtime);
						throw error;
					} finally {
						pipelineObservation.end();
					}
				},
			),
		{
			asType: "span",
			endOnExit: false,
			startTime: new Date(),
		},
	);
}

export async function traceAgentRun<TResult extends AgentRunTelemetryResult>({
	runId,
	agentKey,
	agentName,
	routingMode,
	model,
	input,
	execute,
	getEvalScore,
}: AgentRunTraceInput<TResult>): Promise<{
	result: TResult;
	trace: AgentTraceRecord;
}> {
	const runtime = getLangfuseRuntime();
	if (!runtime) {
		const startedAt = Date.now();
		const result = await execute();
		const usage = snapshotUsage(result.state.usage);
		return {
			result,
			trace: {
				agent: agentKey,
				traceId: null,
				latencyMs: Date.now() - startedAt,
				usage,
				tokenCount: usage.totalTokens,
				costUsd: estimateCostUsd(model.modelId, usage),
				evalScore: getEvalScore?.(result),
				telemetryLogged: false,
			},
		};
	}

	const startedAt = Date.now();
	const traceName = `agentflow.agent.${agentKey}`;

	return await startActiveObservation(
		traceName,
		async (agentObservation) => {
			agentObservation.update({
				input,
				metadata: buildAgentMetadata(
					runId,
					agentKey,
					agentName,
					routingMode,
					model,
				),
			});
					let agentObservationEnded = false;
					let generationEnded = false;
					const generation = agentObservation.startObservation(
						`${agentName} generation`,
						{
							input,
							model: model.modelId,
							metadata: buildAgentMetadata(
								runId,
								agentKey,
								agentName,
								routingMode,
								model,
							),
						},
						{ asType: "generation" },
					);
					const endAgentObservation = () => {
						if (!agentObservationEnded) {
							agentObservation.end();
							agentObservationEnded = true;
						}
					};
					const endGeneration = () => {
						if (!generationEnded) {
							generation.end();
							generationEnded = true;
						}
					};

					try {
						const result = await execute();
						const latencyMs = Date.now() - startedAt;
						const usage = snapshotUsage(result.state.usage);
						generation.update({
							output: result.finalOutput ?? null,
							usageDetails: buildUsageDetails(result.state.usage),
							metadata: buildAgentMetadata(
								runId,
								agentKey,
								agentName,
								routingMode,
								model,
								{ latencyMs, usage },
							),
						});
						endGeneration();
						agentObservation.update({
							output: result.finalOutput ?? null,
							metadata: buildAgentMetadata(
								runId,
								agentKey,
								agentName,
								routingMode,
								model,
								{ latencyMs, usage },
							),
						});
						scoreTrace(runtime.client, agentObservation, "agent_success", 1);
						const evalScore = getEvalScore?.(result);
						if (typeof evalScore === "number") {
						scoreTrace(
						runtime.client,
						agentObservation,
						"eval_score",
						evalScore,
						);
						}
						endAgentObservation();

						return {
						result,
						trace: {
						agent: agentKey,
						traceId: agentObservation.traceId,
						latencyMs,
						usage,
						tokenCount: usage.totalTokens,
						 costUsd: estimateCostUsd(model.modelId, usage),
						  evalScore:
								typeof evalScore === "number" ? evalScore : undefined,
							telemetryLogged: await flushLangfuse(runtime),
						},
					};
					} catch (error) {
						const latencyMs = Date.now() - startedAt;
						const message = errorMessage(error);
						generation.update({
							output: { error: message },
							level: "ERROR",
							statusMessage: message,
							metadata: buildAgentMetadata(
								runId,
								agentKey,
								agentName,
								routingMode,
								model,
								{ latencyMs },
							),
						});
						endGeneration();
						const errorEvent = agentObservation.startObservation(
							"agent_run_error",
							{
								output: { error: message },
								level: "ERROR",
								statusMessage: message,
								metadata: { runId, agent: agentKey, message },
							},
							{ asType: "event" },
						);
						errorEvent.end();
						agentObservation.update({
							output: { error: message },
							level: "ERROR",
							statusMessage: message,
							metadata: buildAgentMetadata(
								runId,
								agentKey,
								agentName,
								routingMode,
								model,
								{ latencyMs },
							),
						});
						scoreTrace(runtime.client, agentObservation, "agent_success", 0);
						endAgentObservation();
						await flushLangfuse(runtime);
						throw error;
					} finally {
						endGeneration();
						endAgentObservation();
					}
			},
		{
			asType: "agent",
			endOnExit: false,
			startTime: new Date(startedAt),
		},
	);
}

export async function logHitlDecision({
	runId,
	decision,
	humanLatencyMs,
	originalPlan,
	finalPlan,
	diff,
}: HitlDecisionLogInput): Promise<boolean> {
	const runtime = getLangfuseRuntime();
	if (!runtime) {
		return false;
	}

	const traceName = "agentflow.hitl_decision";
	return await startActiveObservation(
		traceName,
		async (observation) =>
			await propagateAttributes(
				{
					sessionId: runId,
					traceName,
					tags: ["agentflow", "hitl", decision],
					metadata: {
						app: "agentflow",
						runId,
						decision,
					},
				},
				async () => {
					observation.update({
						input: { originalPlan },
						metadata: {
							runId,
							decision,
							humanLatencyMs,
							diff,
						},
					});
					let observationEnded = false;
					const endObservation = () => {
						if (!observationEnded) {
							observation.end();
							observationEnded = true;
						}
					};
					try {
						const decisionEvent = observation.startObservation(
							"hitl_gate_decision",
							{
								input: { originalPlan },
								output: { finalPlan },
								metadata: {
									decision,
									humanLatencyMs,
									diff,
								},
							},
							{ asType: "event" },
						);
						decisionEvent.end();
						observation.update({
							output: { finalPlan },
							metadata: {
								runId,
								decision,
								humanLatencyMs,
								diff,
							},
						});
						scoreTrace(
							runtime.client,
							observation,
							"human_latency_ms",
							humanLatencyMs,
						);
						endObservation();
						return await flushLangfuse(runtime);
					} finally {
						endObservation();
					}
				},
			),
		{
			endOnExit: false,
			asType: "span",
		},
	);
}
