import { Langfuse } from "langfuse";
import { env } from "$env/dynamic/private";
import type { PocPlan } from "$lib/agents/types";
import type { HitlDecisionType, JsonDiffEntry } from "./hitl";

export interface HitlDecisionLogInput {
	runId: string;
	decision: HitlDecisionType;
	humanLatencyMs: number;
	originalPlan: PocPlan;
	finalPlan: PocPlan;
	diff: JsonDiffEntry[];
}

function createLangfuseClient(): Langfuse {
	if (!(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY)) {
		throw new Error(
			"LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required to log HITL decisions.",
		);
	}

	return new Langfuse({
		publicKey: env.LANGFUSE_PUBLIC_KEY,
		secretKey: env.LANGFUSE_SECRET_KEY,
		baseUrl: env.LANGFUSE_BASE_URL,
		flushAt: 1,
	});
}

export async function logHitlDecision({
	runId,
	decision,
	humanLatencyMs,
	originalPlan,
	finalPlan,
	diff,
}: HitlDecisionLogInput): Promise<void> {
	const client = createLangfuseClient();
	const trace = client.trace({
		name: "agentflow.hitl_decision",
		sessionId: runId,
		input: { originalPlan },
		output: { finalPlan },
		metadata: {
			runId,
			decision,
			humanLatencyMs,
			diff,
		},
		tags: ["agentflow", "hitl", decision],
	});

	trace.event({
		name: "hitl_gate_decision",
		input: { originalPlan },
		output: { finalPlan },
		metadata: {
			decision,
			humanLatencyMs,
			diff,
		},
	});
	trace.score({
		name: "human_latency_ms",
		value: humanLatencyMs,
	});

	await client.flushAsync();
}
