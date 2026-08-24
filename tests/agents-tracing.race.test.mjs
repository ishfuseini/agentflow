// Regression test: the OpenAI Agents SDK registers its OpenAI tracing exporter
// at module-import time (see @openai/agents/dist/index.mjs →
// setDefaultOpenAITracingExporter()). In dev, routes load lazily after
// hooks.server.ts, so the first import of @openai/agents can re-register the
// OpenAI exporter *after* our boot-time overwrite — resurrecting the
// "No API key provided for OpenAI tracing exporter" errors.
//
// configureAgentsTracing() re-asserts the Langfuse processor on every call, so
// runPipeline/runSingleAgent (which call it first) always win the race. This
// test proves a real trace exports through the Langfuse exporter with no
// "No API key" noise, even when @openai/agents is imported between calls.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";

const root = process.cwd();

const createTestServer = async () =>
	createServer({
		root,
		appType: "custom",
		configFile: false,
		logLevel: "error",
		resolve: { alias: { $lib: resolve(root, "src/lib") } },
		server: { middlewareMode: true },
		plugins: [
			{
				name: "race-test-env-mock",
				enforce: "pre",
				resolveId(id) {
					return id === "$env/dynamic/private"
						? { id: "\0mock:$env/dynamic/private", external: false }
						: undefined;
				},
				load(id) {
					if (id !== "\0mock:$env/dynamic/private") {
						return;
					}
					return "export const env = globalThis.__raceTestEnv ?? {};";
				},
			},
		],
		ssr: { noExternal: ["@openai/agents"] },
	});

const setupEnv = () => {
	globalThis.__raceTestEnv = {
		LANGFUSE_PUBLIC_KEY: "pk-test",
		LANGFUSE_SECRET_KEY: "sk-test",
		LANGFUSE_BASE_URL: "https://example.langfuse.com",
	};
	globalThis.__agentflowAgentsTracingProcessor = undefined;
};

// Capture console.error so we can assert the OpenAI exporter's "No API key"
// message never appears. The Langfuse exporter's own non-fatal warnings go to
// console.warn, so they don't trip this.
const captureConsoleError = () => {
	const errors = [];
	const original = console.error;
	console.error = (...args) => {
		errors.push(
			args.map((a) => (a instanceof Error ? a.message : a)).join(" "),
		);
	};
	return {
		errors,
		restore: () => {
			console.error = original;
		},
	};
};

test("configureAgentsTracing wins the race against @openai/agents import-time registration", async () => {
	setupEnv();
	const server = await createTestServer();
	const cap = captureConsoleError();
	try {
		const tracing = await server.ssrLoadModule("/src/lib/pipeline/tracing.ts");
		// Boot-time configure.
		tracing.configureTracing();

		// Simulate a route lazily importing @openai/agents after boot (this is
		// what resurrects the OpenAI exporter in dev).
		await import("@openai/agents");

		// Re-assert — this is what runPipeline/runSingleAgent do first.
		tracing.configureTracing();

		// Create + end a real trace to trigger the active processor's export.
		const { getGlobalTraceProvider } = await import("@openai/agents");
		const provider = getGlobalTraceProvider();
		const trace = provider.createTrace({ name: "race test" });
		await trace.start();
		const span = provider.createSpan(
			{ traceId: trace.traceId, data: { type: "agent", name: "Race Agent" } },
			trace,
		);
		span.start();
		span.end();
		await trace.end();
		await provider.forceFlush();

		const noApiKeyNoise = cap.errors.filter((e) =>
			e.includes("No API key provided for OpenAI tracing exporter"),
		);
		assert.deepEqual(
			noApiKeyNoise,
			[],
			"OpenAI tracing exporter must not run after configureAgentsTracing",
		);
	} finally {
		cap.restore();
		await server.close();
	}
});

test("no OpenAI exporter noise even when Langfuse is unconfigured", async () => {
	globalThis.__raceTestEnv = {}; // no keys
	globalThis.__agentflowAgentsTracingProcessor = undefined;
	const server = await createTestServer();
	const cap = captureConsoleError();
	try {
		const tracing = await server.ssrLoadModule("/src/lib/pipeline/tracing.ts");
		tracing.configureTracing();
		await import("@openai/agents");
		tracing.configureTracing();

		const { getGlobalTraceProvider } = await import("@openai/agents");
		const provider = getGlobalTraceProvider();
		const trace = provider.createTrace({ name: "unconfigured test" });
		await trace.start();
		const span = provider.createSpan(
			{ traceId: trace.traceId, data: { type: "agent", name: "Agent" } },
			trace,
		);
		span.start();
		span.end();
		await trace.end();
		await provider.forceFlush();

		const noise = cap.errors.filter((e) =>
			e.includes("No API key provided for OpenAI tracing exporter"),
		);
		assert.deepEqual(noise, [], "No OpenAI exporter noise when unconfigured");
	} finally {
		cap.restore();
		await server.close();
	}
});
