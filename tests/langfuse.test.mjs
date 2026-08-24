import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const FILE_EXTENSION_SUFFIX = /\.(ts|js|mjs)$/;
const AGENT_FAILED_MESSAGE = /agent failed/;

const normalizeModuleId = (id) => {
	const normalized = id.split("\\").join("/");
	const normalizedRoot = root.split("\\").join("/");
	if (normalized.startsWith(`${normalizedRoot}/`)) {
		return normalized
			.slice(normalizedRoot.length + 1)
			.replace(FILE_EXTENSION_SUFFIX, "");
	}
	return normalized.replace(FILE_EXTENSION_SUFFIX, "");
};

const getMock = (moduleMocks, id) =>
	moduleMocks[id] ??
	moduleMocks[normalizeModuleId(id)] ??
	moduleMocks[`/${normalizeModuleId(id)}`];

const createMockedServer = async (moduleMocks) =>
	createServer({
		root,
		appType: "custom",
		configFile: false,
		logLevel: "error",
		resolve: {
			alias: {
				$lib: resolve(root, "src/lib"),
			},
		},
		server: {
			middlewareMode: true,
		},
		plugins: [
			{
				name: "agentflow-test-mocks",
				enforce: "pre",
				resolveId(id) {
					return getMock(moduleMocks, id) === undefined
						? undefined
						: { id: `\0mock:${id}`, external: false };
				},
				load(id) {
					if (!id.startsWith("\0mock:")) {
						return;
					}
					return getMock(moduleMocks, id.slice("\0mock:".length));
				},
			},
		],
		ssr: {
			noExternal: Object.keys(moduleMocks).filter((id) => id.startsWith("@")),
		},
	});

const usage = {
	requests: 1,
	inputTokens: 12,
	outputTokens: 34,
	totalTokens: 46,
	inputTokensDetails: [{ cached_tokens: 0 }],
	outputTokensDetails: [{ reasoning_tokens: 0 }],
	requestUsageEntries: [
		{
			inputTokens: 12,
			outputTokens: 34,
			totalTokens: 46,
			inputTokensDetails: { cached_tokens: 0 },
			outputTokensDetails: { reasoning_tokens: 0 },
			endpoint: "test-endpoint",
		},
	],
};

const model = {
	model: { id: "fake-model" },
	provider: "ollama-cloud",
	modelId: "gpt-oss:20b",
};

const pocPlan = {
	scope: "scope",
	timeline: "timeline",
	data_zones: ["bronze", "silver", "gold"],
	integrations: ["Databricks"],
	resource_estimate: "1 engineer",
};

const resetLangfuseState = () => {
	globalThis.__agentflowLangfuseRuntime = undefined;
	globalThis.__langfuseTestEnv = {
		LANGFUSE_PUBLIC_KEY: "pk-test",
		LANGFUSE_SECRET_KEY: "sk-test",
		LANGFUSE_BASE_URL: "https://langfuse.example.test",
		LANGFUSE_RELEASE: "test-release",
	};
	globalThis.__langfuseTestState = {
		clients: [],
		clientFlushes: 0,
		forceFlushes: 0,
		nextObservationId: 0,
		nextTraceId: 0,
		observations: [],
		propagations: [],
		scores: [],
		sdks: [],
		spanProcessors: [],
	};
	return globalThis.__langfuseTestState;
};

