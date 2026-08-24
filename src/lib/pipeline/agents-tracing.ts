import {
	type AgentSpanData,
	BatchTraceProcessor,
	type FunctionSpanData,
	type GenerationSpanData,
	type GuardrailSpanData,
	type HandoffSpanData,
	type MCPListToolsSpanData,
	type Span,
	type SpanData,
	setTraceProcessors,
	type Trace,
	type TracingExporter,
	type TracingProcessor,
} from "@openai/agents";
import { env } from "$env/dynamic/private";

/**
 * Bridges the OpenAI Agents SDK's native tracing into Langfuse via its
 * OpenTelemetry (OTLP/HTTP) ingestion endpoint.
 *
 * Why this exists: the Agents SDK ships traces to OpenAI's tracing API by
 * default (`OpenAITracingExporter`), which logs
 * "No API key provided for OpenAI tracing exporter" on every export when
 * `OPENAI_API_KEY` is a dummy. Replacing the default processor with this
 * exporter routes the SDK's rich agent/generation/tool/MCP spans to Langfuse
 * instead — no noisy errors, and the detailed LLM telemetry shows up in the
 * Langfuse UI alongside the manual `agentflow.*` traces.
 *
 * The manual traces in `langfuse.ts` (`tracePipelineRun`/`traceAgentRun`) are
 * untouched — they remain the source for the in-app trace summary table. This
 * exporter only fills in the per-LLM-call and per-tool-call subtree that the
 * manual wrappers don't capture.
 */

const OTEL_TRACES_PATH = "/api/public/otel/v1/traces";
const INSTRUMENTATION_SCOPE = "gen_ai";

/** OTLP/JSON attribute value: oneof string|int|double|bool|array. */
type OtlpAttributeValue = string | number | boolean | OtlpAttributeValue[];
interface OtlpAttribute {
	key: string;
	value: {
		stringValue?: string;
		intValue?: string;
		doubleValue?: number;
		boolValue?: boolean;
		arrayValue?: { values: OtlpAttribute["value"][] };
	};
}

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: OtlpAttribute[];
	status: { code: number; message?: string };
}

interface OtlpResourceSpans {
	resource: {
		attributes: OtlpAttribute[];
	};
	scopeSpans: Array<{
		scope: { name: string };
		spans: OtlpSpan[];
	}>;
}

interface OtlpExportPayload {
	resourceSpans: OtlpResourceSpans[];
}

export interface LangfuseAgentsExporterOptions {
	publicKey: string;
	secretKey: string;
	baseUrl: string;
	/** App/service name attached to every exported span as a resource attribute. */
	serviceName?: string;
	/** Optional environment/release tags (e.g. dev, sha). */
	environment?: string;
	release?: string;
}

const TRACE_ID_PREFIX = /^trace_/;
const DASHES = /-/g;
const SPAN_ID_PREFIX = /^span_/;
const TRAILING_SLASH = /\/$/;
const ZERO_SPAN_ID = "0000000000000000";
const ZERO_TRACE_ID = "0".repeat(32);

/** Agents SDK trace/span IDs are prefixed and odd-length; OTLP needs fixed hex. */
function toOtlpTraceId(rawId: string | null | undefined): string {
	const hex = (rawId ?? "").replace(TRACE_ID_PREFIX, "").replace(DASHES, "");
	// OTLP trace IDs are 32 hex chars (128-bit). Pad/truncate to fit.
	return hex.padStart(32, "0").slice(-32);
}

function toOtlpSpanId(rawId: string | null | undefined): string {
	// Agents SDK span IDs are `span_` + 24 hex (96-bit). OTLP span IDs are 16 hex
	// (64-bit). Truncate to the last 16 chars — deterministic and preserves the
	// tree (parent/child both derive from their own IDs the same way).
	const hex = (rawId ?? "").replace(SPAN_ID_PREFIX, "").replace(DASHES, "");
	return hex.padStart(16, "0").slice(-16);
}

function attr(key: string, value: OtlpAttributeValue): OtlpAttribute {
	if (typeof value === "string") {
		return { key, value: { stringValue: value } };
	}
	if (typeof value === "number") {
		return {
			key,
			value: Number.isInteger(value)
				? { intValue: String(value) }
				: { doubleValue: value },
		};
	}
	if (typeof value === "boolean") {
		return { key, value: { boolValue: value } };
	}
	return {
		key,
		value: {
			arrayValue: {
				values: value.map((entry) => attr(key, entry).value),
			},
		},
	};
}

