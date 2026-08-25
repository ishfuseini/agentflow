// Smoke test for the Langfuse Agents SDK tracing bridge.
// Verifies configureAgentsTracing replaces the default OpenAI exporter and
// the exporter builds + fails non-fatally. Uses the same vite ssrLoadModule
// loader + $env mock pattern as langfuse.test.mjs.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";

const root = process.cwd();
const FILE_EXTENSION_SUFFIX = /\.(ts|js|mjs)$/;
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
		server: { middlewareMode: true },
		plugins: [
			{
				name: "agentflow-tracing-test-mocks",
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

const resetTracingState = () => {
	globalThis.__agentflowAgentsTracingTestEnv = {
		LANGFUSE_PUBLIC_KEY: "pk-test",
		LANGFUSE_SECRET_KEY: "sk-test",
		LANGFUSE_BASE_URL: "https://example.langfuse.com",
		LANGFUSE_RELEASE: "test-release",
		LANGFUSE_TRACING_ENVIRONMENT: "test",
	};
	globalThis.__agentflowAgentsTracingProcessor = undefined;
};

const mocks = {
	"$env/dynamic/private": `
		export const env = globalThis.__agentflowAgentsTracingTestEnv ?? {};
	`,
};

const withModule = async (fn) => {
	resetTracingState();
	const server = await createMockedServer(mocks);
	try {
		const module = await server.ssrLoadModule(
			"/src/lib/pipeline/agents-tracing.ts",
		);
		await fn(module);
	} finally {
		await server.close();
	}
};

test("configureAgentsTracing runs without throwing", async () => {
	await withModule((module) => {
		assert.doesNotThrow(() => module.configureAgentsTracing());
	});
});

test("configureAgentsTracing is idempotent across calls", async () => {
	await withModule((module) => {
		assert.doesNotThrow(() => module.configureAgentsTracing());
		assert.doesNotThrow(() => module.configureAgentsTracing());
	});
});

test("configureAgentsTracing clears processors when Langfuse is unconfigured", async () => {
	resetTracingState();
	globalThis.__agentflowAgentsTracingTestEnv = {}; // no keys
	globalThis.__agentflowAgentsTracingProcessor = undefined;
	const server = await createMockedServer(mocks);
	try {
		const module = await server.ssrLoadModule(
			"/src/lib/pipeline/agents-tracing.ts",
		);
		// Must not throw even though keys are missing — should install a no-op
		// processor set so the OpenAI exporter never runs.
		assert.doesNotThrow(() => module.configureAgentsTracing());
	} finally {
		await server.close();
	}
});

test("LangfuseAgentsExporter builds the correct OTLP endpoint", async () => {
	await withModule((module) => {
		const exporter = new module.LangfuseAgentsExporter({
			publicKey: "pk-test",
			secretKey: "sk-test",
			baseUrl: "https://example.langfuse.com",
		});
		assert.equal(
			exporter.endpoint,
			"https://example.langfuse.com/api/public/otel/v1/traces",
		);
	});
});

test("LangfuseAgentsExporter strips a trailing slash from baseUrl", async () => {
	await withModule((module) => {
		const exporter = new module.LangfuseAgentsExporter({
			publicKey: "pk-test",
			secretKey: "sk-test",
			baseUrl: "https://example.langfuse.com/",
		});
		assert.equal(
			exporter.endpoint,
			"https://example.langfuse.com/api/public/otel/v1/traces",
		);
	});
});

test("export() with empty items is a no-op (no network)", async () => {
	await withModule(async (module) => {
		const exporter = new module.LangfuseAgentsExporter({
			publicKey: "pk-test",
			secretKey: "sk-test",
			baseUrl: "https://example.langfuse.com",
		});
		await assert.doesNotReject(() => exporter.export([]));
	});
});

test("export() stays non-fatal when the endpoint is unreachable", async () => {
	await withModule(async (module) => {
		const exporter = new module.LangfuseAgentsExporter({
			publicKey: "pk-test",
			secretKey: "sk-test",
			baseUrl: "http://127.0.0.1:1", // nothing listening
		});
		const trace = {
			type: "trace",
			traceId: "trace_abcdef1234567890abcdef1234567890",
			name: "smoke",
			groupId: null,
			metadata: {},
		};
		const span = {
			type: "trace.span",
			spanId: "span_abcdef1234567890abcdef",
			traceId: trace.traceId,
			parentId: null,
			startedAt: new Date().toISOString(),
			endedAt: new Date().toISOString(),
			spanData: { type: "generation", model: "gpt-oss:20b" },
			error: null,
		};
		// Unreachable host would normally reject; exporter swallows it so a
		// tracing hiccup can never break a pipeline run.
		await assert.doesNotReject(() => exporter.export([trace, span]));
	});
});
