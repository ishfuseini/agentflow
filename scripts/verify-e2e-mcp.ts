/**
 * Task 3.8 verification: healthcare scenario via the live /api/run endpoint.
 *
 * This script is intentionally test-only: it monkey-patches the MCP Client's
 * `connect()` to pass `prior: { kind: 'legacy' }` so the OpenAI Agents SDK's
 * hardcoded `versionNegotiation: { mode: 'auto' }` skipped its server/discover
 * probe — which agentflow-mcp (a stateless server) doesn't implement. It only
 * patches the in-process Module cache; it does not modify production code.
 *
 * Usage:
 *   1. `npm run dev` in another terminal (the script targets localhost:5173)
 *   2. `node --env-file=.env --experimental-strip-types scripts/verify-e2e-mcp.ts`
 */
import { getScenario } from "../src/lib/pipeline/scenarios.ts";

const APP_URL = process.env.AGENTFLOW_APP_URL ?? "http://localhost:5173";

// --- Step 1: monkey-patch MCP Client.connect to force legacy negotiation ----
// OpenAI Agents SDK hardcodes { mode: 'auto' }; the stateless agentflow-mcp
// server returns 500 to the server/discover probe. `prior: { kind: 'legacy' }`
// bypasses the probe and runs the plain legacy `initialize` handshake,
// byte-identical to `mode: 'legacy'`.
async function installLegacyMcpPatch(): Promise<void> {
	const clientModule = await import("@modelcontextprotocol/client");
	const { Client } = clientModule as {
		Client: {
			prototype: {
				connect: (
					transport: unknown,
					options?: Record<string, unknown>,
				) => Promise<unknown>;
			};
		};
	};
	const originalConnect = Client.prototype.connect;
	Client.prototype.connect = function patchedConnect(
		transport: unknown,
		options?: Record<string, unknown>,
	) {
		const nextOptions = { ...options, prior: { kind: "legacy" } };
		return originalConnect.call(this, transport, nextOptions);
	};
	console.log(
		"[patch] MCP Client.connect defaulted to prior: { kind: 'legacy' }",
	);
}

await installLegacyMcpPatch();

const scenario = getScenario("healthcare");
console.log("=== Task 3.8: Healthcare scenario via /api/run ===");
console.log(`App:    ${APP_URL}`);
console.log(`Prompt: ${scenario.prompt}`);
console.log(`Domain: ${scenario.domain}\n`);

const response = await fetch(`${APP_URL}/api/run`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		prompt: scenario.prompt,
		routingMode: "cost",
		domain: scenario.domain,
	}),
});

if (!response.ok) {
	const text = await response.text();
	console.error(`✗ /api/run returned ${response.status}: ${text}`);
	process.exit(1);
}

const result = (await response.json()) as {
	toolCalls?: Array<{
		agent: string;
		tool: string;
		arguments: unknown;
		result: unknown;
	}>;
	qualifier?: Record<string, unknown>;
	architect?: Record<string, unknown>;
	riskChecker?: Record<string, unknown>;
	error?: string;
};

if (result.error) {
	console.error(`✗ pipeline error: ${result.error}`);
	process.exit(1);
}

console.log("--- Pipeline result ---");
console.log(
	`Qualifier keys:    ${Object.keys(result.qualifier ?? {})
		.sort()
		.join(", ")}`,
);
console.log(
	`Architect keys:    ${Object.keys(result.architect ?? {})
		.sort()
		.join(", ")}`,
);
console.log(
	`Risk Checker keys: ${Object.keys(result.riskChecker ?? {})
		.sort()
		.join(", ")}`,
);
console.log(`Tool calls:        ${result.toolCalls?.length ?? 0}\n`);

// --- Assertions --------------------------------------------------------------
const failures: string[] = [];
function expect(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
	} else {
		console.error(`  ✗ ${message}`);
		failures.push(message);
	}
}

const calls = result.toolCalls ?? [];
const byTool = (name: string) => calls.find((c) => c.tool === name);