function isoToUnixNano(iso: string | null | undefined): string {
	if (!iso) {
		return "0";
	}
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) {
		return "0";
	}
	return String(ms * 1_000_000);
}

function spanName(data: SpanData, trace: Trace): string {
	if (data.type === "custom") {
		return data.name;
	}
	if (data.type === "generation") {
		return "chat.completions";
	}
	if (data.type === "function") {
		return data.name;
	}
	if (data.type === "agent") {
		return data.name;
	}
	return trace.name ?? data.type;
}

/**
 * Maps an Agents SDK `generation` span onto GenAI semantic conventions so
 * Langfuse renders it as an LLM generation with model, I/O, and usage.
 */
function generationAttributes(data: GenerationSpanData): OtlpAttribute[] {
	const attributes: OtlpAttribute[] = [
		attr("gen_ai.operation.name", "chat.completions"),
		attr("gen_ai.system", "openai"),
	];
	if (data.model) {
		attributes.push(attr("gen_ai.request.model", data.model));
	}
	if (data.input) {
		attributes.push(attr("gen_ai.input.messages", JSON.stringify(data.input)));
	}
	if (data.output) {
		attributes.push(
			attr("gen_ai.output.messages", JSON.stringify(data.output)),
		);
	}
	if (data.usage) {
		if (typeof data.usage.input_tokens === "number") {
			attributes.push(
				attr("gen_ai.usage.input_tokens", data.usage.input_tokens),
			);
		}
		if (typeof data.usage.output_tokens === "number") {
			attributes.push(
				attr("gen_ai.usage.output_tokens", data.usage.output_tokens),
			);
		}
	}
	return attributes;
}

function functionAttributes(data: FunctionSpanData): OtlpAttribute[] {
	const attributes: OtlpAttribute[] = [attr("gen_ai.tool.name", data.name)];
	if (data.input) {
		attributes.push(attr("gen_ai.tool.input", data.input));
	}
	if (data.output) {
		attributes.push(attr("gen_ai.tool.output", data.output));
	}
	if (data.mcp_data) {
		attributes.push(attr("mcp.data", data.mcp_data));
	}
	return attributes;
}

function agentAttributes(data: AgentSpanData): OtlpAttribute[] {
	const attributes: OtlpAttribute[] = [attr("gen_ai.agent.name", data.name)];
	if (data.tools?.length) {
		attributes.push(attr("gen_ai.agent.tools", data.tools));
	}
	if (data.output_type) {
		attributes.push(attr("gen_ai.agent.output_type", data.output_type));
	}
	return attributes;
}

function spanAttributes(span: Span<SpanData>): OtlpAttribute[] {
	const data = span.spanData;
	switch (data.type) {
		case "generation":
			return generationAttributes(data);
		case "function":
			return functionAttributes(data);
		case "agent":
			return agentAttributes(data);
		case "mcp_tools":
			return mcpToolsAttributes(data);
		case "handoff":
			return handoffAttributes(data);
		case "guardrail":
			return guardrailAttributes(data);
		case "custom":
			return customAttributes(data);
		default:
			return [];
	}
}

function mcpToolsAttributes(data: MCPListToolsSpanData): OtlpAttribute[] {
	const attributes: OtlpAttribute[] = [];
	if (data.server) {
		attributes.push(attr("mcp.server", data.server));
	}
	if (data.result) {
		attributes.push(attr("mcp.tools", data.result));
	}
	return attributes;
}

function handoffAttributes(data: HandoffSpanData): OtlpAttribute[] {
	const attributes: OtlpAttribute[] = [];
	if (data.from_agent) {
		attributes.push(attr("gen_ai.agent.from", data.from_agent));
	}
	if (data.to_agent) {
		attributes.push(attr("gen_ai.agent.to", data.to_agent));
	}
	return attributes;
}

function guardrailAttributes(data: GuardrailSpanData): OtlpAttribute[] {
	return [
		attr("guardrail.name", data.name),
		attr("guardrail.triggered", data.triggered),
	];
}

function customAttributes(
	data: Extract<SpanData, { type: "custom" }>,
): OtlpAttribute[] {
	const attributes: OtlpAttribute[] = [];
	for (const [key, value] of Object.entries(data.data)) {
		if (value === null || value === undefined) {
			continue;
		}
		attributes.push(attr(key, value as OtlpAttributeValue));
	}
	return attributes;
}

