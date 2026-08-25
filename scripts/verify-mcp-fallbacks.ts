/**
 * Verifies the graceful-fallback contracts from the mcp-tool-integration
 * spec (tasks 3.9 and 3.10) against the live agentflow-mcp server:
 *
 *   3.9  brand_context_lookup unavailable  -> resolves with available=false, no logo
 *   3.10 arch_pattern_lookup weak match    -> generic_enterprise_ai_poc, confidence < 0.5
 *        arch_diagram on the fallback      -> available=false, no diagram_data
 *
 * Both fallbacks are decided server-side, so this needs no model and no LLM
 * credentials — only AGENTFLOW_MCP_URL. The agents' downstream reaction to
 * these responses (weak_match=true, continuing without brand context) is
 * prompt-driven and is covered by the live run in verify-e2e-mcp.ts.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/verify-mcp-fallbacks.ts
 */
import { MCPServerStreamableHttp } from "@openai/agents";

const url =
	process.env.AGENTFLOW_MCP_URL ?? "https://agentflow-mcp.fly.dev/mcp";

/** Generous timeout: the Fly.io deployment scales to zero when idle. */
const MCP_TIMEOUT_MS = 60_000;

/** A domain that cannot resolve, forcing the unavailable path. */
const UNRESOLVABLE_DOMAIN = "this-company-does-not-exist-zzq472.invalid";

const failures: string[] = [];

function expect(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
	} else {
		console.error(`  ✗ ${message}`);
		failures.push(message);
	}
}

/** MCP tools return their JSON payload as a text content block. */
function parseToolResult(result: unknown): Record<string, unknown> {
	const blocks = Array.isArray(result)
		? result
		: ((result as { content?: unknown[] } | null | undefined)?.content ?? []);
	const text = (blocks as Array<{ type?: string; text?: string }>).find(
		(block) => block?.type === "text",
	)?.text;
	if (!text) {
		throw new Error(
			`No text content block in tool result: ${JSON.stringify(result)}`,
		);
	}
	return JSON.parse(text) as Record<string, unknown>;
}

const server = new MCPServerStreamableHttp({
	url,
	name: "agentflow-mcp-fallback-check",
	timeout: MCP_TIMEOUT_MS,
});

console.log(`agentflow-mcp: ${url}\n`);
await server.connect();

try {
	console.log("3.9 — brand_context_lookup returns unavailable, does not throw");
	let brand: Record<string, unknown>;
	try {
		brand = parseToolResult(
			await server.callTool("brand_context_lookup", {
				domain: UNRESOLVABLE_DOMAIN,
			}),
		);
		expect(true, "call resolved instead of throwing");
	} catch (error) {
		expect(false, `call resolved instead of throwing (threw: ${error})`);
		throw error;
	}
	expect(
		brand.available === false,
		`available === false (got ${JSON.stringify(brand.available)})`,
	);
	expect(
		brand.logo_url === null || brand.logo_url === undefined,
		`logo_url is null/omitted (got ${JSON.stringify(brand.logo_url)})`,
	);
	expect(
		brand.company_name === null || brand.company_name === undefined,
		`company_name is null/omitted (got ${JSON.stringify(brand.company_name)})`,
	);
	expect(
		brand.confidence === 0,
		`confidence === 0 (got ${JSON.stringify(brand.confidence)})`,
	);
	expect(typeof brand.message === "string", "carries a human-readable message");

	console.log(
		"\n3.10 — arch_pattern_lookup returns weak match with no diagram, does not throw",
	);
	let arch: Record<string, unknown>;
	try {
		arch = parseToolResult(
			await server.callTool("arch_pattern_lookup", {
				industry: "competitive_underwater_basket_weaving",
				data_stack: ["Lotus Notes"],
				cloud: "on-prem",
				constraints: ["none"],
				latency: "batch",
			}),
		);
		expect(true, "call resolved instead of throwing");
	} catch (error) {
		expect(false, `call resolved instead of throwing (threw: ${error})`);
		throw error;
	}
	expect(
		typeof arch.pattern_id === "string",
		`returns a fallback pattern_id (got ${JSON.stringify(arch.pattern_id)})`,
	);
	expect(
		typeof arch.confidence === "number" && (arch.confidence as number) < 0.5,
		`confidence < 0.5 (got ${JSON.stringify(arch.confidence)})`,
	);
	expect(
		arch.pattern_id === "generic_enterprise_ai_poc",
		`pattern_id is generic_enterprise_ai_poc (got ${JSON.stringify(arch.pattern_id)})`,
	);
	expect(
		arch.diagram_data === undefined || arch.diagram_data === null,
		"diagram_data never returned inline by arch_pattern_lookup",
	);
	expect(
		arch.source_references === undefined || arch.source_references === null,
		"source_references never returned inline by arch_pattern_lookup",
	);
	expect(
		Array.isArray(arch.recommended_components),
		"still returns recommended_components to build on",
	);

	console.log(
		"\n3.10 — arch_diagram on the fallback pattern returns available=false",
	);
	const diagram = parseToolResult(
		await server.callTool("arch_diagram", {
			pattern_id: arch.pattern_id as string,
		}),
	);
	expect(
		diagram.available === false,
		`available === false (got ${JSON.stringify(diagram.available)})`,
	);
	expect(
		diagram.diagram_data === undefined || diagram.diagram_data === null,
		"diagram_data is null for the fallback pattern",
	);
	expect(
		typeof diagram.message === "string",
		"carries a human-readable message",
	);
} finally {
	await server.close().catch(() => undefined);
}

console.log("\n=== Summary ===");
if (failures.length === 0) {
	console.log("✓ All graceful-fallback contracts hold");
	process.exit(0);
}
console.error(`✗ ${failures.length} assertion(s) failed`);
for (const failure of failures) {
	console.error(`  - ${failure}`);
}
process.exit(1);
