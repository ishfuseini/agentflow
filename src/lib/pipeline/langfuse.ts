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

let langfuseClient: Langfuse | undefined;

function getLangfuseClient(): Langfuse | null {
	if (langfuseClient) {
		return langfuseClient;
	}

	if (!(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY)) {
		return null;
	}

	langfuseClient = new Langfuse({
		publicKey: env.LANGFUSE_PUBLIC_KEY,
		secretKey: env.LANGFUSE_SECRET_KEY,
		baseUrl: env.LANGFUSE_BASE_URL,
		flushAt: 1,
	});
	return langfuseClient;
}

export async function logHitlDecision({
	runId,
	decision,
	humanLatencyMs,
	originalPlan,
	finalPlan,
	diff,
}: HitlDecisionLogInput): Promise<boolean> {
	const client = getLangfuseClient();
	if (!client) {
		return false;
	}

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

	try {
		await client.flushAsync();
		return true;
	} catch {
		return false;
	}
}