function toOtlpSpan(span: Span<SpanData>, trace: Trace): OtlpSpan | null {
	const spanId = toOtlpSpanId(span.spanId);
	const traceId = toOtlpTraceId(span.traceId);
	if (spanId === ZERO_SPAN_ID || traceId === ZERO_TRACE_ID) {
		return null;
	}
	const parentSpanId = span.parentId ? toOtlpSpanId(span.parentId) : undefined;
	const { error } = span;
	return {
		traceId,
		spanId,
		...(parentSpanId && parentSpanId !== ZERO_SPAN_ID ? { parentSpanId } : {}),
		name: spanName(span.spanData, trace),
		kind: 0, // UNSPECIFIED — Langfuse doesn't require a specific kind.
		startTimeUnixNano: isoToUnixNano(span.startedAt),
		endTimeUnixNano: isoToUnixNano(span.endedAt),
		attributes: spanAttributes(span),
		status: error ? { code: 2, message: error.message } : { code: 1 },
	};
}

function syntheticRootSpan(trace: Trace): OtlpSpan {
	const traceId = toOtlpTraceId(trace.traceId);
	return {
		traceId,
		spanId: toOtlpSpanId(`${trace.traceId}_root`),
		name: trace.name,
		kind: 0,
		startTimeUnixNano: isoToUnixNano(undefined),
		endTimeUnixNano: isoToUnixNano(undefined),
		attributes: [
			attr("workflow.name", trace.name),
			...(trace.groupId ? [attr("trace.group.id", trace.groupId)] : []),
			...(trace.metadata
				? [attr("trace.metadata", JSON.stringify(trace.metadata))]
				: []),
		],
		status: { code: 1 },
	};
}

/** Groups converted OTLP spans by traceId, adding a synthetic root per trace. */
function groupSpansByTraceId(
	traces: Trace[],
	spans: Span<SpanData>[],
): Map<string, OtlpSpan[]> {
	const [fallbackTrace] = traces;
	const spansByTraceId = new Map<string, OtlpSpan[]>();
	for (const span of spans) {
		const otlpSpan = toOtlpSpan(span, fallbackTrace ?? span);
		if (!otlpSpan) {
			continue;
		}
		const bucket = spansByTraceId.get(otlpSpan.traceId) ?? [];
		bucket.push(otlpSpan);
		spansByTraceId.set(otlpSpan.traceId, bucket);
	}

	// Traces carry workflow name + metadata as a synthetic root span so the
	// workflow name is visible in Langfuse even when the SDK only emitted child spans.
	for (const trace of traces) {
		const traceId = toOtlpTraceId(trace.traceId);
		if (traceId === ZERO_TRACE_ID) {
			continue;
		}
		const existing = spansByTraceId.get(traceId) ?? [];
		const hasRoot = existing.some((span) => !span.parentSpanId);
		if (!hasRoot) {
			existing.unshift(syntheticRootSpan(trace));
		}
		spansByTraceId.set(traceId, existing);
	}
	return spansByTraceId;
}

function buildOtlpPayload(
	resourceAttributes: OtlpAttribute[],
	spansByTraceId: Map<string, OtlpSpan[]>,
): OtlpExportPayload {
	return {
		resourceSpans: [
			{
				resource: { attributes: resourceAttributes },
				scopeSpans: [
					{
						scope: { name: INSTRUMENTATION_SCOPE },
						spans: [...spansByTraceId.values()].flat(),
					},
				],
			},
		],
	};
}

/**
 * A `TracingExporter` that ships Agents SDK traces/spans to Langfuse's OTLP
 * ingestion endpoint as standard OpenTelemetry spans.
 */
export class LangfuseAgentsExporter implements TracingExporter {
	private readonly publicKey: string;
	private readonly secretKey: string;
	private readonly endpoint: string;
	private readonly resourceAttributes: OtlpAttribute[];

	constructor(options: LangfuseAgentsExporterOptions) {
		this.publicKey = options.publicKey;
		this.secretKey = options.secretKey;
		this.endpoint = `${options.baseUrl.replace(TRAILING_SLASH, "")}${OTEL_TRACES_PATH}`;
		this.resourceAttributes = [
			attr("service.name", options.serviceName ?? "agentflow"),
			...(options.environment
				? [attr("deployment.environment", options.environment)]
				: []),
			...(options.release ? [attr("service.version", options.release)] : []),
		];
	}