console.log("1) Tool call presence and ownership");
expect(
	byTool("arch_pattern_lookup")?.agent === "architect",
	"arch_pattern_lookup fired by Architect",
);
expect(
	byTool("tool_selection_lookup")?.agent === "architect",
	"tool_selection_lookup fired by Architect",
);
expect(
	byTool("brand_context_lookup")?.agent === "architect",
	"brand_context_lookup fired by Architect",
);
expect(
	byTool("risk_policy_lookup")?.agent === "riskChecker",
	"risk_policy_lookup fired by Risk Checker",
);
expect(calls.length === 4, `exactly 4 tool calls (got ${calls.length})`);

console.log("\n2) Argument contracts");
const ap = (byTool("arch_pattern_lookup")?.arguments ?? {}) as Record<
	string,
	unknown
>;
expect(
	typeof ap.industry === "string",
	"arch_pattern_lookup.industry is string",
);
expect(Array.isArray(ap.data_stack), "arch_pattern_lookup.data_stack is array");
expect(
	Array.isArray(ap.constraints),
	"arch_pattern_lookup.constraints is array",
);

const ts = (byTool("tool_selection_lookup")?.arguments ?? {}) as Record<
	string,
	unknown
>;
expect(
	typeof ts.use_case === "string",
	"tool_selection_lookup.use_case is string",
);

const bc = (byTool("brand_context_lookup")?.arguments ?? {}) as Record<
	string,
	unknown
>;
expect(
	bc.domain === scenario.domain,
	`brand_context_lookup.domain === "${scenario.domain}" (got ${JSON.stringify(bc.domain)})`,
);

const rp = (byTool("risk_policy_lookup")?.arguments ?? {}) as Record<
	string,
	unknown
>;
expect(
	typeof rp.industry === "string",
	"risk_policy_lookup.industry is string",
);
expect(
	Array.isArray(rp.data_classification),
	"risk_policy_lookup.data_classification is array",
);
expect(typeof rp.region === "string", "risk_policy_lookup.region is string");

console.log("\n3) Result contracts");
const apR = (byTool("arch_pattern_lookup")?.result ?? {}) as Record<
	string,
	unknown
>;
expect(
	typeof apR.pattern_id === "string",
	"arch_pattern_lookup returned pattern_id",
);
expect(
	typeof apR.confidence === "number",
	"arch_pattern_lookup returned confidence",
);

const bcR = (byTool("brand_context_lookup")?.result ?? {}) as Record<
	string,
	unknown
>;
expect(
	typeof bcR.company_name === "string",
	"brand_context_lookup returned company_name",
);

const rpR = (byTool("risk_policy_lookup")?.result ?? {}) as Record<
	string,
	unknown
>;
expect(
	Array.isArray(rpR.required_controls),
	"risk_policy_lookup returned required_controls[]",
);
expect(
	typeof rpR.hitl_required === "boolean",
	"risk_policy_lookup returned hitl_required",
);
expect(rpR.hitl_required === true, "Healthcare → hitl_required=true (PHI)");

console.log("\n4) Data flow between agents");
expect(
	JSON.stringify(result.qualifier).toLowerCase().includes("hipaa") ||
		JSON.stringify(result.qualifier).toLowerCase().includes("phi"),
	"Qualifier extracted HIPAA/PHI",
);
expect(
	JSON.stringify(ap).toLowerCase().includes("hipaa") ||
		JSON.stringify(ap).toLowerCase().includes("phi"),
	"Architect's arch_pattern_lookup args include HIPAA/PHI",
);
const archPatternMatch = result.architect?.pattern_match as
	| Record<string, unknown>
	| undefined;
expect(
	archPatternMatch?.confidence === apR.confidence,
	`Architect.pattern_match.confidence (${archPatternMatch?.confidence}) matches tool result (${apR.confidence})`,
);

console.log("\n=== Summary ===");
if (failures.length === 0) {
	console.log(
		"✓ All 4 MCP tools fired with correct data flowing between agents",
	);
	console.log("\n architect.pattern_match:", JSON.stringify(archPatternMatch));
	console.log(
		" risk_checker.overall:",
		(result.riskChecker as { overall_score?: number } | undefined)
			?.overall_score,
	);
	process.exit(0);
} else {
	console.error(`✗ ${failures.length} assertion(s) failed`);
	for (const f of failures) {
		console.error(`  - ${f}`);
	}
	process.exit(1);
}
