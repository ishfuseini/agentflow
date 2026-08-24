/**
 * Task 4.x verification: HITL pause/resume through the live API.
 *
 * Usage:
 *   1. `npm run dev` in another terminal
 *   2. `node --env-file=.env --experimental-strip-types scripts/verify-hitl-gate.ts`
 */
import { getScenario } from "../src/lib/pipeline/scenarios.ts";

const APP_URL = process.env.AGENTFLOW_APP_URL ?? "http://localhost:5173";
const ALLOWED_PATHS = new Set([
	"/api/run",
	"/api/hitl/approve",
	"/api/hitl/edit",
]);

interface RunPausedResponse {
	status: "paused";
	runId: string;
	gate: {
		proposedPlan: {
			scope: string;
			timeline: string;
			data_zones: string[];
			integrations: string[];
			resource_estimate: string;
		};
		highSeverityRisks: Array<{ severity: string; issue: string }>;
		review_reason?: string;
		riskPolicy: {
			hitl_required?: boolean;
			review_reason?: string;
		} | null;
	};
}

interface HitlCompletedResponse {
	status: "completed";
	runId: string;
	decision: "approved" | "edited";
	humanLatencyMs: number;
	diff: Array<{ path: string; before: unknown; after: unknown }>;
	finalOutput: {
		pocPlan: RunPausedResponse["gate"]["proposedPlan"];
	};
}

const failures: string[] = [];

function expect(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
	} else {
		console.error(`  ✗ ${message}`);
		failures.push(message);
	}
}

async function postJson<T>(
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	if (!ALLOWED_PATHS.has(path)) {
		throw new Error(`Unauthorized test path: ${path}`);
	}

	const response = await fetch(`${APP_URL}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}

	if (!response.ok) {
		throw new Error(`${path} returned ${response.status}: ${text}`);
	}
	return parsed as T;
}

async function runScenario(
	scenarioId: "healthcare" | "fsi-governance",
): Promise<RunPausedResponse> {
	const scenario = getScenario(scenarioId);
	const result = await postJson<RunPausedResponse>("/api/run", {
		prompt: scenario.prompt,
		routingMode: "cost",
		domain: scenario.domain,
	});

	expect(result.status === "paused", `${scenario.name} returns paused status`);
	expect(typeof result.runId === "string", `${scenario.name} returns runId`);
	expect(
		result.gate.riskPolicy?.hitl_required === true,
		`${scenario.name} risk_policy_lookup returned hitl_required=true`,
	);
	expect(
		typeof result.gate.review_reason === "string" &&
			result.gate.review_reason.length > 0,
		`${scenario.name} gate includes review_reason`,
	);
	expect(
		result.gate.highSeverityRisks.length > 0,
		`${scenario.name} gate displays high-severity risks`,
	);
	expect(
		typeof result.gate.proposedPlan.scope === "string" &&
			result.gate.proposedPlan.scope.length > 0,
		`${scenario.name} gate includes proposed POC plan`,
	);

	return result;
}

console.log(`App: ${APP_URL}\n`);

console.log("4.1 / 4.2 / 4.6 — Healthcare pauses at HITL");
const healthcare = await runScenario("healthcare");

console.log("\n4.3 / 4.5 — approve resumes with unchanged plan");
const approved = await postJson<HitlCompletedResponse>("/api/hitl/approve", {
	runId: healthcare.runId,
});
expect(approved.status === "completed", "approve returns completed status");
expect(approved.decision === "approved", "approve logs approved decision");
expect(approved.humanLatencyMs >= 0, "approve captures human latency");
expect(approved.diff.length === 0, "approve has no diff");
expect(
	JSON.stringify(approved.finalOutput.pocPlan) ===
		JSON.stringify(healthcare.gate.proposedPlan),
	"approve uses the agent-produced plan unchanged",
);

console.log("\n4.1 / 4.2 / 4.6 — FSI Governance pauses at HITL");
const fsi = await runScenario("fsi-governance");

console.log("\n4.4 / 4.5 — edit resumes with modified plan and diff");
const editedPlan = {
	...fsi.gate.proposedPlan,
	scope: `${fsi.gate.proposedPlan.scope} Human reviewer added audit-log validation before signoff.`,
};
const edited = await postJson<HitlCompletedResponse>("/api/hitl/edit", {
	runId: fsi.runId,
	pocPlan: editedPlan,
});
expect(edited.status === "completed", "edit returns completed status");
expect(edited.decision === "edited", "edit logs edited decision");
expect(edited.humanLatencyMs >= 0, "edit captures human latency");
expect(
	edited.diff.some((entry) => entry.path === "scope"),
	"edit includes diff",
);
expect(
	edited.finalOutput.pocPlan.scope === editedPlan.scope,
	"edit uses the modified plan as final output",
);

console.log("\n=== Summary ===");
if (failures.length === 0) {
	console.log("✓ HITL gate verification passed");
	process.exit(0);
}

console.error(`✗ ${failures.length} assertion(s) failed`);
for (const failure of failures) {
	console.error(`  - ${failure}`);
}
process.exit(1);