	async export(
		items: (Trace | Span<SpanData>)[],
		signal?: AbortSignal,
	): Promise<void> {
		const traces = items.filter((item): item is Trace => item.type === "trace");
		const spans = items.filter(
			(item): item is Span<SpanData> => item.type === "trace.span",
		);
		// OTLP groups spans by resource. We have one resource (agentflow), but each
		// Agents SDK trace maps to a distinct OTLP traceId — so we group OTLP spans
		// by their traceId to keep the per-trace tree intact.
		const spansByTraceId = groupSpansByTraceId(traces, spans);
		if (spansByTraceId.size === 0) {
			return;
		}
		await this.postOtlp(
			buildOtlpPayload(this.resourceAttributes, spansByTraceId),
			signal,
		);
	}

	private async postOtlp(
		payload: OtlpExportPayload,
		signal?: AbortSignal,
	): Promise<void> {
		const auth = btoa(`${this.publicKey}:${this.secretKey}`);
		try {
			const response = await fetch(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Basic ${auth}`,
					"x-langfuse-public-key": this.publicKey,
				},
				body: JSON.stringify(payload),
				signal,
			});
			if (!response.ok) {
				// Non-fatal: tracing must never break a pipeline run. One-line warning
				// keeps it quiet unlike the OpenAI exporter's retry/noisy-error loop.
				console.warn(
					`[langfuse-agents-tracing] OTLP export failed: ${response.status} ${response.statusText}`,
				);
			}
		} catch (error) {
			console.warn(
				"[langfuse-agents-tracing] OTLP export error:",
				error instanceof Error ? error.message : error,
			);
		}
	}
}

type AgentflowGlobal = typeof globalThis & {
	__agentflowAgentsTracingProcessor?: TracingProcessor;
};

/**
 * Replaces the Agents SDK's default OpenAI tracing processor with a
 * Langfuse OTLP exporter. Idempotent and safe to call repeatedly.
 *
 * Why this must be re-asserted on every call (not just once at boot):
 * `@openai/agents` calls `setDefaultOpenAITracingExporter()` at module import
 * time (see @openai/agents/dist/index.mjs), which `setTraceProcessors`s in
 * the OpenAI exporter. In dev, routes load lazily after `hooks.server.ts`, so
 * the first import of `@openai/agents` (triggered by a route hitting
 * `orchestrator.ts`) can re-register the OpenAI exporter *after* our boot-time
 * overwrite — resurrecting the "No API key provided for OpenAI tracing
 * exporter" errors. Re-asserting each call wins that race.
 *
 * When Langfuse is not configured (missing keys), the processors are cleared
 * so the OpenAI exporter never runs and no errors are emitted.
 */
export function configureAgentsTracing(
	options?: Partial<{
		maxQueueSize?: number;
		maxBatchSize?: number;
		scheduleDelay?: number;
		exportTriggerRatio?: number;
	}>,
): void {
	const publicKey = env.LANGFUSE_PUBLIC_KEY;
	const secretKey = env.LANGFUSE_SECRET_KEY;
	const baseUrl = env.LANGFUSE_BASE_URL;

	if (!(publicKey && secretKey && baseUrl)) {
		// No Langfuse config → clear processors so the OpenAI exporter (the
		// source of the noisy errors) never runs.
		setTraceProcessors([]);
		return;
	}

	const agentflowGlobal = globalThis as AgentflowGlobal;
	if (!agentflowGlobal.__agentflowAgentsTracingProcessor) {
		const exporter = new LangfuseAgentsExporter({
			publicKey,
			secretKey,
			baseUrl,
			...(env.LANGFUSE_TRACING_ENVIRONMENT
				? { environment: env.LANGFUSE_TRACING_ENVIRONMENT }
				: {}),
			...(env.LANGFUSE_RELEASE ? { release: env.LANGFUSE_RELEASE } : {}),
		});
		agentflowGlobal.__agentflowAgentsTracingProcessor = new BatchTraceProcessor(
			exporter,
			options,
		);
	}
	// Re-assert on every call to overwrite any OpenAI exporter that
	// `@openai/agents`'s import-time setDefaultOpenAITracingExporter() registered.
	setTraceProcessors([agentflowGlobal.__agentflowAgentsTracingProcessor]);
}
