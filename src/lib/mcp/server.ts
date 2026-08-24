import {
	createMCPToolStaticFilter,
	MCPServerStreamableHttp,
	type MCPServer,
} from "@openai/agents";
import { env } from "$env/dynamic/private";

/**
 * agentflow-mcp client registration (mcp-tool-integration spec).
 *
 * The server is an external tool provider deployed at agentflow-mcp.fly.dev/mcp
 * (HTTP stream transport). For local dev the server is inspected directly via
 * MCP Inspector over stdio — that path never goes through this app, so this
 * module only implements the remote HTTP transport.
 */

/** The four tools exposed by the agentflow-mcp server. */
export const MCP_TOOL_NAMES = {
	archPatternLookup: "arch_pattern_lookup",
	toolSelectionLookup: "tool_selection_lookup",
	brandContextLookup: "brand_context_lookup",
	riskPolicyLookup: "risk_policy_lookup",
} as const;

/** Tools the Architect Agent may call (per the integration contract). */
export const ARCHITECT_MCP_TOOLS = [
	MCP_TOOL_NAMES.archPatternLookup,
	MCP_TOOL_NAMES.toolSelectionLookup,
	MCP_TOOL_NAMES.brandContextLookup,
] as const;

/** Tools the Risk Checker Agent may call. */
export const RISK_CHECKER_MCP_TOOLS = [MCP_TOOL_NAMES.riskPolicyLookup] as const;

/** Generous per-request timeout: the Fly.io deployment scales to zero when idle. */
const MCP_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Creates a connection to the agentflow-mcp server, filtered to
 * `allowedToolNames` so each agent only sees the tools it is contracted to call.
 *
 * The caller owns the lifecycle: `await server.connect()` before the run,
 * `await server.close()` when done (the Agents SDK requires this).
 */
export function createAgentflowMcpServer(
	allowedToolNames: readonly string[],
): MCPServer {
	const url = env.AGENTFLOW_MCP_URL;
	if (!url) {
		throw new Error(
			"AGENTFLOW_MCP_URL is not set. Add it to .env (see .env.example).",
		);
	}

	return new MCPServerStreamableHttp({
		url,
		name: "agentflow-mcp",
		cacheToolsList: true,
		timeout: MCP_REQUEST_TIMEOUT_MS,
		toolFilter: createMCPToolStaticFilter({
			allowed: [...allowedToolNames],
		}),
	});
}