const langfuseMocks = {
	"$env/dynamic/private": `
		export const env = globalThis.__langfuseTestEnv ?? {};
	`,
	"@langfuse/client": `
		const state = () => globalThis.__langfuseTestState;
		export class LangfuseClient {
			constructor(params) {
				state().clients.push(params);
				this.score = {
					trace(observation, data) {
						state().scores.push({
							traceId: observation.traceId,
							observationId: observation.id,
							...data,
						});
					},
				};
			}
			async flush() {
				state().clientFlushes += 1;
			}
			async shutdown() {}
		}
	`,
	"@langfuse/otel": `
		const state = () => globalThis.__langfuseTestState;
		export class LangfuseSpanProcessor {
			constructor(params) {
				this.params = params;
				state().spanProcessors.push(params);
			}
			async forceFlush() {
				state().forceFlushes += 1;
			}
		}
	`,
	"@langfuse/tracing": `
		const state = () => globalThis.__langfuseTestState;

		class MockObservation {
			constructor(name, attributes = {}, options = {}, parent = null) {
				this.name = name;
				this.type = options.asType ?? "span";
				this.id = "obs-" + (++state().nextObservationId);
				this.traceId = parent?.traceId ?? "trace-" + (++state().nextTraceId);
				this.parentObservationId = parent?.id ?? null;
				this.input = attributes.input;
				this.output = attributes.output;
				this.level = attributes.level ?? "DEFAULT";
				this.statusMessage = attributes.statusMessage ?? "";
				this.metadata = {
					...(state().activePropagation?.metadata ?? {}),
					...(attributes.metadata ?? {}),
				};
				this.usageDetails = attributes.usageDetails;
				this.model = attributes.model;
				this.ended = false;
				this.updates = [];
				state().observations.push(this);
			}
			update(attributes) {
				this.updates.push(attributes);
				if ("input" in attributes) this.input = attributes.input;
				if ("output" in attributes) this.output = attributes.output;
				if ("level" in attributes) this.level = attributes.level;
				if ("statusMessage" in attributes) this.statusMessage = attributes.statusMessage;
				if ("usageDetails" in attributes) this.usageDetails = attributes.usageDetails;
				if ("metadata" in attributes) {
					this.metadata = { ...this.metadata, ...attributes.metadata };
				}
				return this;
			}
			startObservation(name, attributes = {}, options = {}) {
				return new MockObservation(name, attributes, options, this);
			}
			end() {
				this.ended = true;
			}
		}

		export async function propagateAttributes(params, fn) {
			state().propagations.push(params);
			const previous = state().activePropagation;
			state().activePropagation = params;
			try {
				return await fn();
			} finally {
				state().activePropagation = previous;
			}
		}

		export async function startActiveObservation(name, fn, options = {}) {
			const observation = new MockObservation(name, {}, options);
			const result = await fn(observation);
			if (options.endOnExit !== false) {
				observation.end();
			}
			return result;
		}
	`,
	"@opentelemetry/sdk-node": `
		const state = () => globalThis.__langfuseTestState;
		export class NodeSDK {
			constructor(params) {
				this.params = params;
				this.started = false;
				state().sdks.push(params);
			}
			start() {
				this.started = true;
				state().sdkStarted = (state().sdkStarted ?? 0) + 1;
			}
			async shutdown() {}
		}
	`,
};

const loadLangfuseModule = async () => {
	const server = await createMockedServer(langfuseMocks);
	try {
		return {
			module: await server.ssrLoadModule("/src/lib/pipeline/langfuse.ts"),
			server,
		};
	} catch (error) {
		await server.close();
		throw error;
	}
};

const findObservation = (state, name) =>
	state.observations.find((observation) => observation.name === name);

test("traceAgentRun initializes OTEL and logs an agent observation with child generation", async () => {
	const state = resetLangfuseState();
	const { module, server } = await loadLangfuseModule();
	try {
		const response = await module.traceAgentRun({
			runId: "run-1",
			agentKey: "qualifier",
			agentName: "Qualifier",
			routingMode: "cost",
			model,
			input: "hello",
			execute: async () => ({
				finalOutput: { ok: true },
				state: { usage },
			}),
			getEvalScore: () => 0.82,
		});

		assert.equal(response.trace.agent, "qualifier");
		assert.equal(response.trace.traceId, "trace-1");
		assert.equal(response.trace.telemetryLogged, true);
		assert.equal(response.trace.usage?.totalTokens, 46);
		assert.equal(state.sdkStarted, 1);
		assert.equal(state.spanProcessors[0].exportMode, "immediate");

		const rootObservation = findObservation(state, "agentflow.agent.qualifier");
		const generation = findObservation(state, "Qualifier generation");
		assert.equal(rootObservation.type, "agent");
		assert.equal(rootObservation.ended, true);
		assert.equal(rootObservation.metadata.runId, "run-1");
		assert.equal(rootObservation.metadata.routingMode, "cost");
		assert.equal(rootObservation.metadata.provider, "ollama-cloud");
		assert.equal(generation.type, "generation");
		assert.equal(generation.parentObservationId, rootObservation.id);
		assert.deepEqual(generation.usageDetails, {
			input: 12,
			output: 34,
			total: 46,
		});
		assert.deepEqual(generation.output, { ok: true });
		assert.deepEqual(
			state.scores.map(({ name, value }) => ({ name, value })),
			[
				{ name: "agent_success", value: 1 },
				{ name: "eval_score", value: 0.82 },
			],
		);
	} finally {
		await server.close();
	}
});

