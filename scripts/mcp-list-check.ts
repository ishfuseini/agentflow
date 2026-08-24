/**
 * Verifies that all 4 agentflow-mcp tools are discoverable via MCP tool listing
 * (task 3.1 of the agentflow-demo change).
 *
 * Run with Node >= 22.6 (built-in type stripping + .env loading):
 *   node --env-file=.env --experimental-strip-types scripts/mcp-list-check.ts
 *
 * Or with tsx (any Node >= 20):
 *   npx tsx --env-file=.env scripts/mcp-list-check.ts
 */
import { MCPServerStreamableHttp } from "@openai/agents";

const EXPECTED_TOOLS = [
	"arch_pattern_lookup",
	"brand_context_lookup",
	"risk_policy_lookup",
	"tool_selection_lookup",
] as const;

/** Generous timeout: the Fly.io deployment scales to zero when idle. */
const MCP_TIMEOUT_MS = 60_000;

const url =
	process.env.AGENTFLOW_MCP_URL ?? "https://agentflow-mcp.fly.dev/mcp";

const server = new MCPServerStreamableHttp({
	url,
	name: "agentflow-mcp-list-check",
	timeout: MCP_TIMEOUT_MS,
});

try {
	await server.connect();
	const tools = await server.listTools();
	const names = tools.map((tool) => tool.name).sort();

	console.log(`agentflow-mcp: ${url}`);
	console.log(`Discovered tools (${names.length}):`);
	for (const name of names) {
		console.log(`  - ${name}`);
	}

	const missing = EXPECTED_TOOLS.filter((name) => !names.includes(name));
	if (missing.length > 0) {
		console.error(`✗ Missing tools: ${missing.join(", ")}`);
		process.exitCode = 1;
	} else {
		console.log("✓ All 4 expected tools are discoverable");
	}
} catch (error) {
	console.error(`✗ Failed to list tools from ${url}`);
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await server.close().catch(() => undefined);
}
