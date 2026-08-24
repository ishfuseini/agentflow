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
const MODEL_COST_USD_PER_1M: Record<string, { input: number; output: number }> =
	{
		// Ollama Cloud (gpt-oss:20b) is subscription-based; a nominal stand-in.
		"gpt-oss:20b": { input: 0.15, output: 0.15 },
		// claude-opus-4-8 via OpenRouter — Opus-class frontier pricing.
		"claude-opus-4-8": { input: 15, output: 75 },
	};

export function estimateCostUsd(
	modelId: string,
	usage: AgentsUsageSnapshot,
): number {
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
}: PipelineTraceInput<TResult>): Promise<{
	result: TResult;
	trace: PipelineTraceRecord;
}> {
	const runtime = getLangfuseRuntime();
	if (!runtime) {
		return {
			result: await execute(),
			trace: { traceId: null, telemetryLogged: false },
		};
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
				const costUsd = estimateCostUsd(model.modelId, usage);
				generation.update({
					output: result.finalOutput ?? null,
					usageDetails: buildUsageDetails(result.state.usage),
					metadata: buildAgentMetadata(
						runId,
						agentKey,
						agentName,
						routingMode,
						model,
						{ latencyMs, usage, costUsd },
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
						{ latencyMs, usage, costUsd },
					),
				});
				scoreTrace(runtime.client, agentObservation, "agent_success", 1);
				const evalScore = getEvalScore?.(result);
				if (typeof evalScore === "number") {
					scoreTrace(runtime.client, agentObservation, "eval_score", evalScore);
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
						evalScore: typeof evalScore === "number" ? evalScore : undefined,
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

// ---------------------------------------------------------------------------
// Trace reading (Langfuse API) — powers the trace summary table.
// ---------------------------------------------------------------------------

export interface TraceAgentSummary {
	agent: TracedAgentKey;
	label: string;
	latencyMs: number | null;
	tokenCount: number | null;
	costUsd: number | null;
	evalScore: number | null;
}

export interface TraceHitlSummary {
	decision: HitlDecisionType;
	humanLatencyMs: number;
}

export interface TraceAggregateSummary {
	latencyMs: number | null;
	totalTokens: number | null;
	costUsd: number | null;
	evalScore: number | null;
}

export interface RunTraceSummary {
	runId: string;
	available: boolean;
	found: boolean;
	agents: TraceAgentSummary[];
	hitl: TraceHitlSummary | null;
	aggregate: TraceAggregateSummary;
}

/** Subset of a Langfuse public-API trace list item we read. */
interface LangfuseTraceListItem {
	id: string;
	name: string | null;
}

/** Subset of a Langfuse observation (v1 view) we read. */
interface LangfuseObservation {
	id: string;
	name: string | null;
	type: string;
	parentObservationId: string | null;
	latency?: number | null;
	usageDetails?: Record<string, number> | null;
	totalPrice?: number | null;
	calculatedTotalCost?: number | null;
	metadata?: unknown;
}

/** Subset of a Langfuse trace detail (GET /api/public/traces/{id}). */
interface LangfuseTraceDetail {
	id: string;
	name: string | null;
	observations: LangfuseObservation[];
	scores: Array<{
		name: string;
		value: number;
		observationId?: string | null;
	}>;
}

interface LangfuseTraceListResponse {
	data: LangfuseTraceListItem[];
}

const PIPELINE_TRACE_NAME = "agentflow.pipeline";
const HITL_TRACE_NAME = "agentflow.hitl_decision";
const GENERATION_OBSERVATION_TYPE = "GENERATION";
const EVAL_SCORE_NAME = "eval_score";
const HUMAN_LATENCY_SCORE_NAME = "human_latency_ms";

const AGENT_OBSERVATION_NAMES: Record<TracedAgentKey, string> = {
	qualifier: "agentflow.agent.qualifier",
	architect: "agentflow.agent.architect",
	riskChecker: "agentflow.agent.riskChecker",
};

const AGENT_LABELS: Record<TracedAgentKey, string> = {
	qualifier: "Qualifier",
	architect: "Architect",
	riskChecker: "Risk Checker",
};

const TRACED_AGENTS: TracedAgentKey[] = [
	"qualifier",
	"architect",
	"riskChecker",
];

const TRACE_FETCH_RETRIES = 3;
const TRACE_FETCH_RETRY_DELAY_MS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function waitForTraceExport(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyRunTraceSummary(
	runId: string,
	available: boolean,
): RunTraceSummary {
	return {
		runId,
		available,
		found: false,
		agents: TRACED_AGENTS.map((agent) => ({
			agent,
			label: AGENT_LABELS[agent],
			latencyMs: null,
			tokenCount: null,
			costUsd: null,
			evalScore: null,
		})),
		hitl: null,
		aggregate: {
			latencyMs: null,
			totalTokens: null,
			costUsd: null,
			evalScore: null,
		},
	};
}

function readCostUsd(observation: LangfuseObservation | undefined): number | null {
	if (!observation) {
		return null;
	}
	const metadata = isRecord(observation.metadata) ? observation.metadata : {};
	if (typeof metadata.costUsd === "number") {
		return metadata.costUsd;
	}
	if (typeof observation.totalPrice === "number") {
		return observation.totalPrice;
	}
	if (typeof observation.calculatedTotalCost === "number") {
		return observation.calculatedTotalCost;
	}
	return null;
}

function readEvalScore(
	trace: LangfuseTraceDetail,
	observationId: string,
): number | null {
	const score = trace.scores.find(
		(item) =>
			item.name === EVAL_SCORE_NAME &&
			(item.observationId === observationId || item.observationId === null),
	);
	return score && typeof score.value === "number" ? score.value : null;
}

function extractAgentSummary(
	trace: LangfuseTraceDetail,
	agent: TracedAgentKey,
): TraceAgentSummary {
	const label = AGENT_LABELS[agent];
	const root = trace.observations.find(
		(observation) => observation.name === AGENT_OBSERVATION_NAMES[agent],
	);
	if (!root) {
		return {
			agent,
			label,
			latencyMs: null,
			tokenCount: null,
			costUsd: null,
			evalScore: null,
		};
	}
	const generation = trace.observations.find(
		(observation) =>
			observation.parentObservationId === root.id &&
			observation.type === GENERATION_OBSERVATION_TYPE,
	);
	const usageSource = generation ?? root;
	const tokenCount =
		typeof usageSource.usageDetails?.total === "number"
			? usageSource.usageDetails.total
			: null;
	const latencyMs =
		typeof root.latency === "number" ? root.latency * 1000 : null;
	const costUsd = readCostUsd(root) ?? readCostUsd(generation);
	const evalScore = readEvalScore(trace, root.id);
	return { agent, label, latencyMs, tokenCount, costUsd, evalScore };
}

function extractHitlSummary(trace: LangfuseTraceDetail): TraceHitlSummary | null {
	const root = trace.observations.find(
		(observation) => observation.name === HITL_TRACE_NAME,
	);
	const metadata = isRecord(root?.metadata) ? root.metadata : {};
	const decision: HitlDecisionType | undefined =
		metadata.decision === "approved" || metadata.decision === "edited"
			? metadata.decision
			: undefined;
	let humanLatencyMs =
		typeof metadata.humanLatencyMs === "number" ? metadata.humanLatencyMs : null;
	if (humanLatencyMs === null) {
		const score = trace.scores.find(
			(item) => item.name === HUMAN_LATENCY_SCORE_NAME,
		);
		humanLatencyMs =
			score && typeof score.value === "number" ? score.value : null;
	}
	if (!decision || humanLatencyMs === null) {
		return null;
	}
	return { decision, humanLatencyMs };
}

function buildAggregate(agents: TraceAgentSummary[]): TraceAggregateSummary {
	const latencies = agents.flatMap((agent) =>
		agent.latencyMs === null ? [] : [agent.latencyMs],
	);
	const tokens = agents.flatMap((agent) =>
		agent.tokenCount === null ? [] : [agent.tokenCount],
	);
	const costs = agents.flatMap((agent) =>
		agent.costUsd === null ? [] : [agent.costUsd],
	);
	const evals = agents.flatMap((agent) =>
		agent.evalScore === null ? [] : [agent.evalScore],
	);
	const sum = (values: number[]): number | null =>
		values.length === 0
			? null
			: values.reduce((total, value) => total + value, 0);
	return {
		latencyMs: sum(latencies),
		totalTokens: sum(tokens),
		costUsd: sum(costs),
		evalScore:
			evals.length === 0
				? null
				: evals.reduce((total, value) => total + value, 0) / evals.length,
	};
}

/**
 * Fetches the Langfuse trace summary for a pipeline run via the Langfuse API.
 *
 * Traces are scoped by `sessionId = runId` (see `tracePipelineRun`). The summary
 * contains one row per agent plus the HITL decision row (when present) and
 * aggregate totals — all read back from Langfuse, not from in-memory state.
 */
export async function fetchRunTraces(runId: string): Promise<RunTraceSummary> {
	const runtime = getLangfuseRuntime();
	if (!runtime) {
		return emptyRunTraceSummary(runId, false);
	}

	const api = runtime.client.api;
	let pipelineTrace: LangfuseTraceDetail | null = null;
	let hitlTrace: LangfuseTraceDetail | null = null;

	// The span processor exports with `exportMode: "immediate"`, but ingestion
	// can still lag a beat — retry briefly so a just-finished run is found.
	for (let attempt = 0; attempt < TRACE_FETCH_RETRIES; attempt += 1) {
		if (attempt > 0) {
			await waitForTraceExport(TRACE_FETCH_RETRY_DELAY_MS);
		}
		const traces = (await api.trace.list({
			sessionId: runId,
			limit: 50,
		})) as unknown as LangfuseTraceListResponse;
		const traceIdsByName = new Map(
			traces.data.map((trace) => [trace.name, trace.id]),
		);
		const pipelineId = traceIdsByName.get(PIPELINE_TRACE_NAME);
		if (pipelineId) {
			pipelineTrace = (await api.trace.get(
				pipelineId,
			)) as unknown as LangfuseTraceDetail;
			const hitlId = traceIdsByName.get(HITL_TRACE_NAME);
			if (hitlId) {
				hitlTrace = (await api.trace.get(
					hitlId,
				)) as unknown as LangfuseTraceDetail;
			}
			break;
		}
	}

	if (!pipelineTrace) {
		return emptyRunTraceSummary(runId, true);
	}

	const detail = pipelineTrace;
	const agents = TRACED_AGENTS.map((agent) =>
		extractAgentSummary(detail, agent),
	);
	const hitl = hitlTrace ? extractHitlSummary(hitlTrace) : null;
	return {
		runId,
		available: true,
		found: true,
		agents,
		hitl,
		aggregate: buildAggregate(agents),
	};
}