test("traceAgentRun logs ERROR observations and agent_success=0 when execution fails", async () => {
	const state = resetLangfuseState();
	const { module, server } = await loadLangfuseModule();
	try {
		await assert.rejects(
			module.traceAgentRun({
				runId: "run-error",
				agentKey: "architect",
				agentName: "Architect",
				routingMode: "cost",
				model,
				input: "hello",
				execute: () => Promise.reject(new Error("agent failed")),
			}),
			AGENT_FAILED_MESSAGE,
		);

		const rootObservation = findObservation(state, "agentflow.agent.architect");
		const generation = findObservation(state, "Architect generation");
		const errorEvent = findObservation(state, "agent_run_error");
		assert.equal(rootObservation.level, "ERROR");
		assert.equal(rootObservation.statusMessage, "agent failed");
		assert.equal(generation.level, "ERROR");
		assert.equal(generation.statusMessage, "agent failed");
		assert.equal(errorEvent.type, "event");
		assert.deepEqual(errorEvent.output, { error: "agent failed" });
		assert.deepEqual(state.scores, [
			{
				traceId: rootObservation.traceId,
				observationId: rootObservation.id,
				name: "agent_success",
				value: 0,
			},
		]);
		assert.equal(state.forceFlushes, 1);
		assert.equal(state.clientFlushes, 1);
	} finally {
		await server.close();
	}
});

test("logHitlDecision creates a span, event metadata, and human latency score", async () => {
	const state = resetLangfuseState();
	const { module, server } = await loadLangfuseModule();
	try {
		const telemetryLogged = await module.logHitlDecision({
			runId: "run-hitl",
			decision: "approved",
			humanLatencyMs: 1234,
			originalPlan: pocPlan,
			finalPlan: pocPlan,
			diff: [],
		});

		const rootObservation = findObservation(state, "agentflow.hitl_decision");
		const decisionEvent = findObservation(state, "hitl_gate_decision");
		assert.equal(telemetryLogged, true);
		assert.equal(rootObservation.type, "span");
		assert.equal(rootObservation.metadata.runId, "run-hitl");
		assert.equal(rootObservation.metadata.decision, "approved");
		assert.equal(rootObservation.metadata.humanLatencyMs, 1234);
		assert.deepEqual(rootObservation.input, { originalPlan: pocPlan });
		assert.deepEqual(rootObservation.output, { finalPlan: pocPlan });
		assert.equal(decisionEvent.type, "event");
		assert.equal(decisionEvent.parentObservationId, rootObservation.id);
		assert.deepEqual(state.scores, [
			{
				traceId: rootObservation.traceId,
				observationId: rootObservation.id,
				name: "human_latency_ms",
				value: 1234,
			},
		]);
	} finally {
		await server.close();
	}
});

test("traceAgentRun propagates session and routing metadata into the OTEL context", async () => {
	const state = resetLangfuseState();
	const { module, server } = await loadLangfuseModule();
	try {
		await module.traceAgentRun({
			runId: "run-propagation",
			agentKey: "riskChecker",
			agentName: "Risk Checker",
			routingMode: "intelligence",
			model: {
				...model,
				provider: "openrouter",
				modelId: "anthropic/claude-opus-4.8",
			},
			input: { plan: true },
			execute: async () => ({
				finalOutput: { overall_score: 4 },
				state: { usage },
			}),
		});

		assert.deepEqual(state.propagations[0], {
			sessionId: "run-propagation",
			traceName: "agentflow.agent.riskChecker",
			tags: ["agentflow", "agent-run", "riskChecker", "intelligence"],
			metadata: {
				app: "agentflow",
				runId: "run-propagation",
				agent: "riskChecker",
				agentName: "Risk Checker",
				routingMode: "intelligence",
				provider: "openrouter",
				modelId: "anthropic/claude-opus-4.8",
			},
		});

		const generation = findObservation(state, "Risk Checker generation");
		assert.equal(generation.metadata.runId, "run-propagation");
		assert.equal(generation.metadata.routingMode, "intelligence");
		assert.equal(generation.metadata.provider, "openrouter");
	} finally {
		await server.close();
	}
});

