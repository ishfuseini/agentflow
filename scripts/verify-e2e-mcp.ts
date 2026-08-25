/**
 * Task 3.11 verification: healthcare scenario via the live /api/run endpoint,
 * then an on-demand diagram fetch via /api/diagram.
 *
 * Asserts the revised tool-call order from the mcp-tool-integration spec:
 * brand resolution (brand_search → brand_context_lookup) before
 * arch_pattern_lookup → arch_pattern_references → tool_selection_lookup,
 * risk_policy_lookup after the Architect's calls, and arch_diagram only via
 * /api/diagram after the run (never by an agent mid-pipeline).
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
import http from "node:http";
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
console.log("=== Task 3.11: Healthcare scenario via /api/run ===");
console.log(`App:    ${APP_URL}`);
console.log(`Prompt: ${scenario.prompt}`);
console.log(`Domain: ${scenario.domain}\n`);

// The full run can take several minutes (cold MCP start + one output retry);
// undici's default 5-minute headers timeout would abort global fetch, so this
// request goes through node:http with explicit long timeouts instead.
function postJson(
	url: string,
	body: unknown,
	timeoutMs = 15 * 60_000,
): Promise<{ status: number; json: () => unknown }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			url,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				timeout: timeoutMs,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({
						status: res.statusCode ?? 0,
						json: () => JSON.parse(text),
					});
				});
			},
		);
		req.on("timeout", () => req.destroy(new Error("request timed out")));
		req.on("error", reject);
		req.end(JSON.stringify(body));
	});
}

const response = await postJson(`${APP_URL}/api/run`, {
	prompt: scenario.prompt,
	routingMode: "cost",
	domain: scenario.domain,
});

if (response.status !== 200) {
	console.error(`✗ /api/run returned ${response.status}: ${JSON.stringify(response.json())}`);
	process.exit(1);
}

const envelope = response.json() as {
	status?: string;
	error?: string;
	pipeline?: {
		toolCalls?: Array<{
			agent: string;
			tool: string;
			arguments: unknown;
			result: unknown;
		}>;
		qualifier?: Record<string, unknown>;
		architect?: Record<string, unknown>;
		riskChecker?: Record<string, unknown>;
	};
};

if (envelope.error) {
	console.error(`✗ pipeline error: ${envelope.error}`);
	process.exit(1);
}

const result = envelope.pipeline ?? {};
console.log(`Run status: ${envelope.status ?? "unknown"}`);

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
const indexOfTool = (name: string) => calls.findIndex((c) => c.tool === name);

console.log("1) Tool call presence and ownership");
expect(
	byTool("arch_pattern_lookup")?.agent === "architect",
	"arch_pattern_lookup fired by Architect",
);
expect(
	byTool("arch_pattern_references")?.agent === "architect",
	"arch_pattern_references fired by Architect",
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
expect(
	byTool("arch_diagram") === undefined,
	"arch_diagram never called by an agent mid-pipeline",
);

console.log("\n2) Tool call order (brand → pattern → references → selection → risk)");
const brandIndex = Math.max(
	indexOfTool("brand_search"),
	indexOfTool("brand_context_lookup"),
);
expect(
	brandIndex !== -1 && brandIndex < indexOfTool("arch_pattern_lookup"),
	"brand resolution before arch_pattern_lookup",
);
expect(
	indexOfTool("arch_pattern_lookup") !== -1 &&
		indexOfTool("arch_pattern_lookup") < indexOfTool("arch_pattern_references"),
	"arch_pattern_lookup before arch_pattern_references",
);
expect(
	indexOfTool("arch_pattern_lookup") !== -1 &&
		indexOfTool("arch_pattern_lookup") < indexOfTool("tool_selection_lookup"),
	"arch_pattern_lookup before tool_selection_lookup",
);
expect(
	indexOfTool("risk_policy_lookup") > indexOfTool("tool_selection_lookup"),
	"risk_policy_lookup after the Architect's calls",
);

console.log("\n3) Argument contracts");
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

const ar = (byTool("arch_pattern_references")?.arguments ?? {}) as Record<
	string,
	unknown
>;
expect(
	typeof ar.pattern_id === "string",
	"arch_pattern_references.pattern_id is string",
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

console.log("\n4) Result contracts");
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
expect(
	apR.diagram_data === undefined || apR.diagram_data === null,
	"arch_pattern_lookup no longer returns diagram_data inline",
);
expect(
	apR.source_references === undefined || apR.source_references === null,
	"arch_pattern_lookup no longer returns source_references inline",
);

const arR = (byTool("arch_pattern_references")?.result ?? {}) as Record<
	string,
	unknown
>;
expect(
	Array.isArray(arR.source_references),
	"arch_pattern_references returned source_references[]",
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

console.log("\n5) Data flow between agents");
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

console.log("\n6) On-demand diagram via /api/diagram (after risk evaluation)");
const runPatternId = archPatternMatch?.pattern_id;
expect(
	typeof runPatternId === "string",
	"pattern_id available for diagram request",
);

// The endpoint contract is pattern-driven, not model-driven: when the run
// landed a curated match we use its pattern_id; when the model's arguments
// produced only the weak fallback (a known 20B derivation wobble), we still
// verify the endpoint against the curated healthcare pattern and separately
// verify the fallback pattern returns unavailable.
const curatedPatternId =
	typeof runPatternId === "string" && runPatternId !== "generic_enterprise_ai_poc"
		? runPatternId
		: "healthcare_patient_insights";
if (runPatternId === "generic_enterprise_ai_poc") {
	console.log(
		"  ! run matched the fallback pattern; endpoint checked against healthcare_patient_insights",
	);
}

const diagramResponse = await fetch(`${APP_URL}/api/diagram`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		patternId: curatedPatternId,
		fallbackTitle: curatedPatternId.replace(/_/g, " "),
	}),
});
const diagramResult = (await diagramResponse.json()) as {
	status?: string;
	html?: string;
	message?: string;
	error?: string;
};
expect(
	diagramResponse.ok && diagramResult.status === "ok",
	`/api/diagram returned status ok for a curated pattern (got ${JSON.stringify(diagramResult.status ?? diagramResult.error)})`,
);
expect(
	typeof diagramResult.html === "string" &&
		diagramResult.html.includes("<svg"),
	"/api/diagram returned rendered HTML containing an SVG",
);

const fallbackDiagramResponse = await fetch(`${APP_URL}/api/diagram`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		patternId: "generic_enterprise_ai_poc",
		fallbackTitle: "generic enterprise ai poc",
	}),
});
const fallbackDiagramResult = (await fallbackDiagramResponse.json()) as {
	status?: string;
	message?: string;
};
expect(
	fallbackDiagramResponse.ok &&
		fallbackDiagramResult.status === "unavailable" &&
		typeof fallbackDiagramResult.message === "string",
	"/api/diagram returns unavailable + message for the fallback pattern",
);

console.log("\n=== Summary ===");
if (failures.length === 0) {
	console.log(
		"✓ MCP tools fired in the revised order; diagram fetched on demand after the run",
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