test("POST /api/run returns trace records for all three agents", async () => {
	globalThis.__apiRunTestState = { calls: [] };
	const server = await createMockedServer({
		"$lib/pipeline/hitl": `
			export function shouldPauseForHitl() {
				return false;
			}
			export function buildFinalPocOutput() {
				return { ok: true };
			}
		`,
		"$lib/pipeline/hitl-state": `
			export async function createPendingHitlRun(pipeline, runId) {
				return { runId, gate: {}, pipeline };
			}
		`,
		"$lib/pipeline/orchestrator": `
			export async function runPipeline(prompt, routingMode, domain, runId) {
				globalThis.__apiRunTestState.calls.push({ prompt, routingMode, domain, runId });
				return {
					runId,
					prompt,
					routingMode,
					qualifier: { ok: true },
					architect: { poc_plan: {} },
					riskChecker: { overall_score: 4 },
					toolCalls: [],
					traces: [
						{ agent: "qualifier", traceId: "trace-q", latencyMs: 1, usage: null, telemetryLogged: true },
						{ agent: "architect", traceId: "trace-a", latencyMs: 2, usage: null, telemetryLogged: true },
						{ agent: "riskChecker", traceId: "trace-r", latencyMs: 3, usage: null, telemetryLogged: true },
					],
				};
			}
		`,
		"$lib/pipeline/routing": `
			export const ROUTING_MODES = ["cost", "intelligence"];
		`,
		"src/lib/pipeline/hitl": `
			export function shouldPauseForHitl() {
				return false;
			}
			export function buildFinalPocOutput() {
				return { ok: true };
			}
		`,
		"src/lib/pipeline/hitl-state": `
			export async function createPendingHitlRun(pipeline, runId) {
				return { runId, gate: {}, pipeline };
			}
		`,
		"src/lib/pipeline/orchestrator": `
			export async function runPipeline(prompt, routingMode, domain, runId) {
				globalThis.__apiRunTestState.calls.push({ prompt, routingMode, domain, runId });
				return {
					runId,
					prompt,
					routingMode,
					qualifier: { ok: true },
					architect: { poc_plan: {} },
					riskChecker: { overall_score: 4 },
					toolCalls: [],
					traces: [
						{ agent: "qualifier", traceId: "trace-q", latencyMs: 1, usage: null, telemetryLogged: true },
						{ agent: "architect", traceId: "trace-a", latencyMs: 2, usage: null, telemetryLogged: true },
						{ agent: "riskChecker", traceId: "trace-r", latencyMs: 3, usage: null, telemetryLogged: true },
					],
				};
			}
		`,
		"src/lib/pipeline/routing": `
			export const ROUTING_MODES = ["cost", "intelligence"];
		`,
	});
	try {
		const { POST } = await server.ssrLoadModule(
			"/src/routes/api/run/+server.ts",
		);
		const response = await POST({
			request: new Request("http://localhost/api/run", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					prompt: "hello",
					routingMode: "cost",
					domain: "example.com",
				}),
			}),
		});

		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.status, "completed");
		assert.deepEqual(
			body.pipeline.traces.map((trace) => trace.agent),
			["qualifier", "architect", "riskChecker"],
		);
		assert.deepEqual(
			body.pipeline.traces.map((trace) => trace.traceId),
			["trace-q", "trace-a", "trace-r"],
		);
		assert.equal(globalThis.__apiRunTestState.calls[0].runId, body.runId);
	} finally {
		await server.close();
	}
});
